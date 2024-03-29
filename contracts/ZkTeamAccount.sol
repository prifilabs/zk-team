// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.12;

/* solhint-disable avoid-low-level-calls */
/* solhint-disable no-inline-assembly */
/* solhint-disable reason-string */

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";

import "@account-abstraction/contracts/core/BaseAccount.sol";
import "@account-abstraction/contracts/samples/callback/TokenCallbackHandler.sol";

import "./MerkleTree.sol";

import "./ZkTeamVerifier.sol";
import "poseidon-solidity/PoseidonT2.sol";

// import "hardhat/console.sol";

struct CommitmentHashInfo {
    uint256 commitmentHash;
    uint256[] treeSiblings;
    uint8[] treePathIndices;
}

/**
  * minimal account.
  *  this is sample minimal account.
  *  has execute, eth handling methods
  *  has a single signer that can send requests through the entryPoint.
  */
contract ZkTeamAccount is BaseAccount, TokenCallbackHandler, UUPSUpgradeable, Initializable {
    using ECDSA for bytes32;

    address public owner;
    
    using MerkleTree for MerkleTreeData;
    MerkleTreeData public tree;
    
    mapping(uint256 => bytes32) public nullifierHashes;

    IEntryPoint private immutable _entryPoint;
    Groth16Verifier private immutable _verifier;
    uint256 private immutable _depth = 20;
    uint256 private immutable _rootHistorySize = 5;

    event ZkTeamDiscard(uint256 commitmentHash);
    event ZkTeamExecution(uint256 nullifierHash, uint256 commitmentHash, uint256 value, bytes32 encryptedAllowance, address dest);
    event ZkTeamInit(IEntryPoint indexed entryPoint, address indexed owner);


    /// @inheritdoc BaseAccount
    function entryPoint() public view virtual override returns (IEntryPoint) {
        return _entryPoint;
    }


    // solhint-disable-next-line no-empty-blocks
    receive() external payable {}

    constructor(IEntryPoint anEntryPoint, Groth16Verifier aVerifier) {
        _entryPoint = anEntryPoint;
        _verifier = aVerifier;
        _disableInitializers();
    }

    /**
     * @dev The _entryPoint member is immutable, to reduce gas consumption.  To upgrade EntryPoint,
     * a new implementation of ZkTeamAccount must be deployed with the new EntryPoint address, then upgrading
      * the implementation by calling `upgradeTo()`
     */
    function initialize(address anOwner) public virtual initializer {
        owner = anOwner;
        tree.init(_depth, _rootHistorySize);
        emit ZkTeamInit(_entryPoint, owner);
    }
    
    /// implement template method of BaseAccount
    function _validateSignature(UserOperation calldata userOp, bytes32 userOpHash)
    internal override virtual returns (uint256 validationData) {        
        if (userOp.signature.length == 65){
            bytes32 hash = userOpHash.toEthSignedMessageHash();
            if (owner != hash.recover(userOp.signature))
                return SIG_VALIDATION_FAILED;
            return 0;
        } else {
            ( uint256[2] memory pi_a, uint256[2][2] memory pi_b, uint256[2] memory pi_c, uint256[6] memory signals ) = abi.decode(userOp.signature, (uint256[2], uint256[2][2], uint256[2], uint256[6]));
            ( uint256 nullifierHash, uint256 commitmentHash, uint256 value ) = abi.decode(userOp.callData[4:100], (uint256, uint256, uint256));
            // check value matches calldata
            if (value != signals[4]) return SIG_VALIDATION_FAILED;
            // check commitmentHash matches the callData
            if (commitmentHash != signals[2]) return SIG_VALIDATION_FAILED;
            // check nullifierHash matches the callData
            if (nullifierHash != signals[0]) return SIG_VALIDATION_FAILED;
            // check nullifierHash has not been used already
            if (nullifierHashes[nullifierHash] != bytes32(0))  return SIG_VALIDATION_FAILED;
            // check oldRoot
            if (!tree.isKnownRoot(signals[1])) return SIG_VALIDATION_FAILED;
            // check newRoot
            if (signals[3] != tree.simulatedInsert(commitmentHash)) return SIG_VALIDATION_FAILED;
            // check callData hash matches the hash of calldata
            uint hash = PoseidonT2.hash([uint(keccak256(userOp.callData))]);
            if (hash != signals[5])  return SIG_VALIDATION_FAILED;
            // check the proof
            (bool valid, ) = address(_verifier).staticcall(abi.encodeWithSelector(Groth16Verifier.verifyProof.selector, pi_a, pi_b, pi_c, signals));
            if (!valid) return SIG_VALIDATION_FAILED;
            // finally
            return 0;
        }
    }
    
    function _onlyOwner() internal view {
         // directly from EOA owner, or through the account itself (which gets redirected through execute())
         require(msg.sender == owner || msg.sender == address(this), "only owner");
     }
    
     // Require the function call went through EntryPoint or owner
     function _onlyEntryPointOrOwner() internal view {
         require(msg.sender == address(entryPoint()) || msg.sender == owner, "account: not Owner or EntryPoint");
     }

    /**
     * execute a transaction (called directly from owner, or by entryPoint)
     */
    function execute(uint256 nullifierHash, uint256 commitmentHash, uint256 value, bytes32 encryptedAllowance, address dest, bytes calldata data) external {
        _onlyEntryPointOrOwner();
        nullifierHashes[nullifierHash] = encryptedAllowance;
        tree.insert(commitmentHash);
        emit ZkTeamExecution(nullifierHash, commitmentHash, value, encryptedAllowance, dest);
        (bool success, bytes memory result) = dest.call{value : value}(data);
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }
    
    function discardCommitmentHashes(CommitmentHashInfo[] calldata commitmentHashList) public{
         _onlyOwner();
        for (uint i=0; i<commitmentHashList.length; i++) {
            tree.update(commitmentHashList[i].commitmentHash, 0, commitmentHashList[i].treeSiblings, commitmentHashList[i].treePathIndices);
            emit ZkTeamDiscard(commitmentHashList[i].commitmentHash);
        }
    }
    
    function withdraw(address payable withdrawAddress, uint256 amount) public {
        _onlyOwner();
        (bool success, ) = withdrawAddress.call{value: amount}("");
        require(success, "Transfer failed");
    }

    /**
     * check current account deposit in the entryPoint
     */
    function getDeposit() public view returns (uint256) {
        return entryPoint().balanceOf(address(this));
    }

    /**
     * deposit more funds for this account in the entryPoint
     */
    function addDeposit() public payable {
        entryPoint().depositTo{value : msg.value}(address(this));
    }

    /**
     * withdraw value from the account's deposit
     * @param withdrawAddress target to send to
     * @param amount to withdraw
     */
    function withdrawDepositTo(address payable withdrawAddress, uint256 amount) public {
        _onlyOwner();
        entryPoint().withdrawTo(withdrawAddress, amount);
    }

    function _authorizeUpgrade(address newImplementation) internal view override {
        (newImplementation);
        _onlyOwner();
    }
}


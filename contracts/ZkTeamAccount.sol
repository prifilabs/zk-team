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

import "hardhat/console.sol";
import "@zk-kit/incremental-merkle-tree.sol/IncrementalBinaryTree.sol";

import "./ZkTeamVerifier.sol";
import "poseidon-solidity/PoseidonT2.sol";

/**
  * minimal account.
  *  this is sample minimal account.
  *  has execute, eth handling methods
  *  has a single signer that can send requests through the entryPoint.
  */
contract ZkTeamAccount is BaseAccount, TokenCallbackHandler, UUPSUpgradeable, Initializable {
    using ECDSA for bytes32;

    address public owner;
    
    using IncrementalBinaryTree for IncrementalTreeData;
    IncrementalTreeData public tree;
    
    mapping(uint256 => bytes32) public nullifierHashes;

    IEntryPoint private immutable _entryPoint;
    Groth16Verifier private immutable _verifier;
    uint256 private immutable _depth = 20;

    event ZkTeamExecution(uint256 nullifierHash, uint256 commitmentHash);
    event ZkTeamAccountInitialized(IEntryPoint indexed entryPoint, address indexed owner);


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
        tree.init(_depth, 0);
        tree.insert(42); // Bug: I have no clue why it does not work without this first insert
        emit ZkTeamAccountInitialized(_entryPoint, owner);
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
            ( uint256 nullifierHash, uint256 commitmentHash, uint256 root, uint256 value ) = abi.decode(userOp.callData[4:132], (uint256, uint256, uint256, uint256));
            // check value matches calldata
            if (value != signals[4]) return SIG_VALIDATION_FAILED;
            // check commitmentHash matches the callData
            if (commitmentHash != signals[2]) return SIG_VALIDATION_FAILED;
            // check nullifierHash matches the callData
            if (nullifierHash != signals[0]) return SIG_VALIDATION_FAILED;
            // check nullifierHash has not been used already
            if (nullifierHashes[nullifierHash] != bytes32(0))  return SIG_VALIDATION_FAILED;
            // check oldRoot 
            if (tree.root != signals[1])  return SIG_VALIDATION_FAILED;
            // check newRoot matches the callData
            if (root != signals[3])  return SIG_VALIDATION_FAILED;
            // check callData hash matches the hash of calldata
            uint hash = PoseidonT2.hash([uint(keccak256(userOp.callData))]);
            if (hash != signals[5])  return SIG_VALIDATION_FAILED;
            // check the proof
            bool res = _verifier.verifyProof(pi_a, pi_b, pi_c, signals);
            if (!res) return SIG_VALIDATION_FAILED;
            // finally
            return 0;
        }
    }
    
    function _onlyOwner() internal view {
         //directly from EOA owner, or through the account itself (which gets redirected through execute())
         require(msg.sender == owner || msg.sender == address(this), "only owner");
     }
    
     // Require the function call went through EntryPoint or owner
     function _onlyEntryPointOrOwner() internal view {
         require(msg.sender == address(entryPoint()) || msg.sender == owner, "account: not Owner or EntryPoint");
     }

    /**
     * execute a transaction (called directly from owner, or by entryPoint)
     */
    function execute(uint256 nullifierHash, uint256 commitmentHash, uint256 root, uint256 value, bytes32 encryptedAllowance, address dest, bytes calldata data) external {
        _onlyEntryPointOrOwner();
        nullifierHashes[nullifierHash] = encryptedAllowance;
        tree.insert(commitmentHash);
        emit ZkTeamExecution(nullifierHash, commitmentHash);
        require(root == tree.root);
        (bool success, bytes memory result) = dest.call{value : value}(data);
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
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


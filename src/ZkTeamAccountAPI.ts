import { resolve } from "path";

import { Provider } from '@ethersproject/providers'
import { BigNumber, BigNumberish, Contract } from 'ethers'
import { arrayify, hexConcat } from 'ethers/lib/utils'
import { Signer } from '@ethersproject/abstract-signer'

import {
  EntryPoint, EntryPoint__factory,
  UserOperationStruct
} from '@account-abstraction/contracts'

import { BaseApiParams, TransactionDetailsForUserOp, calcPreVerificationGas, GasOverheads } from '@account-abstraction/sdk'
import { resolveProperties } from 'ethers/lib/utils'
import { PaymasterAPI } from './PaymasterAPI'
import { getUserOpHash, NotPromise, packUserOp } from '@account-abstraction/utils'

import * as ZkTeamAccountFactory from '../artifacts/contracts/ZkTeamAccountFactory.sol/ZkTeamAccountFactory.json';
import * as ZkTeamAccount from '../artifacts/contracts/ZkTeamAccount.sol/ZkTeamAccount.json';

import { groth16 } from "snarkjs";
import { wasm as wasm_tester} from "circom_tester";
import { IncrementalMerkleTree } from "@zk-kit/incremental-merkle-tree"
import { poseidon1, poseidon2, poseidon3 } from "poseidon-lite"

/**
 * constructor params, added no top of base params:
 * @param owner the signer object for the account owner
 * @param factoryAddress address of contract "factory" to deploy new contracts (not needed if account already deployed)
 * @param index nonce value used when creating multiple accounts for the same owner
 */
export interface ZkTeamAccountApiParams extends BaseApiParams {
  owner: Signer
  factoryAddress?: string
  index?: BigNumberish
}

/**
 * An implementation of the BaseAccountAPI using the ZkTeamAccount contract.
 * - contract deployer gets "entrypoint", "owner" addresses and "index" nonce
 * - owner signs requests using normal "Ethereum Signed Message" (ether's signer.signMessage())
 * - nonce method is "nonce()"
 * - execute method is "execFromEntryPoint()"
 */
export class ZkTeamAccountAPI {
  
    private senderAddress!: string
    private isPhantom = true
    // entryPoint connected to "zero" address. allowed to make static calls (e.g. to getSenderAddress)
    private readonly entryPointView: EntryPoint
    provider: Provider
    overheads?: Partial<GasOverheads>
    entryPointAddress: string
    accountAddress?: string
    paymasterAPI?: PaymasterAPI
    factoryAddress?: string
    owner: Signer
    index: BigNumberish
    accountContract?: ZkTeamAccount
    factory?: ZkTeamAccountFactory

  constructor (params: ZkTeamAccountApiParams) {
    this.overheads = params.overheads
    this.entryPointAddress = params.entryPointAddress
    this.accountAddress = params.accountAddress
    this.paymasterAPI = params.paymasterAPI
    this.entryPointView = EntryPoint__factory.connect(params.entryPointAddress, params.provider).connect(ethers.constants.AddressZero)
    this.factoryAddress = params.factoryAddress
    this.owner = params.owner
    this.index = BigNumber.from(params.index ?? 0)
    this.provider = params.provider
  }

  async init (): Promise<this> {
    if (await this.provider.getCode(this.entryPointAddress) === '0x') {
      throw new Error(`entryPoint not deployed at ${this.entryPointAddress}`)
    }

    await this.getAccountAddress()
    return this
  }

  async _getAccountContract (): Promise<ethers.contract> {
    if (this.accountContract == null) {
       this.accountContract = new Contract(await this.getAccountAddress(), ZkTeamAccount.abi, this.provider);
    }
    return this.accountContract
  }
  
  /**
   * check if the contract is already deployed.
   */
  async checkAccountPhantom (): Promise<boolean> {
    if (!this.isPhantom) {
      // already deployed. no need to check anymore.
      return this.isPhantom
    }
    const senderAddressCode = await this.provider.getCode(this.getAccountAddress())
    if (senderAddressCode.length > 2) {
      // console.log(`SimpleAccount Contract already deployed at ${this.senderAddress}`)
      this.isPhantom = false
    } else {
      // console.log(`SimpleAccount Contract is NOT YET deployed at ${this.senderAddress} - working in "phantom account" mode.`)
    }
    return this.isPhantom
  }
  
  /**
   * calculate the account address even before it is deployed
   */
  async getCounterFactualAddress (): Promise<string> {
    const initCode = this.getAccountInitCode()
    // use entryPoint to query account address (factory can provide a helper method to do the same, but
    // this method attempts to be generic
    try {
      await this.entryPointView.callStatic.getSenderAddress(initCode)
    } catch (e: any) {
      if (e.errorArgs == null) {
        throw e
      }
      return e.errorArgs.sender
    }
    throw new Error('must handle revert')
  }
  
  /**
   * return the account's address.
   * this value is valid even before deploying the contract.
   */
  async getAccountAddress (): Promise<string> {
    if (this.senderAddress == null) {
      if (this.accountAddress != null) {
        this.senderAddress = this.accountAddress
      } else {
        this.senderAddress = await this.getCounterFactualAddress()
      }
    }
    return this.senderAddress
  }

  /**
   * return the value to put into the "initCode" field, if the account is not yet deployed.
   * this value holds the "factory" address, followed by this account's information
   */
  async getAccountInitCode (): Promise<string> {
    if (this.factory == null) {
      if (this.factoryAddress != null && this.factoryAddress !== '') {
        this.factory = new Contract(this.factoryAddress, ZkTeamAccountFactory.abi, this.provider);
      } else {
        throw new Error('no factory to get initCode')
      }
    }
    return hexConcat([
      this.factory.address,
      this.factory.interface.encodeFunctionData('createAccount', [await this.owner.getAddress(), this.index])
    ])
  }
  

  /**
   * return initCode value to into the UserOp.
   * (either deployment code, or empty hex if contract already deployed)
   */
  async getInitCode (): Promise<string> {
    if (await this.checkAccountPhantom()) {
      return await this.getAccountInitCode()
    }
    return '0x'
  }

  async getNonce (): Promise<BigNumber> {
    if (await this.checkAccountPhantom()) {
      return BigNumber.from(0)
    }
    const accountContract = await this._getAccountContract()
    return await accountContract.getNonce()
  }
  
  /**
   * return maximum gas used for verification.
   * NOTE: createUnsignedUserOp will add to this value the cost of creation, if the contract is not yet created.
   */
  async getVerificationGasLimit (): Promise<BigNumberish> {
    return 1000000
  }

  /**
   * should cover cost of putting calldata on-chain, and some overhead.
   * actual overhead depends on the expected bundle size
   */
  async getPreVerificationGas (userOp: Partial<UserOperationStruct>): Promise<number> {
    const p = await resolveProperties(userOp)
    return calcPreVerificationGas(p, this.overheads)
  }

  async estimateCreationGas (initCode?: string): Promise<BigNumberish> {
    if (initCode == null || initCode === '0x') return 0
    const deployerAddress = initCode.substring(0, 42)
    const deployerCallData = '0x' + initCode.substring(42)
    return await this.provider.estimateGas({ to: deployerAddress, data: deployerCallData })
  }
  

  /**
   * ABI-encode a user operation. used for calldata cost estimation
   */
  packUserOp (userOp: NotPromise<UserOperationStruct>): string {
    return packUserOp(userOp, false)
  }

  /**
   * encode a method call from entryPoint to our contract
   * @param target
   * @param value
   * @param data
   */
  async encodeExecute (nullifierHash: BigNumberish, commitmentHash: BigNumberish, root: BigNumberish, value: BigNumberish,  target: string, data: string): Promise<string> {
    const accountContract = await this._getAccountContract()
    return accountContract.interface.encodeFunctionData(
      'execute',
      [
        nullifierHash,
        commitmentHash,
        root,
        value,
        target,
        data
      ])
  }
  
  async encodeUserOpCallDataAndGasLimit (detailsForUserOp: TransactionDetailsForUserOp): Promise<{ callData: string, callGasLimit: BigNumber }> {
    function parseNumber (a: any): BigNumber | null {
      if (a == null || a === '') return null
      return BigNumber.from(a.toString())
    }

    const value = parseNumber(detailsForUserOp.value) ?? BigNumber.from(0)
    const nullifierHash = poseidon1([detailsForUserOp.oldNullifier]); 
    const commitmentHash = poseidon3([detailsForUserOp.newNullifier, detailsForUserOp.newSecret, detailsForUserOp.newBalance]);
    const tree = new IncrementalMerkleTree(poseidon2, 20, BigInt(0), 2, detailsForUserOp.leaves);
    tree.insert(commitmentHash);
    const root = tree.root;
    
    const callData = await this.encodeExecute(nullifierHash, commitmentHash, root, value, detailsForUserOp.target, detailsForUserOp.data)
    const callGasLimit = parseNumber(detailsForUserOp.gasLimit) ?? await this.provider.estimateGas({
      from: this.entryPointAddress,
      to: this.getAccountAddress(),
      data: callData
    })

    return {
      callData,
      callGasLimit
    }
  }

  /**
   * return userOpHash for signing.
   * This value matches entryPoint.getUserOpHash (calculated off-chain, to avoid a view call)
   * @param userOp userOperation, (signature field ignored)
   */
  async getUserOpHash (userOp: UserOperationStruct): Promise<string> {
    const op = await resolveProperties(userOp)
    const chainId = await this.provider.getNetwork().then(net => net.chainId)
    return getUserOpHash(op, this.entryPointAddress, chainId)
  }

  /**
   * create a UserOperation, filling all details (except signature)
   * - if account is not yet created, add initCode to deploy it.
   * - if gas or nonce are missing, read them from the chain (note that we can't fill gaslimit before the account is created)
   * @param info
   */
  async createUnsignedUserOp (info: TransactionDetailsForUserOp): Promise<UserOperationStruct> {
    const {
      callData,
      callGasLimit
    } = await this.encodeUserOpCallDataAndGasLimit(info)
    const initCode = await this.getInitCode()

    const initGas = await this.estimateCreationGas(initCode)
    const verificationGasLimit = BigNumber.from(await this.getVerificationGasLimit())
      .add(initGas)

    let {
      maxFeePerGas,
      maxPriorityFeePerGas
    } = info
    if (maxFeePerGas == null || maxPriorityFeePerGas == null) {
      const feeData = await this.provider.getFeeData()
      if (maxFeePerGas == null) {
        maxFeePerGas = feeData.maxFeePerGas ?? undefined
      }
      if (maxPriorityFeePerGas == null) {
        maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? undefined
      }
    }

    const partialUserOp: any = {
      sender: this.getAccountAddress(),
      nonce: info.nonce ?? this.getNonce(),
      initCode,
      callData,
      callGasLimit,
      verificationGasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
      paymasterAndData: '0x'
    }

    let paymasterAndData: string | undefined
    if (this.paymasterAPI != null) {
      // fill (partial) preVerificationGas (all except the cost of the generated paymasterAndData)
      const userOpForPm = {
        ...partialUserOp,
        preVerificationGas: await this.getPreVerificationGas(partialUserOp)
      }
      paymasterAndData = await this.paymasterAPI.getPaymasterAndData(userOpForPm)
    }
    partialUserOp.paymasterAndData = paymasterAndData ?? '0x'
    return {
      ...partialUserOp,
      preVerificationGas: this.getPreVerificationGas(partialUserOp),
      signature: '',
    }
  }

  /**
     * Sign the filled userOp.
     * @param userOp the UserOperation to sign (with signature field ignored)
     */
    async signUserOp (userOp: UserOperationStruct): Promise<UserOperationStruct> {
      const userOpHash = await this.getUserOpHash(userOp)
      const signature = await this.owner.signMessage(arrayify(userOpHash))
      return {
        ...userOp,
        signature
      }
    }

    /**
     * helper method: create and sign a user operation.
     * @param info transaction details for the userOp
     */
    async createSignedUserOp (info: TransactionDetailsForUserOp): Promise<UserOperationStruct> {
      return await this.signUserOp(await this.createUnsignedUserOp(info))
    }
    
    /**
     * helper method: create and sign a user operation.
     * @param info transaction details for the userOp
     */
    async createProvedUserOp (info: TransactionDetailsForUserOp): Promise<UserOperationStruct> {
         const oldNullifierHash  = poseidon1([info.oldNullifier]);
         const oldTree = new IncrementalMerkleTree(poseidon2, 20, BigInt(0), 2, info.leaves);
         const oldRoot = oldTree.root; 
         const oldCommitmentHash = poseidon3([info.oldNullifier, info.oldSecret, info.oldBalance]);   
         const oldMerkleProof = oldTree.createProof(oldTree.indexOf(oldCommitmentHash));
         const oldTreeSiblings = oldMerkleProof.siblings.map( (s) => s[0]); 
         const oldTreePathIndices = oldMerkleProof.pathIndices;

         let userOp = await this.createUnsignedUserOp(info);

        const newCommitmentHash = poseidon3([info.newNullifier, info.newSecret, info.newBalance]);
        const newTree = new IncrementalMerkleTree(poseidon2, 20, BigInt(0), 2, info.leaves);
        const newRoot = newTree.root;
        const newMerkleProof = newTree.createProof(newTree.indexOf(newCommitmentHash));
        const newTreeSiblings = newMerkleProof.siblings.map( (s) => s[0]); 
        const newTreePathIndices = newMerkleProof.pathIndices;

        const callDataHash = BigNumber.from(ethers.utils.keccak256(userOp.callData)).toBigInt();

        const inputs = {
            value: info.value,
            oldBalance: info.oldBalance,
            oldNullifier: info.oldNullifier,
            oldSecret: info.oldSecret,
            oldTreeSiblings,
            oldTreePathIndices,
            newBalance: info.newBalance,
            newNullifier: info.newNullifier,
            newSecret: info.newSecret,
            newTreeSiblings,
            newTreePathIndices, 
            callDataHash
        };

        const outputs = {
            oldNullifierHash,
            oldRoot,
            newCommitmentHash,
            newRoot,
        };
        
        // These three lines are just for checking the proof
        const zkHiddenBalancePoseidonCircuit = await wasm_tester(resolve("circuits/ZKHiddenBalancePoseidon.circom"));
        const witness = await zkHiddenBalancePoseidonCircuit.calculateWitness(inputs);
        await zkHiddenBalancePoseidonCircuit.assertOut(witness, outputs);

        const { proof, publicSignals } = await groth16.fullProve(
            inputs,
            "zk-data/ZKHiddenBalancePoseidon_js/ZKHiddenBalancePoseidon.wasm",
            "zk-data/ZKHiddenBalancePoseidon_0001.zkey",
        );

        const proofCalldata = await groth16.exportSolidityCallData(proof, publicSignals);      
        const proofCalldataFormatted = JSON.parse("[" + proofCalldata + "]");
  
        const ZKHiddenBalancePoseidonVerifier = await ethers.getContractFactory("Groth16Verifier");
        const zkHiddenBalancePoseidonVerifier = await ZKHiddenBalancePoseidonVerifier.deploy();

        // verifying on-chain
        console.log(
        await zkHiddenBalancePoseidonVerifier.verifyProof(
            proofCalldataFormatted[0],
            proofCalldataFormatted[1],
            proofCalldataFormatted[2],
            proofCalldataFormatted[3],
        ));
  
        return {
            ...userOp,
            signature: ethers.utils.defaultAbiCoder.encode([ "uint256[2]",  "uint256[2][2]", "uint256[2]", "uint256[6]"], proofCalldataFormatted)
        }
}


  /**
   * get the transaction that has this userOpHash mined, or null if not found
   * @param userOpHash returned by sendUserOpToBundler (or by getUserOpHash..)
   * @param timeout stop waiting after this timeout
   * @param interval time to wait between polls.
   * @return the transactionHash this userOp was mined, or null if not found.
   */
  async getUserOpReceipt (userOpHash: string, timeout = 30000, interval = 5000): Promise<string | null> {
    const endtime = Date.now() + timeout
    while (Date.now() < endtime) {
      const events = await this.entryPointView.queryFilter(this.entryPointView.filters.UserOperationEvent(userOpHash))
      if (events.length > 0) {
        return events[0].transactionHash
      }
      await new Promise(resolve => setTimeout(resolve, interval))
    }
    return null
  }
}

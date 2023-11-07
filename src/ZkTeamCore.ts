import { readFileSync } from "fs";
import { resolve } from "path";

import { BigNumber, BigNumberish, Contract, constants } from 'ethers'
import { arrayify, hexConcat, keccak256, defaultAbiCoder } from 'ethers/lib/utils'

import { BaseAccountAPI } from '@account-abstraction/sdk'

import * as ZkTeamAccountFactory from '../artifacts/contracts/ZkTeamAccountFactory.sol/ZkTeamAccountFactory.json';
import * as ZkTeamAccount from '../artifacts/contracts/ZkTeamAccount.sol/ZkTeamAccount.json';

import { groth16 } from "snarkjs";
import { wasm as wasm_tester} from "circom_tester";

import { MerkleTree } from "./utils/MerkleTree";
import { encryptAllowance, decryptAllowance } from "./utils/encryption";
import { poseidon1, poseidon3 } from "poseidon-lite"

import AsyncLock from 'async-lock';

function parseNumber(a) {
    if (a == null || a === '')
        return null;
    return BigNumber.from(a.toString());
}

/**
 * constructor params, added no top of base params:
 * @param signer only needed for the admin
 * @param factoryAddress not needed if account already deployed
 * @param index not needed if account already deployed
 */
export interface ZkTeamCoreParams extends BaseApiParams {
  signer?: Signer
  factoryAddress?: string
  index?: BigNumberish
}

export class ZkTeamCore extends BaseAccountAPI {
    
    constructor(params: ZkTeamCoreParams) {
        var _a;
        super(params);
        this.signer = params.signer;
        this.factoryAddress = params.factoryAddress;
        this.index = BigNumber.from((_a = params.index) !== null && _a !== void 0 ? _a : 0);
        this.data = {
            lock: new AsyncLock(),
            blockIndex:0,
            logs: [],
            commitmentHashes: {},
            nullifierHashes: {},
        }
    }
    
    static getNullifierHash(nullifier){
        return poseidon1([nullifier]);
    }
    
    static getCommitmentHash(nullifier, secret, allowance){
        return poseidon3([nullifier, secret, allowance]);
    }
    
    async getData(){
        const self = this;
        const data = this.data;
        return data.lock.acquire('key', async function() {
                if (await self.checkAccountPhantom()) return [];
                const latest = await self.provider.getBlock('latest');
                if (latest.number < data.blockIndex) return data.logs;
                const accountContract = await self.getAccountContract();
                const executionEvents = await accountContract.queryFilter('ZkTeamExecution', data.blockIndex, latest.number)
                for (let event of executionEvents) {
                    let [nullifierHash, commitmentHash, encryptedAllowance] = event.args
                    nullifierHash = BigNumber.from(nullifierHash).toBigInt();
                    commitmentHash = BigNumber.from(commitmentHash).toBigInt();
                    const log = { encryptedAllowance, commitmentHash, nullifierHash };
                    data.logs.push(log);
                    data.commitmentHashes[commitmentHash] = log;
                    data.nullifierHashes[nullifierHash] = log;
                }
                const discardEvents = await accountContract.queryFilter('ZkTeamDiscard', data.blockIndex, latest.number)
                for (let event of discardEvents) {
                    let [commitmentHash] = event.args
                    commitmentHash = BigNumber.from(commitmentHash).toBigInt();
                    data.commitmentHashes[commitmentHash].discarded = true;
                }
                data.blockIndex = latest.number + 1;
                return data.logs;
        })
    }
    
    async getCommitmentHashes(){
        await this.getData();
        const commitmentHashes =  this.data.logs.map(function(log){
            if (log.discarded) return BigInt(0);
            else return log.commitmentHash;
        });
        return [...commitmentHashes];
    }
    
    async getEncryptedAllowance(nullifierHash){
        await this.getData();
        if (nullifierHash in this.data.nullifierHashes) return this.data.nullifierHashes[nullifierHash].encryptedAllowance;
        else return constants.HashZero;
    }
    
    async getDecryptedAllowance(nullifierHash, key, nonce){
        const encryptedAllowance = await this.getEncryptedAllowance(nullifierHash);
        if (encryptedAllowance == constants.HashZero) throw new Error('Encrypted Allowance is set to 0');
        return decryptAllowance(encryptedAllowance, key, nonce); 
    }
    
    async getAccountContract() {
        if (this.accountContract == null) {
            const signerOrProvider = (this.signer)? this.signer : this.provider;
            this.accountContract = new Contract(await this.getAccountAddress(), ZkTeamAccount.abi, signerOrProvider);
        }
        return this.accountContract;
    }
    
    /**
     * return the value to put into the "initCode" field, if the account is not yet deployed.
     * this value holds the "factory" address, followed by this account's information
     */
    async getAccountInitCode() {
        if (this.factory == null) {
            if (this.factoryAddress != null && this.factoryAddress !== '') {
                this.factory = new Contract(this.factoryAddress, ZkTeamAccountFactory.abi, this.provider);
            }
            else {
                throw new Error('No factory to get initCode');
            }
        }
        return hexConcat([
            this.factory.address,
            this.factory.interface.encodeFunctionData('createAccount', [await this.signer.getAddress(), this.index])
        ]);
    }
    
    async getNonce() {
        if (await this.checkAccountPhantom()) {
            return BigNumber.from(0);
        }
        const accountContract = await this.getAccountContract();
        return await accountContract.getNonce();
    }
    
    async getVerificationGasLimit (): Promise<BigNumberish> {
      return 1000000
    }
    
    /**
     * encode a method call from entryPoint to our contract
     * @param target
     * @param value
     * @param data
     */
    async encodeExecute(detailsForUserOp) {
        const accountContract = await this.getAccountContract();
        const value = parseNumber(detailsForUserOp.value) ?? BigNumber.from(0)
                                                  
        return accountContract.interface.encodeFunctionData(
          'execute',
          [
            detailsForUserOp.oldNullifierHash,
            detailsForUserOp.newCommitmentHash,
            value,
            detailsForUserOp.encryptedAllowance,
            detailsForUserOp.target,
            detailsForUserOp.data
          ])
    }
    
    async encodeUserOpCallDataAndGasLimit(detailsForUserOp) {
        var _a, _b;
        const callData = await this.encodeExecute(detailsForUserOp);
        const callGasLimit = (_b = parseNumber(detailsForUserOp.gasLimit)) !== null && _b !== void 0 ? _b : await this.provider.estimateGas({
            from: this.entryPointAddress,
            to: this.getAccountAddress(),
            data: callData
        });
        return {
            callData,
            callGasLimit
        };
    }
    
    async generateSignatureInputs(params){
        const newAllowance = params.newAllowance;
        const oldNullifierHash  = ZkTeamCore.getNullifierHash(params.oldNullifier);
        const newCommitmentHash = ZkTeamCore.getCommitmentHash(params.newNullifier, params.newSecret, newAllowance);
        const commitmentHashes = await this.getCommitmentHashes();
        const tree = new MerkleTree(commitmentHashes);
        tree.insert(newCommitmentHash);
        const newRoot = tree.getRoot();
        const encryptedAllowance = encryptAllowance(newAllowance, params.newKey, params.newNonce, params.newPadding);
        return  { 
            newAllowance, 
            oldNullifierHash, 
            newCommitmentHash, 
            newRoot, 
            encryptedAllowance,
        };
    }
    
    async signUserOpHash(userOpHash) {
        return await this.signer.signMessage((0, arrayify)(userOpHash));
    }
    
    async createSignedUserOp(info) {
        return super.createSignedUserOp({...info, gasLimit: 1000000});
    }
    
    async generateProofInputs(params){
        const value = params.value;
        const {padding: oldPadding, allowance: oldAllowance} = await this.getDecryptedAllowance(params.oldNullifierHash, params.oldKey, params.oldNonce);
        
        const oldNullifierHash  = ZkTeamCore.getNullifierHash(params.oldNullifier);
        const oldCommitmentHash = ZkTeamCore.getCommitmentHash(params.oldNullifier, params.oldSecret, oldAllowance);
        
        const commitmentHashes = await this.getCommitmentHashes();
        const tree = new MerkleTree(commitmentHashes);      
        const oldRoot = tree.getRoot();
        const { treeSiblings:oldTreeSiblings, treePathIndices: oldTreePathIndices} = tree.getProof(oldCommitmentHash);

        const newAllowance = oldAllowance - value;
        if (newAllowance < 0) throw new Error('Insufficient allowance');
        const newNullifierHash  = ZkTeamCore.getNullifierHash(params.newNullifier);
        const newCommitmentHash  = ZkTeamCore.getCommitmentHash(params.newNullifier, params.newSecret, newAllowance);
        tree.insert(newCommitmentHash);
        const newRoot = tree.getRoot();
        const { treeSiblings:newTreeSiblings, treePathIndices: newTreePathIndices} = tree.getProof(newCommitmentHash);
        
        const encryptedAllowance = encryptAllowance(newAllowance, params.newKey, params.newNonce, params.newPadding);
        
        return { 
            value, 
            oldAllowance, 
            oldPadding,
            oldNullifier: params.oldNullifier,
            oldSecret: params.oldSecret,
            oldNullifierHash, 
            oldCommitmentHash, 
            oldRoot, 
            oldTreeSiblings, 
            oldTreePathIndices, 
            newAllowance, 
            newNullifier: params.newNullifier,
            newSecret: params.newSecret,
            newNullifierHash, 
            newCommitmentHash, 
            newRoot, 
            newTreeSiblings, 
            newTreePathIndices, 
            encryptedAllowance,
        }
    }
    
    async createProvedUserOp (info) {
        
        let userOp = await this.createUnsignedUserOp({...info});

        // interstingly we cannot just use the keccak hash value. It makes the proof crash. We must hash it using poseidon.
        const callDataHash = poseidon1([BigNumber.from(keccak256(userOp.callData)).toBigInt()]);

        const inputs = {
            value: info.value,
            oldAllowance: info.oldAllowance,
            oldNullifier: info.oldNullifier,
            oldSecret: info.oldSecret,
            oldTreeSiblings: info.oldTreeSiblings,
            oldTreePathIndices: info.oldTreePathIndices,
            newAllowance: info.newAllowance,
            newNullifier: info.newNullifier,
            newSecret: info.newSecret,
            newTreeSiblings: info.newTreeSiblings,
            newTreePathIndices: info.newTreePathIndices,
            callDataHash
        };
        
        const outputs = {
            oldNullifierHash: info.oldNullifierHash,
            oldRoot: info.oldRoot,
            newCommitmentHash: info.newCommitmentHash,
            newRoot: info.newRoot,
        };
                        
        // These three lines are just for checking the proof
        const zkHiddenAllowancePoseidonCircuit = await wasm_tester(resolve("circuits/zkteam.circom"));
        const witness = await zkHiddenAllowancePoseidonCircuit.calculateWitness(inputs);
        await zkHiddenAllowancePoseidonCircuit.assertOut(witness, outputs);

        const { proof, publicSignals } = await groth16.fullProve(
            inputs,
            "ptau-data/ZkTeam_js/ZkTeam.wasm",
            "ptau-data/ZkTeam_0001.zkey",
        );
                
        const vKey = JSON.parse(readFileSync("ptau-data/verification_key.json"));
        let res = await groth16.verify(vKey, publicSignals, proof);
        
        if (!res) throw new Error('Invalid proof');

        const proofCalldata = await groth16.exportSolidityCallData(proof, publicSignals);      
        const proofCalldataFormatted = JSON.parse("[" + proofCalldata + "]");
                
        return {
            ...userOp,
            signature: defaultAbiCoder.encode([ "uint256[2]",  "uint256[2][2]", "uint256[2]", "uint256[6]"], proofCalldataFormatted)
        }
    }
    
    public async discardCommitmentHashes(commitmentHashes){
        const tree = new MerkleTree(await this.getCommitmentHashes());
        const commitmentHashList = [];
        for( let commitmentHash of commitmentHashes){
            const { treeSiblings, treePathIndices } = tree.getProof(commitmentHash);
            commitmentHashList.push({commitmentHash, treeSiblings, treePathIndices});
            tree.discard(commitmentHash);
        }
        const contract = await this.getAccountContract();
        return contract.discardCommitmentHashes(commitmentHashList);
    }
}
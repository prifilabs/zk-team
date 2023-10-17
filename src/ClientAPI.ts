import { ZkTeamAccountAPI } from "./ZkTeamAccountAPI"

import { HDNode, arrayify, hexlify, randomBytes } from 'ethers/lib/utils'
import { IncrementalMerkleTree } from "@zk-kit/incremental-merkle-tree"
import { poseidon1, poseidon2, poseidon3 } from "poseidon-lite"

import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { bigintToBuf, bufToBigint } from "bigint-conversion";

import * as ZkTeamAccountFactory from '../artifacts/contracts/ZkTeamAccountFactory.sol/ZkTeamAccountFactory.json';
import * as ZkTeamAccount from '../artifacts/contracts/ZkTeamAccount.sol/ZkTeamAccount.json';


export async function getAccount(provider, factoryAddress, ownerAddress, accountIndex){
    const factory = new ethers.Contract(factoryAddress, ZkTeamAccountFactory.abi, provider);
    const accountAddress = await factory.getAddress(ownerAddress, accountIndex);
    const accountCode = await provider.getCode(accountAddress);
    const exists = (accountCode.length > 2);
    const balance = await provider.getBalance(accountAddress);
    return { balance, exists }
}

export async function getAccounts(provider, factoryAddress, ownerAddress, page, limit){
    const tasks = Array.from({length:limit},(v,k)=>getAccount(provider, factoryAddress, ownerAddress, page*limit+k));
    return Promise.all(tasks);
}

class ZkTeamClient extends ZkTeamAccountAPI {

    constructor(provider, owner, index, key, config) {
      super({
          provider,
          entryPointAddress: config.entryPointAddress,
          owner,
          factoryAddress: config.factoryAddress,
          index,
      });
      this.config = config;
      this.provider = provider;
      this.key = HDNode.fromExtendedKey(key);
      this.executionLogs = [];
      this.blockIndex = 0;
    }
    
    protected static encryptAllowance(allowance, key, nonce, padding?) {
      if (padding == undefined){
          padding = randomBytes(7);
      }else{
          if ((padding.constructor !== Uint8Array)||(padding.length !== 7)){
              throw new Error('Padding should be a Uint8Array of length 7');
          }
      }
      const stream = xchacha20poly1305(key, nonce);
      const plaintext = bigintToBuf(allowance);
      const ciphertext = stream.encrypt(new Uint8Array([...padding, ...plaintext]));
      return hexlify(ciphertext);
    }
    
    protected static decryptAllowance(encryptedAllowance, key, nonce) {
      const stream = xchacha20poly1305(key, nonce);
      const ciphertext = arrayify(encryptedAllowance);
      const plaintext = stream.decrypt(ciphertext);
      return { padding: plaintext.slice(0, 7), allowance: bufToBigint(plaintext.slice(7)) };
    }

    protected static generateTriplet(key, index){
        const s = ethers.BigNumber.from(key.derivePath(`${index}/0`).privateKey).toBigInt();
        const n = ethers.BigNumber.from(key.derivePath(`${index}/1`).privateKey).toBigInt();
        const k = arrayify(key.derivePath(`${index}/2`).privateKey);
        const i = arrayify(key.derivePath(`${index}/3`).privateKey).slice(0, 24);
        return {s, n, k, i};
    }
    
    protected async updateExecutionLogs(){
        if (await this.checkAccountPhantom()) {
          return;
        }
        const latest = await this.provider.getBlock('latest')
        const accountContract = await this.getAccountContract()
        let events = await accountContract.queryFilter('ZkTeamExecution', this.blockIndex, latest.number)
        let shields = {}
        for (let event of events) {
            const [nullifierHash, commitmentHash] = event.args
            this.executionLogs.push({nullifierHash: ethers.BigNumber.from(nullifierHash).toBigInt(), commitmentHash: ethers.BigNumber.from(commitmentHash).toBigInt()});
        }
        this.blockIndex = latest.number + 1;
    }
    
    protected async getUpdatedMerkleTree(){
        await this.updateExecutionLogs();
        const commitmentHashes = [42, ...this.executionLogs.map(({nullifierHash, commitmentHash}) => commitmentHash)];
        return new IncrementalMerkleTree(poseidon2, 20, BigInt(0), 2, commitmentHashes);
    }
    
    protected static async insertMerkleTree(tree, commitmentHash){
        tree.insert(commitmentHash);
    }
    
    protected static async getMerkleRoot(tree){
        return tree.root;
    }
    
    protected static async getMerkleProof(tree, commitmentHash){
        const merkleProof = tree.createProof(tree.indexOf(commitmentHash));
        const treeSiblings = merkleProof.siblings.map( (s) => s[0]);
        const treePathIndices = merkleProof.pathIndices;
        return { treeSiblings, treePathIndices };
    }
    
    protected async getLastIndex(key){
        if (await this.checkAccountPhantom()) {
          return 0;
        }
        const accountContract = await this.getAccountContract()
        let index = 0;
        while(true){
            const nullifier = ethers.BigNumber.from(key.derivePath(`${index}/1`).privateKey).toBigInt();
            const nullifierHash  = poseidon1([nullifier]);
            const encryptedAllowance = await accountContract.nullifierHashes(nullifierHash);
            if (encryptedAllowance === ethers.constants.HashZero) break;
            index++;
        }
        return index;
    }
    
    protected async getAllowanceAtIndex(key, index){
        const { n, k, i } = ZkTeamClient.generateTriplet(key, index);
        const nullifierHash  = poseidon1([n]);
        const accountContract = await this.getAccountContract()
        const encryptedAllowance = await accountContract.nullifierHashes(nullifierHash);
        return ZkTeamClient.decryptAllowance(encryptedAllowance, k, i);
    }
    
    protected async getAllowance(key){
        const index = await this.getLastIndex(key);
        if (index == 0) return null;
        const {allowance} = await this.getAllowanceAtIndex(key, index-1);
        return allowance;
    }
}

export class ZkTeamClientAdmin extends ZkTeamClient {
    
    public async getUserKey(userIndex){
        const userKey = this.key.derivePath(`m/${this.index}/${userIndex}'`);
        return userKey.extendedKey;
    }

    public async getAllowance(userIndex){
        const userKey = this.key.derivePath(`m/${this.index}/${userIndex}'`);
        const allowance = await super.getAllowance(userKey);
        if (allowance == null) return null;
        return ethers.BigNumber.from(allowance);
    }
    
    public async getAllowances(page, limit){
        const tasks = Array.from({length:limit},(v,k)=>this.getAllowance(page*limit+k));
        return Promise.all(tasks);
    }
    
    public async setAllowance(userIndex, rawNewAllowance, padding?){
        const newAllowance = ethers.BigNumber.from(rawNewAllowance).toBigInt();
        
        const userKey = this.key.derivePath(`m/${this.index}/${userIndex}'`);
        const index = await this.getLastIndex(userKey);
        const oldTriplet = ZkTeamClient.generateTriplet(userKey, index);
        const newTriplet = ZkTeamClient.generateTriplet(userKey, index+1);        
        const oldNullifierHash  = poseidon1([oldTriplet.n]);
        const newCommitmentHash = poseidon3([newTriplet.n, newTriplet.s, newAllowance]);
        const merkleTree = await this.getUpdatedMerkleTree();
        await ZkTeamClient.insertMerkleTree(merkleTree, newCommitmentHash);
        const newRoot = await ZkTeamClient.getMerkleRoot(merkleTree);
        const privateInputs = { oldNullifierHash, newCommitmentHash, newRoot };
        const encryptedAllowance = ZkTeamClient.encryptAllowance(newAllowance, oldTriplet.k, oldTriplet.i, padding);
        
        const op = await this.createSignedUserOp({
            ...privateInputs,
            encryptedAllowance,
            target: await this.getAccountAddress(),
            data: "0x",
            gasLimit: 1000000 // Bug: the function estimateGas does not give the right result when adding things to do in the contract's execute function
        });
                     
        const uoHash = await this.config.sendUserOp(op);
        return this.getUserOpReceipt(uoHash);
    }
    
    public async checkIntegrity(){
        
    }
    
    public async deleteCommitmentHashes(){
    
    }
    
}

export class ZkTeamClientUser extends ZkTeamClient {

    public async getAllowance(){
        return super.getAllowance(this.key);
    }
    
    public async sendTransaction(target, v, data, padding?){
        
        const index = await this.getLastIndex(this.key);
        if (index == 0) throw new Error('Allowance not set');
        
        const oldTriplet = ZkTeamClient.generateTriplet(this.key, index);
        const oldNullifierHash  = poseidon1([oldTriplet.n]);
        const { allowance: oldAllowance } = await this.getAllowanceAtIndex(this.key, index-1);
        const oldCommitmentHash  = poseidon3([oldTriplet.n, oldTriplet.s, oldAllowance]);
                
        const merkleTree = await this.getUpdatedMerkleTree();        
        const oldRoot = await ZkTeamClient.getMerkleRoot(merkleTree);
        const { treeSiblings:oldTreeSiblings, treePathIndices: oldTreePathIndices} = await ZkTeamClient.getMerkleProof(merkleTree, oldCommitmentHash);

        const value = ethers.BigNumber.from(v).toBigInt();
        const newAllowance = oldAllowance - value;
        if (newAllowance < 0) throw new Error('Insufficient allowance');
        const newTriplet = ZkTeamClient.generateTriplet(this.key, index+1);
        const newNullifierHash  = poseidon1([newTriplet.n]);
        const newCommitmentHash  = poseidon3([newTriplet.n, newTriplet.s, newAllowance]);
        await ZkTeamClient.insertMerkleTree(merkleTree, newCommitmentHash);
        const newRoot = await ZkTeamClient.getMerkleRoot(merkleTree);
        const { treeSiblings:newTreeSiblings, treePathIndices: newTreePathIndices} = await ZkTeamClient.getMerkleProof(merkleTree, newCommitmentHash);        
        
        const privateInputs = {
            value,
            oldAllowance,
            oldNullifier: oldTriplet.n,
            oldSecret: oldTriplet.s,
            oldNullifierHash,
            oldRoot,
            oldTreeSiblings,
            oldTreePathIndices,
            newAllowance,
            newNullifier: newTriplet.n,
            newSecret: newTriplet.s,
            newCommitmentHash,
            newRoot,
            newTreeSiblings,
            newTreePathIndices,
        };
                
        const encryptedAllowance = ZkTeamClient.encryptAllowance(newAllowance, oldTriplet.k, oldTriplet.i, padding);
        
        const op = await this.createProvedUserOp({
            ...privateInputs,
            encryptedAllowance: encryptedAllowance,
            target,
            data,
            gasLimit: 1000000 // Bug: the function estimateGas does not give the right result when adding things to do in the contract's execute function
        });
        
        const uoHash = await this.config.sendUserOp(op);
        return this.getUserOpReceipt(uoHash);
    }

}


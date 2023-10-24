import { ZkTeamAccountAPI } from "./ZkTeamAccountAPI"

import { HDNode, arrayify, hexlify, randomBytes } from 'ethers/lib/utils'
import { poseidon1, poseidon3 } from "poseidon-lite"

import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { bigintToBuf, bufToBigint } from "bigint-conversion";

import * as ZkTeamAccountFactory from '../artifacts/contracts/ZkTeamAccountFactory.sol/ZkTeamAccountFactory.json';
import * as ZkTeamAccount from '../artifacts/contracts/ZkTeamAccount.sol/ZkTeamAccount.json';

import { MerkleTree } from "./MerkleTree";

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

class ZkTeamClient extends ZkTeamAccountAPI{

    constructor(config){
        super(config);
    }
    
    static generateTriplet(key, index){
        const s = ethers.BigNumber.from(key.derivePath(`${index}/0`).privateKey).toBigInt();
        const n = ethers.BigNumber.from(key.derivePath(`${index}/1`).privateKey).toBigInt();
        const k = arrayify(key.derivePath(`${index}/2`).privateKey);
        const i = arrayify(key.derivePath(`${index}/3`).privateKey).slice(0, 24);
        return {s, n, k, i};
    }
    
    static encryptAllowance(allowance, key, nonce, padding?) {
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
    
    static decryptAllowance(encryptedAllowance, key, nonce) {
      const stream = xchacha20poly1305(key, nonce);
      const ciphertext = arrayify(encryptedAllowance);
      const plaintext = stream.decrypt(ciphertext);
      return { padding: plaintext.slice(0, 7), allowance: bufToBigint(plaintext.slice(7)) };
    }

    async decryptAllowanceAtIndex(key, index){
        const { n, k, i } = ZkTeamClient.generateTriplet(key, index);
        const nullifierHash  = poseidon1([n]);
        const encryptedAllowance = await this.getEncryptedAllowance(nullifierHash);
        return ZkTeamClient.decryptAllowance(encryptedAllowance, k, i);
    }

    async getLastIndex(key){
        let index = 0;
        while(true){
            const nullifier = ethers.BigNumber.from(key.derivePath(`${index}/1`).privateKey).toBigInt();
            const nullifierHash  = poseidon1([nullifier]);
            const encryptedAllowance = await this.getEncryptedAllowance(nullifierHash);
            if (encryptedAllowance == ethers.constants.HashZero) break;
            index++;
        }
        return index;
    }
}

export class ZkTeamClientAdmin extends ZkTeamClient {
    
    constructor(provider, signer, index, key, config) {
      super({
          provider,
          signer,
          index,
          entryPointAddress: config.entryPointAddress,
          factoryAddress: config.factoryAddress,
      });
      this.config = config;
      this.provider = provider;
      this.key = HDNode.fromExtendedKey(key);
    }
    
    private getRawUserKey(userIndex){
        return this.key.derivePath(`m/${this.index}/${userIndex}'`);
    }
    
    public async getUserKey(userIndex){
        const userKey = this.getRawUserKey(userIndex);
        return userKey.extendedKey;
    }

    public async getAllowance(userIndex){
        const userKey = this.getRawUserKey(userIndex);
        const index = await this.getLastIndex(userKey);
        if (index == 0) return null;
        const { allowance } = await this.decryptAllowanceAtIndex(userKey, index-1);
        if (allowance == null) return null;
        return ethers.BigNumber.from(allowance);
    }
    
    public async getAllowances(page, limit){
        const tasks = Array.from({length:limit},(v,k)=>this.getAllowance(page*limit+k));
        return Promise.all(tasks);
    }
    
    public async generateInputs(userIndex, rawNewAllowance, padding?){
        const newAllowance = ethers.BigNumber.from(rawNewAllowance).toBigInt();
        const userKey = this.getRawUserKey(userIndex);
        const index = (await this.checkAccountPhantom())? 0 : await this.getLastIndex(userKey);
        const oldTriplet = ZkTeamClient.generateTriplet(userKey, index);
        const newTriplet = ZkTeamClient.generateTriplet(userKey, index+1);        
        const oldNullifierHash  = poseidon1([oldTriplet.n]);
        const newCommitmentHash = poseidon3([newTriplet.n, newTriplet.s, newAllowance]);
        const commitmentHashes = await this.getCommitmentHashes();
        const tree = new MerkleTree(commitmentHashes);
        tree.insert(newCommitmentHash);
        const newRoot = tree.getRoot();
        const encryptedAllowance = ZkTeamClient.encryptAllowance(newAllowance, oldTriplet.k, oldTriplet.i, padding);
        return  { oldNullifierHash, newCommitmentHash, newRoot, encryptedAllowance, k: oldTriplet.k, i: oldTriplet.i };
    }
    
    public async setAllowance(userIndex, rawNewAllowance, padding?){
        const inputs = await this.generateInputs(userIndex, rawNewAllowance, padding);
        const op = await this.createSignedUserOp({
            ...inputs,
            target: await this.getAccountAddress(),
            data: "0x",
            gasLimit: 1000000 // Bug: the function estimateGas does not give the right result when adding things to do in the contract's execute function
        });            
        const uoHash = await this.config.sendUserOp(op);
        return this.getUserOpReceipt(uoHash);
    }
    
    public async checkIntegrity(userIndexLimit){
        for (let userIndex=0; userIndex<=userIndexLimit; userIndex++){
            const userKey = this.getRawUserKey(userIndex);
            const index = await this.getLastIndex(userKey);
            if (index == 0) continue;
            for (let i=1; i<=index; i++){
                const oldTriplet = ZkTeamClient.generateTriplet(userKey, i-1);
                const newTriplet = ZkTeamClient.generateTriplet(userKey, i);
                const nullifierHash  = poseidon1([oldTriplet.n]);
                const log = this.data.nullifierHashes[nullifierHash];
                if (!log.verified && !log.discarded){
                    const {allowance} = ZkTeamClient.decryptAllowance(log.encryptedAllowance, oldTriplet.k, oldTriplet.i);
                    const commitmentHash = poseidon3([newTriplet.n, newTriplet.s, allowance]);
                    if (commitmentHash === log.commitmentHash) log.verified = true;
                }
            }
        }
        return Object.values(this.data.nullifierHashes).reduce(function(acc, log){
            if (!log.verified && !log.discarded)  acc.push(log.commitmentHash);
            return acc; 
        }, []);
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

export class ZkTeamClientUser extends ZkTeamClient {

    constructor(provider, accountAddress, key, config) {
      super({
          provider,
          accountAddress,
          entryPointAddress: config.entryPointAddress,
          factoryAddress: config.factoryAddress,
      });
      this.config = config;
      this.provider = provider;
      this.key = HDNode.fromExtendedKey(key);
    }

    public async getAllowance(){
        const index = await this.getLastIndex(this.key);
        if (index == 0) return null;
        const {allowance} = await this.decryptAllowanceAtIndex(this.key, index-1);
        return allowance;
    }
    
    public async generateInputs(v, padding?){
        const value = ethers.BigNumber.from(v).toBigInt();
        
        const index = await this.getLastIndex(this.key);
        if (index == 0) throw new Error('Allowance not set');
        
        const oldTriplet = ZkTeamClient.generateTriplet(this.key, index);
        const oldNullifierHash  = poseidon1([oldTriplet.n]);
        const { allowance: oldAllowance } = await this.decryptAllowanceAtIndex(this.key, index-1);
        const oldCommitmentHash  = poseidon3([oldTriplet.n, oldTriplet.s, oldAllowance]);
        
        const commitmentHashes = await this.getCommitmentHashes();
        const tree = new MerkleTree(commitmentHashes);      
        const oldRoot = tree.getRoot();
        const { treeSiblings:oldTreeSiblings, treePathIndices: oldTreePathIndices} = tree.getProof(oldCommitmentHash);

        const newAllowance = oldAllowance - value;
        if (newAllowance < 0) throw new Error('Insufficient allowance');
        const newTriplet = ZkTeamClient.generateTriplet(this.key, index+1);
        const newNullifierHash  = poseidon1([newTriplet.n]);
        const newCommitmentHash  = poseidon3([newTriplet.n, newTriplet.s, newAllowance]);
        tree.insert(newCommitmentHash);
        const newRoot = tree.getRoot();
        const { treeSiblings:newTreeSiblings, treePathIndices: newTreePathIndices} = tree.getProof(newCommitmentHash);
        
        const encryptedAllowance = ZkTeamClient.encryptAllowance(newAllowance, oldTriplet.k, oldTriplet.i, padding);
        
        return {
            value,
            index,
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
            encryptedAllowance,
            k: oldTriplet.k,
            i: oldTriplet.i,
        };           
    }
    
    public async sendTransaction(target, v, data, padding?){
        const inputs = await this.generateInputs(v, padding);
        const op = await this.createProvedUserOp({
            ...inputs,
            target,
            data,
            gasLimit: 1000000 // Bug: the function estimateGas does not give the right result when adding things to do in the contract's execute function
        });
        const uoHash = await this.config.sendUserOp(op);
        return this.getUserOpReceipt(uoHash);
    }

}


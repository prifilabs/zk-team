// import ZKTEAM from '../artifacts/contracts/ZkTeamAccount.sol/ZkTeamAccount.json'

// const ZKTEAM_INTERFACE = new ethers.utils.Interface(ZKTEAM.abi)

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
    
    protected static encryptAllowance(allowance, key, nonce) {
      const stream = xchacha20poly1305(key, nonce);
      const plaintext = bigintToBuf(allowance);
      const padding = randomBytes(7);
      const ciphertext = stream.encrypt(new Uint8Array([...padding, ...plaintext]));
      return hexlify(ciphertext);
    }
    
    protected static decryptAllowance(encryptedAllowance, key, nonce) {
      const stream = xchacha20poly1305(key, nonce);
      const ciphertext = arrayify(encryptedAllowance);
      const plaintext = stream.decrypt(ciphertext);
      return bufToBigint(plaintext.slice(7));
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
        const latest = this.provider.getBlock('latest')
        const accountContract = await this.getAccountContract()
        let events = await accountContract.queryFilter('CommitmentHashInserted', this.blockIndex, latest)
        let shields = {}
        for (let event of events) {
            const [nullifierHash, commitmentHash] = event.args
            this.executionLogs.push({nullifierHash, commitmentHash});
        }
        this.blockIndex = latest + 1;
    }
    
    protected async getMerkleRoot(commitmentHash){
        await this.updateExecutionLogs()
        const commitmentHashes = [42, ...this.executionLogs.map(({nullifierHash, commitmentHash}) => commitmentHash)];
        const tree = new IncrementalMerkleTree(poseidon2, 20, BigInt(0), 2, commitmentHashes);
        const oldRoot = tree.root;
        tree.insert(commitmentHash);
        const newRoot = tree.root;
        return {oldRoot, newRoot}
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
            const balance = await accountContract.nullifierHashes(nullifierHash);
            if (balance === ethers.constants.HashZero) break;
            index++;
        }
        return index;
    }
    
    protected async getAllowance(key){
        const index = await this.getLastIndex(key);
        if (index == 0) return null;
        const { n, k, i } = ZkTeamClient.generateTriplet(key, index-1);
        const nullifierHash  = poseidon1([n]);
        const accountContract = await this.getAccountContract()
        const encryptedBalance = await accountContract.nullifierHashes(nullifierHash);
        return ZkTeamClient.decryptAllowance(encryptedBalance, k, i);
    }
}

export class ZkTeamClientAdmin extends ZkTeamClient {
    
    public async getUserKey(userIndex){
        const userKey = this.key.derivePath(`m/${this.index}/${userIndex}'`);
        return userKey.extendedKey;
    }

    public async getAllowance(userIndex){
        const userKey = this.key.derivePath(`m/${this.index}/${userIndex}'`);
        return super.getAllowance(userKey);
    }
    
    public async getAllowances(page, limit){
        const tasks = Array.from({length:limit},(v,k)=>this.getAllowance(page*limit+k));
        return Promise.all(tasks);
    }
    
    public async setAllowance(userIndex, newBalance){        
        const userKey = this.key.derivePath(`m/${this.index}/${userIndex}'`);
        const index = await this.getLastIndex(userKey);
        const oldTriplet = ZkTeamClient.generateTriplet(userKey, index);
        const newTriplet = ZkTeamClient.generateTriplet(userKey, index+1);        
        const oldNullifierHash  = poseidon1([oldTriplet.n]);
        const newCommitmentHash = poseidon3([newTriplet.n, newTriplet.s, newBalance]);
        const { newRoot }  = await this.getMerkleRoot(newCommitmentHash);
        const privateInputs = { oldNullifierHash, newCommitmentHash, newRoot };
        const encryptedBalance = ZkTeamClient.encryptAllowance(newBalance, oldTriplet.k, oldTriplet.i);
        
        const op = await this.createSignedUserOp({
            ...privateInputs,
            balanceEncrypted: encryptedBalance,
            target: await this.getAccountAddress(),
            data: "0x",
            gasLimit: 1000000 // Bug: the function estimateGas does not give the right result when adding things to do in the contract's execute function
        });
                     
        const uoHash = await this.config.sendUserOp(op);
        return this.getUserOpReceipt(uoHash);
    }
    
    public async sendTransaction(){
    
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
    
    public async sendTransaction(){
    
    }

}


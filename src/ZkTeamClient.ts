import { HDNode, arrayify } from 'ethers/lib/utils'

import * as ZkTeamAccountFactory from '../artifacts/contracts/ZkTeamAccountFactory.sol/ZkTeamAccountFactory.json';
import * as ZkTeamAccount from '../artifacts/contracts/ZkTeamAccount.sol/ZkTeamAccount.json';

import { ZkTeamCore } from "./ZkTeamCore"
import { decryptAllowance } from "./utils/encryption";

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

class ZkTeamClient extends ZkTeamCore {

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

    async getLastIndex(key){
        let index = 0;
        while(true){
            const nullifier = ethers.BigNumber.from(key.derivePath(`${index}/1`).privateKey).toBigInt();
            const nullifierHash  = ZkTeamCore.getNullifierHash(nullifier);
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
          entryPointAddress: config.entrypoint.address,
          factoryAddress: config.factory.address,
          bundler: config.bundler
      });
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
        const { n, k, i } = ZkTeamClientAdmin.generateTriplet(userKey, index-1);
        const nullifierHash  = ZkTeamClientAdmin.getNullifierHash(n);
        return this.getDecryptedAllowance(nullifierHash, k, i);
    }
    
    public async getAllowances(page, limit){
        const tasks = Array.from({length:limit},(v,k)=>this.getAllowance(page*limit+k));
        return Promise.all(tasks);
    }
    
    public async generateInputs(userIndex, allowance, padding?){
        const newAllowance = ethers.BigNumber.from(allowance).toBigInt();
        const userKey = this.getRawUserKey(userIndex);
        const index = (await this.checkAccountPhantom())? 0 : await this.getLastIndex(userKey);
        const currentTriplet = ZkTeamClientAdmin.generateTriplet(userKey, index);
        const newTriplet = ZkTeamClientAdmin.generateTriplet(userKey, index+1);
        return this.generateSignatureInputs({
            oldNullifier: currentTriplet.n,
            newAllowance,
            newNullifier: newTriplet.n,
            newSecret: newTriplet.s,
            newKey: currentTriplet.k,
            newNonce: currentTriplet.i,
        });
    }
    
    public async setAllowance(userIndex, allowance, padding?){
        const inputs = await this.generateInputs(userIndex, allowance, padding);
        const op = await this.createSignedUserOp({
            ...inputs,
            target: await this.getAccountAddress(),
            data: "0x",
        });            
        const uoHash = await this.sendUserOp(op);
        return this.getUserOpReceipt(uoHash);
    }
    
    public async checkIntegrity(userIndexLimit){
        for (let userIndex=0; userIndex<=userIndexLimit; userIndex++){
            const userKey = this.getRawUserKey(userIndex);
            const index = await this.getLastIndex(userKey);
            if (index == 0) continue;
            for (let i=1; i<=index; i++){
                const oldTriplet = ZkTeamClientAdmin.generateTriplet(userKey, i-1);
                const currentTriplet = ZkTeamClientAdmin.generateTriplet(userKey, i);
                const nullifierHash  = ZkTeamClientAdmin.getNullifierHash(oldTriplet.n);
                const log = this.data.nullifierHashes[nullifierHash];
                if (!log.verified && !log.discarded){
                    const allowance = decryptAllowance(log.encryptedAllowance, oldTriplet.k, oldTriplet.i);
                    const commitmentHash = ZkTeamClientAdmin.getCommitmentHash(currentTriplet.n, currentTriplet.s, allowance);
                    if (commitmentHash === log.commitmentHash) log.verified = true;
                }
            }
        }
        return Object.values(this.data.nullifierHashes).reduce(function(acc, log){
            if (!log.verified && !log.discarded)  acc.push(log.commitmentHash);
            return acc;
        }, []);
    }
}

export class ZkTeamClientUser extends ZkTeamClient {

    constructor(provider, accountAddress, key, config) {
      super({
          provider,
          accountAddress,
          entryPointAddress: config.entrypoint.address,
          factoryAddress: config.factory.address,
          bundler: config.bundler
      });
      this.provider = provider;
      this.key = HDNode.fromExtendedKey(key);
    }

    public async getAllowance(){
        const index = await this.getLastIndex(this.key);
        if (index == 0) return null;
        const { n, k, i } = ZkTeamClientUser.generateTriplet(this.key, index-1);
        const nullifierHash  = ZkTeamClientUser.getNullifierHash(n);
        return this.getDecryptedAllowance(nullifierHash, k, i);
    }
    
    public async generateInputs(value, padding?){
        const index = await this.getLastIndex(this.key);
        if (index == 0) throw new Error('Allowance not set');

        const oldTriplet = ZkTeamClientUser.generateTriplet(this.key, index-1);
        const oldNullifierHash = ZkTeamClientUser.getNullifierHash(oldTriplet.n);
        const currentTriplet = ZkTeamClientUser.generateTriplet(this.key, index);
        const newTriplet = ZkTeamClientUser.generateTriplet(this.key, index+1);
        
        return this.generateProofInputs({
            value: ethers.BigNumber.from(value).toBigInt(),
            oldNullifierHash,
            oldNullifier: currentTriplet.n,
            oldSecret: currentTriplet.s,
            oldKey: oldTriplet.k,
            oldNonce: oldTriplet.i,
            newNullifier: newTriplet.n,
            newSecret: newTriplet.s,
            newKey: currentTriplet.k,
            newNonce: currentTriplet.i,
        });
    }
    
    public async sendTransaction(target, value, data, padding?){
        const inputs = await this.generateInputs(value, padding);
        const op = await this.createProvedUserOp({
            ...inputs,
            target,
            data,
        });
        const uoHash = await this.sendUserOp(op);
        return this.getUserOpReceipt(uoHash);
    }

}


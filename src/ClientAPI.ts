// import ZKTEAM from '../artifacts/contracts/ZkTeamAccount.sol/ZkTeamAccount.json'

// const ZKTEAM_INTERFACE = new ethers.utils.Interface(ZKTEAM.abi)

import { ZkTeamAccountAPI } from "./ZkTeamAccountAPI"

import { HDNode, arrayify, hexlify, randomBytes } from 'ethers/lib/utils'
import { IncrementalMerkleTree } from "@zk-kit/incremental-merkle-tree"
import { poseidon1, poseidon2, poseidon3 } from "poseidon-lite"

import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { bigintToBuf, bufToBigint } from "bigint-conversion";

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
      this.commitmentHashes = [42];
      this.blockIndex = 0;
    }
    
    protected async updateCommitmentHashes(){
        if (await this.checkAccountPhantom()) {
          return;
        }
        const latest = this.provider.getBlock('latest')
        const accountContract = await this.getAccountContract()
        let events = await accountContract.queryFilter('CommitmentHashInserted', this.blockIndex, latest)
        let shields = {}
        for (let event of events) {
            const [commitmentHash] = event.args
            this.commitmentHashes.push(commitmentHash)
        }
        this.blockIndex = latest + 1;
    }
    
    protected async getMerkleRoot(commitmentHash){
        await this.updateCommitmentHashes()
        const tree = new IncrementalMerkleTree(poseidon2, 20, BigInt(0), 2, this.commitmentHashes);
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
            const balance = await accountContract.nullifiers(nullifierHash);
            if (balance === ethers.constants.HashZero) break;
            index++;
        }
        return index;
    }
    
    protected static encryptBalance(balance, key, nonce) {
      const stream = xchacha20poly1305(key, nonce);
      const plaintext = bigintToBuf(balance);
      const padding = randomBytes(7);
      const ciphertext = stream.encrypt(new Uint8Array([...padding, ...plaintext]));
      return hexlify(ciphertext);
    }
    
    protected static decryptBalance(encryptedBalance, key, nonce) {
      const stream = xchacha20poly1305(key, nonce);
      const ciphertext = arrayify(encryptedBalance);
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
}

export class ZkTeamClientAdmin extends ZkTeamClient {
    
    public async setUserBalance(userIndex, newBalance){        
        const userKey = this.key.derivePath(`m/${userIndex}'`);
        const index = await this.getLastIndex(userKey);
        const oldTriplet = ZkTeamClient.generateTriplet(userKey, index);
        const newTriplet = ZkTeamClient.generateTriplet(userKey, index+1);        
        const oldNullifierHash  = poseidon1([oldTriplet.n]);
        const newCommitmentHash = poseidon3([newTriplet.n, newTriplet.s, newBalance]);
        const { newRoot }  = await this.getMerkleRoot(newCommitmentHash);
        const privateInputs = { oldNullifierHash, newCommitmentHash, newRoot };
        const encryptedBalance = ZkTeamClient.encryptBalance(newBalance, oldTriplet.k, oldTriplet.i);
        
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

    public async getUserBalance(userIndex){
        const userKey = this.key.derivePath(`m/${userIndex}'`);
        const index = await this.getLastIndex(userKey);
        if (index == 0){
            throw new Error(`no balance set for user ${userIndex}`);
        }
        const { n, k, i } = ZkTeamClient.generateTriplet(userKey, index-1);
        const nullifierHash  = poseidon1([n]);
        const accountContract = await this.getAccountContract()
        const encryptedBalance = await accountContract.nullifiers(nullifierHash);
        return ZkTeamClient.decryptBalance(encryptedBalance, k, i);
    }
}

// export class ZkTeamClientUser {
//
// }


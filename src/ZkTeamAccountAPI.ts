import { readFileSync } from "fs";
import { resolve } from "path";

import { BigNumber, BigNumberish, Contract } from 'ethers'
import { arrayify, hexConcat, keccak256, defaultAbiCoder } from 'ethers/lib/utils'

import { BaseAccountAPI } from '@account-abstraction/sdk'

import * as ZkTeamAccountFactory from '../artifacts/contracts/ZkTeamAccountFactory.sol/ZkTeamAccountFactory.json';
import * as ZkTeamAccount from '../artifacts/contracts/ZkTeamAccount.sol/ZkTeamAccount.json';

import { groth16 } from "snarkjs";
import { wasm as wasm_tester} from "circom_tester";

import { poseidon1 } from "poseidon-lite"

function parseNumber(a) {
    if (a == null || a === '')
        return null;
    return BigNumber.from(a.toString());
}

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

export class ZkTeamAccountAPI extends BaseAccountAPI {
    
    constructor(params: ZkTeamAccountApiParams) {
        var _a;
        super(params);
        this.factoryAddress = params.factoryAddress;
        this.owner = params.owner;
        this.index = BigNumber.from((_a = params.index) !== null && _a !== void 0 ? _a : 0);
    }
    
    async getAccountContract() {
        if (this.accountContract == null) {
            this.accountContract = new Contract(await this.getAccountAddress(), ZkTeamAccount.abi, this.provider);
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
                throw new Error('no factory to get initCode');
            }
        }
        return hexConcat([
            this.factory.address,
            this.factory.interface.encodeFunctionData('createAccount', [await this.owner.getAddress(), this.index])
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
            detailsForUserOp.newRoot,
            value,
            detailsForUserOp.balanceEncrypted,
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
    
    
    async signUserOpHash(userOpHash) {
        return await this.owner.signMessage((0, arrayify)(userOpHash));
    }
    
    async createProvedUserOp (info: TransactionDetailsForUserOp): Promise<UserOperationStruct> {
        
        let userOp = await this.createUnsignedUserOp(info);

        // interstingly we cannot just use the keccak hash value. It makes the proof crash. We must hash it using poseidon.
        const callDataHash = poseidon1([BigNumber.from(keccak256(userOp.callData)).toBigInt()]);

        const inputs = {
            value: info.value,
            oldBalance: info.oldBalance,
            oldNullifier: info.oldNullifier,
            oldSecret: info.oldSecret,
            oldTreeSiblings: info.oldTreeSiblings,
            oldTreePathIndices: info.oldTreePathIndices,
            newBalance: info.newBalance,
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
        const zkHiddenBalancePoseidonCircuit = await wasm_tester(resolve("circuits/ZKHiddenBalancePoseidon.circom"));
        const witness = await zkHiddenBalancePoseidonCircuit.calculateWitness(inputs);
        await zkHiddenBalancePoseidonCircuit.assertOut(witness, outputs);

        const { proof, publicSignals } = await groth16.fullProve(
            inputs,
            "zk-data/ZKHiddenBalancePoseidon_js/ZKHiddenBalancePoseidon.wasm",
            "zk-data/ZKHiddenBalancePoseidon_0001.zkey",
        );
                
        const vKey = JSON.parse(readFileSync("zk-data/verification_key.json"));
        let res = await groth16.verify(vKey, publicSignals, proof);
        
        if (!res) throw new Error('Invalid proof');

        const proofCalldata = await groth16.exportSolidityCallData(proof, publicSignals);      
        const proofCalldataFormatted = JSON.parse("[" + proofCalldata + "]");
                
        return {
            ...userOp,
            signature: defaultAbiCoder.encode([ "uint256[2]",  "uint256[2][2]", "uint256[2]", "uint256[6]"], proofCalldataFormatted)
        }
    }
}
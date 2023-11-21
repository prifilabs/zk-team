import { Signer, BigNumber, BigNumberish, Contract } from "ethers";
import { Provider } from "@ethersproject/providers";
import { BaseAccountAPI } from "@account-abstraction/sdk";
import AsyncLock from "async-lock";
export interface CoreInput {
    value: bigint;
    oldNullifierHash: bigint;
    newCommitmentHash: bigint;
    encryptedAllowance: string;
    target: string;
    data: string;
    gasLimit?: BigNumberish;
    maxFeePerGas?: BigNumberish;
    maxPriorityFeePerGas?: BigNumberish;
    nonce?: BigNumberish;
}
export interface SignatureInput extends CoreInput {
    newAllowance: bigint;
    newRoot: bigint;
}
export interface ProofInput extends CoreInput {
    oldAllowance: bigint;
    oldNullifier: bigint;
    oldSecret: bigint;
    oldRoot: bigint;
    oldTreeSiblings: Array<bigint>;
    oldTreePathIndices: Array<number>;
    newAllowance: bigint;
    newNullifier: bigint;
    newSecret: bigint;
    newRoot: bigint;
    newTreeSiblings: Array<bigint>;
    newTreePathIndices: Array<number>;
    encryptedAllowance: string;
}
export interface SignatureInputParams {
    oldNullifier: bigint;
    newAllowance: bigint;
    newNullifier: bigint;
    newSecret: bigint;
    newKey: Uint8Array;
    newNonce: Uint8Array;
}
export interface ProofInputParams {
    value: bigint;
    oldNullifierHash: bigint;
    oldNullifier: bigint;
    oldSecret: bigint;
    oldKey: Uint8Array;
    oldNonce: Uint8Array;
    newNullifier: bigint;
    newSecret: bigint;
    newKey: Uint8Array;
    newNonce: Uint8Array;
}
/**
 * constructor params, added no top of base params:
 * @param signer only needed for the admin
 * @param factoryAddress not needed if account already deployed
 * @param index not needed if account already deployed
 */
export interface ZkTeamCoreParams {
    provider: Provider;
    signer?: Signer;
    index?: BigNumberish;
    accountAddress?: string;
    entryPointAddress: string;
    factoryAddress?: string;
}
export interface Log {
    encryptedAllowance: string;
    commitmentHash: bigint;
    nullifierHash: bigint;
    discarded?: boolean;
    verified?: boolean;
}
export declare class ZkTeamCore extends BaseAccountAPI {
    signer: Signer | undefined;
    factoryAddress: string | undefined;
    index: BigNumber | undefined;
    accountContract: Contract | undefined;
    factoryContract: Contract | undefined;
    data: {
        lock: AsyncLock;
        blockIndex: number;
        logs: Array<Log>;
        commitmentHashes: {
            [key: string]: Log;
        };
        nullifierHashes: {
            [key: string]: Log;
        };
    };
    constructor(params: ZkTeamCoreParams);
    static getNullifierHash(nullifier: bigint): bigint;
    static getCommitmentHash(nullifier: bigint, secret: bigint, allowance: bigint): bigint;
    getData(): Promise<Log[]>;
    getCommitmentHashes(): Promise<Array<bigint>>;
    getEncryptedAllowance(nullifierHash: bigint): Promise<string>;
    getDecryptedAllowance(nullifierHash: bigint, key: Uint8Array, nonce: Uint8Array): Promise<bigint>;
    getAccountContract(): Promise<Contract>;
    /**
     * return the value to put into the "initCode" field, if the account is not yet deployed.
     * this value holds the "factory" address, followed by this account's information
     */
    getAccountInitCode(): Promise<string>;
    getNonce(): Promise<any>;
    getVerificationGasLimit(): Promise<BigNumberish>;
    encodeExecute(target: string, value: BigNumberish, data: string): Promise<string>;
    encodeUserOpCallDataAndGasLimit(detailsForUserOp: CoreInput): Promise<{
        callData: string;
        callGasLimit: BigNumber;
    }>;
    generateSignatureInputs(params: SignatureInputParams): Promise<{
        newAllowance: bigint;
        oldNullifierHash: bigint;
        newCommitmentHash: bigint;
        newRoot: bigint;
        encryptedAllowance: string;
    }>;
    signUserOpHash(userOpHash: string): Promise<string>;
    createUnsignedUserOp(info: CoreInput): Promise<import("@account-abstraction/contracts").UserOperationStruct>;
    generateProofInputs(params: ProofInputParams): Promise<{
        value: bigint;
        oldAllowance: bigint;
        oldNullifier: bigint;
        oldSecret: bigint;
        oldNullifierHash: bigint;
        oldCommitmentHash: bigint;
        oldRoot: bigint;
        oldTreeSiblings: any;
        oldTreePathIndices: any;
        newAllowance: bigint;
        newNullifier: bigint;
        newSecret: bigint;
        newNullifierHash: bigint;
        newCommitmentHash: bigint;
        newRoot: bigint;
        newTreeSiblings: any;
        newTreePathIndices: any;
        encryptedAllowance: string;
    }>;
    createProvedUserOp(info: ProofInput): Promise<{
        signature: string;
        sender: import("@account-abstraction/contracts/dist/types/common").PromiseOrValue<string>;
        nonce: import("@account-abstraction/contracts/dist/types/common").PromiseOrValue<BigNumberish>;
        initCode: import("@account-abstraction/contracts/dist/types/common").PromiseOrValue<import("ethers").BytesLike>;
        callData: import("@account-abstraction/contracts/dist/types/common").PromiseOrValue<import("ethers").BytesLike>;
        callGasLimit: import("@account-abstraction/contracts/dist/types/common").PromiseOrValue<BigNumberish>;
        verificationGasLimit: import("@account-abstraction/contracts/dist/types/common").PromiseOrValue<BigNumberish>;
        preVerificationGas: import("@account-abstraction/contracts/dist/types/common").PromiseOrValue<BigNumberish>;
        maxFeePerGas: import("@account-abstraction/contracts/dist/types/common").PromiseOrValue<BigNumberish>;
        maxPriorityFeePerGas: import("@account-abstraction/contracts/dist/types/common").PromiseOrValue<BigNumberish>;
        paymasterAndData: import("@account-abstraction/contracts/dist/types/common").PromiseOrValue<import("ethers").BytesLike>;
    }>;
    discardCommitmentHashes(commitmentHashes: Array<bigint>): Promise<any[]>;
}

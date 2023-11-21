import { BigNumber } from "ethers";
import { Provider } from "@ethersproject/providers";
import { HDNode } from "ethers/lib/utils";
import { ZkTeamCore, ZkTeamCoreParams } from "./ZkTeamCore";
export declare function getAccount(provider: Provider, factoryAddress: string, ownerAddress: string, accountIndex: number): Promise<{
    balance: BigNumber;
    exists: boolean;
}>;
export declare function getAccounts(provider: Provider, factoryAddress: string, ownerAddress: string, page: number, limit: number): Promise<{
    balance: BigNumber;
    exists: boolean;
}[]>;
export interface ZkTeamClientParams extends ZkTeamCoreParams {
    key: string;
}
declare class ZkTeamClient extends ZkTeamCore {
    key: HDNode;
    constructor(params: ZkTeamClientParams);
    static generateTriplet(key: HDNode, index: number): {
        s: bigint;
        n: bigint;
        k: Uint8Array;
        i: Uint8Array;
    };
    getLastIndex(key: HDNode): Promise<number>;
}
export declare class ZkTeamClientAdmin extends ZkTeamClient {
    private getRawUserKey;
    getUserKey(userIndex: number): Promise<string>;
    getAllowance(userIndex: number): Promise<bigint | null>;
    getAllowances(page: number, limit: number): Promise<(bigint | null)[]>;
    generateInputs(userIndex: number, newAllowance: bigint): Promise<{
        newAllowance: bigint;
        oldNullifierHash: bigint;
        newCommitmentHash: bigint;
        newRoot: bigint;
        encryptedAllowance: string;
    }>;
    setAllowance(userIndex: number, allowance: bigint): Promise<import("@account-abstraction/contracts").UserOperationStruct>;
    checkIntegrity(userIndexLimit: number): Promise<bigint[]>;
}
export declare class ZkTeamClientUser extends ZkTeamClient {
    getAllowance(): Promise<bigint | null>;
    generateInputs(value: bigint): Promise<{
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
    sendTransaction(target: string, value: bigint, data: string): Promise<{
        signature: string;
        sender: import("@account-abstraction/contracts/dist/types/common").PromiseOrValue<string>;
        nonce: import("@account-abstraction/contracts/dist/types/common").PromiseOrValue<import("ethers").BigNumberish>;
        initCode: import("@account-abstraction/contracts/dist/types/common").PromiseOrValue<import("ethers").BytesLike>;
        callData: import("@account-abstraction/contracts/dist/types/common").PromiseOrValue<import("ethers").BytesLike>;
        callGasLimit: import("@account-abstraction/contracts/dist/types/common").PromiseOrValue<import("ethers").BigNumberish>;
        verificationGasLimit: import("@account-abstraction/contracts/dist/types/common").PromiseOrValue<import("ethers").BigNumberish>;
        preVerificationGas: import("@account-abstraction/contracts/dist/types/common").PromiseOrValue<import("ethers").BigNumberish>;
        maxFeePerGas: import("@account-abstraction/contracts/dist/types/common").PromiseOrValue<import("ethers").BigNumberish>;
        maxPriorityFeePerGas: import("@account-abstraction/contracts/dist/types/common").PromiseOrValue<import("ethers").BigNumberish>;
        paymasterAndData: import("@account-abstraction/contracts/dist/types/common").PromiseOrValue<import("ethers").BytesLike>;
    }>;
}
export {};

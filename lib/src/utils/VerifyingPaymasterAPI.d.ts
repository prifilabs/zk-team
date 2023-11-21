import { Contract, Wallet } from "ethers";
import { PaymasterAPI } from "@account-abstraction/sdk";
import { UserOperationStruct } from "@account-abstraction/contracts";
export declare class VerifyingPaymasterAPI extends PaymasterAPI {
    private paymaster;
    private owner;
    private validUntilDelay;
    constructor(paymaster: Contract, owner: Wallet, validUntilDelay: number);
    getPaymasterAndData(userOp: Partial<UserOperationStruct>): Promise<string>;
}

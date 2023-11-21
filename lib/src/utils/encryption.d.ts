export declare const MAXIMUM_ALLOWANCE: bigint;
export declare function encryptAllowance(allowance: bigint, key: Uint8Array, nonce: Uint8Array): string;
export declare function decryptAllowance(encryptedAllowance: string, key: Uint8Array, nonce: Uint8Array): bigint;

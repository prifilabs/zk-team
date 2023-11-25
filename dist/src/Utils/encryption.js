"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decryptAllowance = exports.encryptAllowance = exports.MAXIMUM_ALLOWANCE = void 0;
const utils_1 = require("ethers/lib/utils");
const chacha_1 = require("@noble/ciphers/chacha");
const bigint_conversion_1 = require("bigint-conversion");
const PLAINTEXT_MAX_LENTGH = 16;
exports.MAXIMUM_ALLOWANCE = (0, bigint_conversion_1.bufToBigint)(new Uint8Array(PLAINTEXT_MAX_LENTGH).fill(255));
function encryptAllowance(allowance, key, nonce) {
    if (allowance > exports.MAXIMUM_ALLOWANCE) {
        throw new Error(`allowance cannot be greater than MAXIMUM_ALLOWANCE (${exports.MAXIMUM_ALLOWANCE})`);
    }
    const stream = (0, chacha_1.xchacha20poly1305)(key, nonce);
    const plaintext = new Uint8Array((0, bigint_conversion_1.bigintToBuf)(allowance));
    const padding = new Uint8Array(PLAINTEXT_MAX_LENTGH - plaintext.byteLength);
    const ciphertext = stream.encrypt(new Uint8Array([...padding, ...plaintext]));
    return (0, utils_1.hexlify)(ciphertext);
}
exports.encryptAllowance = encryptAllowance;
function decryptAllowance(encryptedAllowance, key, nonce) {
    const stream = (0, chacha_1.xchacha20poly1305)(key, nonce);
    const ciphertext = (0, utils_1.arrayify)(encryptedAllowance);
    const plaintext = stream.decrypt(ciphertext);
    return (0, bigint_conversion_1.bufToBigint)(plaintext);
}
exports.decryptAllowance = decryptAllowance;

import { arrayify, hexlify } from "ethers/lib/utils";

import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { bigintToBuf, bufToBigint } from "bigint-conversion";

const PLAINTEXT_MAX_LENTGH = 16;
export const MAXIMUM_ALLOWANCE: bigint = bufToBigint(
  new Uint8Array(PLAINTEXT_MAX_LENTGH).fill(255)
);

export function encryptAllowance(
  allowance: bigint,
  key: Uint8Array,
  nonce: Uint8Array
): string {
  if (allowance > MAXIMUM_ALLOWANCE) {
    throw new Error(
      `allowance cannot be greater than MAXIMUM_ALLOWANCE (${MAXIMUM_ALLOWANCE})`
    );
  }
  const stream = xchacha20poly1305(key, nonce);
  const plaintext = new Uint8Array(bigintToBuf(allowance));
  const padding = new Uint8Array(PLAINTEXT_MAX_LENTGH - plaintext.byteLength);
  const ciphertext = stream.encrypt(new Uint8Array([...padding, ...plaintext]));
  return hexlify(ciphertext);
}

export function decryptAllowance(
  encryptedAllowance: string,
  key: Uint8Array,
  nonce: Uint8Array
): bigint {
  const stream = xchacha20poly1305(key, nonce);
  const ciphertext = arrayify(encryptedAllowance);
  const plaintext = stream.decrypt(ciphertext);
  return bufToBigint(plaintext);
}

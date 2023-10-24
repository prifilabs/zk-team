import { arrayify, hexlify, randomBytes } from 'ethers/lib/utils'

import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { bigintToBuf, bufToBigint } from "bigint-conversion";

const PADDING_LENGTH = 7;

export function encryptAllowance(allowance, key, nonce, padding?) {
  if (padding == undefined){
      padding = randomBytes(PADDING_LENGTH);
  }else{
      if ((padding.constructor !== Uint8Array)||(padding.length !== PADDING_LENGTH)){
          throw new Error(`Padding should be a Uint8Array of length ${PADDING_LENGTH}`);
      }
  }
  const stream = xchacha20poly1305(key, nonce);
  const plaintext = bigintToBuf(allowance);
  const ciphertext = stream.encrypt(new Uint8Array([...padding, ...plaintext]));
  return hexlify(ciphertext);
}

export function decryptAllowance(encryptedAllowance, key, nonce) {
  const stream = xchacha20poly1305(key, nonce);
  const ciphertext = arrayify(encryptedAllowance);
  const plaintext = stream.decrypt(ciphertext);
  return { padding: plaintext.slice(0, PADDING_LENGTH), allowance: bufToBigint(plaintext.slice(PADDING_LENGTH)) };
}
import { expect } from "chai";

const hre = require("hardhat");
const { ethers } = hre;

import { randomBytes } from "crypto";

import {
  encryptAllowance,
  decryptAllowance,
  MAXIMUM_ALLOWANCE,
} from "../src/Utils/encryption";

describe("Utils", function () {
  function encryptValue(value) {
    const key = randomBytes(32);
    const nonce = randomBytes(24);
    const encryptedValue = encryptAllowance(value, key, nonce);
    expect(ethers.utils.arrayify(encryptedValue)).to.have.length(32);
    const decryptedValue = decryptAllowance(encryptedValue, key, nonce);
    expect(decryptedValue).to.be.equal(value);
  }

  it("Should encrypt and decrypt 0", async function () {
    encryptValue(ethers.constants.Zero.toBigInt());
  });

  it("Should encrypt and decrypt WeiPerEther", async function () {
    encryptValue(ethers.constants.WeiPerEther.toBigInt());
  });

  it("Should encrypt and decrypt MAXIMUM_ALLOWANCE", async function () {
    encryptValue(MAXIMUM_ALLOWANCE);
  });

  it("Should not encrypt MaxUint256", async function () {
    expect(function () {
      encryptValue(ethers.constants.MaxUint256.toBigInt());
    }).to.throw(Error);
  });
});

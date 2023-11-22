const hre = require("hardhat");
const { ethers } = hre;

import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { expect } from "chai";

import * as EntryPoint from "@account-abstraction/contracts/artifacts/EntryPoint.json";

import { HttpRpcClient } from "@account-abstraction/sdk";

import { VerifyingPaymasterAPI } from "../src/Utils/VerifyingPaymasterAPI";
import { ZkTeamCore } from "../src/ZkTeamCore";

import { deployAll } from "../scripts/deploy";

import "./ZkTeamVerifier.spec";
import "./Utils.spec";

async function topUp(from, address, minimumAmount, maximumAmount, provider) {
  const balance = await provider.getBalance(address);
  if (balance.gte(minimumAmount)) return;
  const amount = maximumAmount.sub(balance);
  console.log(`\tSending ${amount} to ${address}`);
  const tx = await from.sendTransaction({
    to: address,
    value: amount,
  });
  return processTx(tx.hash);
}

export async function setAdmin(deployer, config) {
  let admin;

  const filename = join("test", "wallet.txt");
  if (existsSync(filename)) {
    admin = ethers.Wallet.fromMnemonic(readFileSync(filename, "utf-8")).connect(
      ethers.provider
    );
  } else {
    admin = ethers.Wallet.createRandom().connect(ethers.provider);
    writeFileSync(filename, admin.mnemonic.phrase, "utf-8");
  }
  const adminAddress = await admin.getAddress();
  console.log(`\tAdmin address: ${adminAddress}`);
  await topUp(
    deployer,
    adminAddress,
    ethers.utils.parseEther("0.1"),
    ethers.utils.parseEther("0.2"),
    ethers.provider
  );
  const adminBalance = await ethers.provider.getBalance(adminAddress);
  console.log(
    `\tAdmin balance: ${adminBalance} (${ethers.utils.formatEther(
      adminBalance
    )} eth)`
  );

  return admin;
}

export async function setAccount(deployer, signer, index, config) {
  const account = new ZkTeamCore({
    provider: ethers.provider,
    signer,
    index,
    entryPointAddress: config.entrypoint.address,
    factoryAddress: config.factory.address,
  });

  const accountAddress = await account.getAccountAddress();
  console.log(`\tAccount #0 address: ${accountAddress}`);
  await topUp(
    deployer,
    accountAddress,
    ethers.utils.parseEther("0.1"),
    ethers.utils.parseEther("0.2"),
    ethers.provider
  );
  const accountBalance = await ethers.provider.getBalance(accountAddress);
  console.log(
    `\tAccount #0 balance: ${accountBalance} (${ethers.utils.formatEther(
      accountBalance
    )} eth)`
  );

  return account;
}

export function generateGreeting() {
  return `Hello ${Math.random().toString(36).slice(2)}`;
}

export async function processTx(txHash) {
  console.log(`\tTransaction hash: ${txHash}`);
  const tx = await ethers.provider.getTransaction(txHash);
  const receipt = await tx.wait();
  const gasCost = receipt.gasUsed.mul(receipt.effectiveGasPrice);
  console.log(
    `\tGas cost: ${gasCost} (${ethers.utils.formatEther(gasCost)} eth)`
  );
}

export async function processOp(account, op, config) {
  let uoHash;
  if (config.chainId == 31337) {
    const [deployer] = await ethers.getSigners();
    const entrypoint = new ethers.Contract(
      config.entrypoint.address,
      EntryPoint.abi,
      ethers.provider
    );
    await entrypoint.connect(deployer).handleOps([op], config.bundler.address);
    uoHash = await entrypoint.getUserOpHash(op);
  } else {
    const client = new HttpRpcClient(
      config.bundler.url,
      config.entrypoint.address,
      config.chainId
    );
    uoHash = await client.sendUserOpToBundler(op);
  }
  console.log(`\tUserOperation hash: ${uoHash}`);
  const txHash = await account.getUserOpReceipt(uoHash);
  return processTx(txHash);
}

describe("ZkTeam Core", function () {
  let config;
  let admin;
  let adminInstance;
  let user;
  let greeter;

  it("Should deploy the framework", async function () {
    const [deployer] = await ethers.getSigners();
    config = await deployAll();
    admin = await setAdmin(deployer, config);
    adminInstance = await setAccount(deployer, admin, 0, config);
  });

  it("Should allow the admin to set the user's allowance (signed transaction)", async function () {
    const oldNullifier = ethers.BigNumber.from(
      ethers.utils.randomBytes(32)
    ).toBigInt();

    const newAllowance = ethers.utils.parseEther("0.01").toBigInt();
    const newNullifier = ethers.BigNumber.from(
      ethers.utils.randomBytes(32)
    ).toBigInt();
    const newSecret = ethers.BigNumber.from(
      ethers.utils.randomBytes(32)
    ).toBigInt();
    const newKey = ethers.utils.randomBytes(32);
    const newNonce = ethers.utils.randomBytes(24);

    const inputs = await adminInstance.generateSignatureInputs({
      oldNullifier,
      newAllowance,
      newNullifier,
      newSecret,
      newKey,
      newNonce,
    });

    const Greeter = await ethers.getContractFactory("Greeter");
    greeter = Greeter.attach(config.greeter.address);
    const target = greeter.address;
    const greeting = generateGreeting();
    const data = greeter.interface.encodeFunctionData("setGreeting", [
      greeting,
    ]);

    const op = await adminInstance.createSignedUserOp({
      ...inputs,
      target,
      data,
    });

    await processOp(adminInstance, op, config);

    expect(await greeter.greet()).to.equal(greeting);

    user = {
      oldNullifierHash: inputs.oldNullifierHash,
      oldNullifier: newNullifier,
      oldSecret: newSecret,
      oldKey: newKey,
      oldNonce: newNonce,
    };
  });

  it("Should allow a user to use its allowance (proved transaction)", async function () {
    const userInstance = new ZkTeamCore({
      provider: ethers.provider,
      accountAddress: await adminInstance.getAccountAddress(),
      entryPointAddress: config.entrypoint.address,
      factoryAddress: config.factory.address,
    });

    const value = ethers.utils.parseEther("0.001").toBigInt();

    const newNullifier = ethers.BigNumber.from(
      ethers.utils.randomBytes(32)
    ).toBigInt();
    const newSecret = ethers.BigNumber.from(
      ethers.utils.randomBytes(32)
    ).toBigInt();
    const newKey = ethers.utils.randomBytes(32);
    const newNonce = ethers.utils.randomBytes(24);

    const inputs = await userInstance.generateProofInputs({
      ...user,
      value,
      newNullifier,
      newSecret,
      newKey,
      newNonce,
    });

    const target = greeter.address;
    const greeting = generateGreeting();
    const data = greeter.interface.encodeFunctionData("setGreeting", [
      greeting,
    ]);

    const op = await userInstance.createProvedUserOp({
      ...inputs,
      target,
      data,
    });

    await processOp(userInstance, op, config);

    expect(await greeter.greet()).to.equal(greeting);

    user = {
      oldNullifierHash: inputs.oldNullifierHash,
      oldNullifier: newNullifier,
      oldSecret: newSecret,
      oldKey: newKey,
      oldNonce: newNonce,
    };
  });

  // it.skip("Should allow a user to use its allowance (proved transaction with Paymaster)", async function () {
  //
  //     const VerifyingPaymasterFactory = await ethers.getContractFactory(VerifyingPaymaster.abi, VerifyingPaymaster.bytecode);
  //     const verifyingPaymaster = await VerifyingPaymasterFactory.deploy(config.entrypoint.address, await admin.getAddress());
  //     const verifyingPaymasterApi = new VerifyingPaymasterAPI(verifyingPaymaster, admin);
  //
  //     await verifyingPaymaster.connect(admin).deposit({
  //         value: ethers.utils.parseEther('0.01'),
  //     })
  //
  //     await verifyingPaymaster.addStake(21600, { value: ethers.utils.parseEther('0.01') })
  //
  //     const zkTeamAccount = new ZkTeamCore({
  //         provider: ethers.provider,
  //         accountAddress: await adminInstance.getAccountAddress(),
  //         entryPointAddress: config.entrypoint.address,
  //         factoryAddress: config.factory.address,
  //         overheads: {zeroByte: DefaultGasOverheads.nonZeroByte},
  //         paymasterAPI: verifyingPaymasterApi,
  //         bundler: config.bundler
  //     });
  //
  //     const value = ethers.utils.parseEther("0.001").toBigInt();
  //
  //     const newNullifier = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt();
  //     const newSecret = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt();
  //     const newKey = ethers.utils.randomBytes(32);
  //     const newNonce = ethers.utils.randomBytes(24);
  //
  //     const inputs = await zkTeamAccount.generateProofInputs({
  //         ...user,
  //         value,
  //         newNullifier,
  //         newSecret,
  //         newKey,
  //         newNonce,
  //     });
  //
  //     const target = greeter.address;
  //     const greeting = generateGreeting();
  //     const data = greeter.interface.encodeFunctionData('setGreeting', [greeting]);
  //
  //     const op = await zkTeamAccount.createProvedUserOp({
  //         ...inputs,
  //         target,
  //         data,
  //     });
  //
  //     const uoHash = await zkTeamAccount.sendUserOp(op);
  //     const txHash = await zkTeamAccount.getUserOpReceipt(uoHash);
  //     expect(await greeter.greet()).to.equal(greeting);
  //
  //     user = {
  //         oldNullifierHash: inputs.oldNullifierHash,
  //         oldNullifier: newNullifier,
  //         oldSecret: newSecret,
  //         oldKey: newKey,
  //         oldNonce: newNonce,
  //     }
  // })

  it("Should allow the admin to cancel the user's allowance ", async function () {
    const commitmentHashes = await adminInstance.getCommitmentHashes();
    const txHashes = await adminInstance.discardCommitmentHashes(
      commitmentHashes.slice(-1)
    );
    await Promise.all(
      txHashes.map(function (txHash) {
        return processTx(txHash);
      })
    );
  });
});

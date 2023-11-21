const hre = require("hardhat");
const { ethers } = hre;

import { expect } from "chai";

import { ZkTeamClientAdmin, ZkTeamClientUser } from "../src/ZkTeamClient";
import { encryptAllowance } from "../src/Utils/encryption";

import { deployAll } from "../scripts/deploy";
import { setAdmin, setAccount, processTx, processOp } from "./ZkTeamCore.spec";

import "./ZkTeamClient.spec";

describe("Anomaly Detection", function () {
  let config;
  let adminInstance;
  let userInstances: Array<ZkTeamClientUser> = [];
  let greeter;
  let anomalies: Array<bigint> = [];

  it("Should deploy the framework", async function () {
    const [deployer] = await ethers.getSigners();
    config = await deployAll();
    const Greeter = await ethers.getContractFactory("Greeter");
    greeter = Greeter.attach(config.greeter.address);
    const admin = await setAdmin(deployer, config);
    await setAccount(deployer, admin, 0, config);
    const mnemonic = ethers.Wallet.createRandom().mnemonic.phrase;
    const key = ethers.utils.HDNode.fromMnemonic(mnemonic).extendedKey;
    adminInstance = new ZkTeamClientAdmin({
      provider: ethers.provider,
      signer: admin,
      index: 0,
      key,
      entryPointAddress: config.entrypoint.address,
      factoryAddress: config.factory.address,
    });
  });

  it("Should allow the admin to set the allowance for user #0, #1, #2", async function () {
    const allowance = ethers.utils.parseEther("0.005").toBigInt();
    for (let userIndex of [0, 1, 2]) {
      const op = await adminInstance.setAllowance(userIndex, allowance);
      await processOp(adminInstance, op, config);
      expect(await adminInstance.getAllowance(userIndex)).to.be.equal(
        allowance
      );
    }
  });

  it("Should allow user 0 to use its allowance once", async function () {
    const key = await adminInstance.getUserKey(0);
    const accountAddress = await adminInstance.getAccountAddress();
    const userInstance = new ZkTeamClientUser({
      provider: ethers.provider,
      accountAddress,
      key,
      entryPointAddress: config.entrypoint.address,
      factoryAddress: config.factory.address,
    });
    userInstances[0] = userInstance;

    const target = greeter.address;
    const value = ethers.utils.parseEther("0.001").toBigInt();
    const greeting = `User #0 is honest`;
    const data = greeter.interface.encodeFunctionData("setGreeting", [
      greeting,
    ]);

    const op = await userInstance.sendTransaction(target, value, data);
    await processOp(userInstance, op, config);

    expect(await greeter.greet()).to.equal(greeting);
    expect(await userInstance.getAllowance()).to.be.equal(
      ethers.utils.parseEther("0.004").toBigInt()
    );
  });

  it("Should allow user 1 to tampered with the balance", async function () {
    const key = await adminInstance.getUserKey(1);
    const accountAddress = await adminInstance.getAccountAddress();
    const userInstance = new ZkTeamClientUser({
      provider: ethers.provider,
      accountAddress,
      key,
      entryPointAddress: config.entrypoint.address,
      factoryAddress: config.factory.address,
    });
    userInstances[1] = userInstance;

    const target = greeter.address;
    const value = ethers.utils.parseEther("0.001").toBigInt();
    const greeting = `User #1 is a cheating the balance`;
    const data = greeter.interface.encodeFunctionData("setGreeting", [
      greeting,
    ]);
    const inputs = await userInstance.generateInputs(value);
    const index = await userInstance.getLastIndex(userInstance.key);
    const { k, i } = await ZkTeamClientUser.generateTriplet(
      userInstance.key,
      index
    );
    const tamperedAllowance = encryptAllowance(
      ethers.utils.parseEther("0.005").toBigInt(),
      k,
      i
    );
    anomalies.push(inputs.newCommitmentHash);
    const op = await userInstance.createProvedUserOp({
      ...inputs,
      encryptedAllowance: tamperedAllowance,
      target,
      data,
    });
    await processOp(userInstance, op, config);

    expect(await greeter.greet()).to.equal(greeting);
    expect(await adminInstance.getAllowance(1)).to.be.equal(
      ethers.utils.parseEther("0.005").toBigInt()
    );
  });

  let rogueKey;

  it("Should allow user 2 to steal the allowance", async function () {
    const key = await adminInstance.getUserKey(2);
    const accountAddress = await adminInstance.getAccountAddress();
    const userInstance = new ZkTeamClientUser({
      provider: ethers.provider,
      accountAddress,
      key,
      entryPointAddress: config.entrypoint.address,
      factoryAddress: config.factory.address,
    });
    userInstances[2] = userInstance;

    const target = greeter.address;
    const value = ethers.utils.parseEther("0.001").toBigInt();
    const greeting = "User #2 is taking away the balance";
    const data = greeter.interface.encodeFunctionData("setGreeting", [
      greeting,
    ]);

    const index = await userInstance.getLastIndex(userInstance.key);
    const oldTriplet = await ZkTeamClientUser.generateTriplet(
      userInstance.key,
      index - 1
    );
    const currentTriplet = await ZkTeamClientUser.generateTriplet(
      userInstance.key,
      index
    );

    rogueKey = ethers.utils.HDNode.fromMnemonic(
      ethers.Wallet.createRandom().mnemonic.phrase
    );
    const newTriplet = await ZkTeamClientUser.generateTriplet(rogueKey, 0);

    const rogueInputs = await userInstance.generateProofInputs({
      value,
      oldNullifierHash: ZkTeamClientUser.getNullifierHash(oldTriplet.n),
      oldNullifier: currentTriplet.n,
      oldSecret: currentTriplet.s,
      oldKey: oldTriplet.k,
      oldNonce: oldTriplet.i,
      newNullifier: newTriplet.n,
      newSecret: newTriplet.s,
      newKey: currentTriplet.k,
      newNonce: currentTriplet.i,
    });

    anomalies.push(rogueInputs.newCommitmentHash);

    const op = await userInstance.createProvedUserOp({
      ...rogueInputs,
      target,
      data,
    });
    await processOp(userInstance, op, config);

    expect(await greeter.greet()).to.equal(greeting);
    expect(await adminInstance.getAllowance(2)).to.be.equal(
      ethers.utils.parseEther("0.004").toBigInt()
    );
  });

  it("Should allow user 2 to use the stolen allowance", async function () {
    const userInstance = userInstances[2];

    const target = greeter.address;
    const value = ethers.utils.parseEther("0.002").toBigInt();
    const greeting = "User #2 is now using its rogue wallet";
    const data = greeter.interface.encodeFunctionData("setGreeting", [
      greeting,
    ]);

    const index = await userInstance.getLastIndex(userInstance.key);
    const oldTriplet = await ZkTeamClientUser.generateTriplet(
      userInstance.key,
      index - 1
    );
    const currentTriplet = await ZkTeamClientUser.generateTriplet(rogueKey, 0);
    const newTriplet = await ZkTeamClientUser.generateTriplet(rogueKey, 1);

    const rogueInputs = await userInstance.generateProofInputs({
      value: value,
      oldNullifierHash: ZkTeamClientUser.getNullifierHash(oldTriplet.n),
      oldNullifier: currentTriplet.n,
      oldSecret: currentTriplet.s,
      oldKey: oldTriplet.k,
      oldNonce: oldTriplet.i,
      newNullifier: newTriplet.n,
      newSecret: newTriplet.s,
      newKey: currentTriplet.k,
      newNonce: currentTriplet.i,
    });

    anomalies.push(rogueInputs.newCommitmentHash);

    const op = await userInstance.createProvedUserOp({
      ...rogueInputs,
      target,
      data,
    });
    await processOp(userInstance, op, config);

    expect(await greeter.greet()).to.equal(greeting);
    expect(await adminInstance.getAllowance(2)).to.be.equal(
      ethers.utils.parseEther("0.004").toBigInt()
    );
  });

  it("Should allow the admin to detect anomalies", async function () {
    const detectedAnomalies = await adminInstance.checkIntegrity(2);
    expect(
      detectedAnomalies.slice(detectedAnomalies.length - anomalies.length)
    ).to.have.all.members(anomalies);
  });

  it("Should allow the admin to correct anomalies", async function () {
    const detectedAnomalies = await adminInstance.checkIntegrity(2);
    const txHashes = await adminInstance.discardCommitmentHashes(
      detectedAnomalies
    );
    await Promise.all(
      txHashes.map(function (txHash) {
        return processTx(txHash);
      })
    );
  });

  it("Should no longer detect any anomaly", async function () {
    const detectedAnomalies = await adminInstance.checkIntegrity(2);
    expect(detectedAnomalies).to.have.length(0);
  });

  it("Should allow user 0 to use its allowance again", async function () {
    const userInstance = userInstances[0];

    const target = greeter.address;
    const value = ethers.utils.parseEther("0.002").toBigInt();
    const greeting = `User #0 is still honest`;
    const data = greeter.interface.encodeFunctionData("setGreeting", [
      greeting,
    ]);

    const op = await userInstance.sendTransaction(target, value, data);
    await processOp(userInstance, op, config);

    expect(await greeter.greet()).to.equal(greeting);
    expect(await userInstance.getAllowance()).to.be.equal(
      ethers.utils.parseEther("0.002").toBigInt()
    );
  });
});

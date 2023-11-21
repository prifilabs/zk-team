const hre = require("hardhat");
const { ethers } = hre;

import { expect } from "chai";

import {
  ZkTeamClientAdmin,
  ZkTeamClientUser,
  getAccounts,
} from "../src/ZkTeamClient";

import { deployAll } from "../scripts/deploy";
import {
  setAdmin,
  setAccount,
  generateGreeting,
  processOp,
} from "./ZkTeamCore.spec";

describe("ZkTeam Client", function () {
  let config;
  let greeter;
  let admin;
  let adminInstance;
  let userInstance;

  it("Should deploy the framework", async function () {
    const [deployer] = await ethers.getSigners();
    config = await deployAll();
    const Greeter = await ethers.getContractFactory("Greeter");
    greeter = Greeter.attach(config.greeter.address);
    admin = await setAdmin(deployer, config);
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

  it("Should allow the admin to set the allowance for user #0", async function () {
    const allowance = ethers.utils.parseEther("0.005").toBigInt();
    const op = await adminInstance.setAllowance(0, allowance);
    await processOp(adminInstance, op, config);
    expect(await adminInstance.checkAccountPhantom()).to.be.false;
  });

  it("Should allow the admin to get the allowance for user #0", async function () {
    const allowance = await adminInstance.getAllowance(0);
    expect(allowance).to.be.equal(ethers.utils.parseEther("0.005"));
  });

  it("Should allow the admin to get the balance for multiple accounts", async function () {
    const adminAddress = await admin.getAddress();
    const balances = await getAccounts(
      ethers.provider,
      config.factory.address,
      adminAddress,
      0,
      5
    );
    expect(balances[0]).to.have.property("exists", true);
    expect(balances[0]).to.have.property("balance").to.be.above(0);
    expect(balances.slice(1)).to.deep.equal(
      Array(4).fill({ balance: ethers.utils.parseEther("0"), exists: false })
    );
  });

  it("Should allow the admin to get the allowance for multiple users", async function () {
    const allowances = await adminInstance.getAllowances(0, 5);
    expect(allowances[0]).to.be.equal(ethers.utils.parseEther("0.005"));
    expect(allowances.slice(1)).to.deep.equal(Array(4).fill(null));
  });

  it("Should allow user 0 to get its allowance", async function () {
    const key = await adminInstance.getUserKey(0);
    const accountAddress = await adminInstance.getAccountAddress();
    userInstance = new ZkTeamClientUser({
      provider: ethers.provider,
      accountAddress,
      key,
      entryPointAddress: config.entrypoint.address,
      factoryAddress: config.factory.address,
    });
    const allowance = await userInstance.getAllowance();
    expect(allowance).to.be.equal(ethers.utils.parseEther("0.005"));
  });

  it("Should allow user 0 to use its allowance once", async function () {
    const target = greeter.address;
    const value = ethers.utils.parseEther("0.001").toBigInt();
    const greeting = generateGreeting();
    const data = greeter.interface.encodeFunctionData("setGreeting", [
      greeting,
    ]);
    const op = await userInstance.sendTransaction(target, value, data);
    await processOp(userInstance, op, config);
    expect(await greeter.greet()).to.equal(greeting);
    const allowance = await userInstance.getAllowance();
    expect(allowance).to.be.equal(ethers.utils.parseEther("0.004").toBigInt());
  });

  it("Should allow user 0 to use its allowance again", async function () {
    const target = greeter.address;
    const value = ethers.utils.parseEther("0.002").toBigInt();
    const greeting = generateGreeting();
    const data = greeter.interface.encodeFunctionData("setGreeting", [
      greeting,
    ]);
    const op = await userInstance.sendTransaction(target, value, data);
    await processOp(userInstance, op, config);
    expect(await greeter.greet()).to.equal(greeting);
    const allowance = await userInstance.getAllowance();
    expect(allowance).to.be.equal(ethers.utils.parseEther("0.002").toBigInt());
  });

  it("Should allow the admin to update the allowance for user #0", async function () {
    const allowance = ethers.utils.parseEther("0.005").toBigInt();
    const op = await adminInstance.setAllowance(0, allowance);
    await processOp(adminInstance, op, config);
    expect(await adminInstance.getAllowance(0)).to.be.equal(
      ethers.utils.parseEther("0.005").toBigInt()
    );
    expect(await userInstance.getAllowance()).to.be.equal(
      ethers.utils.parseEther("0.005").toBigInt()
    );
  });

  it("Should allow user 0 to use its allowance one more time", async function () {
    const target = greeter.address;
    const value = ethers.utils.parseEther("0.003").toBigInt();
    const greeting = generateGreeting();
    const data = greeter.interface.encodeFunctionData("setGreeting", [
      greeting,
    ]);
    const op = await userInstance.sendTransaction(target, value, data);
    await processOp(userInstance, op, config);
    expect(await greeter.greet()).to.equal(greeting);
    const allowance = await userInstance.getAllowance();
    expect(allowance).to.be.equal(ethers.utils.parseEther("0.002").toBigInt());
  });
});

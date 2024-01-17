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
  provisionAccount,
  generateGreeting,
  processOp,
} from "./ZkTeamCore.spec";

describe("ZkTeam Client", function () {
  let config;
  let greeter;
  let admin;
  let adminInstance;
  let userInstance;
  let transactions = [];

  it("Should deploy the framework", async function () {
    const [deployer] = await ethers.getSigners();
    config = await deployAll();
    const Greeter = await ethers.getContractFactory("Greeter");
    greeter = Greeter.attach(config.greeter.address);
    admin = await setAdmin(deployer, config);
    await setAccount(deployer, admin, 1, config);
    const mnemonic = ethers.Wallet.createRandom().mnemonic.phrase;
    const key = ethers.utils.HDNode.fromMnemonic(mnemonic).extendedKey;
    adminInstance = new ZkTeamClientAdmin({
      provider: ethers.provider,
      signer: admin,
      index: 1,
      key,
      entryPointAddress: config.entrypoint.address,
      factoryAddress: config.factory.address,
    });
  });

  it("Should allow the admin to set the allowance for user #0", async function () {
    const allowance = ethers.utils.parseEther("0.01").toBigInt();
    const op = await adminInstance.setAllowance(0, allowance);
    let txHash = await processOp(adminInstance, op, config);
    transactions.unshift(txHash);
    expect(await adminInstance.checkAccountPhantom()).to.be.false;
  });

  it("Should allow the admin to get info for user #0", async function () {
    const allowance = await adminInstance.getAllowance(0);
    expect(allowance).to.be.equal(ethers.utils.parseEther("0.01"));
  });

  it("Should allow user 0 to get its allowance", async function () {
    const { key } = await adminInstance.getUser(0);
    const accountAddress = await adminInstance.getAccountAddress();
    userInstance = new ZkTeamClientUser({
      provider: ethers.provider,
      accountAddress,
      key,
      entryPointAddress: config.entrypoint.address,
      factoryAddress: config.factory.address,
    });
    const allowance = await userInstance.getAllowance();
    expect(allowance).to.be.equal(ethers.utils.parseEther("0.01"));
  });

  it("Should allow user 0 to use its allowance", async function () {
    const target = greeter.address;
    const value = ethers.utils.parseEther("0.001").toBigInt();
    const greeting = generateGreeting();
    const data = greeter.interface.encodeFunctionData("setGreeting", [
      greeting,
    ]);
    const op = await userInstance.setTransaction(target, value, data);
    let txHash = await processOp(userInstance, op, config);
    transactions.unshift(txHash);
    expect(await greeter.greet()).to.equal(greeting);
    const allowance = await userInstance.getAllowance();
    expect(allowance).to.be.equal(ethers.utils.parseEther("0.009").toBigInt());
  });

  it("Should allow user 0 to use its allowance again", async function () {
    const target = greeter.address;
    const value = ethers.utils.parseEther("0.002").toBigInt();
    const greeting = generateGreeting();
    const data = greeter.interface.encodeFunctionData("setGreeting", [
      greeting,
    ]);
    const op = await userInstance.setTransaction(target, value, data);
    let txHash = await processOp(userInstance, op, config);
    transactions.unshift(txHash);
    expect(await greeter.greet()).to.equal(greeting);
    const allowance = await userInstance.getAllowance();
    expect(allowance).to.be.equal(ethers.utils.parseEther("0.007").toBigInt());
  });

  it("Should allow the admin to update the allowance for user #0", async function () {
    const allowance = ethers.utils.parseEther("0.02").toBigInt();
    const op = await adminInstance.setAllowance(0, allowance);
    let txHash = await processOp(adminInstance, op, config);
    transactions.unshift(txHash);
    expect(await adminInstance.getAllowance(0)).to.be.equal(
      ethers.utils.parseEther("0.02").toBigInt()
    );
    expect(await userInstance.getAllowance()).to.be.equal(
      ethers.utils.parseEther("0.02").toBigInt()
    );
  });

  it("Should allow user 0 to use its allowance one more time", async function () {
    const target = greeter.address;
    const value = ethers.utils.parseEther("0.003").toBigInt();
    const greeting = generateGreeting();
    const data = greeter.interface.encodeFunctionData("setGreeting", [
      greeting,
    ]);
    const op = await userInstance.setTransaction(target, value, data);
    let txHash = await processOp(userInstance, op, config);
    transactions.unshift(txHash);
    expect(await greeter.greet()).to.equal(greeting);
    const allowance = await userInstance.getAllowance();
    expect(allowance).to.be.equal(ethers.utils.parseEther("0.017").toBigInt());
  });
  
  it("Should allow the admin to get info for multiple accounts", async function () {
    const adminAddress = await admin.getAddress();
    const accounts = await getAccounts(
      ethers.provider,
      config.factory.address,
      adminAddress,
      0,
      5
    );
    expect(accounts[1]).to.have.property("exists", true);
    expect(accounts[1]).to.have.property("balance");
    expect(accounts[1].balance > BigInt(0)).to.be.true;
  });

  it("Should allow the admin to get info for multiple users", async function () {
    const users = await adminInstance.getUsers(0, 5);
    expect(users).to.have.lengthOf(5);
  });
  
  it("Should allow the admin to get most recent transactions", async function () {
    const txs = await adminInstance.getTransactions(0, 5);
    for(let i in txs){
        expect(txs[i]).to.have.property("transactionHash", transactions[i]);
        expect(txs[i]).to.have.property("userIndex", 0);
        expect(txs[i]).to.have.property("valid", true);
    }
  });
  
  it("Should allow user 0 to get most recent transactions", async function () {
    const txs = await userInstance.getTransactions(0, 5);
    for(let i in txs){
         expect(txs[i]).to.have.property("transactionHash", transactions[i]);
    }
  });
  
});

import { readFileSync, existsSync, writeFileSync } from "fs";
import { expect } from 'chai'

import { ethers } from "hardhat";

import * as ZkTeamAccountFactory from '@account-abstraction/contracts/artifacts/ZkTeamAccountFactory.json';
import * as VerifyingPaymaster from '@account-abstraction/contracts/artifacts/VerifyingPaymaster.json';

import { VerifyingPaymasterAPI } from "../src/utils/VerifyingPaymasterAPI";
import { ZkTeamCore, getFactory } from "../src/ZkTeamCore";

import { DefaultGasOverheads } from "@account-abstraction/sdk";

import { deployAll } from "../scripts/deploy"

async function topUp(from, address, minimumAmount, maximumAmount, provider){
    const balance = await provider.getBalance(address);
    if (balance.gte(minimumAmount)) return;
    const amount = maximumAmount.sub(balance);
    console.log(`Sending ${amount} to ${address}`)
    const tx = await from.sendTransaction({
        to: address,
        value: amount
    });
    return tx.wait();
}

export async function setAdminAccount(deployer, config){
    let admin;
    const filename = 'mnemonic.txt';
    if (existsSync(filename)){
        admin = ethers.Wallet.fromMnemonic(readFileSync(filename, 'utf-8'));
    }else{
        admin = ethers.Wallet.createRandom().connect(ethers.provider);
        writeFileSync(filename, wallet.mnemonic.phrase, 'utf-8');
    }
    const adminAddress = await admin.getAddress();
    console.log(`Admin address: ${adminAddress}`);
    await topUp(deployer, adminAddress, ethers.utils.parseEther('0.3'), ethers.utils.parseEther('0.5'), ethers.provider);
    const adminBalance = await ethers.provider.getBalance(adminAddress);
    console.log(`Admin balance: ${adminBalance} (${ethers.utils.formatEther(adminBalance)} eth)`)
    
    const factory = await getFactory(config);
    const accountAddress = await factory.getAddress(admin.address, 0);
    console.log(`Account #0 address: ${accountAddress}`);
    await topUp(deployer, accountAddress, ethers.utils.parseEther('0.3'), ethers.utils.parseEther('0.5'), ethers.provider);
    const accountBalance = await ethers.provider.getBalance(accountAddress);
    console.log(`Account #0 balance: ${accountBalance} (${ethers.utils.formatEther(accountBalance)} eth)`)
    
    return admin;
}

export function generateGreeting(){
    return `Hello ${Math.random().toString(36).slice(2)}`;
}

describe("ZkTeam Core", function () {
    
    this.timeout(100000);
    let config;
    let admin;
    let adminInstance;
    let user;
    let greeter;
  
    it("Should deploy the framework", async function () {         
        const [deployer] = await ethers.getSigners()
        config = await deployAll();
        admin = await setAdminAccount(deployer, config);
    })  
    
    it("Should allow the admin to set the user's allowance (signed transaction)", async function () {

      adminInstance = new ZkTeamCore({
           provider: ethers.provider,
           signer: admin,
           index: 0,
           entryPointAddress: config.entrypoint.address,
           factoryAddress: config.factory.address,
           bundler: config.bundler
      });

      const oldNullifier = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt();

      const newAllowance = ethers.utils.parseEther("0.005").toBigInt();
      const newNullifier = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt();
      const newSecret = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt();
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
      const data = greeter.interface.encodeFunctionData('setGreeting', [greeting]);

      const op = await adminInstance.createSignedUserOp({ ...inputs, target, data });
            
      // console.log("UserOperation: ", await ethers.utils.resolveProperties(op));
            
      const uoHash = await adminInstance.sendUserOp(op);
      console.log(`UserOperation hash: ${uoHash}`);

      const txHash = await adminInstance.getUserOpReceipt(uoHash);
      console.log(`Transaction hash: ${txHash}`);

      const tx = await ethers.provider.getTransaction(txHash);
      const receipt = await tx.wait()
      const gasCost = receipt.gasUsed.mul(receipt.effectiveGasPrice);
      console.log(`Gas cost: ${gasCost} (${ethers.utils.formatEther(gasCost)} eth)`);
      expect(await greeter.greet()).to.equal(greeting);

      user = {
          oldNullifierHash: inputs.oldNullifierHash,
          oldNullifier: newNullifier,
          oldSecret: newSecret,
          oldKey: newKey,
          oldNonce: newNonce,
      }
  })
  
  it("Should allow a user to use its allowance (proved transaction)", async function () {

      const userInstance = new ZkTeamCore({
          provider: ethers.provider,
          accountAddress: await adminInstance.getAccountAddress(),
          entryPointAddress: config.entrypoint.address,
          factoryAddress: config.factory.address,
          bundler: config.bundler,
      });

      const value = ethers.utils.parseEther("0.001").toBigInt();
      
      const newNullifier = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt();
      const newSecret = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt();
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
      const data = greeter.interface.encodeFunctionData('setGreeting', [greeting]);

      const op = await userInstance.createProvedUserOp({
          ...inputs,
          target,
          data,
      });  
            
      // console.log("UserOperation: ", await ethers.utils.resolveProperties(op));
            
      const uoHash = await adminInstance.sendUserOp(op);
      console.log(`UserOperation hash: ${uoHash}`);

      const txHash = await adminInstance.getUserOpReceipt(uoHash);
      console.log(`Transaction hash: ${txHash}`);

      const tx = await ethers.provider.getTransaction(txHash);
      const receipt = await tx.wait()
      const gasCost = receipt.gasUsed.mul(receipt.effectiveGasPrice);
      console.log(`Gas cost: ${gasCost} (${ethers.utils.formatEther(gasCost)} eth)`);
      expect(await greeter.greet()).to.equal(greeting);
      
      user = {
          oldNullifierHash: inputs.oldNullifierHash,
          oldNullifier: newNullifier,
          oldSecret: newSecret,
          oldKey: newKey,
          oldNonce: newNonce,
      }
  })
  
  it.skip("Should allow a user to use its allowance (proved transaction with Paymaster)", async function () {

      const VerifyingPaymasterFactory = await ethers.getContractFactory(VerifyingPaymaster.abi, VerifyingPaymaster.bytecode);
      const verifyingPaymaster = await VerifyingPaymasterFactory.deploy(config.entrypoint.address, await admin.getAddress());
      const verifyingPaymasterApi = new VerifyingPaymasterAPI(verifyingPaymaster, admin);

      await verifyingPaymaster.connect(admin).deposit({
          value: ethers.utils.parseEther('0.01'),
      })

      await verifyingPaymaster.addStake(21600, { value: ethers.utils.parseEther('0.01') })

      const zkTeamAccount = new ZkTeamCore({
          provider: ethers.provider,
          accountAddress: await adminInstance.getAccountAddress(),
          entryPointAddress: config.entrypoint.address,
          factoryAddress: config.factory.address,
          overheads: {zeroByte: DefaultGasOverheads.nonZeroByte},
          paymasterAPI: verifyingPaymasterApi,
          bundler: config.bundler
      });

      const value = ethers.utils.parseEther("0.001").toBigInt();
      
      const newNullifier = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt();
      const newSecret = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt();
      const newKey = ethers.utils.randomBytes(32);
      const newNonce = ethers.utils.randomBytes(24);
      
      const inputs = await zkTeamAccount.generateProofInputs({
          ...user,
          value,
          newNullifier,
          newSecret,
          newKey,
          newNonce,
      });
            
      const target = greeter.address;
      const greeting = generateGreeting();
      const data = greeter.interface.encodeFunctionData('setGreeting', [greeting]);

      const op = await zkTeamAccount.createProvedUserOp({
          ...inputs,
          target,
          data,
      });
            
      const uoHash = await zkTeamAccount.sendUserOp(op);
      const txHash = await zkTeamAccount.getUserOpReceipt(uoHash);
      expect(await greeter.greet()).to.equal(greeting);
     
      user = {
          oldNullifierHash: inputs.oldNullifierHash,
          oldNullifier: newNullifier,
          oldSecret: newSecret,
          oldKey: newKey,
          oldNonce: newNonce,
      }
  })
  
  it.skip("Should allow the admin to cancel the user's allowance ", async function () {
      
      const commitmentHashes = await adminInstance.getCommitmentHashes();
      await adminInstance.discardCommitmentHashes(commitmentHashes.slice(-1));
  });
 
});

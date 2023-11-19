import { expect } from 'chai'

import { ethers } from "hardhat";

import * as VerifyingPaymaster from '@account-abstraction/contracts/artifacts/VerifyingPaymaster.json';

import { VerifyingPaymasterAPI } from "../src/utils/VerifyingPaymasterAPI";
import { ZkTeamCore } from "../src/ZkTeamCore";

import { DefaultGasOverheads } from "@account-abstraction/sdk";

import { deployAll, deployContract, useWallet, topUp } from "../src/Deploy";

const MNEMONIC_FILE = 'mnemonic.txt';

function generateGreeting(){
    return `Hello ${Math.random().toString(36).slice(2)}`;
}

describe.only("ZkTeam Core", function () {
    
    this.timeout(300000);
    let config;
    let admin;
    let adminInstance;
    let user;
    let greeter;
  
    it("Should deploy the framework", async function () {         
                    
        const [deployer] = await ethers.getSigners()
        console.log('Deployer address:', deployer.address)
        const balance = await deployer.getBalance();
        console.log(`Deployer balance: ${balance} (${ethers.utils.formatEther(balance)} eth)`)

        config = await deployAll();
        admin = useWallet(MNEMONIC_FILE, ethers.utils.parseEther('0.5'));
        const adminAddress = await admin.getAddress();
        console.log(`Admin address: ${adminAddress}`);
        await topUp(deployer, adminAddress, ethers.utils.parseEther('0.3'), ethers.utils.parseEther('0.5'), ethers.provider);
        const adminBalance = await ethers.provider.getBalance(adminAddress);
        console.log(`Admin balance: ${adminBalance} (${ethers.utils.formatEther(adminBalance)} eth)`)

        adminInstance = new ZkTeamCore({
             provider: ethers.provider,
             signer: admin,
             index: 0,
             entryPointAddress: config.entrypoint.address,
             factoryAddress: config.factory.address,
             bundler: config.bundler
        });

        const accountAddress = await adminInstance.getAccountAddress();
        console.log(`Account address: ${accountAddress}`);
        await topUp(deployer, accountAddress, ethers.utils.parseEther('0.3'), ethers.utils.parseEther('0.5'), ethers.provider);
        const accountBalance = await ethers.provider.getBalance(accountAddress);
        console.log(`Account balance: ${accountBalance} (${ethers.utils.formatEther(accountBalance)} eth)`)
    })  
    
  it("Should allow the admin to set the user's allowance (signed transaction)", async function () {

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
            
      console.log("UserOperation: ", await ethers.utils.resolveProperties(op));
            
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
            
      console.log("UserOperation: ", await ethers.utils.resolveProperties(op));
            
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

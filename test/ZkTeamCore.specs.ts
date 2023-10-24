import { expect } from 'chai'

import { ethers } from "hardhat";

import * as VerifyingPaymaster from '@account-abstraction/contracts/artifacts/VerifyingPaymaster.json';

import { VerifyingPaymasterAPI } from "../src/utils/VerifyingPaymasterAPI";
import { ZkTeamCore } from "../src/ZkTeamCore";

import { DefaultGasOverheads } from "@account-abstraction/sdk";

import { deployAll } from "../src/utils/deploy";

describe("ZkTeam Core", function () {
    
    let init;
    let admin;
    let user;
  
    it("Should deploy the framework", async function () { 
        
        const chainId = (await hre.ethers.provider.getNetwork()).chainId;
        
        init = await deployAll(chainId);
        admin = (await ethers.getSigners())[0];
        
        const accountAddress = await init.zkTeamAccountFactory.getAddress(await admin.getAddress(), 0);
        
        init = {...init, accountAddress};

        await admin.sendTransaction({
            to: accountAddress,
            value: ethers.utils.parseEther('100'), 
        })

        expect(await init.greeter.greet()).to.equal("Hello World!");
                        
    })  
    
  it("Should allow the admin to set the user's allowance (signed transaction)", async function () {

      const zkTeamAccount = new ZkTeamCore({
          provider: ethers.provider,
          signer: admin,
          index: 0,
          entryPointAddress: init.entryPointAddress,
          factoryAddress: init.zkTeamAccountFactory.address,
      });

      const oldNullifier = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt();

      const newAllowance = ethers.utils.parseEther("50").toBigInt();
      const newNullifier = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt();
      const newSecret = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt();
      const newKey = ethers.utils.randomBytes(32);
      const newNonce = ethers.utils.randomBytes(24);

      const inputs = await zkTeamAccount.generateSignatureInputs({
          oldNullifier,
          newAllowance,
          newNullifier,
          newSecret,
          newKey,
          newNonce,
      });

      const target = init.greeter.address;
      const greeting = "Hola Mundo!";
      const data = init.greeter.interface.encodeFunctionData('setGreeting', [greeting]);

      const op = await zkTeamAccount.createSignedUserOp({ ...inputs, target, data });

      // console.log("\nSigned UserOperation: ", await ethers.utils.resolveProperties(op));

      const uoHash = await init.sendUserOp(op);
      // console.log(`\nUserOperation sent to bundler - UserOperation hash: ${uoHash}`);

      // const txHash = await zkTeamAccount.getUserOpReceipt(uoHash);
      // console.log(`\nUserOperation executed - Transaction hash: ${txHash}`);

      expect(await init.greeter.greet()).to.equal(greeting);

      user = {
          oldNullifierHash: inputs.oldNullifierHash,
          oldNullifier: newNullifier,
          oldSecret: newSecret,
          oldKey: newKey,
          oldNonce: newNonce,
      }
  })
  
  it("Should allow a user to use its allowance (proved transaction)", async function () {

      const zkTeamAccount = new ZkTeamCore({
          provider: ethers.provider,
          accountAddress: init.accountAddress,
          entryPointAddress: init.entryPointAddress,
          factoryAddress: init.factoryAddress,
      });

      const value = ethers.utils.parseEther("2.5").toBigInt();
      
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
            
      const target = init.greeter.address;
      const greeting = "Hallo Welt!";
      const data = init.greeter.interface.encodeFunctionData('setGreeting', [greeting]);

      const op = await zkTeamAccount.createProvedUserOp({
          ...inputs,
          target,
          data,
      });
      await init.sendUserOp(op);
      expect(await init.greeter.greet()).to.equal(greeting);
      
      user = {
          oldNullifierHash: inputs.oldNullifierHash,
          oldNullifier: newNullifier,
          oldSecret: newSecret,
          oldKey: newKey,
          oldNonce: newNonce,
      }
  })
  
  it("Should allow a user to use its allowance (proved transaction with Paymaster)", async function () {

      const VerifyingPaymasterFactory = await ethers.getContractFactory(VerifyingPaymaster.abi, VerifyingPaymaster.bytecode);
      const verifyingPaymaster = await VerifyingPaymasterFactory.deploy(init.entryPointAddress, await admin.getAddress());
      const verifyingPaymasterApi = new VerifyingPaymasterAPI(verifyingPaymaster, admin);

      await verifyingPaymaster.connect(admin).deposit({
          value: ethers.utils.parseEther('0.1'),
      })

      await verifyingPaymaster.addStake(21600, { value: ethers.utils.parseEther('0.01') })

      const zkTeamAccount = new ZkTeamCore({
          provider: ethers.provider,
          accountAddress: init.accountAddress,
          entryPointAddress: init.entryPointAddress,
          factoryAddress: init.zkTeamAccountFactoryAddress,
          overheads: {zeroByte: DefaultGasOverheads.nonZeroByte},
          paymasterAPI: verifyingPaymasterApi,
      });

      const value = ethers.utils.parseEther("3").toBigInt();
      
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
            
      const target = init.greeter.address;
      const greeting = "Bonjour Le Monde!";
      const data = init.greeter.interface.encodeFunctionData('setGreeting', [greeting]);

      const op = await zkTeamAccount.createProvedUserOp({
          ...inputs,
          target,
          data,
      });
      await init.sendUserOp(op);
      expect(await init.greeter.greet()).to.equal(greeting);
     
      user = {
          oldNullifierHash: inputs.oldNullifierHash,
          oldNullifier: newNullifier,
          oldSecret: newSecret,
          oldKey: newKey,
          oldNonce: newNonce,
      }
  })
  
  it("Should allow the admin to cancel the user's allowance ", async function () {

      const zkTeamAccount = new ZkTeamCore({
          provider: ethers.provider,
          signer: admin,
          index: 0,
          entryPointAddress: init.entryPointAddress,
          factoryAddress: init.zkTeamAccountFactory.address,
      });
      
      const commitmentHashes = await zkTeamAccount.getCommitmentHashes();
      await zkTeamAccount.discardCommitmentHashes(commitmentHashes.slice(-1));
  });
  
  it.skip("Should not allow a user to use its allowance", async function () {

      const zkTeamAccount = new ZkTeamCore({
          provider: ethers.provider,
          accountAddress: init.accountAddress,
          entryPointAddress: init.entryPointAddress,
          factoryAddress: init.factoryAddress,
      });

      const value = ethers.utils.parseEther("1").toBigInt();
      
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
            
      const target = init.greeter.address;
      const greeting = "Why not?";
      const data = init.greeter.interface.encodeFunctionData('setGreeting', [greeting]);

      const op = await zkTeamAccount.createProvedUserOp({
          ...inputs,
          target,
          data,
      });
      await init.sendUserOp(op);
      expect(await init.greeter.greet()).to.not.equal(greeting);
  })

});

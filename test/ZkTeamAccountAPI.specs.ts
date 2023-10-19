import { expect } from 'chai'

import { ethers } from "hardhat";

import * as VerifyingPaymaster from '@account-abstraction/contracts/artifacts/VerifyingPaymaster.json';

import { VerifyingPaymasterAPI } from "../src/VerifyingPaymasterAPI";
import { ZkTeamAccountAPI } from "../src/ZkTeamAccountAPI";

import { DefaultGasOverheads } from "@account-abstraction/sdk";

import { MerkleTree } from "../src/MerkleTree"
import { poseidon1, poseidon3 } from "poseidon-lite"

import { deployEntrypointAndBundlerHardhat, deployEntrypointAndBundlerHardhat, deployPoseidon, deployZkTeamFactory } from "../src/Deploy";

describe("ZkTeam Account API", function () {
    
    let config;
  
    it("Should deploy the framework", async function () { 
        const chainId = (await hre.ethers.provider.getNetwork()).chainId;
        
        let init = (chainId == 1337)? await deployEntrypointAndBundlerLocal() :  await deployEntrypointAndBundlerHardhat() ;

        await deployPoseidon();
    
        const zkTeamAccountFactory = await deployZkTeamFactory(chainId, init.entryPointAddress);

        const [admin] = await ethers.getSigners();
        
        const accountAddress = await zkTeamAccountFactory.getAddress(admin.address, 0);

        await admin.sendTransaction({
            to: accountAddress,
            value: ethers.utils.parseEther('100'), 
        })

        const Greeter = await ethers.getContractFactory("Greeter");
        const greeter = await Greeter.deploy("Hello World!");

        expect(await greeter.greet()).to.equal("Hello World!");
                        
        context = { ...init, admin, greeter, factoryAddress: zkTeamAccountFactory.address }
    })  
    
  it("Should allow the admin to sign a transaction (without Paymaster)", async function () {
               
      const zkTeamAccount = new ZkTeamAccountAPI({
          provider: ethers.provider,
          signer: context.admin,
          index: 0,
          entryPointAddress: context.entryPointAddress,
          factoryAddress: context.factoryAddress,
      });
            
      const oldNullifier = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt();
      const oldNullifierHash  = poseidon1([oldNullifier]);
      
      const newAllowance = ethers.utils.parseEther("10").toBigInt();
      const newNullifier = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt();
      const newSecret = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt();
      const newCommitmentHash = poseidon3([newNullifier, newSecret, newAllowance]);      
      
      const commitmentHashes = await zkTeamAccount.getCommitmentHashes();
      const merkleTree = new MerkleTree(commitmentHashes);
      merkleTree.insert(newCommitmentHash);
      const newRoot = merkleTree.getRoot();

      const privateInputs = { oldNullifierHash, newCommitmentHash, newRoot };
      
      const op = await zkTeamAccount.createSignedUserOp({
          ...privateInputs,
          encryptedAllowance: ethers.utils.formatBytes32String("dummy"),
          target: context.greeter.address,
          data: context.greeter.interface.encodeFunctionData('setGreeting', ["Hola Mundo!"]),
          gasLimit: 1000000 // Bug: the function estimateGas does not give the right result when adding things to do in the contract's execute function
      });

      // console.log("\nSigned UserOperation: ", await ethers.utils.resolveProperties(op));
     
      const uoHash = await context.sendUserOp(op);
      // console.log(`\nUserOperation sent to bundler - UserOperation hash: ${uoHash}`);

      // const txHash = await zkTeamAccount.getUserOpReceipt(uoHash);
      // console.log(`\nUserOperation executed - Transaction hash: ${txHash}`);
      
      expect(await context.greeter.greet()).to.equal("Hola Mundo!");
                  
      context = { 
          ...context,
          allowance: newAllowance, 
          nullifier: newNullifier, 
          secret: newSecret,
          accountAddress: await zkTeamAccount.getAccountAddress()
      }; 
  })
  
  it("Should allow any user to prove a transaction (without Paymaster)", async function () {
                       
      const zkTeamAccount = new ZkTeamAccountAPI({
          provider: ethers.provider,
          accountAddress: context.accountAddress,
          entryPointAddress: context.entryPointAddress,
          factoryAddress: context.factoryAddress,
      });
      
      const value = ethers.utils.parseEther("2.5").toBigInt();
      
      const oldAllowance = context.allowance; // should be 10;
      const oldNullifier = context.nullifier;
      const oldSecret = context.secret;
      const oldNullifierHash  = poseidon1([oldNullifier]);
      const oldCommitmentHash = poseidon3([oldNullifier, oldSecret, oldAllowance]);  
      
      const commitmentHashes = await zkTeamAccount.getCommitmentHashes();
      const merkleTree = new MerkleTree(commitmentHashes);
      
      const oldRoot = merkleTree.getRoot();
      const { treeSiblings:oldTreeSiblings, treePathIndices:oldTreePathIndices} = merkleTree.getProof(oldCommitmentHash)
      
      const newAllowance = ethers.utils.parseEther("7.5").toBigInt();
      const newNullifier = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt();
      const newSecret = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt();
      const newCommitmentHash = poseidon3([newNullifier, newSecret, newAllowance]);
      
      merkleTree.insert(newCommitmentHash);
      const newRoot = merkleTree.getRoot();
      const { treeSiblings:newTreeSiblings, treePathIndices:newTreePathIndices} = merkleTree.getProof(newCommitmentHash)

      const privateInputs = {
          value,
          oldAllowance,
          oldNullifier,
          oldSecret,
          oldNullifierHash,
          oldRoot,
          oldTreeSiblings,
          oldTreePathIndices,
          newAllowance,
          newNullifier,
          newSecret,
          newCommitmentHash,
          newRoot,
          newTreeSiblings,
          newTreePathIndices,
      };
                  
      const op = await zkTeamAccount.createProvedUserOp({
          ...privateInputs,
          encryptedAllowance: ethers.utils.formatBytes32String("dummy"),
          target: context.greeter.address,
          data: context.greeter.interface.encodeFunctionData('setGreeting', ["Hallo Welt!"]),
          gasLimit: 1000000 // Bug: the function estimateGas does not give the right result when adding things to do in the contract's execute function
      });
      
      // console.log("\nSigned UserOperation: ", await ethers.utils.resolveProperties(op));
      
      await context.sendUserOp(op);
      
      expect(await context.greeter.greet()).to.equal("Hallo Welt!");
            
      context = { 
          ...context, 
          allowance: privateInputs.newAllowance, 
          nullifier: privateInputs.newNullifier, 
          secret: privateInputs.newSecret, 
      };      
  })
  
  it("Should allow any user to prove a transaction (with Paymaster)", async function () {

      const VerifyingPaymasterFactory = await ethers.getContractFactory(VerifyingPaymaster.abi, VerifyingPaymaster.bytecode);
      const verifyingPaymaster = await VerifyingPaymasterFactory.deploy(context.entryPointAddress, await context.admin.getAddress());
      const verifyingPaymasterApi = new VerifyingPaymasterAPI(verifyingPaymaster, context.admin);

      await verifyingPaymaster.connect(context.admin).deposit({
          value: ethers.utils.parseEther('0.1'),
      })
      
      await verifyingPaymaster.addStake(21600, { value: ethers.utils.parseEther('0.01') })
                  
      const zkTeamAccount = new ZkTeamAccountAPI({
          provider: ethers.provider,
          accountAddress: context.accountAddress,
          entryPointAddress: context.entryPointAddress,
          factoryAddress: context.zkTeamAccountFactoryAddress,
          overheads: {zeroByte: DefaultGasOverheads.nonZeroByte},
          paymasterAPI: verifyingPaymasterApi,
      });
      
      const value = ethers.utils.parseEther("3").toBigInt();
      
      const oldAllowance = context.allowance; // should be 7.5;
      const oldNullifier = context.nullifier;
      const oldSecret = context.secret;
      const oldNullifierHash  = poseidon1([oldNullifier]);
      const oldCommitmentHash = poseidon3([oldNullifier, oldSecret, oldAllowance]);  
      
      const commitmentHashes = await zkTeamAccount.getCommitmentHashes();
      const merkleTree = new MerkleTree(commitmentHashes);
      
      const oldRoot = merkleTree.getRoot();
      const { treeSiblings:oldTreeSiblings, treePathIndices:oldTreePathIndices} = merkleTree.getProof(oldCommitmentHash)
      
      const newAllowance = ethers.utils.parseEther("4.5").toBigInt();
      const newNullifier = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt();
      const newSecret = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt();
      const newCommitmentHash = poseidon3([newNullifier, newSecret, newAllowance]);
      
      merkleTree.insert(newCommitmentHash);
      const newRoot = merkleTree.getRoot();
      const { treeSiblings:newTreeSiblings, treePathIndices:newTreePathIndices} = merkleTree.getProof(newCommitmentHash)

      const privateInputs = {
          value,
          oldAllowance,
          oldNullifier,
          oldSecret,
          oldNullifierHash,
          oldRoot,
          oldTreeSiblings,
          oldTreePathIndices,
          newAllowance,
          newNullifier,
          newSecret,
          newCommitmentHash,
          newRoot,
          newTreeSiblings,
          newTreePathIndices,
      };

      const op = await zkTeamAccount.createProvedUserOp({
          ...privateInputs,
          encryptedAllowance: ethers.utils.formatBytes32String("dummy"),
          target: context.greeter.address,
          data: context.greeter.interface.encodeFunctionData('setGreeting', ["Bonjour Le Monde!"]),
          gasLimit: 1000000 // Bug: the function estimateGas does not give the right result when adding things to do in the contract's execute function
      });

      await context.sendUserOp(op);  
            
      expect(await context.greeter.greet()).to.equal("Bonjour Le Monde!")
      
  })

});

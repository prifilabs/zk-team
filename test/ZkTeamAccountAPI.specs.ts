import { expect } from 'chai'

import { ethers } from "hardhat";

import * as VerifyingPaymaster from '@account-abstraction/contracts/artifacts/VerifyingPaymaster.json';

import { VerifyingPaymasterAPI } from "../src/VerifyingPaymasterAPI";
import { ZkTeamAccountAPI } from "../src/ZkTeamAccountAPI";

import { DefaultGasOverheads } from "@account-abstraction/sdk";

import { MerkleTree } from "../src/MerkleTree"
import { poseidon1, poseidon3 } from "poseidon-lite"

import { deployAll } from "../src/Deploy";

describe("ZkTeam Account API", function () {
    
    let init;
    let admin;
    let triplet;
  
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
    
  it("Should allow the admin to sign a transaction (without Paymaster)", async function () {
               
      const zkTeamAccount = new ZkTeamAccountAPI({
          provider: ethers.provider,
          signer: admin,
          index: 0,
          entryPointAddress: init.entryPointAddress,
          factoryAddress: init.zkTeamAccountFactory.address,
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
          target: init.greeter.address,
          data: init.greeter.interface.encodeFunctionData('setGreeting', ["Hola Mundo!"]),
          gasLimit: 1000000 // Bug: the function estimateGas does not give the right result when adding things to do in the contract's execute function
      });

      // console.log("\nSigned UserOperation: ", await ethers.utils.resolveProperties(op));
     
      const uoHash = await init.sendUserOp(op);
      // console.log(`\nUserOperation sent to bundler - UserOperation hash: ${uoHash}`);

      // const txHash = await zkTeamAccount.getUserOpReceipt(uoHash);
      // console.log(`\nUserOperation executed - Transaction hash: ${txHash}`);
      
      expect(await init.greeter.greet()).to.equal("Hola Mundo!");
      
      triplet = { 
          allowance: newAllowance, 
          nullifier: newNullifier, 
          secret: newSecret
      }
  })
  
  it("Should allow any user to prove a transaction (without Paymaster)", async function () {
                       
      const zkTeamAccount = new ZkTeamAccountAPI({
          provider: ethers.provider,
          accountAddress: init.accountAddress,
          entryPointAddress: init.entryPointAddress,
          factoryAddress: init.factoryAddress,
      });
      
      const value = ethers.utils.parseEther("2.5").toBigInt();
      
      const oldAllowance = triplet.allowance; // should be 10;
      const oldNullifier = triplet.nullifier;
      const oldSecret = triplet.secret;
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
          target: init.greeter.address,
          data: init.greeter.interface.encodeFunctionData('setGreeting', ["Hallo Welt!"]),
          gasLimit: 1000000 // Bug: the function estimateGas does not give the right result when adding things to do in the contract's execute function
      });
      
      // console.log("\nSigned UserOperation: ", await ethers.utils.resolveProperties(op));
      
      await init.sendUserOp(op);
      
      expect(await init.greeter.greet()).to.equal("Hallo Welt!");
            
      triplet = { 
          allowance: privateInputs.newAllowance, 
          nullifier: privateInputs.newNullifier, 
          secret: privateInputs.newSecret, 
      };      
  })
  
  it("Should allow any user to prove a transaction (with Paymaster)", async function () {

      const VerifyingPaymasterFactory = await ethers.getContractFactory(VerifyingPaymaster.abi, VerifyingPaymaster.bytecode);
      const verifyingPaymaster = await VerifyingPaymasterFactory.deploy(init.entryPointAddress, await admin.getAddress());
      const verifyingPaymasterApi = new VerifyingPaymasterAPI(verifyingPaymaster, admin);

      await verifyingPaymaster.connect(admin).deposit({
          value: ethers.utils.parseEther('0.1'),
      })
      
      await verifyingPaymaster.addStake(21600, { value: ethers.utils.parseEther('0.01') })
                  
      const zkTeamAccount = new ZkTeamAccountAPI({
          provider: ethers.provider,
          accountAddress: init.accountAddress,
          entryPointAddress: init.entryPointAddress,
          factoryAddress: init.zkTeamAccountFactoryAddress,
          overheads: {zeroByte: DefaultGasOverheads.nonZeroByte},
          paymasterAPI: verifyingPaymasterApi,
      });
      
      const value = ethers.utils.parseEther("3").toBigInt();
      
      const oldAllowance = triplet.allowance; // should be 7.5;
      const oldNullifier = triplet.nullifier;
      const oldSecret = triplet.secret;
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
          target: init.greeter.address,
          data: init.greeter.interface.encodeFunctionData('setGreeting', ["Bonjour Le Monde!"]),
          gasLimit: 1000000 // Bug: the function estimateGas does not give the right result when adding things to do in the contract's execute function
      });

      await init.sendUserOp(op);  
            
      expect(await init.greeter.greet()).to.equal("Bonjour Le Monde!")
      
  })

});

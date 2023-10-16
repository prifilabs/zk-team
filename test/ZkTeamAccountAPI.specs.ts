import { expect } from 'chai'

import { ethers } from "hardhat";

import * as VerifyingPaymaster from '@account-abstraction/contracts/artifacts/VerifyingPaymaster.json';

import { VerifyingPaymasterAPI } from "../src/VerifyingPaymasterAPI";
import { ZkTeamAccountAPI } from "../src/ZkTeamAccountAPI";

import { DefaultGasOverheads } from "@account-abstraction/sdk";

import { IncrementalMerkleTree } from "@zk-kit/incremental-merkle-tree"
import { poseidon1, poseidon2, poseidon3 } from "poseidon-lite"

import { deployEntrypointAndBundlerHardhat, deployEntrypointAndBundlerHardhat, deployPoseidon, deployZkTeamFactory } from "../src/deploy";

describe("ERC-4337 Account Abstraction", function () {
    
    let config;
  
    it("Should deploy the framework", async function () { 
        const chainId = (await hre.ethers.provider.getNetwork()).chainId;
        
        let init = (chainId == 1337)? await deployEntrypointAndBundlerLocal() :  await deployEntrypointAndBundlerHardhat() ;

        await deployPoseidon();
    
        const zkTeamAccountFactory = await deployZkTeamFactory(chainId, init.entryPointAddress);

        const owner = ethers.Wallet.createRandom();
        const accountAddress = await zkTeamAccountFactory.getAddress(await owner.getAddress(), 0);

        const signer = ethers.provider.getSigner(0);
        await signer.sendTransaction({
            to: accountAddress,
            value: ethers.utils.parseEther('100'), 
        })

        const Greeter = await ethers.getContractFactory("Greeter");
        const greeter = await Greeter.deploy("Hello World!");

        expect(await greeter.greet()).to.equal("Hello World!");
        
        const tree = new IncrementalMerkleTree(poseidon2, 20, BigInt(0), 2, [42]);

        config = { ...init, zkTeamAccountFactory, greeter, owner, tree }
    })  
    
  it("Should allow the admin to sign a transaction (without Paymaster)", async function () {
               
      const zkTeamAccount = new ZkTeamAccountAPI({
          provider: ethers.provider,
          entryPointAddress: config.entryPointAddress,
          owner: config.owner,
          factoryAddress: config.zkTeamAccountFactory.address,
          index: 0,
      });
            
      const oldNullifier = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt();
      const oldNullifierHash  = poseidon1([oldNullifier]);
      
      const newBalance = ethers.utils.parseEther("10").toBigInt();
      const newNullifier = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt();
      const newSecret = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt();
      const newCommitmentHash = poseidon3([newNullifier, newSecret, newBalance]);
      config.tree.insert(newCommitmentHash);
      const newRoot = config.tree.root;

      const privateInputs = { oldNullifierHash, newCommitmentHash, newRoot };
      
      const op = await zkTeamAccount.createSignedUserOp({
          ...privateInputs,
          balanceEncrypted: ethers.utils.formatBytes32String("1"),
          target: config.greeter.address,
          data: config.greeter.interface.encodeFunctionData('setGreeting', ["Hola Mundo!"]),
          gasLimit: 1000000 // Bug: the function estimateGas does not give the right result when adding things to do in the contract's execute function
      });

      // console.log("\nSigned UserOperation: ", await ethers.utils.resolveProperties(op));
     
      const uoHash = await config.sendUserOp(op);
      // console.log(`\nUserOperation sent to bundler - UserOperation hash: ${uoHash}`);

      // const txHash = await zkTeamAccount.getUserOpReceipt(uoHash);
      // console.log(`\nUserOperation executed - Transaction hash: ${txHash}`);
      
      expect(await config.greeter.greet()).to.equal("Hola Mundo!");
                  
      config = { 
          ...config,
          balance: newBalance, 
          nullifier: newNullifier, 
          secret: newSecret,
      }; 
  })
  
  it("Should allow any user to prove a transaction (without Paymaster)", async function () {
                           
      const zkTeamAccount = new ZkTeamAccountAPI({
          provider: ethers.provider,
          entryPointAddress: config.entryPointAddress,
          owner: config.owner,
          factoryAddress: config.zkTeamAccountFactory.address,
          index: 0,
      });
      
      const value = ethers.utils.parseEther("2.5").toBigInt();
      
      const oldBalance = config.balance; // should be 10;
      const oldNullifier = config.nullifier;
      const oldSecret = config.secret;
      const oldNullifierHash  = poseidon1([oldNullifier]);
      const oldCommitmentHash = poseidon3([oldNullifier, oldSecret, oldBalance]);  
      const oldRoot = config.tree.root;
      const oldMerkleProof = config.tree.createProof(config.tree.indexOf(oldCommitmentHash));
      const oldTreeSiblings = oldMerkleProof.siblings.map( (s) => s[0]);
      const oldTreePathIndices = oldMerkleProof.pathIndices;
      
      const newBalance = ethers.utils.parseEther("7.5").toBigInt();
      const newNullifier = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt();
      const newSecret = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt();
      const newCommitmentHash = poseidon3([newNullifier, newSecret, newBalance]);
      config.tree.insert(newCommitmentHash);
      const newRoot = config.tree.root;
      const newMerkleProof = config.tree.createProof(config.tree.indexOf(newCommitmentHash));
      const newTreeSiblings = newMerkleProof.siblings.map( (s) => s[0]);
      const newTreePathIndices = newMerkleProof.pathIndices;

      const privateInputs = {
          value,
          oldBalance,
          oldNullifier,
          oldSecret,
          oldNullifierHash,
          oldRoot,
          oldTreeSiblings,
          oldTreePathIndices,
          newBalance,
          newNullifier,
          newSecret,
          newCommitmentHash,
          newRoot,
          newTreeSiblings,
          newTreePathIndices,
      };
                  
      const op = await zkTeamAccount.createProvedUserOp({
          ...privateInputs,
          balanceEncrypted: ethers.utils.formatBytes32String("1"),
          target: config.greeter.address,
          data: config.greeter.interface.encodeFunctionData('setGreeting', ["Hallo Welt!"]),
          gasLimit: 1000000 // Bug: the function estimateGas does not give the right result when adding things to do in the contract's execute function
      });
      
      // console.log("\nSigned UserOperation: ", await ethers.utils.resolveProperties(op));
      
      await config.sendUserOp(op);
      
      expect(await config.greeter.greet()).to.equal("Hallo Welt!");
            
      config = { 
          ...config, 
          balance: privateInputs.newBalance, 
          nullifier: privateInputs.newNullifier, 
          secret: privateInputs.newSecret, 
      };      
  })
  
  it("Should allow any user to prove a transaction (with Paymaster)", async function () {
      
      const owner = ethers.Wallet.createRandom();
      const ownerAddress = await owner.getAddress();
      const accountAddress = await config.zkTeamAccountFactory.getAddress(await owner.getAddress(), 0);

      const VerifyingPaymasterFactory = await ethers.getContractFactory(VerifyingPaymaster.abi, VerifyingPaymaster.bytecode);
      const verifyingPaymaster = await VerifyingPaymasterFactory.deploy(config.entryPointAddress, owner.address);
      const verifyingPaymasterApi = new VerifyingPaymasterAPI(verifyingPaymaster, owner);

      const signer = ethers.provider.getSigner(0);

      await verifyingPaymaster.connect(signer).deposit({
          value: ethers.utils.parseEther('0.1'),
      })
      
      await verifyingPaymaster.addStake(21600, { value: ethers.utils.parseEther('0.01') })
                  
      const zkTeamAccount = new ZkTeamAccountAPI({
          provider: ethers.provider,
          entryPointAddress: config.entryPointAddress,
          owner: config.owner,
          factoryAddress: config.zkTeamAccountFactory.address,
          overheads: {zeroByte: DefaultGasOverheads.nonZeroByte},
          paymasterAPI: verifyingPaymasterApi,
      });
      
      const value = ethers.utils.parseEther("3").toBigInt();
      
      const oldBalance = config.balance; // should be 7.5;
      const oldNullifier = config.nullifier;
      const oldSecret = config.secret;
      const oldNullifierHash  = poseidon1([oldNullifier]);
      const oldCommitmentHash = poseidon3([oldNullifier, oldSecret, oldBalance]);  
      const oldRoot = config.tree.root;
      const oldMerkleProof = config.tree.createProof(config.tree.indexOf(oldCommitmentHash));
      const oldTreeSiblings = oldMerkleProof.siblings.map( (s) => s[0]);
      const oldTreePathIndices = oldMerkleProof.pathIndices;
      
      const newBalance = ethers.utils.parseEther("4.5").toBigInt();
      const newNullifier = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt();
      const newSecret = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt();
      const newCommitmentHash = poseidon3([newNullifier, newSecret, newBalance]);
      config.tree.insert(newCommitmentHash);
      const newRoot = config.tree.root;
      const newMerkleProof = config.tree.createProof(config.tree.indexOf(newCommitmentHash));
      const newTreeSiblings = newMerkleProof.siblings.map( (s) => s[0]);
      const newTreePathIndices = newMerkleProof.pathIndices;

      const privateInputs = {
          value,
          oldBalance,
          oldNullifier,
          oldSecret,
          oldNullifierHash,
          oldRoot,
          oldTreeSiblings,
          oldTreePathIndices,
          newBalance,
          newNullifier,
          newSecret,
          newCommitmentHash,
          newRoot,
          newTreeSiblings,
          newTreePathIndices,
      };

            
      const op = await zkTeamAccount.createProvedUserOp({
          ...privateInputs,
          balanceEncrypted: ethers.utils.formatBytes32String("1"),
          target: config.greeter.address,
          data: config.greeter.interface.encodeFunctionData('setGreeting', ["Bonjour Le Monde!"]),
          gasLimit: 1000000 // Bug: the function estimateGas does not give the right result when adding things to do in the contract's execute function
      });

      await config.sendUserOp(op);  
            
      expect(await config.greeter.greet()).to.equal("Bonjour Le Monde!")
      
  })

});

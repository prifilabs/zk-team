import { expect } from 'chai'

import { ethers } from "hardhat";

import { deployAll } from "../src/Deploy";

import { ZkTeamClientAdmin, ZkTeamClientUser, getAccount, getAccounts } from "../src/ClientAPI";

import { MerkleTree } from "../src/MerkleTree";
import { poseidon1, poseidon3 } from "poseidon-lite"

describe.only("Anomaly Detection", function () {
    
    let config;
    let admin;
    let anomalies = [];
  
    it("Should deploy the framework", async function () { 
        const chainId = (await hre.ethers.provider.getNetwork()).chainId;
        
        const init = await deployAll(chainId);

        const [signer] = await ethers.getSigners();
        const mnemonic = ethers.Wallet.createRandom().mnemonic.phrase;
        const key = ethers.utils.HDNode.fromMnemonic(mnemonic).extendedKey;                                              
        const accountAddress = await init.zkTeamAccountFactory.getAddress(await signer.getAddress(), 0);

        await signer.sendTransaction({
            to: accountAddress,
            value: ethers.utils.parseEther('1000'), 
        })
        
        config = {
            ...init,
            accountAddress,
            factoryAddress: init.zkTeamAccountFactory.address, 
        }
        
        const client = new ZkTeamClientAdmin(ethers.provider, signer, 0, key, config);
        
        admin = {signer, key, client};
                    
    })  
    
  it("Should allow the admin to set the allowance for user #0, #1, #2", async function () {                               
     const allowance = ethers.utils.parseEther("100");
     for (let userIndex of [0,1,2]){
         await admin.client.setAllowance(userIndex, allowance);         
         expect(await admin.client.getAllowance(userIndex)).to.be.equal(allowance);
     }
  })
  
  it("Should allow user 0 to use its allowance once", async function () {
     const userKey = await admin.client.getUserKey(0);
     const userClient = new ZkTeamClientUser(ethers.provider, config.accountAddress, userKey, config);

     const target = config.greeter.address;
     const value = ethers.utils.parseEther("60");
     const greeting = `User #0 is honest`;
     const data = config.greeter.interface.encodeFunctionData('setGreeting', [greeting]);

     const txHash = await userClient.sendTransaction(target, value, data);
     expect(await config.greeter.greet()).to.equal(greeting);
     expect(await userClient.getAllowance()).to.be.equal(ethers.utils.parseEther("40"));
  })

  it("Should allow user 1 to tampered with the balance", async function () {
     const userKey = await admin.client.getUserKey(1);
     const userClient = new ZkTeamClientUser(ethers.provider, config.accountAddress, userKey, config);

     const target = config.greeter.address;
     const value = ethers.utils.parseEther("60");
     const greeting = `User #1 is a cheating the balance`;
     const data = config.greeter.interface.encodeFunctionData('setGreeting', [greeting]);

     const inputs = await userClient.generateInputs(value);

     const tamperedAllowance = ZkTeamClientUser.encryptAllowance(ethers.utils.parseEther("100").toBigInt(), inputs.k, inputs.i);

     anomalies.push(inputs.newCommitmentHash);

     const op = await userClient.createProvedUserOp({
         ...inputs,
         encryptedAllowance: tamperedAllowance,
         target,
         data,
         gasLimit: 1000000 // Bug: the function estimateGas does not give the right result when adding things to do in the contract's execute function
     });
     const uoHash = await config.sendUserOp(op);
     const txHash = await userClient.getUserOpReceipt(uoHash);

     expect(await config.greeter.greet()).to.equal(greeting);
     expect(await admin.client.getAllowance(1)).to.be.equal(ethers.utils.parseEther("100"));
  })
  
  it("Should allow user 2 to take away the balance", async function () {
     const userKey = await admin.client.getUserKey(2);
     const userClient = new ZkTeamClientUser(ethers.provider, config.accountAddress, userKey, config);

     const target = config.greeter.address;
     const value = ethers.utils.parseEther("30");
     const greeting = 'User #2 is taking away the balance';
     const data = config.greeter.interface.encodeFunctionData('setGreeting', [greeting]);

     const inputs = await userClient.generateInputs(value);
     
     const rogueKey = ethers.utils.HDNode.fromMnemonic(ethers.Wallet.createRandom().mnemonic.phrase);
     const {n, s} = await ZkTeamClientUser.generateTriplet(rogueKey, 0);
     const newNullifierHash  = poseidon1([n]);
     const newCommitmentHash  = poseidon3([n, s, inputs.newAllowance]);
     const commitmentHashes = await userClient.getCommitmentHashes();
     const tree = new MerkleTree(commitmentHashes);     
     tree.insert(newCommitmentHash);
     const newRoot = tree.getRoot();
     const { treeSiblings:newTreeSiblings, treePathIndices: newTreePathIndices} = tree.getProof(newCommitmentHash);

     anomalies.push(newCommitmentHash);

     const op = await userClient.createProvedUserOp({
         ...inputs,
         newNullifier: n,
         newSecret: s,
         newCommitmentHash,
         newRoot,
         newTreeSiblings,
         newTreePathIndices,
         target,
         data,
         gasLimit: 1000000 // Bug: the function estimateGas does not give the right result when adding things to do in the contract's execute function
     });
     const uoHash = await config.sendUserOp(op);
     const txHash = await userClient.getUserOpReceipt(uoHash);

     expect(await config.greeter.greet()).to.equal(greeting);
     expect(await admin.client.getAllowance(2)).to.be.equal(ethers.utils.parseEther("70"));
     
     const rogueGreeting = 'User #2 is now using its rogue wallet';
     const rogueData = config.greeter.interface.encodeFunctionData('setGreeting', [rogueGreeting]);
     
     const rogueValue = ethers.utils.parseEther("20").toBigInt();
     const {n: rogueN, s: rogueS, k: rogueK, i: rogueI} = await ZkTeamClientUser.generateTriplet(rogueKey, 1);
     const rogueAllowance = inputs.newAllowance - rogueValue;
     const rogueCommitmentHash  = poseidon3([rogueN, rogueS, rogueAllowance]);
     tree.insert(rogueCommitmentHash);
     const rogueRoot = tree.getRoot();
     const { treeSiblings:rogueTreeSiblings, treePathIndices: rogueTreePathIndices} = tree.getProof(rogueCommitmentHash);
     
     const rogueInputs = {
         value: rogueValue,
         oldAllowance: inputs.newAllowance,
         oldNullifier: n,
         oldSecret: s,
         oldNullifierHash: newNullifierHash,
         oldRoot: newRoot,
         oldTreeSiblings: newTreeSiblings,
         oldTreePathIndices: newTreePathIndices,
         newAllowance: rogueAllowance,
         newNullifier: rogueN,
         newSecret: rogueS,
         newCommitmentHash: rogueCommitmentHash,
         newRoot: rogueRoot,
         newTreeSiblings: rogueTreeSiblings,
         newTreePathIndices: rogueTreePathIndices,
     };
         
     const rogueEncryptedAllowance = ZkTeamClientUser.encryptAllowance(rogueAllowance, rogueK, rogueI);
     
     anomalies.push(rogueCommitmentHash);
     
     const rogueOp = await userClient.createProvedUserOp({
         ...rogueInputs,
         target,
         encryptedAllowance: rogueEncryptedAllowance,
         data: rogueData,
         gasLimit: 1000000 // Bug: the function estimateGas does not give the right result when adding things to do in the contract's execute function
     });
     
     const rogueUoHash = await config.sendUserOp(rogueOp);
     const rogueTxHash = await userClient.getUserOpReceipt(rogueUoHash);
     
     expect(await config.greeter.greet()).to.equal(rogueGreeting);
     expect(await admin.client.getAllowance(2)).to.be.equal(ethers.utils.parseEther("70"));
  })
  
    it("Should allow the admin to detect anomalies", async function () {
        const detectedAnomalies = await admin.client.checkIntegrity(2);
        expect(detectedAnomalies).to.have.all.members(anomalies)
    });
    
    it("Should allow the admin to correct anomalies", async function () {
        await admin.client.discardCommitmentHashes(anomalies);
    });
    
    it("Should no longer detect any anomaly", async function () {
        const detectedAnomalies = await admin.client.checkIntegrity(2);
        expect(detectedAnomalies).to.have.length(0);
    });
    
    it("Should allow user 0 to use its allowance again", async function () {
        const userKey = await admin.client.getUserKey(0);
        const userClient = new ZkTeamClientUser(ethers.provider, config.accountAddress, userKey, config);

        const target = config.greeter.address;
        const value = ethers.utils.parseEther("10");
        const greeting = `User #0 is still honest`;
        const data = config.greeter.interface.encodeFunctionData('setGreeting', [greeting]);

        const txHash = await userClient.sendTransaction(target, value, data);
        expect(await config.greeter.greet()).to.equal(greeting);
        expect(await userClient.getAllowance()).to.be.equal(ethers.utils.parseEther("30"));
    });
})
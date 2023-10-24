import { expect } from 'chai'
import { ethers } from "hardhat";

import { ZkTeamClientAdmin, ZkTeamClientUser, getAccount, getAccounts } from "../src/ZkTeamClient";
import { encryptAllowance } from "../src/utils/encryption";
import { deployAll } from "../src/utils/deploy";

describe("Anomaly Detection", function () {
    
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

     const index = await userClient.getLastIndex(userClient.key);
     const {k, i} = await ZkTeamClientUser.generateTriplet(userClient.key, index);
     
     const tamperedAllowance = encryptAllowance(ethers.utils.parseEther("100").toBigInt(), k, i);
     
     anomalies.push(inputs.newCommitmentHash);
     
     const op = await userClient.createProvedUserOp({
         ...inputs,
         encryptedAllowance: tamperedAllowance,
         target,
         data,
     });
     const uoHash = await config.sendUserOp(op);
     const txHash = await userClient.getUserOpReceipt(uoHash);

     expect(await config.greeter.greet()).to.equal(greeting);
     expect(await admin.client.getAllowance(1)).to.be.equal(ethers.utils.parseEther("100"));
  })
  
  let rogueKey;
  
  it("Should allow user 2 to steal the allowance", async function () {
     const userKey = await admin.client.getUserKey(2);
     const userClient = new ZkTeamClientUser(ethers.provider, config.accountAddress, userKey, config);

     const target = config.greeter.address;
     const value = ethers.utils.parseEther("30");
     const greeting = 'User #2 is taking away the balance';
     const data = config.greeter.interface.encodeFunctionData('setGreeting', [greeting]);
     
     const index = await userClient.getLastIndex(userClient.key);
     const oldTriplet = await ZkTeamClientUser.generateTriplet(userClient.key, index-1);
     const currentTriplet = await ZkTeamClientUser.generateTriplet(userClient.key, index);
     
     rogueKey = ethers.utils.HDNode.fromMnemonic(ethers.Wallet.createRandom().mnemonic.phrase);
     const newTriplet = await ZkTeamClientUser.generateTriplet(rogueKey, 0);
     
     const rogueInputs = await userClient.generateProofInputs({
         value: value.toBigInt(),
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

     const op = await userClient.createProvedUserOp({
         ...rogueInputs,
         target,
         data,
     });
     const uoHash = await config.sendUserOp(op);
     const txHash = await userClient.getUserOpReceipt(uoHash);

     expect(await config.greeter.greet()).to.equal(greeting);
     expect(await admin.client.getAllowance(2)).to.be.equal(ethers.utils.parseEther("70"));
  })

  it("Should allow user 2 to use the stolen allowance", async function () {
      
      const userKey = await admin.client.getUserKey(2);
      const userClient = new ZkTeamClientUser(ethers.provider, config.accountAddress, userKey, config);

      const target = config.greeter.address;
      const value = ethers.utils.parseEther("20");
      const greeting = 'User #2 is now using its rogue wallet';
      const data = config.greeter.interface.encodeFunctionData('setGreeting', [greeting]);
     
     const index = await userClient.getLastIndex(userClient.key);
     const oldTriplet = await ZkTeamClientUser.generateTriplet(userClient.key, index-1);
     const currentTriplet = await ZkTeamClientUser.generateTriplet(rogueKey, 0);
     const newTriplet = await ZkTeamClientUser.generateTriplet(rogueKey, 1);
     
     const rogueInputs = await userClient.generateProofInputs({
         value: value.toBigInt(),
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

     const op = await userClient.createProvedUserOp({
         ...rogueInputs,
         target,
         data,
     });
     const uoHash = await config.sendUserOp(op);
     const txHash = await userClient.getUserOpReceipt(uoHash);

     expect(await config.greeter.greet()).to.equal(greeting);
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
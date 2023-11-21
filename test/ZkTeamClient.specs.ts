import { expect } from 'chai'
import { ethers } from "hardhat";

import { deploy } from "../src/Deploy";
import { ZkTeamClientAdmin, ZkTeamClientUser, getAccount, getAccounts } from "../src/ZkTeamClient";

import { deployAll } from "../scripts/deploy"
import { setAdmin, setAccount, generateGreeting, processTx, processOp } from "./ZkTeamCore.specs"

describe("ZkTeam Client", function () {
    
    let config;
    let admin;
    let greeter; 
  
    it("Should deploy the framework", async function () {         
        const [deployer] = await ethers.getSigners()
        config = await deployAll();
        const Greeter = await ethers.getContractFactory("Greeter");
        greeter = Greeter.attach(config.greeter.address);
        const signer = await setAdmin(deployer, config);
        await setAccount(deployer, signer, 0, config);
        const mnemonic = ethers.Wallet.createRandom().mnemonic.phrase;
        const key = ethers.utils.HDNode.fromMnemonic(mnemonic).extendedKey;
        const client = new ZkTeamClientAdmin(ethers.provider, signer, 0, key, config);
        admin = {signer, key, client};
    })  
    
  it("Should allow the admin to set the allowance for user #0", async function () {                                    
     const allowance = ethers.utils.parseEther("0.005")
     const txHash = await admin.client.setAllowance(0, allowance);
     await processTx(txHash);
     expect(await admin.client.checkAccountPhantom()).to.be.false;
  })
  
  it("Should allow the admin to get the allowance for user #0", async function () {            
     const allowance = await admin.client.getAllowance(0);
     expect(allowance).to.be.equal(ethers.utils.parseEther("0.005"));
  })
  
  it("Should allow the admin to get the balance for multiple accounts", async function () {               
     const balances =  await getAccounts(ethers.provider, config.factory.address, admin.signer.address, 0, 5);
     expect(balances[0]).to.have.property("exists", true);
     expect(balances[0]).to.have.property("balance").to.be.above(0)
     expect(balances.slice(1)).to.deep.equal(Array(4).fill({balance: ethers.utils.parseEther("0"), exists: false}));
  })
        
  
  it("Should allow the admin to get the allowance for multiple users", async function () {
     const allowances = await admin.client.getAllowances(0, 5);     
     expect(allowances[0]).to.be.equal(ethers.utils.parseEther("0.005"));
     expect(allowances.slice(1)).to.deep.equal(Array(4).fill(null));
  })
  
  it("Should allow user 0 to get its allowance", async function () {           
     const userKey = await admin.client.getUserKey(0);
     const userClient = new ZkTeamClientUser(ethers.provider, await admin.client.getAccountAddress(), userKey, config);     
     const allowance = await userClient.getAllowance();
     expect(allowance).to.be.equal(ethers.utils.parseEther("0.005"));
  })
  
  it("Should allow user 0 to use its allowance once", async function () {     
     const userKey = await admin.client.getUserKey(0);     
     const userClient = new ZkTeamClientUser(ethers.provider, await admin.client.getAccountAddress(), userKey, config);     
     const target = greeter.address;
     const value = ethers.utils.parseEther("0.001");
     const greeting = generateGreeting();
     const data = greeter.interface.encodeFunctionData('setGreeting', [greeting]);
     const txHash = await userClient.sendTransaction(target, value, data);
     await processTx(txHash);
     expect(await greeter.greet()).to.equal(greeting);
     const allowance = await userClient.getAllowance();
     expect(allowance).to.be.equal(ethers.utils.parseEther("0.004"));  
  })
  
  it("Should allow user 0 to use its allowance again", async function () {                                     
     const userKey = await admin.client.getUserKey(0);     
     const userClient = new ZkTeamClientUser(ethers.provider, await admin.client.getAccountAddress(), userKey, config);     
     const target = greeter.address;
     const value = ethers.utils.parseEther("0.002");
     const greeting = generateGreeting();
     const data = greeter.interface.encodeFunctionData('setGreeting', [greeting]);
     const txHash = await userClient.sendTransaction(target, value, data);
     await processTx(txHash);
     expect(await greeter.greet()).to.equal(greeting);
     const allowance = await userClient.getAllowance();
     expect(allowance).to.be.equal(ethers.utils.parseEther("0.002"));  
  })
  
  it("Should allow the admin to update the allowance for user #0", async function () {  
     const allowance = ethers.utils.parseEther("0.005");     
     const txHash = await admin.client.setAllowance(0, allowance);  
     await processTx(txHash);
     expect(await admin.client.getAllowance(0)).to.be.equal(ethers.utils.parseEther("0.005"));     
     const userKey = await admin.client.getUserKey(0);
     const userClient = new ZkTeamClientUser(ethers.provider, await admin.client.getAccountAddress(), userKey, config);     
     expect(await userClient.getAllowance()).to.be.equal(ethers.utils.parseEther("0.005"));
  })
  
  it("Should allow user 0 to use its allowance one more time", async function () {                                     
     const userKey = await admin.client.getUserKey(0);     
     const userClient = new ZkTeamClientUser(ethers.provider, await admin.client.getAccountAddress(), userKey, config);     
     const target = greeter.address;
     const value = ethers.utils.parseEther("0.003");
     const greeting = generateGreeting();
     const data = greeter.interface.encodeFunctionData('setGreeting', [greeting]);
     const txHash = await userClient.sendTransaction(target, value, data);
     await processTx(txHash);
     expect(await greeter.greet()).to.equal(greeting);
     const allowance = await userClient.getAllowance();
     expect(allowance).to.be.equal(ethers.utils.parseEther("0.002"));  
  })
})
import { expect } from 'chai'

import { ethers } from "hardhat";

import { deployAll } from "../src/Deploy";

import { ZkTeamClientAdmin, ZkTeamClientUser, getAccount, getAccounts } from "../src/ClientAPI";

describe("ZkTeam Admin/Client API", function () {
    
    let config;
    let admin;
  
    it("Should deploy the framework", async function () { 
        const chainId = (await hre.ethers.provider.getNetwork()).chainId;
        
        const init = await deployAll(chainId);

        const [signer] = await ethers.getSigners();
        const mnemonic = ethers.Wallet.createRandom().mnemonic.phrase;
        const key = ethers.utils.HDNode.fromMnemonic(mnemonic).extendedKey;                                              
                
        const accountAddress = await init.zkTeamAccountFactory.getAddress(await signer.getAddress(), 0);

        await signer.sendTransaction({
            to: accountAddress,
            value: ethers.utils.parseEther('100'), 
        })
        
        config = {
            ...init,
            accountAddress,
            factoryAddress: init.zkTeamAccountFactory.address, 
        }
        
        const client = new ZkTeamClientAdmin(ethers.provider, signer, 0, key, config);
        
        admin = {signer, key, client};
                    
    })  
    
  it("Should allow the admin to set the allowance for user #0", async function () {                                    
     expect(await admin.client.checkAccountPhantom()).to.be.true;
     const allowance = ethers.utils.parseEther("100")
     const txHash = await admin.client.setAllowance(0, allowance);
     // console.log(`Transaction hash: ${txHash}`);
     expect(await admin.client.checkAccountPhantom()).to.be.false;
              
  })
  
  it("Should allow the admin to get the allowance for user #0", async function () {            
     const allowance = await admin.client.getAllowance(0);
     expect(allowance).to.be.equal(ethers.utils.parseEther("100"));
        
  })
  
  it("Should allow the admin to get the balance for multiple accounts", async function () {               
     const balances =  await getAccounts(ethers.provider, config.factoryAddress, admin.signer.address, 0, 5);
     expect(balances[0]).to.have.property("exists", true);
     expect(balances[0]).to.have.property("balance").to.be.above(0)
     expect(balances.slice(1)).to.deep.equal(Array(4).fill({balance: ethers.utils.parseEther("0"), exists: false}));
  })
        
  
  it("Should allow the admin to get the allowance for multiple users", async function () {
     const allowances = await admin.client.getAllowances(0, 5);     
     expect(allowances[0]).to.be.equal(ethers.utils.parseEther("100"));
     expect(allowances.slice(1)).to.deep.equal(Array(4).fill(null));
  })
  
  it("Should allow user 0 to get its allowance", async function () {           
     const userKey = await admin.client.getUserKey(0);
     const userClient = new ZkTeamClientUser(ethers.provider, config.accountAddress, userKey, config);     const allowance = await userClient.getAllowance();
     expect(allowance).to.be.equal(ethers.utils.parseEther("100"));
  })
  
  it("Should allow user 0 to use its allowance once", async function () {     
     expect(await config.greeter.greet()).to.equal("Hello World!")             
     const userKey = await admin.client.getUserKey(0);     
     const userClient = new ZkTeamClientUser(ethers.provider, config.accountAddress, userKey, config);     
     const target = config.greeter.address;
     const value = ethers.utils.parseEther("10");
     const data = config.greeter.interface.encodeFunctionData('setGreeting', ["Bonjour Le Monde!"]);
     const txHash = await userClient.sendTransaction(target, value, data);
     expect(await config.greeter.greet()).to.equal("Bonjour Le Monde!");
     const allowance = await userClient.getAllowance();
     expect(allowance).to.be.equal(ethers.utils.parseEther("90"));  
  })
  
  it("Should allow user 0 to use its allowance again", async function () {                                     
     const userKey = await admin.client.getUserKey(0);     
     const userClient = new ZkTeamClientUser(ethers.provider, await admin.client.getAccountAddress(), userKey, config);     
     const target = config.greeter.address;
     const value = ethers.utils.parseEther("42");
     const data = config.greeter.interface.encodeFunctionData('setGreeting', ["Hola Mundo!"]);
     const txHash = await userClient.sendTransaction(target, value, data);
     expect(await config.greeter.greet()).to.equal("Hola Mundo!");
     const allowance = await userClient.getAllowance();
     expect(allowance).to.be.equal(ethers.utils.parseEther("48"));  
  })
  
  it("Should allow the admin to update the allowance for user #0", async function () {  
     const allowance = ethers.utils.parseEther("100");     
     const txHash = await admin.client.setAllowance(0, allowance);  
     expect(await admin.client.getAllowance(0)).to.be.equal(ethers.utils.parseEther("100"));     
     const userKey = await admin.client.getUserKey(0);
     const userClient = new ZkTeamClientUser(ethers.provider, await admin.client.getAccountAddress(), userKey, config);     
     expect(await userClient.getAllowance()).to.be.equal(ethers.utils.parseEther("100"));
  })
})
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
        
        admin = {signer, key};
        
        config = {
            ...init,
            accountAddress,
            factoryAddress: init.zkTeamAccountFactory.address, 
        }
                    
    })  
    
  it("Should allow the admin to set the allowance for user #0", async function () {
                                        
     const adminClient = new ZkTeamClientAdmin(ethers.provider, admin.signer, 0, admin.key, config);
     expect(await adminClient.checkAccountPhantom()).to.be.true;
     
     const allowance = ethers.utils.parseEther("100")
     const txHash = await adminClient.setAllowance(0, allowance);
     // console.log(`Transaction hash: ${txHash}`);
     expect(await adminClient.checkAccountPhantom()).to.be.false;
              
  })
  
  it("Should allow the admin to get the allowance for user #0", async function () {
                        
     const adminClient = new ZkTeamClientAdmin(ethers.provider, admin.signer, 0, admin.key, config);  
     const allowance = await adminClient.getAllowance(0);
     expect(allowance).to.be.equal(ethers.utils.parseEther("100"));
        
  })
  
  it("Should allow the admin to get the balance for multiple accounts", async function () {               
     const balances =  await getAccounts(ethers.provider, config.factoryAddress, admin.signer.address, 0, 5);
     expect(balances[0]).to.have.property("exists", true);
     expect(balances[0]).to.have.property("balance").to.be.above(0)
     expect(balances.slice(1)).to.deep.equal(Array(4).fill({balance: ethers.utils.parseEther("0"), exists: false}));
  })
        
  
  it("Should allow the admin to get the allowance for multiple users", async function () {
     const adminClient = new ZkTeamClientAdmin(ethers.provider, admin.signer, 0, admin.key, config);
     const allowances = await adminClient.getAllowances(0, 5);     
     expect(allowances[0]).to.be.equal(ethers.utils.parseEther("100"));
     expect(allowances.slice(1)).to.deep.equal(Array(4).fill(null));
  })
  
  it("Should allow user 0 to get its allowance", async function () {           
     const adminClient = new ZkTeamClientAdmin(ethers.provider, admin.signer, 0, admin.key, config);
     const userKey = await adminClient.getUserKey(0);
     
     const userClient = new ZkTeamClientUser(ethers.provider, await adminClient.getAccountAddress(), userKey, config);     const allowance = await userClient.getAllowance();
     expect(allowance).to.be.equal(ethers.utils.parseEther("100"));
  })
  
  it("Should allow user 0 to use its allowance once", async function () {     
     expect(await config.greeter.greet()).to.equal("Hello World!")             
     const adminClient = new ZkTeamClientAdmin(ethers.provider, admin.signer, 0, admin.key, config);
     const userKey = await adminClient.getUserKey(0);
     
     const userClient = new ZkTeamClientUser(ethers.provider, await adminClient.getAccountAddress(), userKey, config);     
     const target = config.greeter.address;
     const value = ethers.utils.parseEther("10");
     const data = config.greeter.interface.encodeFunctionData('setGreeting', ["Bonjour Le Monde!"]),
     const txHash = await userClient.sendTransaction(target, value, data);
     expect(await config.greeter.greet()).to.equal("Bonjour Le Monde!");
     
     const allowance = await userClient.getAllowance();
     expect(allowance).to.be.equal(ethers.utils.parseEther("90"));  
  })
  
  it("Should allow user 0 to use its allowance again", async function () {                                     
     const adminClient = new ZkTeamClientAdmin(ethers.provider, admin.signer, 0, admin.key, config);
     const userKey = await adminClient.getUserKey(0);
     
     const userClient = new ZkTeamClientUser(ethers.provider, await adminClient.getAccountAddress(), userKey, config);     
     const target = config.greeter.address;
     const value = ethers.utils.parseEther("42");
     const data = config.greeter.interface.encodeFunctionData('setGreeting', ["Hola Mundo!"]),
     const txHash = await userClient.sendTransaction(target, value, data);
     expect(await config.greeter.greet()).to.equal("Hola Mundo!");
     
     const allowance = await userClient.getAllowance();
     expect(allowance).to.be.equal(ethers.utils.parseEther("48"));  
  })
  
  it("Should allow the admin to update the allowance for user #0", async function () {  
     const adminClient = new ZkTeamClientAdmin(ethers.provider, admin.signer, 0, admin.key, config);
     const allowance = ethers.utils.parseEther("100");     
     const txHash = await adminClient.setAllowance(0, allowance);  
     expect(await adminClient.getAllowance(0)).to.be.equal(ethers.utils.parseEther("100"));
     
     const userKey = await adminClient.getUserKey(0);
     const userClient = new ZkTeamClientUser(ethers.provider, await adminClient.getAccountAddress(), userKey, config);     
     expect(await userClient.getAllowance()).to.be.equal(ethers.utils.parseEther("100"));
  })
})
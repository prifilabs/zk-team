import { expect } from 'chai'

import { ethers } from "hardhat";

import { deployEntrypointAndBundlerHardhat, deployEntrypointAndBundlerHardhat, deployPoseidon, deployZkTeamFactory } from "../src/deploy";

import { ZkTeamClientAdmin } from "../src/ClientAPI";

describe("ERC-4337 Account Abstraction", function () {
    
    let context;
  
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
        
        const config = {
            factoryAddress: zkTeamAccountFactory.address, 
            ...init
        }
                        
        context = { ...init, owner, config }
    })  
    
  it("Should allow the admin to set the balance for user #0", async function () {
            
     const key =  ethers.utils.HDNode.fromMnemonic(context.owner.mnemonic.phrase).extendedKey;                                              
                            
     const adminClient = new ZkTeamClientAdmin(ethers.provider, context.owner, 0, key, context.config);
     
     expect(await adminClient.checkAccountPhantom()).to.be.true;
     
     const balance = ethers.utils.parseEther("100").toBigInt();
     
     const txHash = await adminClient.setUserBalance(0, balance);
     // console.log(`Transaction hash: ${txHash}`);
     
     expect(await adminClient.checkAccountPhantom()).to.be.false;
     
  })
  
  it("Should allow the admin to get the balance for user #0", async function () {
                        
     const key =  ethers.utils.HDNode.fromMnemonic(context.owner.mnemonic.phrase).extendedKey;                                                                
     const adminClient = new ZkTeamClientAdmin(ethers.provider, context.owner, 0, key, context.config);
          
     const balance = await adminClient.getUserBalance(0);     
     expect(balance).to.be.equal(ethers.utils.parseEther("100").toBigInt());
        
  })
  
})
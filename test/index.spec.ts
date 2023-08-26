import { expect } from 'chai'

import { ethers } from "hardhat";

import * as EntryPoint from '@account-abstraction/contracts/artifacts/EntryPoint.json';
import * as VerifyingPaymaster from '@account-abstraction/contracts/artifacts/VerifyingPaymaster.json';

import { HttpRpcClient } from '@account-abstraction/sdk'

import { VerifyingPaymasterAPI } from "../src/VerifyingPaymasterAPI";
import { ZkTeamAccountAPI } from "../src/ZkTeamAccountAPI";

import { DefaultGasOverheads } from "@account-abstraction/sdk";

import { proxy, PoseidonT3 } from "poseidon-solidity";

async function deployHardhat(){
    const EntryPointFactory = await ethers.getContractFactory(EntryPoint.abi, EntryPoint.bytecode);
    const entryPoint = await EntryPointFactory.deploy();
    const bundler = ethers.Wallet.createRandom();
    const bundlerAddress = await bundler.getAddress();
    const sendUserOp = async function(account, params){
        
        // console.log(params);
        
        const op = await account.createSignedUserOp(params);
        
        // console.log("\nSigned UserOperation: ", await ethers.utils.resolveProperties(op));
        
        await entryPoint.handleOps([op], bundlerAddress);
        
        const uoHash =  await entryPoint.getUserOpHash(op); 
        const txHash = await account.getUserOpReceipt(uoHash);
        // console.log(`\nUserOperation executed - Transaction hash: ${txHash}`);
    }
    return { entryPointAddress: entryPoint.address, bundlerAddress, sendUserOp }
}

async function deployLocal(){
    const entryPointAddress = "0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789";
    const bundlerUrl = 'http://localhost:3000/rpc';
    const bundlerAddress = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
    const sendUserOp = async function(account, params){
        
        const op = await account.createSignedUserOp(params);
        
        // console.log("\nSigned UserOperation: ", await ethers.utils.resolveProperties(op));
        
        const client = new HttpRpcClient(
          bundlerUrl,
          entryPointAddress,
          1337 // chainid
        );
        const uoHash =  await client.sendUserOpToBundler(op) 
        // console.log(`\nUserOperation sent to bundler - UserOperation hash: ${uoHash}`);

        const txHash = await account.getUserOpReceipt(uoHash);
        // console.log(`\nUserOperation executed - Transaction hash: ${txHash}`);
    }
    return { entryPointAddress, bundlerAddress, sendUserOp }
}

describe.only("ERC-4337 Account Abstraction", function () {
    
    let config;
  
    it("Should deploy the framework", async function () { 
        const chainId = (await hre.ethers.provider.getNetwork()).chainId;
    
        let init = (chainId == 1337)? await deployLocal() :  await deployHardhat() ;

        const [sender] = await ethers.getSigners()

        // First check if the proxy exists
        if (await ethers.provider.getCode(proxy.address) === '0x') {
          // fund the keyless account
          await sender.sendTransaction({
            to: proxy.from,
            value: proxy.gas,
          })

          // then send the presigned transaction deploying the proxy
          await ethers.provider.sendTransaction(proxy.tx)
        }

        // Then deploy the hasher, if needed
        if (await ethers.provider.getCode(PoseidonT3.address) === '0x') {
          await sender.sendTransaction({
            to: proxy.address,
            data: PoseidonT3.data
          })
        }

        // console.log(`PoseidonT3 deployed to: ${PoseidonT3.address}`)

        const IncrementalBinaryTreeLibFactory = await ethers.getContractFactory("IncrementalBinaryTree", {
            libraries: {
                PoseidonT3: PoseidonT3.address
            }
        })
        const incrementalBinaryTreeLib = await IncrementalBinaryTreeLibFactory.deploy()

        await incrementalBinaryTreeLib.deployed()

        // console.log(`IncrementalBinaryTree library has been deployed to: ${incrementalBinaryTreeLib.address}`)

        const zkTeamAccountFactoryFactory = await ethers.getContractFactory("ZkTeamAccountFactory", {        
            libraries: {
                IncrementalBinaryTree: incrementalBinaryTreeLib.address
        }});
        const zkTeamAccountFactory = await zkTeamAccountFactoryFactory.deploy(init.entryPointAddress);

        const Greeter = await ethers.getContractFactory("Greeter");
        const greeter = await Greeter.deploy("Hello World!");

        // console.log(
        //     "\nMain Contract Addresses: ",
        //     "\no EntryPointAddress:", init.entryPointAddress,
        //     "\no ZkTeamAccountFactory:", zkTeamAccountFactory.address,
        //     "\n",
        // );

        config = { ...init, greeter, zkTeamAccountFactory }
    })  
    
  it("Should test Simple Account (without Paymaster)", async function () {

      const owner = ethers.Wallet.createRandom();
      const ownerAddress = await owner.getAddress();
      const accountAddress = await config.zkTeamAccountFactory.getAddress(await owner.getAddress(), 0);

      const signer = ethers.provider.getSigner(0);
      await signer.sendTransaction({
          to: accountAddress,
          value: ethers.utils.parseEther('0.1'),
      })
      
      // console.log(
      //     `\nBalances:`,
      //     `\no Bundler ${config.bundlerAddress}: ${ethers.utils.formatEther(await ethers.provider.getBalance(config.bundlerAddress))}`,
      //     `\no Owner ${ownerAddress}: ${ethers.utils.formatEther(await ethers.provider.getBalance(ownerAddress))}`,
      //     `\no ZkTeamAccount ${accountAddress}: ${ethers.utils.formatEther(await ethers.provider.getBalance(accountAddress))}`,
      //     `\n`
      // );
      
      expect(await config.greeter.greet()).to.equal("Hello World!");
         
      const zkTeamAccount = new ZkTeamAccountAPI({
          provider: ethers.provider,
          entryPointAddress: config.entryPointAddress,
          owner,
          factoryAddress: config.zkTeamAccountFactory.address,
          provider: ethers.provider,
          index: 0,
      });

      await config.sendUserOp(zkTeamAccount, {
          target: config.greeter.address,
          data: config.greeter.interface.encodeFunctionData('setGreeting', ["Hola Mundo!"]),
      });
      
      // console.log(
      //     `\nBalances:`,
      //     `\no Bundler ${config.bundlerAddress}: ${ethers.utils.formatEther(await ethers.provider.getBalance(config.bundlerAddress))}`,
      //     `\no Owner ${ownerAddress}: ${ethers.utils.formatEther(await ethers.provider.getBalance(ownerAddress))}`,
      //     `\no ZkTeamAccount ${accountAddress}: ${ethers.utils.formatEther(await ethers.provider.getBalance(accountAddress))}`,
      //     `\n`
      // );
      
      expect(await config.greeter.greet()).to.equal("Hola Mundo!");
      
  })
  
  it("Should test Simple Account with Paymaster", async function () {

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
      
      // console.log(
      //     `\nBalances:`,
      //     `\no Bundler ${config.bundlerAddress}: ${ethers.utils.formatEther(await ethers.provider.getBalance(config.bundlerAddress))}`,
      //     `\no Owner ${ownerAddress}: ${ethers.utils.formatEther(await ethers.provider.getBalance(ownerAddress))}`,
      //     `\no ZkTeamAccount ${accountAddress}: ${ethers.utils.formatEther(await ethers.provider.getBalance(accountAddress))}`,
      //     `\no Paymaster ${verifyingPaymaster.address}: ${ethers.utils.formatEther(await verifyingPaymaster.getDeposit())}`,
      //     `\n`
      // );
      
      expect(await config.greeter.greet()).to.equal("Hola Mundo!")
            
      const zkTeamAccount = new ZkTeamAccountAPI({
          provider: ethers.provider,
          entryPointAddress: config.entryPointAddress,
          owner,
          factoryAddress: config.zkTeamAccountFactory.address,
          overheads: {zeroByte: DefaultGasOverheads.nonZeroByte},
          paymasterAPI: verifyingPaymasterApi,
          provider: ethers.provider,
      });

      await config.sendUserOp(zkTeamAccount, {
          target: config.greeter.address,
          data: config.greeter.interface.encodeFunctionData('setGreeting', ["Bonjour Le Monde!"]),
      });      
      
      // console.log(
      //     `\nBalances:`,
      //     `\no Bundler ${config.bundlerAddress}: ${ethers.utils.formatEther(await ethers.provider.getBalance(config.bundlerAddress))}`,
      //     `\no Owner ${ownerAddress}: ${ethers.utils.formatEther(await ethers.provider.getBalance(ownerAddress))}`,
      //     `\no ZkTeamAccount ${accountAddress}: ${ethers.utils.formatEther(await ethers.provider.getBalance(accountAddress))}`,
      //     `\no Paymaster ${verifyingPaymaster.address}: ${ethers.utils.formatEther(await verifyingPaymaster.getDeposit())}`,
      //     `\n`
      // );
            
      expect(await config.greeter.greet()).to.equal("Bonjour Le Monde!")
      
  })

});

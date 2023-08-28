import { expect } from 'chai'

import { ethers } from "hardhat";

import * as EntryPoint from '@account-abstraction/contracts/artifacts/EntryPoint.json';
import * as VerifyingPaymaster from '@account-abstraction/contracts/artifacts/VerifyingPaymaster.json';

import { HttpRpcClient } from '@account-abstraction/sdk'

import { VerifyingPaymasterAPI } from "../src/VerifyingPaymasterAPI";
import { ZkTeamAccountAPI } from "../src/ZkTeamAccountAPI";

import { DefaultGasOverheads } from "@account-abstraction/sdk";

import { proxy, PoseidonT3 } from "poseidon-solidity";
import { poseidon3 } from "poseidon-lite"

async function deployHardhat(){
    const EntryPointFactory = await ethers.getContractFactory(EntryPoint.abi, EntryPoint.bytecode);
    const entryPoint = await EntryPointFactory.deploy();
    const bundler = ethers.Wallet.createRandom();
    const bundlerAddress = await bundler.getAddress();
    const sendUserOp = async function(account, op){
        
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
        
        //console.log("\nSigned UserOperation: ", await ethers.utils.resolveProperties(op));
        
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

async function deployPoseidon(){
    // see https://github.com/vimwitch/poseidon-solidity
    
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
}

describe.only("ERC-4337 Account Abstraction", function () {
    
    let config;
  
    it.only("Should deploy the framework", async function () { 
        const chainId = (await hre.ethers.provider.getNetwork()).chainId;
    
        let init = (chainId == 1337)? await deployLocal() :  await deployHardhat() ;

        await deployPoseidon();

        const IncrementalBinaryTreeLibFactory = await ethers.getContractFactory("IncrementalBinaryTree", {
            libraries: {
                PoseidonT3: PoseidonT3.address
            }
        })
        const incrementalBinaryTreeLib = await IncrementalBinaryTreeLibFactory.deploy()

        await incrementalBinaryTreeLib.deployed()

        const ZKHiddenBalancePoseidonVerifier = await ethers.getContractFactory("Groth16Verifier");
        const zkHiddenBalancePoseidonVerifier = await ZKHiddenBalancePoseidonVerifier.deploy();

        const zkTeamAccountFactoryFactory = await ethers.getContractFactory("ZkTeamAccountFactory", {        
            libraries: {
                IncrementalBinaryTree: incrementalBinaryTreeLib.address,
        }});
                
        const zkTeamAccountFactory = await zkTeamAccountFactoryFactory.deploy(init.entryPointAddress, zkHiddenBalancePoseidonVerifier.address);

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

        config = { ...init, greeter, zkTeamAccountFactory, owner }
    })  
    
  it.only("Should allow the admin to sign a transaction (without Paymaster)", async function () {
               
      const zkTeamAccount = new ZkTeamAccountAPI({
          provider: ethers.provider,
          entryPointAddress: config.entryPointAddress,
          owner: config.owner,
          factoryAddress: config.zkTeamAccountFactory.address,
          provider: ethers.provider,
          index: 0,
      });

      const privateInputs = {
          oldNullifier: ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt(),
          newBalance: ethers.utils.parseEther("10").toBigInt(),
          newNullifier: ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt(),
          newSecret: ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt(),
          leaves: [42],
      };
      
      const op = await zkTeamAccount.createSignedUserOp({
          ...privateInputs,
          target: config.greeter.address,
          data: config.greeter.interface.encodeFunctionData('setGreeting', ["Hola Mundo!"]),
          gasLimit: 1000000 // Bug: the function estimateGas does not give the right result when adding things to do in the contract's execute function
      });

      await config.sendUserOp(zkTeamAccount, op);
      
      expect(await config.greeter.greet()).to.equal("Hola Mundo!");
                  
      config = { 
          ...config, 
          balance: privateInputs.newBalance, 
          nullifier: privateInputs.newNullifier, 
          secret: privateInputs.newSecret, 
          leaves: privateInputs.leaves
      }; 
  })
  
  it.only("Should allow any user to prove a transaction (without Paymaster)", async function () {
               
      const zkTeamAccount = new ZkTeamAccountAPI({
          provider: ethers.provider,
          entryPointAddress: config.entryPointAddress,
          owner: config.owner,
          factoryAddress: config.zkTeamAccountFactory.address,
          provider: ethers.provider,
          index: 0,
      });

      const privateInputs = {
          value: ethers.utils.parseEther("2.5").toBigInt(),
          oldBalance: config.balance,
          oldNullifier: config.nullifier,
          oldSecret: config.secret,
          newBalance: ethers.utils.parseEther("7.5").toBigInt(),
          newNullifier: ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt(),
          newSecret: ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt(),
          leaves: config.leaves,
      };
            
      const op = await zkTeamAccount.createProvedUserOp({
          ...privateInputs,
          target: config.greeter.address,
          data: config.greeter.interface.encodeFunctionData('setGreeting', ["Hallo Welt!"]),
          gasLimit: 1000000 // Bug: the function estimateGas does not give the right result when adding things to do in the contract's execute function
      });

      await config.sendUserOp(zkTeamAccount, op);
      
      expect(await config.greeter.greet()).to.equal("Hola Mundo!");
            
      config = { 
          ...config, 
          balance: privateInputs.newBalance, 
          nullifier: privateInputs.newNullifier, 
          secret: privateInputs.newSecret, 
          leaves: config.leaves
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
          provider: ethers.provider,
      });

      const op = await zkTeamAccount.createUnsignedUserOp({
          target: config.greeter.address,
          data: config.greeter.interface.encodeFunctionData('setGreeting', ["Bonjour Le Monde!"]),
      });
      
      op.signature = '0x';

      await config.sendUserOp(zkTeamAccount, op);  
            
      expect(await config.greeter.greet()).to.equal("Bonjour Le Monde!")
      
  })

});

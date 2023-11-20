import { readFileSync, existsSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { createHash } from 'crypto';

import { ethers } from "hardhat";
import { proxy, PoseidonT2, PoseidonT3 } from "poseidon-solidity";

import { DeterministicDeployer } from '@account-abstraction/sdk'
import { EntryPoint__factory } from '@account-abstraction/contracts'

import config from './config.json';

const HARDHAT_CHAIN = 31337;
const LOCAL_CHAIN = 1337;

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
    
    if (await ethers.provider.getCode(PoseidonT2.address) === '0x') {
      await sender.sendTransaction({
        to: proxy.address,
        data: PoseidonT2.data
      })
    }
}

async function deployEntryPoint(config){
    config.entrypoint = {address: DeterministicDeployer.getAddress(EntryPoint__factory.bytecode)};
    let deployer = new DeterministicDeployer(ethers.provider)
    if (await deployer.isContractDeployed(config.entrypoint.address)) {
      console.log(`EntryPoint address: ${config.entrypoint.address}`);
      return
    }
    if (config.chainId !== HARDHAT_CHAIN && config.chainId !== LOCAL_CHAIN){
        throw new Error(`EntryPoint is not deployed on chain ${config.chainId}`)
    }
    await deployer.deterministicDeploy(EntryPoint__factory.bytecode)
    console.log(`EntryPoint address: ${config.entrypoint.address}`);
}

async function deployBundler(config){
    if (config.chainId == HARDHAT_CHAIN){
        const bundler = ethers.Wallet.createRandom();
        const address = await bundler.getAddress();
        config.bundler = {address};
        console.log(`Bundler address: ${config.bundler.address}`);
    }else{
        if (!config.bundler.url) throw new Error(`Bundler url is not defined for chain ${config.chainId}`);
        console.log(`Bundler url: ${config.bundler.url}`);
    }
}

async function checkDeployed(config, factory){
    const hash = createHash('sha256').update(factory.bytecode).digest('hex');
    const isDeployed = !(!config || !config.hash || hash !== config.hash || !config.address || (await ethers.provider.getCode(config.address)) == "0x");
    return { isDeployed, hash };
}

async function deployGreeter(config){
    const Greeter = await ethers.getContractFactory("Greeter");
    const { isDeployed, hash } = await checkDeployed(config.greeter, Greeter);
    if (!isDeployed){
        console.log(`Deploying Greeter`);
        const greeter = await Greeter.deploy("Hello World!");
        await greeter.deployed();
        config.greeter = {address: greeter.address, hash};
    }
    console.log(`Greeter address: ${config.greeter.address}`);
}

async function deployVerifier(config){
    const Verifier = await ethers.getContractFactory("Groth16Verifier");
    const { isDeployed, hash } = await checkDeployed(config.verifier, Verifier);
    if (!isDeployed){
        console.log(`Deploying Verifier`);
        const verifier = await Verifier.deploy();
        await verifier.deployed();
        config.verifier = {address: verifier.address, hash};
    }
    console.log(`Verifier address: ${config.verifier.address}`);
}

async function deployMerkleTree(config){
    const Merkle = await ethers.getContractFactory("MerkleTree", {
        libraries: {
            PoseidonT3: PoseidonT3.address
        }
    })
    const { isDeployed, hash } = await checkDeployed(config.merkle, Merkle);
    if (!isDeployed){   
        console.log(`Deploying Merkle`);
        const merkle = await Merkle.deploy();
        await merkle.deployed();
        config.merkle = {address: merkle.address, hash};
    }
    console.log(`Merkle address: ${config.merkle.address}`);
}

async function deployZkTeamFactory(config){
    const Factory = await ethers.getContractFactory("ZkTeamAccountFactory", {        
        libraries: {
            MerkleTree: config.merkle.address,
            PoseidonT2: PoseidonT2.address
    }});
    const { isDeployed, hash } = await checkDeployed(config.factory, Factory);
    if (!isDeployed){   
        console.log(`Deploying ZkTeam Factory`);
        const factory = await Factory.deploy(config.entrypoint.address, config.verifier.address);
        await factory.deployed();
        config.factory = {address: factory.address, hash};
    }
    console.log(`Factory address: ${config.factory.address}`);
}

export async function deployAll() {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    console.log(`Chain id: ${chainId}`);
    const [deployer] = await ethers.getSigners()
    console.log('Deployer address:', deployer.address)
    const balance = await deployer.getBalance();
    console.log(`Deployer balance: ${balance} (${ethers.utils.formatEther(balance)} eth)`)
    
    let config = {chainId}
    const filename = resolve(join('config', `${chainId}.json`));
    if (existsSync(filename)){
        config = JSON.parse(readFileSync(filename, 'utf-8'));
    }

    await deployEntryPoint(config);
    await deployBundler(config);
    await deployGreeter(config);
    await deployPoseidon(config);
    await deployVerifier(config);
    await deployMerkleTree(config);
    await deployZkTeamFactory(config);
                
    if (config.chainId !== HARDHAT_CHAIN){
        const filename = resolve(join('config', `${config.chainId}.json`));
        writeFileSync(filename, JSON.stringify(config, null, 2), 'utf-8');
    }
       
    return config;
}

if (require.main === module) {
    deployAll()
    .catch(function(err){
        console.error(err);
    }) 
}

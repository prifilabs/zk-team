import { readFileSync, existsSync, writeFileSync } from "fs";
import { createHash } from 'crypto';

import { ethers } from "hardhat";
import { proxy, PoseidonT2, PoseidonT3 } from "poseidon-solidity";

import { DeterministicDeployer } from '@account-abstraction/sdk'
import { EntryPoint__factory } from '@account-abstraction/contracts'

import config from './config.json';

const HARDHAT_CHAIN = 31337;
const LOCAL_CHAIN = 1337;

export function useWallet(filename){
    if (existsSync(filename)){
        return ethers.Wallet.fromMnemonic(readFileSync(filename, 'utf-8'));
    }else{
        const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
        writeFileSync(filename, wallet.mnemonic.phrase, 'utf-8');
        return wallet;
    }
}

export async function topUp(from, address, minimumAmount, maximumAmount, provider){
    const balance = await provider.getBalance(address);
    if (balance.gte(minimumAmount)) return;
    const amount = maximumAmount.sub(balance);
    console.log(`Sending ${amount} to ${address}`)
    const tx = await from.sendTransaction({
        to: address,
        value: amount
    });
    return tx.wait();
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
    
    if (await ethers.provider.getCode(PoseidonT2.address) === '0x') {
      await sender.sendTransaction({
        to: proxy.address,
        data: PoseidonT2.data
      })
    }
}


async function deployEntryPoint(chainConfig){
    chainConfig.entrypoint = {address: DeterministicDeployer.getAddress(EntryPoint__factory.bytecode)};
    let deployer = new DeterministicDeployer(ethers.provider)
    if (await deployer.isContractDeployed(chainConfig.entrypoint.address)) {
      console.log(`EntryPoint address: ${chainConfig.entrypoint.address}`);
      return
    }
    if (chainConfig.chainId !== HARDHAT_CHAIN && chainConfig.chainId !== LOCAL_CHAIN){
        throw new Error(`EntryPoint is not deployed on chain ${chainConfig.chainId}`)
    }
    await deployer.deterministicDeploy(EntryPoint__factory.bytecode)
    console.log(`EntryPoint address: ${chainConfig.entrypoint.address}`);
}

async function deployBundler(chainConfig){
    if (chainConfig.chainId == HARDHAT_CHAIN){
        const bundler = ethers.Wallet.createRandom();
        const address = await bundler.getAddress();
        chainConfig.bundler = {address};
        console.log(`Bundler address: ${chainConfig.bundler.address}`);
    }else{
        if (!chainConfig.bundler.url) throw new Error(`Bundler url is not defined for chain ${chainConfig.chainId}`);
        console.log(`Bundler url: ${chainConfig.bundler.url}`);
    }
}

async function checkDeployed(config, factory){
    const hash = createHash('sha256').update(factory.bytecode).digest('hex');
    const isDeployed = !(!config || !config.hash || hash !== config.hash || !config.address || (await ethers.provider.getCode(config.address)) == "0x");
    return { isDeployed, hash };
}

async function deployGreeter(chainConfig){
    const Greeter = await ethers.getContractFactory("Greeter");
    const { isDeployed, hash } = await checkDeployed(chainConfig.greeter, Greeter);
    if (!isDeployed){
        console.log(`Deploying Greeter`);
        const greeter = await Greeter.deploy("Hello World!");
        await greeter.deployed();
        chainConfig.greeter = {address: greeter.address, hash};
    }
    console.log(`Greeter address: ${chainConfig.greeter.address}`);
}

async function deployVerifier(chainConfig){
    const Verifier = await ethers.getContractFactory("Groth16Verifier");
    const { isDeployed, hash } = await checkDeployed(chainConfig.verifier, Verifier);
    if (!isDeployed){
        console.log(`Deploying Verifier`);
        const verifier = await Verifier.deploy();
        await verifier.deployed();
        chainConfig.verifier = {address: verifier.address, hash};
    }
    console.log(`Verifier address: ${chainConfig.verifier.address}`);
}

async function deployMerkleTree(chainConfig){
    const Merkle = await ethers.getContractFactory("MerkleTree", {
        libraries: {
            PoseidonT3: PoseidonT3.address
        }
    })
    const { isDeployed, hash } = await checkDeployed(chainConfig.merkle, Merkle);
    if (!isDeployed){   
        console.log(`Deploying Merkle`);
        const merkle = await Merkle.deploy();
        await merkle.deployed();
        chainConfig.merkle = {address: merkle.address, hash};
    }
    console.log(`Merkle address: ${chainConfig.merkle.address}`);
}

async function deployZkTeamFactory(chainConfig){
    const Factory = await ethers.getContractFactory("ZkTeamAccountFactory", {        
        libraries: {
            MerkleTree: chainConfig.merkle.address,
            PoseidonT2: PoseidonT2.address
    }});
    const { isDeployed, hash } = await checkDeployed(chainConfig.factory, Factory);
    if (!isDeployed){   
        console.log(`Deploying ZkTeam Factory`);
        const factory = await Factory.deploy(chainConfig.entrypoint.address, chainConfig.verifier.address);
        await factory.deployed();
        chainConfig.factory = {address: factory.address, hash};
    }
    console.log(`Factory address: ${chainConfig.factory.address}`);
}

export async function deployAll() {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const chainConfig = config[chainId] || {chainId}

    await deployEntryPoint(chainConfig);
    await deployBundler(chainConfig);
    await deployGreeter(chainConfig);
    await deployPoseidon(chainConfig);
    await deployVerifier(chainConfig);
    await deployMerkleTree(chainConfig);
    await deployZkTeamFactory(chainConfig);
        
    if (chainId !== HARDHAT_CHAIN){
        config[chainId] = chainConfig;
        writeFileSync('./src/config.json', JSON.stringify(config, null, 2));
    }
        
    return chainConfig;
}
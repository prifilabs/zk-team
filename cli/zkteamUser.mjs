#! /usr/bin/env node

import { Command } from "commander";
import { utils } from 'ethers';
import { printTable } from 'console-table-printer';
import { ZkTeamClientUser } from "../dist/src/ZkTeamClient.js";
import { printUserOperation, processTransaction, setUserConfig, getUserConfig, getUserConfigProtected, deleteUserConfig } from './config.mjs';

async function init(options){
    await setUserConfig();
}

async function deleteUser(){
    await deleteUserConfig();
}

async function info(options){
    const config = await getUserConfigProtected();
    console.log(`Account address: ${config.user.address}`);
    const accountBalance = await config.provider.instance.getBalance(config.user.address);
    console.log(`Account balance: ${utils.formatEther(accountBalance)} ETH`);
    const userInstance = new ZkTeamClientUser({
      provider: config.provider.instance,
      accountAddress: config.user.address,
      key: config.user.privkey,
      entryPointAddress: config.entrypoint.address,
      factoryAddress: config.factory.address,
    });
    const allowance = await userInstance.getAllowance();
    console.log(`User's allowance: ${utils.formatEther(allowance)} ETH`);
}

async function transfer(address, value, options){
    const config = await getUserConfigProtected();
    const userInstance = new ZkTeamClientUser({
      provider: config.provider.instance,
      accountAddress: config.user.address,
      key: config.user.privkey,
      entryPointAddress: config.entrypoint.address,
      factoryAddress: config.factory.address,
    });
    console.log(`Transferring ${value} ETH from ZK Team account ${config.user.address} to ${address}`);
    const op = await userInstance.setTransaction(address, utils.parseEther(value).toBigInt(), '0x');
    if (options.debug){
        printUserOperation(op, options.debug);
    }
    const uoHash = await config.client.sendUserOpToBundler(op);
    console.log(`UserOperation hash: ${uoHash}`);
    const txHash = await userInstance.getUserOpReceipt(uoHash);
    const tx = await config.provider.instance.getTransaction(txHash);
    await processTransaction(tx);
    const accountBalance = await config.provider.instance.getBalance(config.user.address);
    console.log(`New account balance: ${utils.formatEther(accountBalance)} ETH`);
    const allowance = await userInstance.getAllowance();
    console.log(`New user's allowance: ${utils.formatEther(allowance)} ETH`);
    // This is bad fix because setTransaction is hanging for some reason
    process.exit(0);
} 

async function transactions(options){
    const config = await getUserConfigProtected();
    const userInstance = new ZkTeamClientUser({
      provider: config.provider.instance,
      accountAddress: config.user.address,
      key: config.user.privkey,
      entryPointAddress: config.entrypoint.address,
      factoryAddress: config.factory.address,
    });
    console.log(`\n Most recent transactions for ZK Team account ${config.user.address}`);
    const transactions = await userInstance.getTransactions(options.page, options.limit);
    printTable(await Promise.all(transactions.map(async function({transactionHash, userIndex, value, dest}){
        const {confirmations, effectiveGasPrice, blockNumber} = await config.provider.instance.getTransactionReceipt(transactionHash);
        const { timestamp } = await config.provider.instance.getBlock(blockNumber);
        return {transactionHash, user: userIndex, recipient: dest, value: utils.formatEther(value), fee: utils.formatEther(effectiveGasPrice), confirmations, blockNumber, time: new Date(timestamp).toString()};
    })));
}

const program = new Command();

program.name("zk-team-admin").description("ZkTeam Admin CLI").version("1.0");

program
  .command("init")
  .description("Configure the ZK-Team user Wallet")
  .action(init);

program
  .command("delete")
  .description("Delete user information")
  .action(deleteUser);
  
program
  .command("info")
  .description("Get user information")
  .option("-k, --key", "show private key")
  .action(info);
  
program
  .command("transactions")
  .description("show transactions")
  .option("-p, --page <page>", "page", 0)
  .option("-l, --limit <limit>", "limit", 10)
  .action(transactions);
  
program
  .command("transfer")
  .description("transfer ETH from ZK-Team account")
  .argument("<address>", "address")
  .argument("<value>", "value in ETH")
  .option("-d, --debug", "show user operation")
  .action(transfer);

program.parse();

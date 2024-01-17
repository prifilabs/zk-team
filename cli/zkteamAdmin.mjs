#! /usr/bin/env node

import { Command } from "commander";
import { utils } from 'ethers';
import { printTable } from 'console-table-printer';
import { ZkTeamClientAdmin, getAccounts, getAccount } from "../dist/src/ZkTeamClient.js";
import { printUserOperation, processTransaction, setAdminConfig, getAdminConfig, getAdminConfigProtected, deleteAdminConfig } from './config.mjs';

async function init(options){
    await setAdminConfig();
}

async function deleteAdmin(){
    await deleteAdminConfig();
}

async function info(options){
    const config = getAdminConfig();
    console.log(`Admin address: ${config.admin.address}`);
    const adminBalance = await config.provider.instance.getBalance(config.admin.address);
    console.log(`Admin balance: ${utils.formatEther(adminBalance)} ETH`);
}

async function accounts(options){
    const config = getAdminConfig();
    const accounts = await getAccounts(config.provider.instance, config.factory.address, config.admin.address, options.page, options.limit);
    printTable(accounts.map(function({index, address, balance, exists}){
        return {index, address, balance: utils.formatEther(balance), exists};
    }));
}

async function users(account, options){
    const config = await getAdminConfigProtected();
    const adminInstance = new ZkTeamClientAdmin({
      provider: config.provider.instance,
      signer: config.admin.wallet,
      index: account,
      key: config.admin.key,
      entryPointAddress: config.entrypoint.address,
      factoryAddress: config.factory.address,
    });
    const users = await adminInstance.getUsers(options.page, options.limit);
    printTable(users.map(function({index, key, allowance, exists}){
        if (options.key){
            return {index, allowance: utils.formatEther(allowance), key, exists};
        } else {
            return {index, allowance: utils.formatEther(allowance), exists};
        }
    }));
}

async function transactions(account, options){
    const config = await getAdminConfigProtected();
    const adminInstance = new ZkTeamClientAdmin({
      provider: config.provider.instance,
      signer: config.admin.wallet,
      index: account,
      key: config.admin.key,
      entryPointAddress: config.entrypoint.address,
      factoryAddress: config.factory.address,
    });
    const transactions = await adminInstance.getTransactions(options.page, options.limit);
    printTable(await Promise.all(transactions.map(async function({transactionHash, userIndex}){
        const {to, value} = await config.provider.instance.getTransaction(transactionHash);
        return {transactionHash, userIndex, to, value};
    })));
}

async function transfer(account, value, options){
    const config = await getAdminConfigProtected();
    const accountInstance = await getAccount(config.provider.instance, config.factory.address, config.admin.address, account);
    console.log(`Transferring ${value} ETH from admin to account #${account}`);
    const tx = await config.admin.wallet.sendTransaction({to: accountInstance.address,value: utils.parseEther(value)});
    await processTransaction(tx);
    const newBalance = await config.provider.instance.getBalance(accountInstance.address);
    console.log(`New balance for account #${account}: ${utils.formatEther(newBalance)} ETH`);
} 

async function allowance(account, user, value, options){
    const config = await getAdminConfigProtected();
    const adminInstance = new ZkTeamClientAdmin({
      provider: config.provider.instance,
      signer: config.admin.wallet,
      index: account,
      key: config.admin.key,
      entryPointAddress: config.entrypoint.address,
      factoryAddress: config.factory.address,
    });
    console.log(`Setting allowance for user #${user} from account #${account} to ${value} ETH`);
    const op = await adminInstance.setAllowance(0, utils.parseEther(value).toBigInt());
    if (options.debug){
        printUserOperation(op);
    }
    const uoHash = await config.client.sendUserOpToBundler(op);
    console.log(`UserOperation hash: ${uoHash}`);    
    const txHash = await adminInstance.getUserOpReceipt(uoHash);
    const tx = await config.provider.instance.getTransaction(txHash);
    await processTransaction(tx); 
    const userInstance = await adminInstance.getUser(user);
    console.log(`New allowance for user #${user} from account: ${utils.formatEther(userInstance.allowance)} ETH`);
} 

const program = new Command();

program.name("zk-team-admin").description("ZkTeam Admin CLI").version("1.0");

program
  .command("init")
  .description("Configure the ZK-Team Admin Wallet")
  .action(init);
  
program
  .command("info")
  .description("Get admin information")
  .action(info);
  
program
  .command("delete")
  .description("Delete admin information")
  .action(deleteAdmin);
  
program
  .command("accounts")
  .description("show information for each account")
  .option("-p, --page <page>", "page", 0)
  .option("-l, --limit <limit>", "limit", 10)
  .action(accounts);
  
program
  .command("users")
  .description("show users for a given account")
  .argument("<account>", "account index")
  .option("-p, --page <page>", "page", 0)
  .option("-l, --limit <limit>", "limit", 10)
  .option("-k, --key", "show private keys")
  .action(users);
  
program
  .command("transactions")
  .description("show transactions for a given account")
  .argument("<account>", "account index")
  .option("-p, --page <page>", "page", 0)
  .option("-l, --limit <limit>", "limit", 10)
  .action(transactions);
  
program
  .command("transfer")
  .description("transfer ETH from admin to account")
  .argument("<account>", "account index")
  .argument("<value>", "value in ETH")
  .action(transfer);
  
program
  .command("allowance")
  .description("transfer ETH from admin to account")
  .argument("<account>", "account index")
  .argument("<user>", "user index")
  .argument("<value>", "value in ETH")
  .option("-d, --debug", "show user operation")
  .action(allowance);


program.parse();

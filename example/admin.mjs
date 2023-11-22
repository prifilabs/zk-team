import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import ethers from "ethers";

import { ZkTeamClientAdmin, ZkTeamClientUser, getAccounts, getAccount }from "@prifilabs/zk-team";

import { config, provider , client } from "./setup.mjs";

let mnemonicFile = "admin.txt";
let mnemonic;
if (existsSync(mnemonicFile)){
    mnemonic = readFileSync(mnemonicFile, "utf-8");
}
else{
    mnemonic = ethers.Wallet.createRandom().mnemonic.phrase;
    writeFileSync(mnemonicFile, mnemonic, "utf-8");
}

const admin = new ethers.Wallet(process.env.METAMASK_PRIVATE_KEY).connect(provider);
export const adminKey = ethers.utils.HDNode.fromMnemonic(mnemonic).extendedKey;

const adminAddress = await admin.getAddress();
console.log(`Admin address: ${adminAddress}`);
const adminBalance = await provider.getBalance(adminAddress);
console.log(`Admin balance: ${adminBalance} (${ethers.utils.formatEther(adminBalance)} ETH)`);

console.log("\nGetting info on admin's first 5 accounts");
const accounts = await getAccounts(provider, config.factory.address, adminAddress, 0, 5);
for (let { index, address, balance, exists } of accounts){
    console.log(`\tAccount #${index}: address:${address}, exists:${exists}, balance:${balance}`);
}

console.log("\nSetting the balance of account #0 to 0.1 ETH");
const account0 = await getAccount(provider, config.factory.address, adminAddress, 0);
// console.log(account0);
const amount = ethers.utils.parseEther("0.1");
const value = amount.sub(account0.balance);
if (value > 0){
    console.log(`Transferring ${value} from admin to account #0`);
    await (await admin.sendTransaction({to: account0.address, value })).wait();
    const newBalance = await provider.getBalance(account0.address);
    console.log(`New balance for account #0: ${newBalance} (${ethers.utils.formatEther(newBalance)} ETH)`);
}

console.log(`\nCreating an instance for account #0`);
const adminInstance = new ZkTeamClientAdmin({
  provider,
  signer: admin,
  index: 0,
  key: adminKey,
  entryPointAddress: config.entrypoint.address,
  factoryAddress: config.factory.address,
});

console.log("\nGetting info about the first 5 users on account #0");
const users = await adminInstance.getUsers(0, 5);
for (let { index, allowance, exists, key } of users){
     console.log(`\tUser #${index}: exists:${exists}, allowance:${allowance}, key:${key}`);
}

console.log("\nSetting user #0 allowance to 0.01 ETH on account #0")
const allowance = ethers.utils.parseEther("0.01").toBigInt();
const op = await adminInstance.setAllowance(0, allowance);
const uoHash = await client.sendUserOpToBundler(op);
console.log(`UserOperation hash: ${uoHash}`);
const txHash = await adminInstance.getUserOpReceipt(uoHash);
console.log(`Transaction hash: ${txHash}`);
const tx = await provider.getTransaction(txHash);
const receipt = await tx.wait();
const gasCost = receipt.gasUsed.mul(receipt.effectiveGasPrice);
console.log(`Gas cost: ${gasCost} (${ethers.utils.formatEther(gasCost)} eth)`);

const user0 = await adminInstance.getUser(0);
console.log(`User #${user0.index}: exists:${user0.exists}, allowance:${user0.allowance}, key:${user0.key}`);

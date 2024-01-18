import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import ethers from "ethers";

import { ZkTeamClientAdmin, getAccounts, getAccount }from "@prifilabs/zk-team";

import { config, provider , client } from "./setup.mjs";

const accountIndex = 0;

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

console.log(`\nSetting the balance of account #${accountIndex} to 0.5 ETH`);
const account = await getAccount(provider, config.factory.address, adminAddress, accountIndex);
console.log(account);
const amount = ethers.utils.parseEther("1");
const value = amount.sub(account.balance);
if (value > 0){
    console.log(`Transferring ${value} from admin to account #${accountIndex}`);
    await (await admin.sendTransaction({to: account.address, value })).wait();
    const newBalance = await provider.getBalance(account.address);
    console.log(`New balance for account #0: ${newBalance} (${ethers.utils.formatEther(newBalance)} ETH)`);
}

console.log(`\nCreating an instance for account #${accountIndex}`);
const adminInstance = new ZkTeamClientAdmin({
  provider,
  signer: admin,
  index: accountIndex,
  key: adminKey,
  entryPointAddress: config.entrypoint.address,
  factoryAddress: config.factory.address,
});

console.log(`\nGetting info about the first 5 users on account #${accountIndex}`);
const users = await adminInstance.getUsers(0, 5);
for (let { index, allowance, exists, key } of users){
     console.log(`\tUser #${index}: exists:${exists}, allowance:${allowance}, key:${key}`);
}

console.log(`\nSetting user #0 allowance to 0.01 ETH on account ${accountIndex}`)
const allowance = ethers.utils.parseEther("0.01").toBigInt();
const op = await adminInstance.setAllowance(0, allowance);
const uoHash = await client.sendUserOpToBundler(op);
console.log(`UserOperation hash: ${uoHash}`);
const txHash = await adminInstance.getUserOpReceipt(uoHash);
console.log(`Transaction hash: ${txHash}`);
const tx = await provider.getTransaction(txHash);
const receipt = await tx.wait();
const gasCost = receipt.gasUsed.mul(receipt.effectiveGasPrice);
console.log(`Gas cost: ${gasCost} (${ethers.utils.formatEther(gasCost)} ETH)`);

const user0 = await adminInstance.getUser(0);
console.log(`User #${user0.index}: exists:${user0.exists}, allowance:${user0.allowance}, key:${user0.key}`);

// share the account address and the user's key with the user
writeFileSync("user.txt", JSON.stringify({ address: account.address, key: user0.key }, null, 2), "utf-8");

import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import ethers from "ethers";

import { ZkTeamClientUser }from "@prifilabs/zk-team";

import * as Greeter from "../artifacts/contracts/Greeter.sol/Greeter.json" assert { type: "json" };

import { config, provider , client } from "./setup.mjs";

let { address, key } = JSON.parse(readFileSync("user.txt", "utf-8"));

console.log(`\nCreating an user instance`);
const userInstance = new ZkTeamClientUser({
  provider,
  accountAddress: address,
  key: key,
  entryPointAddress: config.entrypoint.address,
  factoryAddress: config.factory.address,
});

const allowance = await userInstance.getAllowance();
console.log(`\nUser's allowance ${allowance} (${ethers.utils.formatEther(allowance)} ETH)`);

console.log(`\nSending transaction allowance`);
const greeterAddress = config.greeter.address;
const value = ethers.utils.parseEther("0.001").toBigInt();
const greeting = "Hello world!";

const iface = new ethers.utils.Interface(Greeter.default.abi);
const data = iface.encodeFunctionData("setGreeting", [greeting,]);
const op = await userInstance.setTransaction(greeterAddress, value, data);

const uoHash = await client.sendUserOpToBundler(op);
console.log(`UserOperation hash: ${uoHash}`);
const txHash = await userInstance.getUserOpReceipt(uoHash);
console.log(`Transaction hash: ${txHash}`);
const tx = await provider.getTransaction(txHash);
const receipt = await tx.wait();
const gasCost = receipt.gasUsed.mul(receipt.effectiveGasPrice);
console.log(`Gas cost: ${gasCost} (${ethers.utils.formatEther(gasCost)} ETH)`);
process.exit(0);
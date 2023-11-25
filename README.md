# ZK-Team

An invaluable aspect of account abstraction lies in its ability to facilitate shared ownership of an account among team members, enabling them to transact seamlessly as a unified entity. An organization can create an account abstraction with predefined rules to manage authorized individuals and their allocated spending limits. In a naive setup, the team members' addresses and their corresponding allowances will likely be written on the blockchain. Doing so raises a valid privacy concern since organizations may prefer not to disclose such sensitive information publicly.

ZK-Team is a proof-of-concept of privacy-preserving account abstractions that allows organizations to manage team members while upholding their individual privacy. By leveraging zero-knowledge proofs, ZK-Team enables transactions that ensure the confidentiality of team members' distinct addresses and their associated allowances. We expect our project to be a turnkey solution for organizations to manage teams and assets as well as a reference for Ethereum developers who want to use zero-knowledge proofs for protecting the privacy of information stored in account abstractions.

## Table of contents

- [ZK-Team](#ZK-Team)
  - [Installation](#installation)
  - [Getting Started](#getting-started)
    - [Setup](#setup)
    - [Admin API](#admin-api)
    - [User API](#user-api)
  - [Anomaly Detection API](#anomaly-detection-api)
  - [Paymaster](#paymaster)
  - [Whitepaper](#whitepaper)
  - [Credits](#credits)
  - [Built With](#built-with)
  - [Authors](#authors)
  - [License](#license)

## Installation

```sh
$ npm install @prifilabs/ZK-Team
```

## Getting Started

The code below is based on the [the example code on Github](https://github.com/prifilabs/ZK-Team/tree/master/example)

### Setup

The config file for ZK-Team contains information about:

- the entrypoint address
- the ZK-Team account factory address
- the bundler URL

Here is a configuration example for the Sepolia chain:

```
import config from "@prifilabs/ZK-Team/config/11155111.json" assert { type: "json" };
```

Using this configuration, you can create an instance of the `HttpRpcClient` client that will be used to send user operations.

```
import { HttpRpcClient } from "@account-abstraction/sdk";

const client = new HttpRpcClient(
  config.bundler.url,
  config.entrypoint.address,
  11155111
);
``` 

### Admin API

The main task of the admin is to create the ZK-Team accounts and set the users' allowances. 

The ZK-Team accounts are bound to the admin's EOA address. Here is an example of getting information about the first 5 accounts owned by the admin (`page=0` and `limit=5`):

```
const accounts = await getAccounts(provider, config.factory.address, adminAddress, 0, 5);
for (let { index, address, balance, exists } of accounts){
    console.log(`\tAccount #${index}: address:${address}, exists:${exists}, balance:${balance}`);
}
```

Or get information about a single account (account #0 here):

```
const { index, address, balance, exists } = await getAccount(provider, config.factory.address, adminAddress, 0);
````

The admin will use its EOA account to sign admin user operations (such as the one to set a user's allowance). However, the admin should have a dedicated ZK-Team master key to manage users. This key should be different than the EOA account.

This master key can be derived from a dedicated mnemonic phrase for instance:

```
export const adminKey = ethers.utils.HDNode.fromMnemonic(mnemonic).extendedKey;
```

Once the admin key is created, the admin can then create a ZK-Team account instance for account #0. 

```
const adminInstance = new ZkTeamClientAdmin({
  provider,
  signer: admin,
  index: 0,
  key: adminKey,
  entryPointAddress: config.entrypoint.address,
  factoryAddress: config.factory.address,
});
```

Using this account instance, the admin can gather information about user's and allowances.  Here is an example of getting information about the first 5 users of account #0 (`page=0` and `limit=5`):

```
const users = await adminInstance.getUsers(0, 5);
for (let { index, allowance, exists, key } of users){
     console.log(`\tUser #${index}: exists:${exists}, allowance:${allowance}, key:${key}`);
}
```

Or get information about a single user (user #0 here):

```
const { index, allowance, exists, key } = await adminInstance.getUser(0);
````

The admin can set the allowance for a user. The method `setAllowance` returns a user operation that has not been sent to the bundler yet:

```
const allowance = ethers.utils.parseEther("0.01").toBigInt();
const op = await adminInstance.setAllowance(0, allowance);
```

Finally, the user operation should be sent to bundler. To execute the userOperation, the account must have been provisioned with eth to pay for gas.

``
const uoHash = await client.sendUserOpToBundler(op);
const txHash = await adminInstance.getUserOpReceipt(uoHash);
const tx = await provider.getTransaction(txHash);
const receipt = await tx.wait();
```

### User API

To use a ZK-Team account, users only need two things: the account address and the user's key provided by the admin. Users do not need an EOA at all.

A user can create a ZK-Team account instance using its address and the user's key:

```
const userInstance = new ZkTeamClientUser({
  provider,
  accountAddress: address,
  key: key,
  entryPointAddress: config.entrypoint.address,
  factoryAddress: config.factory.address,
});
```

Users can check the allowance that has been allocated:

```
const allowance = await userInstance.getAllowance();
```

And they can spend their allowance by sending transactions. As an example, the user calls the method `setGreeting` of a greeter contract and pays 0,001 Eth. The method `setTransaction` returns a user operation that has not been sent to the bundler yet: 

```
const greeterAddress = config.greeter.address;
const value = ethers.utils.parseEther("0.001").toBigInt();
const greeting = "Hello world!";

const iface = new ethers.utils.Interface(Greeter.default.abi);
const data = iface.encodeFunctionData("setGreeting", [greeting,]);
const op = await userInstance.setTransaction(greeterAddress, value, data);
```

Finally, the user operation should be sent to bundler:

```
const uoHash = await client.sendUserOpToBundler(op);
const txHash = await userInstance.getUserOpReceipt(uoHash);
const tx = await provider.getTransaction(txHash);
const receipt = await tx.wait();
```

Once the user operation has been executed, the user's allowance is decremented automatically by the amount of Eth sent to the contract. It is important to note that the gas fees are not counted (and cannot be counted) when updating the allowance. 

## Anomaly Detection API

The admin can check whether all users are using their allowance correctly. To do so, the admin can check whether all transactions are valid. The method `checkIntegrity` returns all commitmentHash that are incorrect:

Here is an example for checking the integrity on account #2: 
```
const detectedAnomalies = await adminInstance.checkIntegrity(2);
```

If any incorrect commitment hash has been detected, the admin can cancel those commitment hash preventing users from using them. The method `discardCommitmentHashes` discard all commitment hashes given as inputs. 

```
const txHashes = await adminInstance.discardCommitmentHashes(detectedAnomalies);
```

This method calls the contract directly without using a user operation. This means that the admin must provide the gas cost from his/her EOA account. Moreover, each contract call can cancel 5 bad commitment hashes at a time. This is the reason why the method returns an array of transaction hash corresponding to a call to cancel every group of 5 commitment hashes.  

## Paymaster

Coming soon.

## Whitepaper

Coming soon.

## Credits

This work has been supported through an [ERC-4337 Account Abstraction grant](https://erc4337.mirror.xyz/hRn_41cef8oKn44ZncN9pXvY3VID6LZOtpLlktXYtmA) from the [Ethereum Foundation](https://ethereum.org/en/foundation/).

## Built With

* [@account-abstraction/sdk](https://www.npmjs.com/package/@account-abstraction/sdk)
* [snarkjs](https://www.npmjs.com/package/snarkjs)
* [@zk-kit/incremental-merkle-tree](https://www.npmjs.com/package/@zk-kit/incremental-merkle-tree) and [@zk-kit/incremental-merkle-tree.sol](https://www.npmjs.com/package/@zk-kit/incremental-merkle-tree.sol)
* [poseidon-lite](https://www.npmjs.com/package/poseidon-lite) and [poseidon-solidity](https://www.npmjs.com/package/poseidon-solidity)
* [@noble/ciphers](https://www.npmjs.com/package/@noble/ciphers)

## Authors

**PriFi Labs**:
* Thierry Sans
* David Ziming Liu 

## License

[MIT License](https://opensource.org/license/mit/)
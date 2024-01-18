# ZK-Team

ZK-Team is a **privacy-preserving smart account** that enables organizations to share ownership of accounts among team members while upholding their individual privacy. 

By leveraging zero-knowledge proofs and Ethereum’s Account Abstraction (ERC-4337), our solution enables team members to send transactions from the same smart account without revealing their identities to the blockchain. Additionally, the organization that owns the smart account can assign different allowances to each of its users without disclosing any information that would compromise the privacy of the transactions. 

ZK-Team is **a fully trustless and non-custodial solution** since it is a pure decentralized application that does not rely on any trusted backend.

## Table of contents

- [ZK-Team](#ZK-Team)
  - [Using the Command Line Interface](#using-the-command-line-interface)
    - [Admin Commands](#admin-commands)
    - [User Commands](#user-commands)
  - [Using the Typescript API](#using-the-typescript-api)
    - [Setup](#setup)
    - [Admin API](#admin-api)
    - [User API](#user-api)
    - [Anomaly Detection API](#anomaly-detection-api)
  - [Whitepaper](#whitepaper)
  - [Credits](#credits)
  - [Built With](#built-with)
  - [Authors](#authors)
  - [License](#license)


## Using the Command Line Interface

To use the ZK-Team CLI tool, we need to install the `zk-team` package globally:

```sh
npm install -g @prifilabs/zk-team
```

This package provides two commands:

- `zk-team-admin` for the administrator to manage ZK Team accounts, users and their individual allowances
- `zk-team-user` for individual users to spend their allowance 

### Admin Commands

The main task of the ZK-Team administrator is to manage account and users. The program `zk-team-admin`  has different commands to interact with the ZK-team accounts: 

```
zk-team-admin --help
```

As an administror, let's configure `zk-team-admin`

```
zk-team-admin init
```

The configuration process asks you for various inputs such as:

- a password that will be used to the admin's private key and mnemonic while stored on the local machine for better security
- the chain ID, our tool is deployed on the testnet Sepolia only so far
- the blockchain provider (either _Infura_ or _Alchemy_) and a provider's API key to access the blockchain
- the bundler URL to handle user operations. By default, we are using the excellent public bundler from _Stackup_ but our tool also works with other bundlers (Alchemy has been tested successfully as well)
- the admin account's private key provisioned with Sepolia ETH. The ZK-Team accounts are bound to the admin's EOA address. You can either generate a new one (from your developer wallet for instance) or use the one generated automatically by our tool. 
- a mnemonic phrase (completely separate from your account's private key). This mnemonic phrase will be use to manage users only (but not for sending transactions). You can either generate a new one yourself or use the one generated automatically by our tool. 

Once the configuration has been saved on your computer, you can always change it by doing `zk-team-admin init` again. Make sure to backup your private key and mnemonic once you have started configuring and using ZK Team accounts. If you wish to remove the configuration from your computer completely or starts again with the default parameters, you can use the following command: 

```
zk-team-admin delete
```

Let's make sure that the configuration works by checking the admin's address and balance:

```
zk-team-admin info
```

The ZK-Team account addresses are generated from the admin's address and an account index. The command `zk-team-admin accounts` shows their respective addresses, whether they have been deployed or not and their respective balance. By default the commands shows the first 10 ZK-Team accounts but you can display more by using the options `--page` and `--limit`: 

```
zk-team-admin accounts --page 0 limit 20
```

Like every smart account, you can transfer ETH to a ZK-Team account even if it has not been deployed yet. The command `zk-team-admin transfer` transfers ETH from the admin account to one of the account index. For instance let's transfer 1.1 ETH to account index #0:

```
zk-team-admin transfer 0 1.1
```

When listing the accounts again, now you see that the balance of account #0 is now 1.1 ETH but the account has not been deployed still. 

Now, let's manage the individual users for our ZK Team account index #0. The command `zk-team-admin users` shows for each user whether their allowance has been initialized (`exists`) and the amount of their allowance. By default the command shows the first 10 users but you can display more by using the options `--page` and `--limit`: 

```
zk-team-admin users 0 --page 0 -- limit 20
```

Let's set the allowance for user index #2 to 0.5 ETH for our ZK-Team account #0:

```
zk-team-admin allowance 0 2 0.5
```

This command sends a user operation to the ZK Team account that will deploy the account (first time only) and set the user's allowance to 0.5 ETH. The gas fee associated to this transaction is fully paid by the ZK-Team account. 

Once the user operation has been executed, you can see that:

1. the account #0 has now been deployed (`exists` is true) and 
2. the user #2 for this specific account now exists as well and its allowance is 0.5 ETH

The user is now ready to use our ZK Team account. List again all the users with the option to show their resepctive private keys: 
respective:

```
zk-team-admin users 0 --keys
```

To use the account, the each user will need two pieces of information from the admin:

1. the ZK-Team account address and
2. user #2's private key given by the command `zk-team-admin users 0 --keys`

When user make transactions, the administrator is the only one capable of tracking those transactions to know which user made them:

```
zk-team-admin transactions
```

### User Commands

Users do not need any EOA at all to spend their allowance on a ZK-Team account. Using the program `zk-team-user`, users can spend their allowance by sending transactions from the ZK-Team account. The user must configure the tool first: 

```
zk-team-user init
```

Like the admin, the user configuration needs a password, a chain ID, a provider and its API key and a bundler URL. Plus, it needs the two piece of information given by the admin: the ZK-Team account address and the private key. 

Once the configuration has been saved on the computer, users can get the account's balance and the amount of their personal allowance: 

```
zk-team-user info
```

Users can spend their allowance by transferring ETH to another address. For instance, let's transfer 0.42 ETH to an arbitrary address:

```
zk-team-user transfer 0x3b72519aA112786e2E977Cf2f3775e6eb02d0624 0.42
```

Once the user operation has been executed, the user's allowance has been decremented. It is important to note that the gas fees are not counted (and cannot be counted) when updating the allowance. 

Finally, the transaction can be seen here:

```
zk-team-user transactions
```

## Using the Typescript API

To use the Typescript, we recommend to take a look at the [the example code on Github](https://github.com/prifilabs/ZK-Team/tree/master/example)

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

The admin get can information about multiple accounts. Here is an example of getting information about the first 5 accounts (`page=0` and `limit=5`):

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

Then the admin can create a ZK-Team account instance for account #0. 

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

Using this account instance, the admin can gather information about user's and allowances.  Here is an example of getting information about the first 5 users (`page=0` and `limit=5`):

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

The admin can also get the latest transactions made from this account. Here is an example of getting the 5 most recent transactions (`page=0` and `limit=5`):

```
const transactions = await adminInstance.getTransactions(0, 5);
for (let { transactionHash, userIndex } of transactions){
     console.log(`\t txHash ${transactionHash} made by user ${userIndex}`);
}
````

The admin can set the allowance for a user using the method `setAllowance` that returns a user operation that yet to be sent to the bundler: 

```
const allowance = ethers.utils.parseEther("0.01").toBigInt();
const op = await adminInstance.setAllowance(0, allowance);
```

Finally, the user operation should be sent to bundler. To execute the userOperation, the account must have been provisioned with ETH to pay for deployment fees.

```
const uoHash = await client.sendUserOpToBundler(op);
const txHash = await adminInstance.getUserOpReceipt(uoHash);
const tx = await provider.getTransaction(txHash);
const receipt = await tx.wait();
```

### User API

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

Users can check the allowance that has been allocated to them by the admin:

```
const allowance = await userInstance.getAllowance();
```

Users can get the most recent transactions they made with this account (`page=0` and `limit=5`):

```
const transactions = await userInstance.getTransactions(0, 5);
for (let { transactionHash } of transactions){
     console.log(`\t txHash ${transactionHash}`);
}
````

And they can spend their allowance by sending transactions. As an example, the user calls the method `setGreeting` of a greeter contract and pays 0.001 ETH. The method `setTransaction` returns a user operation that has yet to be sent to the bundler:

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

### Anomaly Detection API

The admin can check whether all users are using their allowance correctly. To do so, the admin can check whether all transactions are valid. The method `checkIntegrity` returns all commitmentHash that are incorrect:

```
const detectedAnomalies = await adminInstance.checkIntegrity();
```

If any incorrect commitment hash has been detected, the admin can cancel those commitment hash preventing users from using them. The method `discardCommitmentHashes` discard all commitment hashes given as inputs. 

```
const txHashes = await adminInstance.discardCommitmentHashes(detectedAnomalies);
```

This method calls the contract directly without using a user operation. This means that the admin must provide the gas cost from his/her EOA account. Moreover, each contract call can cancel 5 bad commitment hashes at a time. This is the reason why the method returns an array of transaction hash corresponding to a call to cancel every group of 5 commitment hashes.  

## Whitepaper

A whitepaper explaining in details how ZK-Team works internally is coming soon. 

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
# Zk-Team

> An invaluable aspect of account abstraction lies in its ability to facilitate shared ownership of an account among team members, enabling them to transact seamlessly as a unified entity. An organization can create an account abstraction with predefined rules to manage authorized individuals and their allocated spending limits. In a naive setup, the team members' addresses and their corresponding allowances will likely be written on the blockchain. Doing so raises a valid privacy concern since organizations may prefer not to disclose such sensitive information publicly.

> ZK-team is a proof-of-concept of privacy-preserving account abstractions that allows organizations to manage team members while upholding their individual privacy. By leveraging zero-knowledge proofs, ZK-team enables transactions that ensure the confidentiality of team members' distinct addresses and their associated allowances. We expect our project to be a turnkey solution for organizations to manage teams and assets as well as a reference for Ethereum developers who want to use zero-knowledge proofs for protecting the privacy of information stored in account abstractions.

## Table of contents

- [Zk-Team](#zk-team)
  - [Installation](#installation)
  - [Getting Started](#getting-started)
    - [Admin API](#admin-api)
    - [User API](#user-api)
    - [Anomaly Detection API](#anomaly-detection-api)
  - [Whitepaper](#whitepaper)
  - [Credits](#credits)
  - [Built With](#built-with)
  - [Authors](#authors)
  - [License](#license)

## Installation

```sh
$ npm install @prifilabs/zk-team
```

## Getting Started

### Admin API

### User API

## Anomaly Detection API

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
* **Thierry Sans** 
* **David Ziming Liu** 

## License

[MIT License](https://opensource.org/license/mit/)
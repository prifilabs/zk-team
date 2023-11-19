## Hardhat Setup (no bundler)

Run the tests

```
cd zk-team
npm install
npx hardhat test
```

## Local GETH node setup + bundler

1. Run a local GETH node (Docker container)

```
docker run --rm -ti --name geth -p 8545:8545 ethereum/client-go:v1.10.26 \
  --miner.gaslimit 12000000 \
  --http --http.api personal,eth,net,web3,debug \
  --http.vhosts '*,localhost,host.docker.internal' --http.addr "0.0.0.0" \
  --ignore-legacy-receipts --allow-insecure-unlock --rpc.allow-unprotected-txs \
  --dev \
  --verbosity 2 \
  --nodiscover --maxpeers 0 --mine --miner.threads 1 \
  --networkid 1337
```

```
docker run --rm -ti --name geth -p 8545:8545 ethereum/client-go   --miner.gaslimit 12000000   --http --http.api personal,eth,net,web3,debug   --http.vhosts '*,localhost,host.docker.internal' --http.addr "0.0.0.0"   --allow-insecure-unlock --rpc.allow-unprotected-txs   --dev   --verbosity 2   --nodiscover --maxpeers 0 --mine   --networkid 1337 
```

2. Clone the eth-infinistism bundler

```
git clone https://github.com/eth-infinitism/bundler
cd bundler
yarn && yarn preprocess
```

3. Deploy contracts (entrypoint, ...) on the GETH node

```
yarn hardhat-deploy --network localhost
```

FYI: try this task several times if it fails because of insufficient funds

4. Run the bundler

```
yarn run bundler
```

5. Run the tests

```
cd zk-team
npm install
npx hardhat test --network localhost
```

## ToDo

We need to come up with a new userOp signature and verification. 

To update the signature, change the function change the typescript function  `signUserOp` in `src/ZkTeamAccountAPI.ts`. 

To change the signature verification, change the solidity function  `_validateSignature` in `contracts/ZkTeamAccount.sol`. 
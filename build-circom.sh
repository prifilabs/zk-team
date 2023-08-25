#!/bin/bash

rm contracts/verifier.sol
rm -Rf zk-data
mkdir zk-data

# compile circom
circom circuits/ZKHiddenBalancePoseidon.circom --r1cs --wasm -o zk-data/

# Powers of Tau
snarkjs powersoftau new bn128 15 zk-data/pot15_0000.ptau -v
snarkjs powersoftau contribute zk-data/pot15_0000.ptau zk-data/pot15_0001.ptau --name="First contribution" -v

# Phase 2 (contract specific)
snarkjs powersoftau prepare phase2 zk-data/pot15_0001.ptau zk-data/pot15_final.ptau -v
snarkjs groth16 setup zk-data/ZKHiddenBalancePoseidon.r1cs zk-data/pot15_final.ptau zk-data/ZKHiddenBalancePoseidon_0000.zkey
snarkjs zkey contribute zk-data/ZKHiddenBalancePoseidon_0000.zkey zk-data/ZKHiddenBalancePoseidon_0001.zkey --name="PriFi Labs" -v
snarkjs zkey export verificationkey zk-data/ZKHiddenBalancePoseidon_0001.zkey zk-data/verification_key.json

# Generate solidty contract
snarkjs zkey export solidityverifier zk-data/ZKHiddenBalancePoseidon_0001.zkey contracts/verifier.sol
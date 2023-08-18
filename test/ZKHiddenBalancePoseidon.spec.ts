import { readFileSync } from "fs";
import { resolve } from "path";

import { ethers } from "hardhat";

import { expect, assert } from "chai";

import { groth16 } from "snarkjs";
import { buildPoseidon } from "circomlibjs";
import { wasm as wasm_tester} from "circom_tester";

describe.only("ZKHiddenBalancePoseidon", function () {

    let config;
    
    it("Circuit Wasm Setup", async function () {
        const [spender] = await ethers.getSigners();

        const zkHiddenBalancePoseidonCircuit = await wasm_tester(resolve("circuits/ZKHiddenBalancePoseidon/ZKHiddenBalancePoseidon.circom"));

        const poseidonHasher = await buildPoseidon();

        config = {
            spender,
            poseidonHasher,
            zkHiddenBalancePoseidonCircuit
        };
        
    });
    
    it("Value smaller than Balance and New Balance Correct should pass", async function () {
               
        const { spender, poseidonHasher, zkHiddenBalancePoseidonCircuit } = config;
                
        const ZKHiddenBalancePoseidonVerifier = await ethers.getContractFactory("Groth16Verifier");
        const zkHiddenBalancePoseidonVerifier = await ZKHiddenBalancePoseidonVerifier.deploy();
        
        const testInputs = {
            secret: "1111",
            address: spender.address,
            balance: ethers.utils.parseEther("10").toBigInt(),
            newBalance: ethers.utils.parseEther("2.5").toBigInt(),
            value: ethers.utils.parseEther("7.5").toBigInt(),
            nonce: 1,
        };
        let poseidonHashJsSecretUserAddressResult = poseidonHasher.F.toString(poseidonHasher([
            testInputs.address,
            testInputs.secret,
            testInputs.nonce,
        ]));

        let poseidonHashJsSecretBalanceResult = poseidonHasher.F.toString(poseidonHasher([
            testInputs.balance,
            testInputs.secret,
            testInputs.nonce,
        ]));

        let poseidonHashJsNewSecretBalanceResult = poseidonHasher.F.toString(poseidonHasher([
            testInputs.newBalance,
            testInputs.secret,
            testInputs.nonce,
        ]));

        const witness = await zkHiddenBalancePoseidonCircuit.calculateWitness(testInputs);

        await zkHiddenBalancePoseidonCircuit.assertOut(witness, {
            out: [
                poseidonHashJsSecretUserAddressResult,
                poseidonHashJsSecretBalanceResult,
                poseidonHashJsNewSecretBalanceResult,
            ],
        });
        
        // on chain verify
        const { proof, publicSignals } = await groth16.fullProve(
            testInputs,
            "circuits/ZKHiddenBalancePoseidon/ZKHiddenBalancePoseidon_js/ZKHiddenBalancePoseidon.wasm",
            "circuits/ZKHiddenBalancePoseidon/ZKHiddenBalancePoseidon_0001.zkey",
        );
        
        const proofCalldata = await groth16.exportSolidityCallData(proof, publicSignals);
                
        const proofCalldataFormatted = JSON.parse("[" + proofCalldata + "]");

        const vKey = JSON.parse(readFileSync("circuits/ZKHiddenBalancePoseidon/verification_key.json"));
                
        const res = await groth16.verify(vKey, publicSignals, proof);
                
        expect(res).to.be.true;

        // verifying on-chain
        expect(
        await zkHiddenBalancePoseidonVerifier.verifyProof(
            proofCalldataFormatted[0],
            proofCalldataFormatted[1],
            proofCalldataFormatted[2],
            proofCalldataFormatted[3],
        )).to.be.true;
    });

    it("Value larger than Balance and New Balance Correct should fail", async function () {
        const { spender, poseidonHasher, zkHiddenBalancePoseidonCircuit } = config;

        const testInputs = {
            secret: "1111",
            address: spender.address,
            balance: ethers.utils.parseEther("10"),
            newBalance: ethers.utils.parseEther("2.5"),
            value: ethers.utils.parseEther("17.5"),
            nonce: 1,
        };

        try {
            await zkHiddenBalancePoseidonCircuit.calculateWitness(testInputs);
            console.log("hi");
            assert(false);
        } catch (e) {
            assert(e.message.includes("Assert Failed"));
        }
    });

    it("Value smaller than Balance and New Balance incorrect should fail", async function () {
        const { spender, poseidonHasher, zkHiddenBalancePoseidonCircuit } = config;

        const testInputs = {
            secret: "1111",
            address: spender.address,
            balance: ethers.utils.parseEther("10"),
            newBalance: ethers.utils.parseEther("2.5"),
            value: ethers.utils.parseEther("9.5"),
            nonce: 1,
        };

        try {
            await zkHiddenBalancePoseidonCircuit.calculateWitness(testInputs);
            assert(false);
        } catch (e) {
            assert(e.message.includes("Assert Failed"));
        }
    });

    it("Secret incorrect should fail", async function () {
        const { spender, poseidonHasher, zkHiddenBalancePoseidonCircuit } = config;

        const testInputs = {
            secret: "1111",
            address: spender.address,
            balance: ethers.utils.parseEther("10"),
            newBalance: ethers.utils.parseEther("2.5"),
            value: ethers.utils.parseEther("7.5"),
            nonce: 1,
        };
        let poseidonHashJsSecretUserAddressResult = poseidonHasher.F.toString(
        poseidonHasher([
        testInputs.address,
        testInputs.secret,
        testInputs.nonce,
        ]),
        );

        let poseidonHashJsSecretBalanceResult = poseidonHasher.F.toString(
        poseidonHasher([
        testInputs.balance,
        testInputs.secret,
        testInputs.nonce,
        ]),
        );

        let poseidonHashJsNewSecretBalanceResult = poseidonHasher.F.toString(
        poseidonHasher([
        testInputs.newBalance,
        testInputs.secret,
        testInputs.nonce,
        ]),
        );

        const witness = await zkHiddenBalancePoseidonCircuit.calculateWitness({
            ...testInputs,
            secret: "2222",
        });

        try {
            await zkHiddenBalancePoseidonCircuit.assertOut(witness, {
                out: [
                poseidonHashJsSecretUserAddressResult,
                poseidonHashJsSecretBalanceResult,
                poseidonHashJsNewSecretBalanceResult,
                ],
            });
            assert(false);
        } catch (e) {}
    });
});

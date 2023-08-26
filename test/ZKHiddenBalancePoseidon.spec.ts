import { readFileSync } from "fs";
import { resolve } from "path";

import { ethers } from "hardhat";

import { expect, assert } from "chai";

import { groth16 } from "snarkjs";
import { wasm as wasm_tester} from "circom_tester";
import { IncrementalMerkleTree } from "@zk-kit/incremental-merkle-tree"
import { poseidon1, poseidon2, poseidon3 } from "poseidon-lite"

function generateValues(tree, balance){
    const nullifier = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt();
    const secret = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt();
    const nullifierHash = poseidon1([nullifier]);
    const commitmentHash = poseidon3([nullifier, secret, balance]);
    tree.insert(commitmentHash);
    const proof = tree.createProof(tree.indexOf(commitmentHash));
    const siblings = proof.siblings.map( (s) => s[0]); 
    const pathIndices = proof.pathIndices;
    const root = proof.root;
    return { nullifier, secret, nullifierHash, commitmentHash, siblings, pathIndices, root }
}

function generateSignals(value, oldBalance, newBalance){
    const tree = new IncrementalMerkleTree(poseidon2, 20, BigInt(0), 2);
    
    const oldValues = generateValues(tree, oldBalance);
    const newValues = generateValues(tree, newBalance);

    const inputs = {
        value,
        oldBalance,
        oldNullifier: oldValues.nullifier,
        oldSecret: oldValues.secret,
        oldTreeSiblings: oldValues.siblings,
        oldTreePathIndices: oldValues.pathIndices,
        newBalance,
        newNullifier: newValues.nullifier,
        newSecret: newValues.secret,
        newTreeSiblings: newValues.siblings,
        newTreePathIndices: newValues.pathIndices,
        callDataHash: poseidon1([ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt()])
    };
    
    const outputs = {
        oldNullifierHash: oldValues.nullifierHash,
        oldRoot: oldValues.root,
        newCommitmentHash: newValues.commitmentHash,
        newRoot: newValues.root,
    };

    return { inputs, outputs };
}

describe("ZKHiddenBalancePoseidon", function () {
    
    let zkHiddenBalancePoseidonCircuit;
    
    before(async function () {
         zkHiddenBalancePoseidonCircuit = await wasm_tester(resolve("circuits/ZKHiddenBalancePoseidon.circom"));
    });
    
    it("should calculate witness on good inputs", async function () {
                       
        const oldBalance = ethers.utils.parseEther("10").toBigInt();
        const value = ethers.utils.parseEther("7.5").toBigInt();
        const newBalance = ethers.utils.parseEther("2.5").toBigInt();
        
        const {inputs, outputs} = generateSignals(value, oldBalance, newBalance);
        
        const witness = await zkHiddenBalancePoseidonCircuit.calculateWitness(inputs);

        await zkHiddenBalancePoseidonCircuit.assertOut(witness, outputs);
        
    });

    it("should be proved off-chain on good inputs", async function () {

        const oldBalance = ethers.utils.parseEther("10").toBigInt();
        const value = ethers.utils.parseEther("7.5").toBigInt();
        const newBalance = ethers.utils.parseEther("2.5").toBigInt();
        
        const { inputs }  = generateSignals(value, oldBalance, newBalance);
        
        const { proof, publicSignals } = await groth16.fullProve(
            inputs,
            "zk-data/ZKHiddenBalancePoseidon_js/ZKHiddenBalancePoseidon.wasm",
            "zk-data/ZKHiddenBalancePoseidon_0001.zkey",
        );
        
        const vKey = JSON.parse(readFileSync("zk-data/verification_key.json"));
                
        const res = await groth16.verify(vKey, publicSignals, proof);
        
        expect(res).to.be.true;
    
    });
    
    it("should be proved on-chain on good inputs", async function () {
    
        const oldBalance = ethers.utils.parseEther("10").toBigInt();
        const value = ethers.utils.parseEther("7.5").toBigInt();
        const newBalance = ethers.utils.parseEther("2.5").toBigInt();
        
        const { inputs, outputs } = generateSignals(value, oldBalance, newBalance);
        
        const { proof, publicSignals } = await groth16.fullProve(
            inputs,
            "zk-data/ZKHiddenBalancePoseidon_js/ZKHiddenBalancePoseidon.wasm",
            "zk-data/ZKHiddenBalancePoseidon_0001.zkey",
        );
        
        console.log(publicSignals);
        
        const ZKHiddenBalancePoseidonVerifier = await ethers.getContractFactory("Groth16Verifier");
        const zkHiddenBalancePoseidonVerifier = await ZKHiddenBalancePoseidonVerifier.deploy();
    
        const proofCalldata = await groth16.exportSolidityCallData(proof, publicSignals);

        const proofCalldataFormatted = JSON.parse("[" + proofCalldata + "]");
        
        console.log(JSON.stringify(proofCalldataFormatted, null, 2));

        // verifying on-chain
        expect(
        await zkHiddenBalancePoseidonVerifier.verifyProof(
            proofCalldataFormatted[0],
            proofCalldataFormatted[1],
            proofCalldataFormatted[2],
            proofCalldataFormatted[3],
        )).to.be.true;
    });

    it("should fail when value greater than old balance", async function () {
        
        const oldBalance = ethers.utils.parseEther("10").toBigInt();
        const value = ethers.utils.parseEther("17.5").toBigInt();
        const newBalance = ethers.utils.parseEther("-7.5").toBigInt();
        
        const {inputs, outputs} = generateSignals(value, oldBalance, newBalance);
        
        try {
            await zkHiddenBalancePoseidonCircuit.calculateWitness(inputs);
            assert(false);
        } catch (e) {
            assert(e.message.includes("Assert Failed"));
        }
    });

    it("should fail when new balance is incorrect", async function () {
        
        const oldBalance = ethers.utils.parseEther("10").toBigInt();
        const value = ethers.utils.parseEther("7.5").toBigInt();
        const newBalance = ethers.utils.parseEther("3.5").toBigInt();
        
        const {inputs, outputs} = generateSignals(value, oldBalance, newBalance);

        try {
            await zkHiddenBalancePoseidonCircuit.calculateWitness(inputs);
            assert(false);
        } catch (e) {
            assert(e.message.includes("Assert Failed"));
        }
    });
});

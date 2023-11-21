import { readFileSync } from "fs";
import { resolve } from "path";

const hre = require("hardhat");
const { ethers } = hre;

import { expect, assert } from "chai";

import { groth16 } from "snarkjs";
import { wasm as wasm_tester } from "circom_tester";
import { IncrementalMerkleTree } from "@zk-kit/incremental-merkle-tree";
import { poseidon1, poseidon2, poseidon3 } from "poseidon-lite";

function generateValues(tree, allowance) {
  const nullifier = ethers.BigNumber.from(
    ethers.utils.randomBytes(32)
  ).toBigInt();
  const secret = ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt();
  const commitmentHash = poseidon3([nullifier, secret, allowance]);
  tree.insert(commitmentHash);
  const proof = tree.createProof(tree.indexOf(commitmentHash));
  const siblings = proof.siblings.map((s) => s[0]);
  const pathIndices = proof.pathIndices;
  const root = proof.root;
  return { nullifier, secret, commitmentHash, siblings, pathIndices, root };
}

function generateSignals(value, oldAllowance, newAllowance) {
  const tree = new IncrementalMerkleTree(poseidon2, 20, BigInt(0), 2);

  const oldValues = generateValues(tree, oldAllowance);
  const newValues = generateValues(tree, newAllowance);

  const inputs = {
    value,
    oldAllowance,
    oldNullifier: oldValues.nullifier,
    oldSecret: oldValues.secret,
    oldTreeSiblings: oldValues.siblings,
    oldTreePathIndices: oldValues.pathIndices,
    newAllowance,
    newNullifier: newValues.nullifier,
    newSecret: newValues.secret,
    newTreeSiblings: newValues.siblings,
    newTreePathIndices: newValues.pathIndices,
    callDataHash: poseidon1([
      ethers.BigNumber.from(ethers.utils.randomBytes(32)).toBigInt(),
    ]),
  };

  const outputs = {
    oldNullifierHash: poseidon1([oldValues.nullifier]),
    oldRoot: oldValues.root,
    newCommitmentHash: newValues.commitmentHash,
    newRoot: newValues.root,
  };

  return { inputs, outputs };
}

describe("ZkTeam Verifier", function () {
  let ZkTeamCircuit;

  before(async function () {
    ZkTeamCircuit = await wasm_tester(resolve("circuits/zkteam.circom"));
  });

  it("should calculate witness on good inputs", async function () {
    const oldAllowance = ethers.utils.parseEther("10").toBigInt();
    const value = ethers.utils.parseEther("7.5").toBigInt();
    const newAllowance = ethers.utils.parseEther("2.5").toBigInt();

    const { inputs, outputs } = generateSignals(
      value,
      oldAllowance,
      newAllowance
    );

    const witness = await ZkTeamCircuit.calculateWitness(inputs);

    await ZkTeamCircuit.assertOut(witness, outputs);
  });

  it("should be proved off-chain on good inputs", async function () {
    const oldAllowance = ethers.utils.parseEther("10").toBigInt();
    const value = ethers.utils.parseEther("7.5").toBigInt();
    const newAllowance = ethers.utils.parseEther("2.5").toBigInt();

    const { inputs } = generateSignals(value, oldAllowance, newAllowance);

    const { proof, publicSignals } = await groth16.fullProve(
      inputs,
      "ptau-data/ZkTeam_js/ZkTeam.wasm",
      "ptau-data/ZkTeam_0001.zkey"
    );

    const vKey = JSON.parse(
      readFileSync("ptau-data/verification_key.json").toString()
    );

    const res = await groth16.verify(vKey, publicSignals, proof);

    expect(res).to.be.true;
  });

  it("should be proved on-chain on good inputs", async function () {
    const oldAllowance = ethers.utils.parseEther("10").toBigInt();
    const value = ethers.utils.parseEther("7.5").toBigInt();
    const newAllowance = ethers.utils.parseEther("2.5").toBigInt();

    const { inputs, outputs } = generateSignals(
      value,
      oldAllowance,
      newAllowance
    );

    const { proof, publicSignals } = await groth16.fullProve(
      inputs,
      "ptau-data/ZkTeam_js/ZkTeam.wasm",
      "ptau-data/ZkTeam_0001.zkey"
    );

    // console.log(publicSignals);

    const proofCalldata = await groth16.exportSolidityCallData(
      proof,
      publicSignals
    );
    const proofCalldataFormatted = JSON.parse("[" + proofCalldata + "]");

    // console.log(JSON.stringify(proofCalldataFormatted, null, 2));

    const ZkTeamVerifier = await ethers.getContractFactory("Groth16Verifier");
    const zkTeamVerifier = await ZkTeamVerifier.deploy();

    // verifying on-chain
    expect(
      await zkTeamVerifier.verifyProof(
        proofCalldataFormatted[0],
        proofCalldataFormatted[1],
        proofCalldataFormatted[2],
        proofCalldataFormatted[3]
      )
    ).to.be.true;
  });

  it("should fail when value greater than old allowance", async function () {
    const oldAllowance = ethers.utils.parseEther("10").toBigInt();
    const value = ethers.utils.parseEther("17.5").toBigInt();
    const newAllowance = ethers.utils.parseEther("-7.5").toBigInt();

    const { inputs, outputs } = generateSignals(
      value,
      oldAllowance,
      newAllowance
    );

    try {
      await ZkTeamCircuit.calculateWitness(inputs);
      assert(false);
    } catch (e) {
      assert(e.message.includes("Assert Failed"));
    }
  });

  it("should fail when new allowance is incorrect", async function () {
    const oldAllowance = ethers.utils.parseEther("10").toBigInt();
    const value = ethers.utils.parseEther("7.5").toBigInt();
    const newAllowance = ethers.utils.parseEther("3.5").toBigInt();

    const { inputs, outputs } = generateSignals(
      value,
      oldAllowance,
      newAllowance
    );

    try {
      await ZkTeamCircuit.calculateWitness(inputs);
      assert(false);
    } catch (e) {
      assert(e.message.includes("Assert Failed"));
    }
  });
});

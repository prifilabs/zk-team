import { join }  from 'path';

import {
  Signer,
  Wallet,
  BigNumber,
  BigNumberish,
  Contract,
  constants,
} from "ethers";
import { Provider } from "@ethersproject/providers";
import {
  arrayify,
  hexConcat,
  keccak256,
  defaultAbiCoder,
} from "ethers/lib/utils";

import { BaseAccountAPI, DefaultGasOverheads } from "@account-abstraction/sdk";

import { groth16 } from "snarkjs";

import { MerkleTree } from "./Utils/MerkleTree";
import { encryptAllowance, decryptAllowance } from "./Utils/encryption";
import { poseidon1, poseidon3 } from "poseidon-lite";

import AsyncLock from "async-lock";

import * as ZkTeamAccountFactory from "../artifacts/contracts/ZkTeamAccountFactory.sol/ZkTeamAccountFactory.json";
import * as ZkTeamAccount from "../artifacts/contracts/ZkTeamAccount.sol/ZkTeamAccount.json";

import vKey from "../ptau-data/verification_key.json";

import { detect } from 'detect-browser';
const platform = detect();
const browser = (platform && platform.type === 'browser');

let wasmFile = join(__dirname, "..", "ptau-data", "zkteam_js", "ZkTeam.wasm");
let zkeyFile = join(__dirname, "..", "ptau-data", "ZkTeam_0001.zkey");

if (browser){
    wasmFile = "https://raw.githubusercontent.com/prifilabs/zk-team/master/ptau-data/zkteam_js/zkteam.wasm";
    zkeyFile = "https://raw.githubusercontent.com/prifilabs/zk-team/master/ptau-data/ZkTeam_0001.zkey"
}

export interface CoreInput {
  value: bigint;
  oldNullifierHash: bigint;
  newCommitmentHash: bigint;
  encryptedAllowance: string;
  target: string;
  data: string;
  gasLimit?: BigNumberish;
  maxFeePerGas?: BigNumberish;
  maxPriorityFeePerGas?: BigNumberish;
  nonce?: BigNumberish;
}

export interface SignatureInput extends CoreInput {
  newAllowance: bigint;
  newRoot: bigint;
}

export interface ProofInput extends CoreInput {
  oldAllowance: bigint;
  oldNullifier: bigint;
  oldSecret: bigint;
  oldRoot: bigint;
  oldTreeSiblings: Array<bigint>;
  oldTreePathIndices: Array<number>;
  newAllowance: bigint;
  newNullifier: bigint;
  newSecret: bigint;
  newRoot: bigint;
  newTreeSiblings: Array<bigint>;
  newTreePathIndices: Array<number>;
  encryptedAllowance: string;
}

export interface SignatureInputParams {
  oldNullifier: bigint;
  newAllowance: bigint;
  newNullifier: bigint;
  newSecret: bigint;
  newKey: Uint8Array;
  newNonce: Uint8Array;
}

export interface ProofInputParams {
  value: bigint;
  oldNullifierHash: bigint;
  oldNullifier: bigint;
  oldSecret: bigint;
  oldKey: Uint8Array;
  oldNonce: Uint8Array;
  newNullifier: bigint;
  newSecret: bigint;
  newKey: Uint8Array;
  newNonce: Uint8Array;
}

/**
 * constructor params, added no top of base params:
 * @param signer only needed for the admin
 * @param factoryAddress not needed if account already deployed
 * @param index not needed if account already deployed
 */
export interface ZkTeamCoreParams {
  provider: Provider;
  signer?: Signer;
  index?: BigNumberish;
  accountAddress?: string;
  entryPointAddress: string;
  factoryAddress?: string;
}

export interface Log {
  encryptedAllowance: string;
  commitmentHash: bigint;
  nullifierHash: bigint;
  transactionHash: string;
  discarded?: boolean;
}

export class ZkTeamCore extends BaseAccountAPI {
  public signer: Signer | undefined;
  public factoryAddress: string | undefined;
  public index: BigNumber | undefined;
  public accountContract: Contract | undefined;
  public factoryContract: Contract | undefined;
  public data: {
    lock: AsyncLock;
    blockIndex: number;
    logs: Array<Log>;
    commitmentHashes: { [key: string]: Log };
    nullifierHashes: { [key: string]: Log };
  };

  constructor(params: ZkTeamCoreParams) {
    var _a;
    const overheads = {
      sigSize: 1000,
      zeroByte: DefaultGasOverheads.nonZeroByte,
    };
    super({ ...params, overheads });
    this.signer = params.signer;
    this.factoryAddress = params.factoryAddress;
    this.index = BigNumber.from(
      (_a = params.index) !== null && _a !== void 0 ? _a : 0
    );
    this.data = {
      lock: new AsyncLock(),
      blockIndex: 0,
      logs: [],
      commitmentHashes: {},
      nullifierHashes: {},
    };
  }

  static getNullifierHash(nullifier: bigint) {
    return poseidon1([nullifier]);
  }

  static getCommitmentHash(
    nullifier: bigint,
    secret: bigint,
    allowance: bigint
  ) {
    return poseidon3([nullifier, secret, allowance]);
  }

  async getData() {
    const self = this;
    const data = this.data;
    return data.lock.acquire("key", async function () {
      if (await self.checkAccountPhantom()) return [];
      const latest = await self.provider.getBlock("latest");
      if (latest.number < data.blockIndex) return data.logs;
      const accountContract = await self.getAccountContract();
      const executionEvents = await accountContract.queryFilter(
        "ZkTeamExecution",
        data.blockIndex,
        latest.number
      );
      for (let event of executionEvents) {
        if (event.args) {
          let [nullifierHash, commitmentHash, encryptedAllowance] = event.args;
          nullifierHash = BigNumber.from(nullifierHash).toBigInt();
          commitmentHash = BigNumber.from(commitmentHash).toBigInt();
          const log: Log = {
            encryptedAllowance,
            commitmentHash,
            nullifierHash,
            transactionHash: event.transactionHash
          };
          data.logs.push(log);
          data.commitmentHashes[commitmentHash] = log;
          data.nullifierHashes[nullifierHash] = log;
        }
      }
      const discardEvents = await accountContract.queryFilter(
        "ZkTeamDiscard",
        data.blockIndex,
        latest.number
      );
      for (let event of discardEvents) {
        if (event.args) {
          let [commitmentHash] = event.args;
          commitmentHash = BigNumber.from(commitmentHash).toBigInt();
          data.commitmentHashes[commitmentHash].discarded = true;
        }
      }
      data.blockIndex = latest.number + 1;
      return data.logs;
    });
  }

  async getCommitmentHashes(): Promise<Array<bigint>> {
    await this.getData();
    const commitmentHashes = this.data.logs.map(function (log) {
      if (log.discarded) return BigInt(0);
      else return log.commitmentHash;
    });
    return [...commitmentHashes];
  }

  async getEncryptedAllowance(nullifierHash: bigint) {
    await this.getData();
    if (nullifierHash.toString() in this.data.nullifierHashes)
      return this.data.nullifierHashes[nullifierHash.toString()]
        .encryptedAllowance;
    else return constants.HashZero;
  }

  async getDecryptedAllowance(
    nullifierHash: bigint,
    key: Uint8Array,
    nonce: Uint8Array
  ) {
    const encryptedAllowance = await this.getEncryptedAllowance(nullifierHash);
    if (encryptedAllowance == constants.HashZero)
      throw new Error("Encrypted Allowance is set to 0");
    return decryptAllowance(encryptedAllowance, key, nonce);
  }

  async getAccountContract() {
    if (this.accountContract == null) {
      this.accountContract = new Contract(
        await this.getAccountAddress(),
        ZkTeamAccount.abi,
        this.provider
      );
    }
    return this.accountContract;
  }

  /**
   * return the value to put into the "initCode" field, if the account is not yet deployed.
   * this value holds the "factory" address, followed by this account's information
   */
  async getAccountInitCode() {
    if (this.factoryContract == null) {
      if (this.factoryAddress != null && this.factoryAddress !== "") {
        this.factoryContract = new Contract(
          this.factoryAddress,
          ZkTeamAccountFactory.abi,
          this.provider
        );
      } else {
        throw new Error("No factory to get initCode");
      }
    }
    return hexConcat([
      this.factoryAddress!,
      this.factoryContract.interface.encodeFunctionData("createAccount", [
        await this.signer!.getAddress(),
        this.index,
      ]),
    ]);
  }

  async getNonce() {
    if (await this.checkAccountPhantom()) {
      return BigNumber.from(0);
    }
    const accountContract = await this.getAccountContract();
    return await accountContract.getNonce();
  }

  async getVerificationGasLimit(): Promise<BigNumberish> {
    return 1000000;
  }

  // implements BaseAccountAPI abstract function
  // however this function is not used because its caller (encodeUserOpCallDataAndGasLimit) is overloaded
  async encodeExecute(
    target: string,
    value: BigNumberish,
    data: string
  ): Promise<string> {
    throw new Error("encodeExecute is not used");
  }

  async encodeUserOpCallDataAndGasLimit(detailsForUserOp: CoreInput) {
    const accountContract = await this.getAccountContract();
    const value = detailsForUserOp.value
      ? BigNumber.from(detailsForUserOp.value)
      : BigNumber.from(0);

    const callData = accountContract.interface.encodeFunctionData("execute", [
      detailsForUserOp.oldNullifierHash,
      detailsForUserOp.newCommitmentHash,
      value,
      detailsForUserOp.encryptedAllowance,
      detailsForUserOp.target,
      detailsForUserOp.data,
    ]);

    let _b;
    const callGasLimit = detailsForUserOp.gasLimit
      ? BigNumber.from(detailsForUserOp.gasLimit)
      : await this.provider.estimateGas({
          from: this.entryPointAddress,
          to: this.getAccountAddress(),
          data: callData,
        });

    let initGas = BigNumber.from(0);
    if (await this.checkAccountPhantom()) {
      const initCode = await this.getInitCode();
      initGas = BigNumber.from(await this.estimateCreationGas(initCode));
    }

    return {
      callData,
      callGasLimit: callGasLimit.add(initGas),
    };
  }

  async generateSignatureInputs(params: SignatureInputParams) {
    const newAllowance = params.newAllowance;
    const oldNullifierHash = ZkTeamCore.getNullifierHash(params.oldNullifier);
    const newCommitmentHash = ZkTeamCore.getCommitmentHash(
      params.newNullifier,
      params.newSecret,
      newAllowance
    );
    const commitmentHashes = await this.getCommitmentHashes();
    const tree = new MerkleTree(commitmentHashes);
    tree.insert(newCommitmentHash);
    const newRoot = tree.getRoot();
    const encryptedAllowance = encryptAllowance(
      newAllowance,
      params.newKey,
      params.newNonce
    );
    return {
      newAllowance,
      oldNullifierHash,
      newCommitmentHash,
      newRoot,
      encryptedAllowance,
    };
  }

  async signUserOpHash(userOpHash: string) {
    return this.signer!.signMessage(arrayify(userOpHash));
  }

  async createUnsignedUserOp(info: CoreInput) {
    const op = await super.createUnsignedUserOp(info);
    const signer = Wallet.createRandom();
    op.signature = signer.signMessage("");
    return op;
  }

  async generateProofInputs(params: ProofInputParams) {
    const value = params.value;
    const oldAllowance = await this.getDecryptedAllowance(
      params.oldNullifierHash,
      params.oldKey,
      params.oldNonce
    );

    const oldNullifierHash = ZkTeamCore.getNullifierHash(params.oldNullifier);
    const oldCommitmentHash = ZkTeamCore.getCommitmentHash(
      params.oldNullifier,
      params.oldSecret,
      oldAllowance
    );

    const commitmentHashes = await this.getCommitmentHashes();
    const tree = new MerkleTree(commitmentHashes);
    const oldRoot = tree.getRoot();
    const {
      treeSiblings: oldTreeSiblings,
      treePathIndices: oldTreePathIndices,
    } = tree.getProof(oldCommitmentHash);

    const newAllowance = oldAllowance - value;
    if (newAllowance < 0) throw new Error("Insufficient allowance");
    const newNullifierHash = ZkTeamCore.getNullifierHash(params.newNullifier);
    const newCommitmentHash = ZkTeamCore.getCommitmentHash(
      params.newNullifier,
      params.newSecret,
      newAllowance
    );
    tree.insert(newCommitmentHash);
    const newRoot = tree.getRoot();
    const {
      treeSiblings: newTreeSiblings,
      treePathIndices: newTreePathIndices,
    } = tree.getProof(newCommitmentHash);

    const encryptedAllowance = encryptAllowance(
      newAllowance,
      params.newKey,
      params.newNonce
    );

    return {
      value,
      oldAllowance,
      oldNullifier: params.oldNullifier,
      oldSecret: params.oldSecret,
      oldNullifierHash,
      oldCommitmentHash,
      oldRoot,
      oldTreeSiblings,
      oldTreePathIndices,
      newAllowance,
      newNullifier: params.newNullifier,
      newSecret: params.newSecret,
      newNullifierHash,
      newCommitmentHash,
      newRoot,
      newTreeSiblings,
      newTreePathIndices,
      encryptedAllowance,
    };
  }

  async createProvedUserOp(info: ProofInput) {
    let userOp = await this.createUnsignedUserOp({ ...info });

    const callData = await userOp.callData;
    // interestingly we cannot just use the keccak hash value. It makes the proof crash. We must hash it using poseidon.
    const callDataHash = poseidon1([
      BigNumber.from(keccak256(callData)).toBigInt(),
    ]);

    const inputs = {
      value: info.value,
      oldAllowance: info.oldAllowance,
      oldNullifier: info.oldNullifier,
      oldSecret: info.oldSecret,
      oldTreeSiblings: info.oldTreeSiblings,
      oldTreePathIndices: info.oldTreePathIndices,
      newAllowance: info.newAllowance,
      newNullifier: info.newNullifier,
      newSecret: info.newSecret,
      newTreeSiblings: info.newTreeSiblings,
      newTreePathIndices: info.newTreePathIndices,
      callDataHash,
    };

    const outputs = {
      oldNullifierHash: info.oldNullifierHash,
      oldRoot: info.oldRoot,
      newCommitmentHash: info.newCommitmentHash,
      newRoot: info.newRoot,
    };
    
    const { proof, publicSignals } = await groth16.fullProve(inputs, wasmFile, zkeyFile);

    let res = await groth16.verify(vKey, publicSignals, proof);

    if (!res) throw new Error("Invalid proof");

    const proofCalldata = await groth16.exportSolidityCallData(
      proof,
      publicSignals
    );
    const proofCalldataFormatted = JSON.parse("[" + proofCalldata + "]");

    return {
      ...userOp,
      signature: defaultAbiCoder.encode(
        ["uint256[2]", "uint256[2][2]", "uint256[2]", "uint256[6]"],
        proofCalldataFormatted
      ),
    };
  }

  public async discardCommitmentHashes(commitmentHashes: Array<bigint>) {
    const tree = new MerkleTree(await this.getCommitmentHashes());
    const commitmentHashList = [];
    for (let commitmentHash of commitmentHashes) {
      const { treeSiblings, treePathIndices } = tree.getProof(commitmentHash);
      commitmentHashList.push({
        commitmentHash,
        treeSiblings,
        treePathIndices,
      });
      tree.discard(commitmentHash);
    }
    const contract = await this.getAccountContract();
    const txHashes = [];
    let sub = commitmentHashList.splice(0, 5);
    do {
      const tx = await contract
        .connect(this.signer!)
        .discardCommitmentHashes(sub);
      await tx.wait();
      txHashes.push(tx.hash);
      sub = commitmentHashList.splice(0, 5);
    } while (sub.length > 0);
    return txHashes;
  }
}

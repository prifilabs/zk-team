"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZkTeamCore = void 0;
const path_1 = require("path");
const ethers_1 = require("ethers");
const utils_1 = require("ethers/lib/utils");
const sdk_1 = require("@account-abstraction/sdk");
const snarkjs_1 = require("snarkjs");
const MerkleTree_1 = require("./Utils/MerkleTree");
const encryption_1 = require("./Utils/encryption");
const poseidon_lite_1 = require("poseidon-lite");
const async_lock_1 = __importDefault(require("async-lock"));
const ZkTeamAccountFactory = __importStar(require("../artifacts/contracts/ZkTeamAccountFactory.sol/ZkTeamAccountFactory.json"));
const ZkTeamAccount = __importStar(require("../artifacts/contracts/ZkTeamAccount.sol/ZkTeamAccount.json"));
const verification_key_json_1 = __importDefault(require("../ptau-data/verification_key.json"));
const detect_browser_1 = require("detect-browser");
const platform = (0, detect_browser_1.detect)();
const browser = (platform && platform.type === 'browser');
let wasmFile = (0, path_1.join)(__dirname, "..", "ptau-data", "zkteam_js", "ZkTeam.wasm");
let zkeyFile = (0, path_1.join)(__dirname, "..", "ptau-data", "ZkTeam_0001.zkey");
if (browser) {
    wasmFile = "https://raw.githubusercontent.com/prifilabs/zk-team/master/ptau-data/zkteam_js/zkteam.wasm";
    zkeyFile = "https://raw.githubusercontent.com/prifilabs/zk-team/master/ptau-data/ZkTeam_0001.zkey";
}
class ZkTeamCore extends sdk_1.BaseAccountAPI {
    constructor(params) {
        var _a;
        const overheads = {
            sigSize: 1000,
            zeroByte: sdk_1.DefaultGasOverheads.nonZeroByte,
        };
        super(Object.assign(Object.assign({}, params), { overheads }));
        this.signer = params.signer;
        this.factoryAddress = params.factoryAddress;
        this.index = ethers_1.BigNumber.from((_a = params.index) !== null && _a !== void 0 ? _a : 0);
        this.data = {
            lock: new async_lock_1.default(),
            blockIndex: 0,
            logs: [],
            commitmentHashes: {},
            nullifierHashes: {},
        };
    }
    static getNullifierHash(nullifier) {
        return (0, poseidon_lite_1.poseidon1)([nullifier]);
    }
    static getCommitmentHash(nullifier, secret, allowance) {
        return (0, poseidon_lite_1.poseidon3)([nullifier, secret, allowance]);
    }
    getData() {
        return __awaiter(this, void 0, void 0, function* () {
            const self = this;
            const data = this.data;
            return data.lock.acquire("key", function () {
                return __awaiter(this, void 0, void 0, function* () {
                    if (yield self.checkAccountPhantom())
                        return [];
                    const latest = yield self.provider.getBlock("latest");
                    if (latest.number < data.blockIndex)
                        return data.logs;
                    const accountContract = yield self.getAccountContract();
                    const executionEvents = yield accountContract.queryFilter("ZkTeamExecution", data.blockIndex, latest.number);
                    for (let event of executionEvents) {
                        if (event.args) {
                            let [nullifierHash, commitmentHash, encryptedAllowance] = event.args;
                            nullifierHash = ethers_1.BigNumber.from(nullifierHash).toBigInt();
                            commitmentHash = ethers_1.BigNumber.from(commitmentHash).toBigInt();
                            const log = {
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
                    const discardEvents = yield accountContract.queryFilter("ZkTeamDiscard", data.blockIndex, latest.number);
                    for (let event of discardEvents) {
                        if (event.args) {
                            let [commitmentHash] = event.args;
                            commitmentHash = ethers_1.BigNumber.from(commitmentHash).toBigInt();
                            data.commitmentHashes[commitmentHash].discarded = true;
                        }
                    }
                    data.blockIndex = latest.number + 1;
                    return data.logs;
                });
            });
        });
    }
    getCommitmentHashes() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getData();
            const commitmentHashes = this.data.logs.map(function (log) {
                if (log.discarded)
                    return BigInt(0);
                else
                    return log.commitmentHash;
            });
            return [...commitmentHashes];
        });
    }
    getEncryptedAllowance(nullifierHash) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getData();
            if (nullifierHash.toString() in this.data.nullifierHashes)
                return this.data.nullifierHashes[nullifierHash.toString()]
                    .encryptedAllowance;
            else
                return ethers_1.constants.HashZero;
        });
    }
    getDecryptedAllowance(nullifierHash, key, nonce) {
        return __awaiter(this, void 0, void 0, function* () {
            const encryptedAllowance = yield this.getEncryptedAllowance(nullifierHash);
            if (encryptedAllowance == ethers_1.constants.HashZero)
                throw new Error("Encrypted Allowance is set to 0");
            return (0, encryption_1.decryptAllowance)(encryptedAllowance, key, nonce);
        });
    }
    getAccountContract() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.accountContract == null) {
                this.accountContract = new ethers_1.Contract(yield this.getAccountAddress(), ZkTeamAccount.abi, this.provider);
            }
            return this.accountContract;
        });
    }
    /**
     * return the value to put into the "initCode" field, if the account is not yet deployed.
     * this value holds the "factory" address, followed by this account's information
     */
    getAccountInitCode() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.factoryContract == null) {
                if (this.factoryAddress != null && this.factoryAddress !== "") {
                    this.factoryContract = new ethers_1.Contract(this.factoryAddress, ZkTeamAccountFactory.abi, this.provider);
                }
                else {
                    throw new Error("No factory to get initCode");
                }
            }
            return (0, utils_1.hexConcat)([
                this.factoryAddress,
                this.factoryContract.interface.encodeFunctionData("createAccount", [
                    yield this.signer.getAddress(),
                    this.index,
                ]),
            ]);
        });
    }
    getNonce() {
        return __awaiter(this, void 0, void 0, function* () {
            if (yield this.checkAccountPhantom()) {
                return ethers_1.BigNumber.from(0);
            }
            const accountContract = yield this.getAccountContract();
            return yield accountContract.getNonce();
        });
    }
    getVerificationGasLimit() {
        return __awaiter(this, void 0, void 0, function* () {
            return 1000000;
        });
    }
    // implements BaseAccountAPI abstract function
    // however this function is not used because its caller (encodeUserOpCallDataAndGasLimit) is overloaded
    encodeExecute(target, value, data) {
        return __awaiter(this, void 0, void 0, function* () {
            throw new Error("encodeExecute is not used");
        });
    }
    encodeUserOpCallDataAndGasLimit(detailsForUserOp) {
        return __awaiter(this, void 0, void 0, function* () {
            const accountContract = yield this.getAccountContract();
            const value = detailsForUserOp.value
                ? ethers_1.BigNumber.from(detailsForUserOp.value)
                : ethers_1.BigNumber.from(0);
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
                ? ethers_1.BigNumber.from(detailsForUserOp.gasLimit)
                : yield this.provider.estimateGas({
                    from: this.entryPointAddress,
                    to: this.getAccountAddress(),
                    data: callData,
                });
            let initGas = ethers_1.BigNumber.from(0);
            if (yield this.checkAccountPhantom()) {
                const initCode = yield this.getInitCode();
                initGas = ethers_1.BigNumber.from(yield this.estimateCreationGas(initCode));
            }
            return {
                callData,
                callGasLimit: callGasLimit.add(initGas),
            };
        });
    }
    generateSignatureInputs(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const newAllowance = params.newAllowance;
            const oldNullifierHash = ZkTeamCore.getNullifierHash(params.oldNullifier);
            const newCommitmentHash = ZkTeamCore.getCommitmentHash(params.newNullifier, params.newSecret, newAllowance);
            const commitmentHashes = yield this.getCommitmentHashes();
            const tree = new MerkleTree_1.MerkleTree(commitmentHashes);
            tree.insert(newCommitmentHash);
            const newRoot = tree.getRoot();
            const encryptedAllowance = (0, encryption_1.encryptAllowance)(newAllowance, params.newKey, params.newNonce);
            return {
                newAllowance,
                oldNullifierHash,
                newCommitmentHash,
                newRoot,
                encryptedAllowance,
            };
        });
    }
    signUserOpHash(userOpHash) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.signer.signMessage((0, utils_1.arrayify)(userOpHash));
        });
    }
    createUnsignedUserOp(info) {
        const _super = Object.create(null, {
            createUnsignedUserOp: { get: () => super.createUnsignedUserOp }
        });
        return __awaiter(this, void 0, void 0, function* () {
            const op = yield _super.createUnsignedUserOp.call(this, info);
            const signer = ethers_1.Wallet.createRandom();
            op.signature = signer.signMessage("");
            return op;
        });
    }
    generateProofInputs(params) {
        return __awaiter(this, void 0, void 0, function* () {
            const value = params.value;
            const oldAllowance = yield this.getDecryptedAllowance(params.oldNullifierHash, params.oldKey, params.oldNonce);
            const oldNullifierHash = ZkTeamCore.getNullifierHash(params.oldNullifier);
            const oldCommitmentHash = ZkTeamCore.getCommitmentHash(params.oldNullifier, params.oldSecret, oldAllowance);
            const commitmentHashes = yield this.getCommitmentHashes();
            const tree = new MerkleTree_1.MerkleTree(commitmentHashes);
            const oldRoot = tree.getRoot();
            const { treeSiblings: oldTreeSiblings, treePathIndices: oldTreePathIndices, } = tree.getProof(oldCommitmentHash);
            const newAllowance = oldAllowance - value;
            if (newAllowance < 0)
                throw new Error("Insufficient allowance");
            const newNullifierHash = ZkTeamCore.getNullifierHash(params.newNullifier);
            const newCommitmentHash = ZkTeamCore.getCommitmentHash(params.newNullifier, params.newSecret, newAllowance);
            tree.insert(newCommitmentHash);
            const newRoot = tree.getRoot();
            const { treeSiblings: newTreeSiblings, treePathIndices: newTreePathIndices, } = tree.getProof(newCommitmentHash);
            const encryptedAllowance = (0, encryption_1.encryptAllowance)(newAllowance, params.newKey, params.newNonce);
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
        });
    }
    createProvedUserOp(info) {
        return __awaiter(this, void 0, void 0, function* () {
            let userOp = yield this.createUnsignedUserOp(Object.assign({}, info));
            const callData = yield userOp.callData;
            // interestingly we cannot just use the keccak hash value. It makes the proof crash. We must hash it using poseidon.
            const callDataHash = (0, poseidon_lite_1.poseidon1)([
                ethers_1.BigNumber.from((0, utils_1.keccak256)(callData)).toBigInt(),
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
            const { proof, publicSignals } = yield snarkjs_1.groth16.fullProve(inputs, wasmFile, zkeyFile);
            let res = yield snarkjs_1.groth16.verify(verification_key_json_1.default, publicSignals, proof);
            if (!res)
                throw new Error("Invalid proof");
            const proofCalldata = yield snarkjs_1.groth16.exportSolidityCallData(proof, publicSignals);
            const proofCalldataFormatted = JSON.parse("[" + proofCalldata + "]");
            return Object.assign(Object.assign({}, userOp), { signature: utils_1.defaultAbiCoder.encode(["uint256[2]", "uint256[2][2]", "uint256[2]", "uint256[6]"], proofCalldataFormatted) });
        });
    }
    discardCommitmentHashes(commitmentHashes) {
        return __awaiter(this, void 0, void 0, function* () {
            const tree = new MerkleTree_1.MerkleTree(yield this.getCommitmentHashes());
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
            const contract = yield this.getAccountContract();
            const txHashes = [];
            let sub = commitmentHashList.splice(0, 5);
            do {
                const tx = yield contract
                    .connect(this.signer)
                    .discardCommitmentHashes(sub);
                yield tx.wait();
                txHashes.push(tx.hash);
                sub = commitmentHashList.splice(0, 5);
            } while (sub.length > 0);
            return txHashes;
        });
    }
}
exports.ZkTeamCore = ZkTeamCore;

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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZkTeamClientUser = exports.ZkTeamClientAdmin = exports.getAccounts = exports.getAccount = void 0;
const ethers_1 = require("ethers");
const utils_1 = require("ethers/lib/utils");
const ZkTeamCore_1 = require("./ZkTeamCore");
const encryption_1 = require("./Utils/encryption");
const ZkTeamAccountFactory = __importStar(require("../artifacts/contracts/ZkTeamAccountFactory.sol/ZkTeamAccountFactory.json"));
function getAccount(provider, factoryAddress, ownerAddress, accountIndex) {
    return __awaiter(this, void 0, void 0, function* () {
        const factory = new ethers_1.Contract(factoryAddress, ZkTeamAccountFactory.abi, provider);
        const accountAddress = yield factory.getAddress(ownerAddress, accountIndex);
        const accountCode = yield provider.getCode(accountAddress);
        let exists = accountCode.length > 2;
        let balance = yield provider.getBalance(accountAddress);
        return { index: accountIndex, address: accountAddress, balance: balance.toBigInt(), exists };
    });
}
exports.getAccount = getAccount;
function getAccounts(provider, factoryAddress, ownerAddress, page, limit) {
    return __awaiter(this, void 0, void 0, function* () {
        const tasks = Array.from({ length: limit }, (v, k) => getAccount(provider, factoryAddress, ownerAddress, page * limit + k));
        return Promise.all(tasks);
    });
}
exports.getAccounts = getAccounts;
class ZkTeamClient extends ZkTeamCore_1.ZkTeamCore {
    constructor(params) {
        super(params);
        this.key = utils_1.HDNode.fromExtendedKey(params.key);
    }
    static generateTriplet(key, index) {
        const s = ethers_1.BigNumber.from(key.derivePath(`${index}/0`).privateKey).toBigInt();
        const n = ethers_1.BigNumber.from(key.derivePath(`${index}/1`).privateKey).toBigInt();
        const k = (0, utils_1.arrayify)(key.derivePath(`${index}/2`).privateKey);
        const i = (0, utils_1.arrayify)(key.derivePath(`${index}/3`).privateKey).slice(0, 24);
        return { s, n, k, i };
    }
    getLastIndex(key) {
        return __awaiter(this, void 0, void 0, function* () {
            let index = 0;
            while (true) {
                const nullifier = ethers_1.BigNumber.from(key.derivePath(`${index}/1`).privateKey).toBigInt();
                const nullifierHash = ZkTeamCore_1.ZkTeamCore.getNullifierHash(nullifier);
                const encryptedAllowance = yield this.getEncryptedAllowance(nullifierHash);
                if (encryptedAllowance == ethers_1.constants.HashZero)
                    break;
                index++;
            }
            return index;
        });
    }
}
class ZkTeamClientAdmin extends ZkTeamClient {
    getUserKey(userIndex) {
        return this.key.derivePath(`m/${this.index}/${userIndex}'`);
    }
    getAllowance(userIndex) {
        return __awaiter(this, void 0, void 0, function* () {
            const userKey = this.getUserKey(userIndex);
            const index = yield this.getLastIndex(userKey);
            if (index == 0)
                return null;
            const { n, k, i } = ZkTeamClientAdmin.generateTriplet(userKey, index - 1);
            const nullifierHash = ZkTeamClientAdmin.getNullifierHash(n);
            return this.getDecryptedAllowance(nullifierHash, k, i);
        });
    }
    getUser(userIndex) {
        return __awaiter(this, void 0, void 0, function* () {
            const key = this.getUserKey(userIndex).extendedKey;
            let allowance = yield this.getAllowance(userIndex);
            let exists = true;
            if (allowance == null) {
                allowance = BigInt(0);
                exists = false;
            }
            return { index: userIndex, key, allowance, exists };
        });
    }
    getUsers(page, limit) {
        return __awaiter(this, void 0, void 0, function* () {
            const users = Array.from({ length: limit }, (v, k) => this.getUser(page * limit + k));
            return Promise.all(users).then(function (users) {
                return users.filter(function (user) {
                    return user.exists;
                });
            });
        });
    }
    generateInputs(userIndex, newAllowance) {
        return __awaiter(this, void 0, void 0, function* () {
            const userKey = this.getUserKey(userIndex);
            const index = (yield this.checkAccountPhantom())
                ? 0
                : yield this.getLastIndex(userKey);
            const currentTriplet = ZkTeamClientAdmin.generateTriplet(userKey, index);
            const newTriplet = ZkTeamClientAdmin.generateTriplet(userKey, index + 1);
            return this.generateSignatureInputs({
                oldNullifier: currentTriplet.n,
                newAllowance,
                newNullifier: newTriplet.n,
                newSecret: newTriplet.s,
                newKey: currentTriplet.k,
                newNonce: currentTriplet.i,
            });
        });
    }
    setAllowance(userIndex, allowance) {
        return __awaiter(this, void 0, void 0, function* () {
            if (userIndex !== 0) {
                if ((yield this.getAllowance(userIndex - 1)) == null) {
                    throw new Error("Allowance for a lower user index has not been set");
                }
            }
            const inputs = yield this.generateInputs(userIndex, allowance);
            return this.createSignedUserOp(Object.assign(Object.assign({}, inputs), { target: yield this.getAccountAddress(), data: "0x" }));
        });
    }
    tagLogs() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.getData();
            let userIndex = 0;
            while ((yield this.getAllowance(userIndex)) !== null) {
                const userKey = this.getUserKey(userIndex);
                const index = yield this.getLastIndex(userKey);
                if (index == 0)
                    continue;
                for (let i = 1; i <= index; i++) {
                    const oldTriplet = ZkTeamClientAdmin.generateTriplet(userKey, i - 1);
                    const currentTriplet = ZkTeamClientAdmin.generateTriplet(userKey, i);
                    const nullifierHash = ZkTeamClientAdmin.getNullifierHash(oldTriplet.n);
                    const log = this.data.nullifierHashes[nullifierHash.toString()];
                    if (!('userIndex' in log))
                        log.userIndex = userIndex;
                    if (!('valid' in log)) {
                        const allowance = (0, encryption_1.decryptAllowance)(log.encryptedAllowance, oldTriplet.k, oldTriplet.i);
                        const commitmentHash = ZkTeamClientAdmin.getCommitmentHash(currentTriplet.n, currentTriplet.s, allowance);
                        log.valid = (commitmentHash === log.commitmentHash);
                    }
                }
                userIndex++;
            }
        });
    }
    getTransactions(page, limit) {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.tagLogs();
            return this.data.logs.slice().reverse().filter(function (log) {
                return ('userIndex' in log);
            }).slice(page * limit, (page + 1) * limit);
        });
    }
    checkIntegrity() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.tagLogs();
            return Object.values(this.data.nullifierHashes).reduce(function (acc, log) {
                const extendedLog = log;
                if (!extendedLog.valid && !extendedLog.discarded)
                    acc.push(extendedLog.commitmentHash);
                return acc;
            }, []);
        });
    }
}
exports.ZkTeamClientAdmin = ZkTeamClientAdmin;
class ZkTeamClientUser extends ZkTeamClient {
    getKey() {
        return this.key.extendedKey;
    }
    getAllowance() {
        return __awaiter(this, void 0, void 0, function* () {
            const index = yield this.getLastIndex(this.key);
            if (index == 0)
                return null;
            const { n, k, i } = ZkTeamClientUser.generateTriplet(this.key, index - 1);
            const nullifierHash = ZkTeamClientUser.getNullifierHash(n);
            return this.getDecryptedAllowance(nullifierHash, k, i);
        });
    }
    generateInputs(value) {
        return __awaiter(this, void 0, void 0, function* () {
            const index = yield this.getLastIndex(this.key);
            if (index == 0)
                throw new Error("Allowance not set");
            const oldTriplet = ZkTeamClientUser.generateTriplet(this.key, index - 1);
            const oldNullifierHash = ZkTeamClientUser.getNullifierHash(oldTriplet.n);
            const currentTriplet = ZkTeamClientUser.generateTriplet(this.key, index);
            const newTriplet = ZkTeamClientUser.generateTriplet(this.key, index + 1);
            return this.generateProofInputs({
                value,
                oldNullifierHash,
                oldNullifier: currentTriplet.n,
                oldSecret: currentTriplet.s,
                oldKey: oldTriplet.k,
                oldNonce: oldTriplet.i,
                newNullifier: newTriplet.n,
                newSecret: newTriplet.s,
                newKey: currentTriplet.k,
                newNonce: currentTriplet.i,
            });
        });
    }
    setTransaction(target, value, data) {
        return __awaiter(this, void 0, void 0, function* () {
            const inputs = yield this.generateInputs(value);
            return this.createProvedUserOp(Object.assign(Object.assign({}, inputs), { target,
                data }));
        });
    }
    getNullifierHash(index) {
        let nullifier = ethers_1.BigNumber.from(this.key.derivePath(`${index}/1`).privateKey).toBigInt();
        return ZkTeamCore_1.ZkTeamCore.getNullifierHash(nullifier);
    }
    getTransactions(page, limit) {
        return __awaiter(this, void 0, void 0, function* () {
            let index = (yield this.getLastIndex(this.key));
            let results = [];
            let i = index - (page * limit);
            while (--i >= 0 && results.length < limit) {
                const nullifierHash = this.getNullifierHash(i);
                const log = this.data.nullifierHashes[nullifierHash.toString()];
                results.push(log);
            }
            return results;
        });
    }
}
exports.ZkTeamClientUser = ZkTeamClientUser;

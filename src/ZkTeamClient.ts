import { Contract, BigNumber, constants } from "ethers";
import { Provider } from "@ethersproject/providers";
import { HDNode, arrayify } from "ethers/lib/utils";

import * as ZkTeamAccountFactory from "../artifacts/contracts/ZkTeamAccountFactory.sol/ZkTeamAccountFactory.json";

import { ZkTeamCore, ZkTeamCoreParams } from "./ZkTeamCore";
import { decryptAllowance } from "./Utils/encryption";

export async function getAccount(
  provider: Provider,
  factoryAddress: string,
  ownerAddress: string,
  accountIndex: number
) {
  const factory = new Contract(
    factoryAddress,
    ZkTeamAccountFactory.abi,
    provider
  );
  const accountAddress = await factory.getAddress(ownerAddress, accountIndex);
  const accountCode = await provider.getCode(accountAddress);
  const exists = accountCode.length > 2;
  const balance = await provider.getBalance(accountAddress);
  return { balance, exists };
}

export async function getAccounts(
  provider: Provider,
  factoryAddress: string,
  ownerAddress: string,
  page: number,
  limit: number
) {
  const tasks = Array.from({ length: limit }, (v, k) =>
    getAccount(provider, factoryAddress, ownerAddress, page * limit + k)
  );
  return Promise.all(tasks);
}

export interface ZkTeamClientParams extends ZkTeamCoreParams {
  key: string;
}

class ZkTeamClient extends ZkTeamCore {
  public key: HDNode;

  constructor(params: ZkTeamClientParams) {
    super(params);
    this.key = HDNode.fromExtendedKey(params.key);
  }

  static generateTriplet(key: HDNode, index: number) {
    const s = BigNumber.from(
      key.derivePath(`${index}/0`).privateKey
    ).toBigInt();
    const n = BigNumber.from(
      key.derivePath(`${index}/1`).privateKey
    ).toBigInt();
    const k = arrayify(key.derivePath(`${index}/2`).privateKey);
    const i = arrayify(key.derivePath(`${index}/3`).privateKey).slice(0, 24);
    return { s, n, k, i };
  }

  async getLastIndex(key: HDNode) {
    let index = 0;
    while (true) {
      const nullifier = BigNumber.from(
        key.derivePath(`${index}/1`).privateKey
      ).toBigInt();
      const nullifierHash = ZkTeamCore.getNullifierHash(nullifier);
      const encryptedAllowance = await this.getEncryptedAllowance(
        nullifierHash
      );
      if (encryptedAllowance == constants.HashZero) break;
      index++;
    }
    return index;
  }
}

export class ZkTeamClientAdmin extends ZkTeamClient {
  private getRawUserKey(userIndex: number) {
    return this.key.derivePath(`m/${this.index}/${userIndex}'`);
  }

  public async getUserKey(userIndex: number) {
    const userKey = this.getRawUserKey(userIndex);
    return userKey.extendedKey;
  }

  public async getAllowance(userIndex: number) {
    const userKey = this.getRawUserKey(userIndex);
    const index = await this.getLastIndex(userKey);
    if (index == 0) return null;
    const { n, k, i } = ZkTeamClientAdmin.generateTriplet(userKey, index - 1);
    const nullifierHash = ZkTeamClientAdmin.getNullifierHash(n);
    return this.getDecryptedAllowance(nullifierHash, k, i);
  }

  public async getAllowances(page: number, limit: number) {
    const tasks = Array.from({ length: limit }, (v, k) =>
      this.getAllowance(page * limit + k)
    );
    return Promise.all(tasks);
  }

  public async generateInputs(userIndex: number, newAllowance: bigint) {
    const userKey = this.getRawUserKey(userIndex);
    const index = (await this.checkAccountPhantom())
      ? 0
      : await this.getLastIndex(userKey);
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
  }

  public async setAllowance(userIndex: number, allowance: bigint) {
    const inputs = await this.generateInputs(userIndex, allowance);
    return this.createSignedUserOp({
      ...inputs,
      target: await this.getAccountAddress(),
      data: "0x",
    });
  }

  public async checkIntegrity(userIndexLimit: number) {
    for (let userIndex = 0; userIndex <= userIndexLimit; userIndex++) {
      const userKey = this.getRawUserKey(userIndex);
      const index = await this.getLastIndex(userKey);
      if (index == 0) continue;
      for (let i = 1; i <= index; i++) {
        const oldTriplet = ZkTeamClientAdmin.generateTriplet(userKey, i - 1);
        const currentTriplet = ZkTeamClientAdmin.generateTriplet(userKey, i);
        const nullifierHash = ZkTeamClientAdmin.getNullifierHash(oldTriplet.n);
        const log = this.data.nullifierHashes[nullifierHash.toString()];
        if (!log.verified && !log.discarded) {
          const allowance = decryptAllowance(
            log.encryptedAllowance,
            oldTriplet.k,
            oldTriplet.i
          );
          const commitmentHash = ZkTeamClientAdmin.getCommitmentHash(
            currentTriplet.n,
            currentTriplet.s,
            allowance
          );
          if (commitmentHash === log.commitmentHash) log.verified = true;
        }
      }
    }
    return Object.values(this.data.nullifierHashes).reduce(function (acc, log) {
      if (!log.verified && !log.discarded) acc.push(log.commitmentHash);
      return acc;
    }, [] as bigint[]);
  }
}

export class ZkTeamClientUser extends ZkTeamClient {
  public async getAllowance() {
    const index = await this.getLastIndex(this.key);
    if (index == 0) return null;
    const { n, k, i } = ZkTeamClientUser.generateTriplet(this.key, index - 1);
    const nullifierHash = ZkTeamClientUser.getNullifierHash(n);
    return this.getDecryptedAllowance(nullifierHash, k, i);
  }

  public async generateInputs(value: bigint) {
    const index = await this.getLastIndex(this.key);
    if (index == 0) throw new Error("Allowance not set");

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
  }

  public async sendTransaction(target: string, value: bigint, data: string) {
    const inputs = await this.generateInputs(value);
    return await this.createProvedUserOp({
      ...inputs,
      target,
      data,
    });
  }
}

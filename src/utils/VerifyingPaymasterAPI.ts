import { Contract, Wallet, utils } from "ethers";
import {
  PaymasterAPI,
  calcPreVerificationGas,
  DefaultGasOverheads,
} from "@account-abstraction/sdk";
import { UserOperationStruct } from "@account-abstraction/contracts";

const SIG_SIZE = 65;

export class VerifyingPaymasterAPI extends PaymasterAPI {
  private paymaster: Contract;
  private owner: Wallet;
  private validUntilDelay: number;

  constructor(paymaster: Contract, owner: Wallet, validUntilDelay: number) {
    super();
    this.paymaster = paymaster;
    this.owner = owner;
    this.validUntilDelay = validUntilDelay || 60 * 360; // six hours from now
  }

  async getPaymasterAndData(
    userOp: Partial<UserOperationStruct>
  ): Promise<string> {
    // Hack: userOp includes empty paymasterAndData which calcPreVerificationGas requires.
    try {
      // userOp.preVerificationGas contains a promise that will resolve to an error.
      await utils.resolveProperties(userOp);
      // eslint-disable-next-line no-empty
    } catch (_) {}

    const currentTime = Math.floor(Date.now() / 1000);
    const validAfter = currentTime;
    const validUntil = currentTime + this.validUntilDelay;
    const dummy_signature = utils.hexlify(Buffer.alloc(SIG_SIZE, 1));

    const pmOp: Partial<UserOperationStruct> = {
      sender: userOp.sender,
      nonce: userOp.nonce,
      initCode: userOp.initCode,
      callData: userOp.callData,
      callGasLimit: userOp.callGasLimit,
      verificationGasLimit: userOp.verificationGasLimit,
      maxFeePerGas: userOp.maxFeePerGas,
      maxPriorityFeePerGas: userOp.maxPriorityFeePerGas,
      paymasterAndData: utils.hexConcat([
        this.paymaster.address,
        utils.defaultAbiCoder.encode(
          ["uint48", "uint48"],
          [validUntil, validAfter]
        ),
        dummy_signature,
      ]),
      signature: dummy_signature,
    };

    const op = await utils.resolveProperties(pmOp);

    op.preVerificationGas = calcPreVerificationGas(op, {
      zeroByte: DefaultGasOverheads.nonZeroByte,
    });

    const hash = await this.paymaster.getHash(op, validUntil, validAfter);
    const sig = await this.owner.signMessage(utils.arrayify(hash));

    const paymasterAndData = utils.hexConcat([
      this.paymaster.address,
      utils.defaultAbiCoder.encode(
        ["uint48", "uint48"],
        [validUntil, validAfter]
      ),
      sig,
    ]);

    return paymasterAndData;
  }
}

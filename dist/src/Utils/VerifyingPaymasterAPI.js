"use strict";
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
exports.VerifyingPaymasterAPI = void 0;
const ethers_1 = require("ethers");
const sdk_1 = require("@account-abstraction/sdk");
const SIG_SIZE = 65;
class VerifyingPaymasterAPI extends sdk_1.PaymasterAPI {
    constructor(paymaster, owner, validUntilDelay) {
        super();
        this.paymaster = paymaster;
        this.owner = owner;
        this.validUntilDelay = validUntilDelay || 60 * 360; // six hours from now
    }
    getPaymasterAndData(userOp) {
        return __awaiter(this, void 0, void 0, function* () {
            // Hack: userOp includes empty paymasterAndData which calcPreVerificationGas requires.
            try {
                // userOp.preVerificationGas contains a promise that will resolve to an error.
                yield ethers_1.utils.resolveProperties(userOp);
                // eslint-disable-next-line no-empty
            }
            catch (_) { }
            const currentTime = Math.floor(Date.now() / 1000);
            const validAfter = currentTime;
            const validUntil = currentTime + this.validUntilDelay;
            const dummy_signature = ethers_1.utils.hexlify(Buffer.alloc(SIG_SIZE, 1));
            const pmOp = {
                sender: userOp.sender,
                nonce: userOp.nonce,
                initCode: userOp.initCode,
                callData: userOp.callData,
                callGasLimit: userOp.callGasLimit,
                verificationGasLimit: userOp.verificationGasLimit,
                maxFeePerGas: userOp.maxFeePerGas,
                maxPriorityFeePerGas: userOp.maxPriorityFeePerGas,
                paymasterAndData: ethers_1.utils.hexConcat([
                    this.paymaster.address,
                    ethers_1.utils.defaultAbiCoder.encode(["uint48", "uint48"], [validUntil, validAfter]),
                    dummy_signature,
                ]),
                signature: dummy_signature,
            };
            const op = yield ethers_1.utils.resolveProperties(pmOp);
            op.preVerificationGas = (0, sdk_1.calcPreVerificationGas)(op, {
                zeroByte: sdk_1.DefaultGasOverheads.nonZeroByte,
            });
            const hash = yield this.paymaster.getHash(op, validUntil, validAfter);
            const sig = yield this.owner.signMessage(ethers_1.utils.arrayify(hash));
            const paymasterAndData = ethers_1.utils.hexConcat([
                this.paymaster.address,
                ethers_1.utils.defaultAbiCoder.encode(["uint48", "uint48"], [validUntil, validAfter]),
                sig,
            ]);
            return paymasterAndData;
        });
    }
}
exports.VerifyingPaymasterAPI = VerifyingPaymasterAPI;

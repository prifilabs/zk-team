pragma circom 2.0.0;

include "../../node_modules/circomlib/circuits/poseidon.circom";

template ZKHiddenBalancePoseidon() {
    signal input secret;
    signal input address;
    signal input balance;
    signal input newBalance;
    signal input value;
    signal input nonce;
    signal output out[3];

    assert(value >= 0);
    assert(balance >= 0);
    assert(newBalance >= 0);
    // check for enough balance
    assert(value <= balance);
    // check correct newBalance
    assert(balance - value == newBalance);

    // check secretUserAddress hash
    component zkNumberHashPoseidon1 = Poseidon(3);
    zkNumberHashPoseidon1.inputs <== [address, secret, nonce];
    out[0] <== zkNumberHashPoseidon1.out;

    // check secretBalance hash
    component zkNumberHashPoseidon2 = Poseidon(3);
    zkNumberHashPoseidon2.inputs <== [balance, secret, nonce];
    out[1] <== zkNumberHashPoseidon2.out;

    // check newSecretBalance hash
    component zkNumberHashPoseidon3 = Poseidon(3);
    zkNumberHashPoseidon3.inputs <== [newBalance, secret, nonce];
    out[2] <== zkNumberHashPoseidon3.out;
 }

 component main {public [value]} = ZKHiddenBalancePoseidon();
 
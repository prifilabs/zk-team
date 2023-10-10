pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "./tree.circom";

template InputHasher(levels){
    signal input secret;
    signal input nullifier;
    signal input balance;
    
    signal output commitmentHash;
    component commitmentHasher = Poseidon(3);
    commitmentHasher.inputs <== [nullifier, secret, balance];
    commitmentHash <== commitmentHasher.out;
    
    signal input treeSiblings[levels];
    signal input treePathIndices[levels];
    signal output root;

    component tree = MerkleTreeInclusionProof(levels);
    tree.leaf <== commitmentHasher.out;
    for (var i = 0; i < levels; i++) {
        tree.siblings[i] <== treeSiblings[i];
        tree.pathIndices[i] <== treePathIndices[i];
    }
    
    root <== tree.root;
}


template Transact(levels) {

    // public input values
    signal input value;
    signal input callDataHash;
    signal input adminHash;
    signal input oldRoot;
    
    // public output values
    signal output nullifierHash;
    signal output commitmentHash;
    signal output root;
    
    // private old input values
    signal input oldBalance;
    signal input oldNullifier;
    signal input oldSecret;
    signal input oldTreeSiblings[levels];
    signal input oldTreePathIndices[levels];
    
    component nullifierHasher = Poseidon(1);
    nullifierHasher.inputs <== [oldNullifier];
    nullifierHash <== nullifierHasher.out;
    
    component oldInputHasher = InputHasher(levels);
    oldInputHasher.nullifier <== oldNullifier;
    oldInputHasher.secret <== oldSecret;
    oldInputHasher.balance <== oldBalance;
    oldInputHasher.treeSiblings <== oldTreeSiblings;
    oldInputHasher.treePathIndices <== oldTreePathIndices;
    
    // private new input values
    
    signal input newBalance;
    signal input newNullifier;
    signal input newSecret;
    signal input newTreeSiblings[levels];
    signal input newTreePathIndices[levels]; 
    
    component newInputHasher = InputHasher(levels);
    newInputHasher.nullifier <== newNullifier;
    newInputHasher.secret <== newSecret;
    newInputHasher.balance <== newBalance;
    newInputHasher.treeSiblings <== newTreeSiblings;
    newInputHasher.treePathIndices <== newTreePathIndices;

    commitmentHash <== newInputHasher.commitmentHash;    
    root <== newInputHasher.root; 
    
    // asserts
    
    assert(value >= 0);
    assert(oldBalance >= value);
    
    component adminHasher = Poseidon(1);
    adminHasher.inputs <== [oldSecret];
    
    if (adminHasher.out == adminHash) {
       assert(newBalance >= 0);
    } else {
       assert(newBalance == oldBalance - value);          
       assert(oldRoot == oldInputHasher.root);
    }
    
    // hidden signals to prevent tampering
    
    signal callDataHashSquared;
    callDataHashSquared <== callDataHash * callDataHash;
}

// Public inputs: adminHash, oldRoot, value, callDataHash
// Outputs: (old) nullifierHash, (new) commitmentHash, root
// Private inputs: secretHash, oldBalance, oldNullifier, oldSecret, oldMerkleProof (oldTreeSiblings + oldTreePathIndices), newBalance, newSecret, newMerkleProof (newTreeSiblings + newTreePathIndices)

component main {public [adminHash, oldRoot, value, callDataHash]} = Transact(20);

pragma circom 2.0.0;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "./tree.circom";

template InputHasher(levels){
    signal input secret;
    signal input nullifier;
    signal input allowance;
    
    signal output commitmentHash;
    component commitmentHasher = Poseidon(3);
    commitmentHasher.inputs <== [nullifier, secret, allowance];
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
    
    // public output values
    signal output oldNullifierHash;
    signal output oldRoot;
    signal output newCommitmentHash;
    signal output newRoot;
    
    // private old input values
    signal input oldAllowance;
    signal input oldNullifier;
    signal input oldSecret;
    signal input oldTreeSiblings[levels];
    signal input oldTreePathIndices[levels];
    
    component oldInputHasher = InputHasher(levels);
    oldInputHasher.nullifier <== oldNullifier;
    oldInputHasher.secret <== oldSecret;
    oldInputHasher.allowance <== oldAllowance;
    oldInputHasher.treeSiblings <== oldTreeSiblings;
    oldInputHasher.treePathIndices <== oldTreePathIndices;
    
    component nullifierHasher = Poseidon(1);
    nullifierHasher.inputs <== [oldNullifier];    
    oldNullifierHash <== nullifierHasher.out;
    oldRoot <== oldInputHasher.root;
    
    // private new input values
    
    signal input newAllowance;
    signal input newNullifier;
    signal input newSecret;
    signal input newTreeSiblings[levels];
    signal input newTreePathIndices[levels]; 
    
    component newInputHasher = InputHasher(levels);
    newInputHasher.nullifier <== newNullifier;
    newInputHasher.secret <== newSecret;
    newInputHasher.allowance <== newAllowance;
    newInputHasher.treeSiblings <== newTreeSiblings;
    newInputHasher.treePathIndices <== newTreePathIndices;

    newCommitmentHash <== newInputHasher.commitmentHash;    
    newRoot <== newInputHasher.root; 
    
    // asserts
    
    assert(value >= 0);
    assert(oldAllowance >= value);
    assert(newAllowance == oldAllowance - value);          
    
    // hidden signals to prevent tampering
    
    signal callDataHashSquared;
    callDataHashSquared <== callDataHash * callDataHash;
}

// Public inputs: value, callDataHash
// Outputs: oldNullifierHash, oldRoot, newCommitmentHash, newRoot
// Private inputs: secretHash, oldAllowance, oldNullifier, oldSecret, oldMerkleProof (oldTreeSiblings + oldTreePathIndices), newAllowance, newSecret, newMerkleProof (newTreeSiblings + newTreePathIndices)

component main {public [value, callDataHash]} = Transact(20);

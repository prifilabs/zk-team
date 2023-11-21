"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MerkleTree = void 0;
const incremental_merkle_tree_1 = require("@zk-kit/incremental-merkle-tree");
const poseidon_lite_1 = require("poseidon-lite");
class MerkleTree {
    constructor(leaves) {
        this.tree = new incremental_merkle_tree_1.IncrementalMerkleTree(poseidon_lite_1.poseidon2, 20, BigInt(0), 2, [
            ...leaves,
        ]);
    }
    insert(commitmentHash) {
        this.tree.insert(commitmentHash);
    }
    getRoot() {
        return this.tree.root;
    }
    discard(commitmentHash) {
        const index = this.tree.indexOf(commitmentHash);
        this.tree.update(index, BigInt(0));
    }
    getProof(commitmentHash) {
        const merkleProof = this.tree.createProof(this.tree.indexOf(commitmentHash));
        const treeSiblings = merkleProof.siblings.map((s) => s[0]);
        const treePathIndices = merkleProof.pathIndices;
        return { treeSiblings, treePathIndices };
    }
}
exports.MerkleTree = MerkleTree;

import { IncrementalMerkleTree, Node } from "@zk-kit/incremental-merkle-tree";
import { poseidon2 } from "poseidon-lite";

export class MerkleTree {
  private tree: Node;

  constructor(leaves: Array<bigint>) {
    this.tree = new IncrementalMerkleTree(poseidon2, 20, BigInt(0), 2, [
      ...leaves,
    ]);
  }

  public insert(commitmentHash: bigint) {
    this.tree.insert(commitmentHash);
  }

  public getRoot(): bigint {
    return this.tree.root;
  }

  public discard(commitmentHash: bigint) {
    const index = this.tree.indexOf(commitmentHash);
    this.tree.update(index, BigInt(0));
  }

  public getProof(commitmentHash: bigint) {
    const merkleProof = this.tree.createProof(
      this.tree.indexOf(commitmentHash)
    );
    const treeSiblings = merkleProof.siblings.map((s: Node[][]) => s[0]);
    const treePathIndices = merkleProof.pathIndices;
    return { treeSiblings, treePathIndices };
  }
}

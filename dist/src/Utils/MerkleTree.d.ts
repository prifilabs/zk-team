export declare class MerkleTree {
    private tree;
    constructor(leaves: Array<bigint>);
    insert(commitmentHash: bigint): void;
    getRoot(): bigint;
    discard(commitmentHash: bigint): void;
    getProof(commitmentHash: bigint): {
        treeSiblings: any;
        treePathIndices: any;
    };
}

import { IncrementalMerkleTree } from "@zk-kit/incremental-merkle-tree"
import { poseidon2 } from "poseidon-lite"

export class MerkleTree{
    
    constructor(leaves){
        this.tree = new IncrementalMerkleTree(poseidon2, 20, BigInt(0), 2, [...leaves]);
    }

    public insert(commitmentHash){
        this.tree.insert(commitmentHash);
    }
    
    public getRoot(){
        
        return this.tree.root;
    }
    
    public discard(commitmentHash){
        const index = this.tree.indexOf(commitmentHash);
        this.tree.update(index, BigInt(0));
    }
    
    public getProof(commitmentHash){
        const merkleProof = this.tree.createProof(this.tree.indexOf(commitmentHash));
        const treeSiblings = merkleProof.siblings.map( (s) => s[0]);
        const treePathIndices = merkleProof.pathIndices;
        return { treeSiblings, treePathIndices };
    }
}
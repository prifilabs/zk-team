import * as EntryPoint from '@account-abstraction/contracts/artifacts/EntryPoint.json';
import { HttpRpcClient } from '@account-abstraction/sdk'
import { proxy, PoseidonT2, PoseidonT3 } from "poseidon-solidity";

export async function deployEntrypointAndBundlerHardhat(){
    const EntryPointFactory = await ethers.getContractFactory(EntryPoint.abi, EntryPoint.bytecode);
    const entryPoint = await EntryPointFactory.deploy();
    const bundler = ethers.Wallet.createRandom();
    const bundlerAddress = await bundler.getAddress();
    const sendUserOp = async function(op){        
        await entryPoint.handleOps([op], bundlerAddress);
        return entryPoint.getUserOpHash(op); 
    }
    return { entryPointAddress: entryPoint.address, bundlerAddress, sendUserOp }
}

export async function deployEntrypointAndBundlerLocal(){
    const entryPointAddress = "0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789";
    const bundlerUrl = 'http://localhost:3000/rpc';
    const bundlerAddress = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
    const sendUserOp = async function(params){
        const client = new HttpRpcClient(
          bundlerUrl,
          entryPointAddress,
          1337 // chainid
        );
        return client.sendUserOpToBundler(op) 
    }
    return { entryPointAddress, bundlerAddress, sendUserOp }
}

export async function deployPoseidon(){
    // see https://github.com/vimwitch/poseidon-solidity
    
    const [sender] = await ethers.getSigners()

    // First check if the proxy exists
    if (await ethers.provider.getCode(proxy.address) === '0x') {
      // fund the keyless account
      await sender.sendTransaction({
        to: proxy.from,
        value: proxy.gas,
      })

      // then send the presigned transaction deploying the proxy
      await ethers.provider.sendTransaction(proxy.tx)
    }

    // Then deploy the hasher, if needed
    if (await ethers.provider.getCode(PoseidonT3.address) === '0x') {
      await sender.sendTransaction({
        to: proxy.address,
        data: PoseidonT3.data
      })
    }
    
    if (await ethers.provider.getCode(PoseidonT2.address) === '0x') {
      await sender.sendTransaction({
        to: proxy.address,
        data: PoseidonT2.data
      })
    }
}

export async function deployZkTeamFactory(chainId, entryPointAddress){
    const IncrementalBinaryTreeLibFactory = await ethers.getContractFactory("IncrementalBinaryTree", {
        libraries: {
            PoseidonT3: PoseidonT3.address
        }
    })
    const incrementalBinaryTreeLib = await IncrementalBinaryTreeLibFactory.deploy()

    await incrementalBinaryTreeLib.deployed()

    const ZkTeamVerifier = await ethers.getContractFactory("Groth16Verifier");
    const zkTeamVerifier = await ZkTeamVerifier.deploy();

    const zkTeamAccountFactoryFactory = await ethers.getContractFactory("ZkTeamAccountFactory", {        
        libraries: {
            IncrementalBinaryTree: incrementalBinaryTreeLib.address,
            PoseidonT2: PoseidonT2.address
    }});
            
    return zkTeamAccountFactoryFactory.deploy(entryPointAddress, zkTeamVerifier.address);
}
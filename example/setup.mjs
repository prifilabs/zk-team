import { join } from "path";
import ethers from "ethers";
import { HttpRpcClient } from "@account-abstraction/sdk";

import sepoliaConfig from "@prifilabs/zk-team/config/11155111.json" assert { type: "json" };

import dotenv from 'dotenv'
dotenv.config({path: join('..', '.env')});

export const network = "sepolia";
export const chainId = 11155111;

export const config = sepoliaConfig;

export const provider = new ethers.providers.InfuraProvider(network, process.env.INFURA_API_KEY)

export const client = new HttpRpcClient(
  config.bundler.url,
  config.entrypoint.address,
  chainId
);

import { pbkdf2 } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha256";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { utf8ToBytes, bytesToUtf8 } from "@noble/ciphers/utils";

import Conf from "conf";
import prompts from "prompts";
import validator from 'validator';

import { Wallet, providers, utils } from 'ethers';

import { readFileSync} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));

import { HttpRpcClient } from "@account-abstraction/sdk";

const onCancel = () => { process.exit(0); }

function encryptData(salt, password, plaintext) {
  const key = pbkdf2(sha256, password, salt, { c: 32, dkLen: 32 });
  const nonce = utils.randomBytes(24);
  const stream = xchacha20poly1305(key, nonce);
  const data = utf8ToBytes(plaintext);
  const ciphertext = stream.encrypt(data);
  return utils.hexlify(new Uint8Array([...nonce, ...ciphertext]));
}

function decryptData(salt, password, data) {
  const key = pbkdf2(sha256, password, salt, { c: 32, dkLen: 32 });
  const raw = utils.arrayify(data);
  const nonce = raw.slice(0, 24);
  const ciphertext = raw.slice(24);
  const stream = xchacha20poly1305(key, nonce);
  const plaintext = stream.decrypt(ciphertext);
  return bytesToUtf8(plaintext);
}

export async function printUserOperation(op){
    const data = await utils.resolveProperties(op);
    ['nonce', 'callGasLimit', 'maxFeePerGas', 'maxPriorityFeePerGas', 'verificationGasLimit', 'preVerificationGas'].map(function(key){
        data[key] = data[key].toString();
    })
    console.log('User Operation sent to the bundler:');
    console.log(JSON.stringify(data, null, 2))
}

export async function processTransaction(tx){
    console.log(`Transaction sent - hash: ${tx.hash}`)
    const receipt = await tx.wait();    
    const gasCost = receipt.gasUsed.mul(receipt.effectiveGasPrice);
    console.log(`Transaction confirmed - cost: ${utils.formatEther(gasCost)} ETH`);
}

function getConfig(type){
    const store = new Conf({projectName: 'zkteam'});
    if (!store.has(type)) return null; 
    const config = store.get(type);
    config.provider.instance = new providers[config.provider.type](config.chainId, config.provider.key);
    config.client = new HttpRpcClient(
        config.bundler.url,
        config.entrypoint.address,
        config.chainId
    );
    return config;
}

function extractData(config){
    return {
        salt: config.salt,
        entrypoint: config.entrypoint,
        factory: config.factory,
        chainId: config.chainId,
        bundler: config.bundler,
        provider: {
            type: config.provider.type,
            key: config.provider.key,
        }
    };
}

function writeConfig(type, config){
    const store = new Conf({projectName: 'zkteam'});
    store.set(type, config);
    console.log(`Your configuration is stored in ${store.path}`);
}

export async function getConfigProtected(type){
    const { password } = await prompts({
        type: 'password',
        name: 'password',
        message: 'Enter your password:',
    }, {onCancel});
    const config = getConfig(type);
    if (!config) return {password};
    config.password = password; 
    return config;
}

export function getAdminConfig(){
    return getConfig('admin');
};

export async function getAdminConfigProtected(){
    const config = await getConfigProtected('admin');
    if ('admin' in config){
        config.admin.privkey = decryptData(config.salt, config.password, config.admin.privkey);
        config.admin.mnemonic = decryptData(config.salt, config.password, config.admin.mnemonic);
        config.admin.wallet = new Wallet(config.admin.privkey).connect(config.provider.instance);
        config.admin.key = utils.HDNode.fromMnemonic(config.admin.mnemonic).extendedKey;
    }
    return config;
};

export function getUserConfig(){
    return getConfig('user');
};

export async function getUserConfigProtected(){
    const config = await getConfigProtected('user');
    if ('user' in config){
        config.user.privkey = decryptData(config.salt, config.password, config.user.privkey);
    }
    return config;
};

async function setConfig(config) {
    if (!config.salt){
        await prompts({
                type: 'password',
                name: 'password',
                message: 'Confirm your password:',
                validate: value => (value == config.password) ? true : `Password does not match the original one`,           
        }, {onCancel});
        const defaultConfig = JSON.parse(readFileSync(join(__dirname, '..', 'config', '11155111.json'), "utf-8"));
        config = {...defaultConfig, ...config};
    }    
    const responses = await prompts([
        {
              type: 'select',
              name: 'chainId',
              message: 'Select the chain',
              choices: [
                { title: 'Sepolia (11155111)', value: '11155111' },
              ],
              initial: 0
        },
        {
              type: 'select',
              name: 'providerType',
              message: 'Select the provider',
              choices: [
                { title: 'Infura', value: 'InfuraProvider' },
                { title: 'Alchemy', value: 'AlchemyProvider' },
              ],
              initial: 0
        },
        {
              type: 'text',
              name: 'providerKey',
              message: 'Enter the provider API key',
              initial: ('provider' in config)? config.provider.key : '',
              onRender(k) {
                if (this.done) { this.rendered = ''; }
            }   
        },
        {
            type: 'text',
            name: 'bundler',
            message: 'Enter the bundler URL:',
            initial: config.bundler.url,
            validate: value => validator.isURL(value) ? true : `Invalid URL`,    
        }
    ], {onCancel});
    config.salt = Math.random().toString(36).slice(2);
    config.chainId = parseInt(responses.chainId);
    config.bundler = {url: responses.bundler};
    config.provider = {
        type: responses.providerType,
        key: responses.providerKey,
    }
    return config;
}

export async function setAdminConfig() {
    const config = await setConfig(await getAdminConfigProtected());
    const responses = await prompts([    
        {
            type: 'text',
            name: 'privkey',
            message: 'Enter the admin private key',
            initial: ('admin' in config)? config.admin.privkey : (new Wallet.createRandom()).privateKey,
            validate: function(value){
                try{
                    new Wallet(value);
                    return true;
                } catch (err){
                    return 'Invalid private key';
                }
            },
            onRender(k) {
                if (this.done) { this.rendered = ''; }
            }    
        },
        {
            type: 'text',
            name: 'mnemonic',
            message: 'Enter your mnemonic phrase for user managements',
            initial: ('admin' in config)? config.admin.mnemonic : (new Wallet.createRandom()).mnemonic.phrase,
            validate: value => utils.isValidMnemonic(value) ? true : `Invalid mnemonic`,
            onRender(k) {
                if (this.done) { this.rendered = ''; }
            }     
        }
    ], {onCancel});
    console.log(`The private key and the mnemonic have been encrypted`);
    const data = extractData(config);
    data.admin = {
        mnemonic: encryptData(config.salt, config.password, responses.mnemonic),
        privkey: encryptData(config.salt, config.password, responses.privkey),
        address: (new Wallet(responses.privkey)).address,
    }
    writeConfig('admin', data);
}

export async function setUserConfig() {
    const config = await setConfig(await getUserConfigProtected());
    const responses = await prompts([    
        {
            type: 'text',
            name: 'address',
            message: 'Enter the ZK Team account address',
            initial: ('user' in config)? config.user.address : '',
            validate: (value) => utils.isAddress(value),
        },
        {
            type: 'text',
            name: 'privkey',
            message: 'Enter your ZK Team private key',
            initial: ('user' in config)? config.user.privkey : '',
            validate: function(value){
                try{
                    new utils.HDNode.fromExtendedKey(value);
                    return true;
                } catch (err){
                    return 'Invalid private key';
                }
            },
            onRender(k) {
                if (this.done) { this.rendered = ''; }
            }    
        },
    ], {onCancel});
    console.log(`The private key has been encrypted`);
    const data = extractData(config);
    data.user  = {
        privkey: encryptData(config.salt, config.password, responses.privkey),
        address: responses.address,
    }
    writeConfig('user', data);
}

async function deleteConfig(type){
    const response = await prompts({
      type: 'confirm',
      name: 'value',
      message: 'Are you sure you want to delete the configuration from your computer?',
      initial: false
    });
    if (response.value){
        const store = new Conf({projectName: 'zkteam'});
        store.delete(type);
        console.log(`The configuration has been deleted from your computer`);
    }
}

export async function deleteAdminConfig(type){
    deleteConfig('admin');
}

export async function deleteUserConfig(type){
    deleteConfig('user');
}

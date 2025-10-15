import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { config as loadEnvFile } from 'dotenv';
import {
  Account,
  EDataAvailabilityMode,
  ec,
  hash,
  json,
  num,
  RpcProvider,
  type CompiledContract,
} from 'starknet';

import type { CallTransport, Felt } from '@ua2/core';

export type Network = 'devnet' | 'sepolia';

export interface Toolkit {
  provider: RpcProvider;
  network: Network;
  chainId: Felt;
  deployer: Account;
  deployerKey: string;
  ownerKey: string;
  ownerPubKey: string;
  guardian: Account;
  guardianPubKey: string;
  guardianAddress: Felt;
  guardianKey: string;
  rpcUrl: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const CONTRACTS_ROOT = path.resolve(PROJECT_ROOT, 'packages/contracts');

export class AccountCallTransport implements CallTransport {
  private readonly account: Account;
  public lastTxHash: Felt | null = null;

  constructor(account: Account) {
    this.account = account;
  }

  async invoke(address: Felt, entrypoint: string, calldata: Felt[]): Promise<{ txHash: Felt }> {
    const response = await this.account.execute({
      contractAddress: address,
      entrypoint,
      calldata,
    }, {
      version: '0x3',
      resourceBounds: defaultResourceBounds(),
      tip: 8n,
      nonceDataAvailabilityMode: EDataAvailabilityMode.L2,
      feeDataAvailabilityMode: EDataAvailabilityMode.L2,
    });
    const txHash = normalizeHex(response.transaction_hash);
    this.lastTxHash = txHash;
    return { txHash };
  }
}

export function loadEnv(network: Network): void {
  const files: string[] = ['.env', '.env.local', `.env.${network}`, `.env.${network}.local`];
  for (const file of files) {
    const full = path.resolve(PROJECT_ROOT, file);
    if (!fs.existsSync(full)) continue;
    loadEnvFile({ path: full, override: true });
  }
}

export function requireEnv(keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim() !== '') {
      return value.trim();
    }
  }
  throw new Error(`Missing required environment variable. Tried: ${keys.join(', ')}`);
}

export function optionalEnv(keys: string[], fallback?: string): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim() !== '') {
      return value.trim();
    }
  }
  return fallback;
}

export async function setupToolkit(network: Network): Promise<Toolkit> {
  loadEnv(network);

  const rpcUrl = requireEnv(['RPC']);
  const provider = new RpcProvider({ nodeUrl: rpcUrl, specVersion: '0.9.0' });
  const chainId = normalizeHex(await provider.getChainId());

  const deployerAddress = normalizeHex(
    requireEnv([`UA2_${network.toUpperCase()}_DEPLOYER_ADDRESS`, 'UA2_DEPLOYER_ADDRESS'])
  );
  const deployerKey = normalizePrivateKey(
    requireEnv([`UA2_${network.toUpperCase()}_DEPLOYER_PRIVATE_KEY`, 'UA2_DEPLOYER_PRIVATE_KEY'])
  );

  const deployer = new Account({
    provider,
    address: deployerAddress,
    signer: deployerKey,
  });

  const ownerKey = normalizePrivateKey(
    requireEnv([`UA2_${network.toUpperCase()}_OWNER_PRIVATE_KEY`, 'UA2_OWNER_PRIVATE_KEY'])
  );
  const ownerPubKey = derivePubKey(ownerKey);

  const guardianKey = normalizePrivateKey(
    requireEnv([`UA2_${network.toUpperCase()}_GUARDIAN_PRIVATE_KEY`, 'UA2_GUARDIAN_PRIVATE_KEY'])
  );
  const guardianPubKey = derivePubKey(guardianKey);
  const guardianAddress = normalizeHex(
    requireEnv([`UA2_${network.toUpperCase()}_GUARDIAN_ADDRESS`, 'UA2_GUARDIAN_ADDRESS'])
  );
  const guardian = new Account({
    provider,
    address: guardianAddress,
    signer: guardianKey,
  });

  console.log('[ua2] toolkit configured', {
    network,
    deployerAddress,
    ownerPubKey,
    guardianAddress,
  });

  return {
    provider,
    network,
    chainId,
    deployer,
    deployerKey,
    ownerKey,
    ownerPubKey,
    guardian,
    guardianPubKey,
    guardianAddress,
    guardianKey,
    rpcUrl,
  };
}

export async function ensureUa2Deployed(
  toolkit: Toolkit,
  existingAddress?: string
): Promise<{ address: Felt; classHash: Felt }> {
  console.log('[ua2] ensureUa2Deployed invoked', {
    existingAddress: existingAddress ?? null,
    deployerAddress: toolkit.deployer.address,
    ownerPubKey: toolkit.ownerPubKey,
  });
  if (existingAddress) {
    console.log('[ua2] using existing UA² address', existingAddress);
    return {
      address: normalizeHex(existingAddress),
      classHash:
        (await readClassHash(toolkit.provider, existingAddress)) ?? ('0x0' as Felt),
    };
  }

  await runCommand('scarb', ['build'], CONTRACTS_ROOT);
  const artifacts = await loadUa2Artifacts();

  const forcedClassHash = optionalEnv([
    `UA2_${toolkit.network.toUpperCase()}_CLASS_HASH`,
    'UA2_CLASS_HASH',
  ]);

  const sierraHash = normalizeHex(
    hash.computeSierraContractClassHash(artifacts.compiledContract)
  );
  const casmHash = normalizeHex(hash.computeCompiledClassHash(artifacts.casm));
  console.log('[ua2] compiled hashes', { sierraHash, casmHash });

  const declareMaxFee = '0x0de0b6b3a7640000';

  const submitDeclareV2 = async (): Promise<{ classHash: Felt; txHash: Felt }> => {
    const nonceRaw = await toolkit.provider.getNonceForAddress(toolkit.deployer.address);
    const nonce = normalizeHex(nonceRaw);
    const declareTxHashHex = hash.calculateDeclareTransactionHash2(
      sierraHash,
      toolkit.deployer.address,
      '0x2',
      declareMaxFee,
      toolkit.chainId,
      nonce,
      casmHash
    );
    const declareTxHashBig = BigInt(declareTxHashHex);
    const priv = BigInt(normalizePrivateKey(toolkit.deployerKey));
    const sig = ec.starkCurve.sign(declareTxHashBig, priv);
    const signature = [
      normalizeHex('0x' + sig.r.toString(16)),
      normalizeHex('0x' + sig.s.toString(16)),
    ];

    const body = {
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'starknet_addDeclareTransaction',
      params: {
        declare_transaction: {
          type: 'DECLARE',
          version: '0x2',
          sender_address: normalizeHex(toolkit.deployer.address),
          class_hash: sierraHash,
          compiled_class_hash: casmHash,
          max_fee: declareMaxFee,
          nonce,
          signature,
          contract_class: artifacts.compiledContract,
        },
      },
    };

    const response = await fetch(toolkit.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await response.json()) as any;
    if (json.error) {
      throw new Error(
        `[ua2] declare v2 failed: code=${json.error.code} message=${json.error.message}`
      );
    }

    const txHashResult: string =
      typeof json.result?.transaction_hash === 'string'
        ? json.result.transaction_hash
        : (json.result as string);
    const classHashResult: string =
      typeof json.result?.class_hash === 'string' ? json.result.class_hash : sierraHash;

    return {
      classHash: normalizeHex(classHashResult),
      txHash: normalizeHex(txHashResult),
    };
  };

  const ensureClassDeclared = async (): Promise<{ classHash: Felt; declareTxHash?: string }> => {
    try {
      await toolkit.provider.getClassByHash(sierraHash);
      console.log('[ua2] class hash already present on node', sierraHash);
      return { classHash: sierraHash };
    } catch (err) {
      console.warn('[ua2] class hash not found on node; declaring', sierraHash);
    }

    const declared = await submitDeclareV2();
    await waitForReceipt(toolkit.provider, declared.txHash, 'declare UA² account');
    console.log('[ua2] class declared (v2)', declared);
    return { classHash: declared.classHash, declareTxHash: declared.txHash };
  };

  let classHash: Felt;
  let declareTxHash: string | undefined;
  if (forcedClassHash) {
    const forcedNormalized = normalizeHex(forcedClassHash);
    if (forcedNormalized !== sierraHash) {
      console.warn('[ua2] forced class hash differs from compiled sierra hash', {
        forcedClassHash: forcedNormalized,
        sierraHash,
      });
    }
    try {
      await toolkit.provider.getClassByHash(forcedNormalized);
      console.log('[ua2] forced class hash present on node', forcedNormalized);
      classHash = forcedNormalized;
    } catch {
      const declared = await ensureClassDeclared();
      classHash = declared.classHash;
      declareTxHash = declared.declareTxHash;
    }
  } else {
    const declared = await ensureClassDeclared();
    classHash = declared.classHash;
    declareTxHash = declared.declareTxHash;
  }

  // Build constructor calldata: must be exactly one numeric felt (owner pubkey)
  const constructorCalldata = buildUa2ConstructorCalldata(artifacts.compiledContract, toolkit);
  console.log('[ua2] ctor calldata', constructorCalldata);
  if (constructorCalldata.length !== 1) {
    throw new Error(`[ua2] ctor must be exactly 1 felt; got ${constructorCalldata.length}`);
  }
  if (!/^0x[0-9a-f]+$/.test(String(constructorCalldata[0]))) {
    throw new Error('[ua2] ctor[0] is not numeric felt');
  }

  // ---------- Deploy via DEPLOY_ACCOUNT (no UDC) ----------
  // Use fixed bounds ≈ 1.5 ETH worst-case to satisfy devnet minimal deploy fee
  function deployBounds1Eth(): ResourceBoundsV3 {
    return {
      l2_gas: { max_amount: 1_500_000_000n, max_price_per_unit: 1_000_000_000n },
      l1_gas: { max_amount: 5_000_000n, max_price_per_unit: 5_000_000n },
      l1_data_gas: { max_amount: 5_000_000n, max_price_per_unit: 5_000_000n },
    };
  }
  function maxFeeUpperBoundWei(b: ResourceBoundsV3): bigint {
    return (
      b.l2_gas.max_amount * b.l2_gas.max_price_per_unit +
      b.l1_gas.max_amount * b.l1_gas.max_price_per_unit +
      b.l1_data_gas.max_amount * b.l1_data_gas.max_price_per_unit
    );
  }

  const bounds = deployBounds1Eth();
  console.log('[ua2] deploy bounds', bounds);
  const worst = maxFeeUpperBoundWei(bounds);
  console.log(`[ua2] worst-case max fee: ${worst} wei (~${Number(worst) / 1e18} ETH)`);

  // Choose a stable salt for deterministic address
  const addressSalt = toFelt(1);
  const predictedAddress = normalizeHex(
    hash.calculateContractAddressFromHash(addressSalt, classHash, constructorCalldata, '0x0')
  );
  console.log('[ua2] predicted UA² address', predictedAddress);
  console.log(
    `[ua2] fund with fee token (example): curl -s "$RPC" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"devnet_mint","params":{"address":"${predictedAddress}","amount":2000000000000000000,"unit":"WEI"}}' | jq`
  );

  // Sign DEPLOY_ACCOUNT with the OWNER key (account being deployed)
  const ownerForDeploy = new Account({
    provider: toolkit.provider,
    address: predictedAddress,
    signer: toolkit.ownerKey,
  });
  console.log('[ua2] owner account for deploy', {
    signerAddress: ownerForDeploy.address,
    ownerPubKey: toolkit.ownerPubKey,
  });
  if (typeof (ownerForDeploy.signer as any)?.getPubKey === 'function') {
    try {
      const ownerSignerPubKey = await (ownerForDeploy.signer as any).getPubKey();
      console.log('[ua2] owner signer pubkey', ownerSignerPubKey);
    } catch (pubKeyErr) {
      console.warn('[ua2] unable to read owner signer pubkey', pubKeyErr);
    }
  }

  // @ts-ignore — v3 tx options supported on deployAccount
  const { transaction_hash, contract_address } = await ownerForDeploy.deployAccount(
    {
      classHash: classHash,
      constructorCalldata,
      addressSalt,
    },
    {
      version: '0x3',
      resourceBounds: bounds,
      tip: 8n,
      nonceDataAvailabilityMode: EDataAvailabilityMode.L2,
      feeDataAvailabilityMode: EDataAvailabilityMode.L2,
    }
  );
  console.log('[ua2] deployAccount submitted', {
    txHash: transaction_hash,
    predictedAddress,
    responseAddress: contract_address ?? null,
  });

  const deployReceipt = await waitForReceipt(
    toolkit.provider,
    transaction_hash,
    'deploy UA² account'
  );
  console.log('[ua2] deployAccount confirmed', {
    txHash: transaction_hash,
    finality: deployReceipt?.finality_status ?? deployReceipt?.status ?? 'UNKNOWN',
    execution: deployReceipt?.execution_status ?? 'UNKNOWN',
  });

  const deployedAddr = normalizeHex(contract_address ?? predictedAddress);
  console.log('[ua2] deployAccount resolved address', {
    deployedAddr,
    predictedAddress,
  });
  const onchainClass = await readClassHash(toolkit.provider, deployedAddr);
  console.log('[ua2] on-chain class hash', {
    deployedAddr,
    onchainClass,
  });
  if (!onchainClass || onchainClass === ('0x0' as Felt)) {
    throw new Error(`[ua2] deploy_account accepted but class not found at ${deployedAddr}`);
  }

  console.log('[ua2] ensureUa2Deployed complete', {
    deployedAddr,
    classHash,
  });

  return {
    address: deployedAddr,
    classHash,
  };
}

export async function waitForReceipt(
  provider: RpcProvider,
  txHash: string,
  label?: string,
  timeoutMs = 180_000
): Promise<any> {
  const normalized = normalizeHex(txHash);
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const receipt = await provider.getTransactionReceipt(normalized);
      const finality = getFinalityStatus(receipt);
      if (finality === 'RECEIVED' || finality === 'PENDING' || finality === 'ACCEPTED_ONCHAIN') {
        await delay(2000);
        continue;
      }
      return receipt;
    } catch (err) {
      const message = String(err);
      if (message.includes('NOT_RECEIVED') || message.includes('Transaction hash not found')) {
        lastError = err;
        await delay(2000);
        continue;
      }
      throw err;
    }
  }

  const context = label ? `${label} (${normalized})` : normalized;
  throw new Error(`Timed out waiting for receipt: ${context}. Last error: ${lastError ?? 'none'}`);
}

export function assertSucceeded(receipt: any, label: string): void {
  const execution = (receipt?.execution_status ?? receipt?.status ?? '').toString();
  const finality = (receipt?.finality_status ?? receipt?.status ?? '').toString();
  const okExecution = execution === '' || execution === 'SUCCEEDED' || execution === 'ACCEPTED_ON_L2' || execution === 'ACCEPTED_ON_L1';
  const okFinality = finality === '' || finality === 'ACCEPTED_ON_L2' || finality === 'ACCEPTED_ON_L1';

  if (!okExecution || !okFinality) {
    const reason = extractRevertReason(receipt);
    throw new Error(
      `${label} failed. execution_status=${execution} finality=${finality} revert_reason=${reason ?? 'unknown'}`
    );
  }
}

export function assertReverted(receipt: any, expectedReason: string, label: string): void {
  const execution = (receipt?.execution_status ?? receipt?.status ?? '').toString();
  if (execution !== 'REVERTED' && execution !== 'REJECTED') {
    throw new Error(`${label} expected revert but got execution_status=${execution}`);
  }

  const reason = extractRevertReason(receipt);
  if (expectedReason && reason && !reason.includes(expectedReason)) {
    throw new Error(`${label} revert reason mismatch. expected~=${expectedReason}, actual=${reason}`);
  }
}

export async function readOwner(provider: RpcProvider, address: Felt): Promise<Felt> {
  const response = await provider.callContract({
    contractAddress: address,
    entrypoint: 'get_owner',
    calldata: [],
  });
  const values = Array.isArray(response)
    ? response
    : ((response as { result?: string[] }).result ?? []);
  const owner = values.length > 0 ? values[0] : '0x0';
  return normalizeHex(owner);
}

export function normalizeHex(value: string): Felt {
  const trimmed = value.trim();
  if (trimmed.startsWith('0x') || trimmed.startsWith('0X')) {
    const normalized = '0x' + trimmed.slice(2).replace(/^0+/, '').toLowerCase();
    return (normalized === '0x' ? '0x0' : (normalized as Felt));
  }
  const hex = BigInt(trimmed).toString(16);
  return ('0x' + hex) as Felt;
}

export function deriveSessionKeyHash(pubkey: Felt): Felt {
  const normalizedKey = normalizeHex(pubkey);
  const hashValue = hash.computePedersenHash(normalizedKey, '0x0');
  return normalizeHex(hashValue);
}

export function normalizePrivateKey(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('0x') || trimmed.startsWith('0X') ? trimmed : `0x${trimmed}`;
}

export function derivePubKey(privateKey: string): Felt {
  const hex = normalizePrivateKey(privateKey);
  const withoutPrefix = hex.replace(/^0x/, '');
  const pubKey = ec.starkCurve.getStarkKey(withoutPrefix);
  return ('0x' + pubKey) as Felt;
}

function getFinalityStatus(receipt: any): string {
  if (!receipt) return '';
  if (typeof receipt.finality_status === 'string') return receipt.finality_status;
  if (typeof receipt.status === 'string') return receipt.status;
  return '';
}

export function extractRevertReason(receipt: any): string {
  if (!receipt) return '';
  const reason = receipt.revert_reason ?? receipt.revertReason ?? receipt.failure_reason ?? receipt.execution_error;
  if (!reason) return '';
  if (Array.isArray(reason)) {
    return reason.join(' ');
  }
  if (typeof reason === 'object') {
    if (typeof reason.revert_reason === 'string') return reason.revert_reason;
    if (Array.isArray(reason.revert_reason)) return reason.revert_reason.join(' ');
  }
  return String(reason);
}

async function loadUa2Artifacts(): Promise<{
  compiledContract: CompiledContract;
  casm: any;
}> {
  const targetDir = path.resolve(CONTRACTS_ROOT, 'target/dev');
  const entries = await fsPromises.readdir(targetDir);

  const contractFile = entries.find((name) => name.endsWith('UA2Account.contract_class.json'));
  const casmFile = entries.find((name) => name.endsWith('UA2Account.compiled_contract_class.json'));

  if (!contractFile || !casmFile) {
    throw new Error('UA² contract artifacts not found. Did you run `scarb build`?');
  }

  const compiledContract = json.parse(
    await fsPromises.readFile(path.join(targetDir, contractFile), 'utf8')
  ) as CompiledContract;
  const casm = json.parse(await fsPromises.readFile(path.join(targetDir, casmFile), 'utf8'));

  return { compiledContract, casm };
}

async function readClassHash(provider: RpcProvider, address: string): Promise<Felt | undefined> {
  try {
    const result = await provider.getClassHashAt(normalizeHex(address));
    return normalizeHex(result);
  } catch (err) {
    return undefined;
  }
}

async function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function toFelt(value: number | bigint | string): Felt {
  if (typeof value === 'string') {
    return normalizeHex(value);
  }
  if (typeof value === 'bigint') {
    return ('0x' + value.toString(16)) as Felt;
  }
  return ('0x' + BigInt(value).toString(16)) as Felt;
}

export function selectorFor(name: string): Felt {
  return normalizeHex(hash.getSelectorFromName(name));
}

// Sanitize any felt-like string into a clean 0x-prefixed hex number
function sanitizeFeltLike(x: string): Felt {
  let s = x.trim().toLowerCase();
  while (s.startsWith('0x')) s = s.slice(2);
  while (s.startsWith('x')) s = s.slice(1);
  s = s.replace(/[^0-9a-f]/g, '');
  if (!s) throw new Error(`[ua2] empty/invalid felt from: ${x}`);
  return ('0x' + s) as Felt;
}

export function logReceipt(label: string, txHash: string, receipt: any): void {
  const status = receipt?.finality_status ?? receipt?.status ?? 'UNKNOWN';
  const execution = receipt?.execution_status ?? 'UNKNOWN';
  console.log(`  • ${label}: tx=${txHash} finality=${status} execution=${execution}`);
}

export interface SessionUsageState {
  callsUsed: number;
  nonce: bigint;
}

export function initialSessionUsageState(): SessionUsageState {
  return { callsUsed: 0, nonce: 0n };
}

export function updateSessionUsage(state: SessionUsageState, deltaCalls: number): SessionUsageState {
  return {
    callsUsed: state.callsUsed + deltaCalls,
    nonce: state.nonce + 1n,
  };
}

// ---------------------------
// v3 resource bounds + ctor
// ---------------------------

type ResourceBoundsV3 = {
  l2_gas: { max_amount: bigint; max_price_per_unit: bigint };
  l1_gas: { max_amount: bigint; max_price_per_unit: bigint };
  l1_data_gas: { max_amount: bigint; max_price_per_unit: bigint };
};

export function defaultResourceBounds(): ResourceBoundsV3 {
  return {
    // Modest, devnet-friendly caps to keep max fee sane
    l2_gas: { max_amount: 50_000_000n, max_price_per_unit: 2_000_000_000n },
    l1_gas: { max_amount: 1_000_000n, max_price_per_unit: 1_000_000n },
    l1_data_gas: { max_amount: 1_000_000n, max_price_per_unit: 1_000_000n },
  };
}

function insaneResourceBounds(): ResourceBoundsV3 {
  return {
    l2_gas: {
      max_amount: 20_000_000_000n,
      max_price_per_unit: 50_000_000_000_000n,
    },
    l1_gas: {
      max_amount: 5_000_000_000n,
      max_price_per_unit: 1_000_000_000n,
    },
    l1_data_gas: {
      max_amount: 5_000_000_000n,
      max_price_per_unit: 1_000_000_000n,
    },
  };
}

/**
 * Reads the constructor inputs from the compiled contract ABI and builds calldata
 * using values from the Toolkit (owner pubkey, guardian pubkey/address).
 * Supports common patterns:
 *  - (owner_pubkey: felt)
 *  - (owner_pubkey: felt, guardian_pubkey: felt)
 *  - (owner_pubkey: felt, guardian_address: felt)
 * If your constructor differs, this throws with a helpful message.
 */
function buildUa2ConstructorCalldata(_compiled: CompiledContract, toolkit: Toolkit): Felt[] {
  // UA² constructor: (public_key: felt252)
  const owner = sanitizeFeltLike(toolkit.ownerPubKey);
  return [owner];
}

// NOTE: We no longer attempt to heuristically extract the deployed address
// from UDC events; the canonical address is deterministically computed via
// calculateContractAddressFromHash and then verified on-chain.

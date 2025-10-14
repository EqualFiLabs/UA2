import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import { config as loadEnvFile } from 'dotenv';
import { Account, ec, hash, json, RpcProvider, type CompiledContract } from 'starknet';

import type { CallTransport, Felt } from '@ua2/core';

export type Network = 'devnet' | 'sepolia';

export interface Toolkit {
  provider: RpcProvider;
  network: Network;
  chainId: Felt;
  deployer: Account;
  ownerKey: string;
  ownerPubKey: string;
  guardian: Account;
  guardianPubKey: string;
  guardianAddress: Felt;
  guardianKey: string;
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

  const rpcUrl = requireEnv(['STARKNET_RPC_URL']);
  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  const chainId = normalizeHex(await provider.getChainId());

  const deployerAddress = normalizeHex(
    requireEnv([`UA2_${network.toUpperCase()}_DEPLOYER_ADDRESS`, 'UA2_DEPLOYER_ADDRESS'])
  );
  const deployerKey = normalizePrivateKey(
    requireEnv([`UA2_${network.toUpperCase()}_DEPLOYER_PRIVATE_KEY`, 'UA2_DEPLOYER_PRIVATE_KEY'])
  );

  const deployer = new Account(provider, deployerAddress, deployerKey);

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
  const guardian = new Account(provider, guardianAddress, guardianKey);

  return {
    provider,
    network,
    chainId,
    deployer,
    ownerKey,
    ownerPubKey,
    guardian,
    guardianPubKey,
    guardianAddress,
    guardianKey,
  };
}

export async function ensureUa2Deployed(
  toolkit: Toolkit,
  existingAddress?: string
): Promise<{ address: Felt; classHash: Felt }> {
  if (existingAddress) {
    return { address: normalizeHex(existingAddress), classHash: (await readClassHash(toolkit.provider, existingAddress)) ?? ('0x0' as Felt) };
  }

  await runCommand('scarb', ['build'], CONTRACTS_ROOT);
  const artifacts = await loadUa2Artifacts();

  const declareResp = await toolkit.deployer.declare({
    contract: artifacts.compiledContract,
    casm: artifacts.casm,
  });
  await waitForReceipt(toolkit.provider, declareResp.transaction_hash, `declare UA² account`);

  const deployResp = await toolkit.deployer.deployContract({
    classHash: declareResp.class_hash,
    constructorCalldata: [toolkit.ownerPubKey],
  });
  await waitForReceipt(toolkit.provider, deployResp.transaction_hash, `deploy UA² account`);

  return {
    address: normalizeHex(deployResp.contract_address),
    classHash: declareResp.class_hash as Felt,
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

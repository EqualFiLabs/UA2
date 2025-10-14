import { spawn } from 'node:child_process';

import { limits, makeSessionsManager, type CallTransport, type Felt, type SessionPolicyInput } from '@ua2/core';
import { RpcProvider } from 'starknet';

import {
  assertReverted,
  assertSucceeded,
  initialSessionUsageState,
  loadEnv,
  normalizeHex,
  optionalEnv,
  readOwner,
  requireEnv,
  selectorFor,
  toFelt,
  updateSessionUsage,
  waitForReceipt,
  type Network,
} from './shared.js';

type SncastConfig = {
  profile: string;
  account: string;
  rpcUrl: string;
};

type SncastResult = {
  code: number;
  stdout: string;
  stderr: string;
};

class SncastTransport implements CallTransport {
  private readonly config: SncastConfig;
  public lastTxHash: Felt | null = null;

  constructor(config: SncastConfig) {
    this.config = config;
  }

  async invoke(address: Felt, entrypoint: string, calldata: Felt[]): Promise<{ txHash: Felt }> {
    const args = buildSncastArgs(this.config, address, entrypoint, calldata);
    const result = await runSncast(args);

    const parsed = parseSncastJson(result.stdout) ?? parseSncastJson(result.stderr);
    if (!parsed || typeof parsed.transaction_hash !== 'string') {
      throw new Error(
        `sncast invoke failed for ${entrypoint}. exit=${result.code} stdout=${result.stdout} stderr=${result.stderr}`
      );
    }

    const txHash = normalizeHex(parsed.transaction_hash);
    this.lastTxHash = txHash;
    return { txHash };
  }
}

async function main(): Promise<void> {
  const network: Network = 'devnet';
  loadEnv(network);

  const rpcUrl = requireEnv(['STARKNET_RPC_URL']);
  const profile = optionalEnv(['SNCAST_PROFILE', 'UA2_SNCAST_PROFILE'], 'devnet') ?? 'devnet';
  const accountName = requireEnv(['SNCAST_ACCOUNT', 'SNCAST_ACCOUNT_NAME']);
  const ua2Address = requireEnv([
    `UA2_${network.toUpperCase()}_PROXY_ADDR`,
    'UA2_PROXY_ADDR',
  ]);

  const provider = new RpcProvider({ nodeUrl: rpcUrl });
  const chainId = normalizeHex(await provider.getChainId());

  const ownerBefore = await readOwner(provider, ua2Address);
  console.log('E2E DEVNET (sncast)');
  console.log(`- profile: ${profile} (account: ${accountName})`);
  console.log(`- UA² account: ${ua2Address}`);
  console.log(`- on-chain owner: ${ownerBefore}`);

  const transport = new SncastTransport({ profile, account: accountName, rpcUrl });
  const sessions = makeSessionsManager({
    account: { address: ua2Address, chainId },
    transport,
    ua2Address,
  });

  const now = Math.floor(Date.now() / 1000);
  const policy: SessionPolicyInput = {
    validAfter: now,
    validUntil: now + 10 * 60,
    limits: limits(2, 10n ** 15n),
    allow: {
      targets: [toFelt(ua2Address)],
      selectors: [selectorFor('apply_session_usage')],
    },
  };

  const session = await sessions.create(policy);
  if (!transport.lastTxHash) {
    throw new Error('Session creation did not emit a transaction hash.');
  }
  const createReceipt = await waitForReceipt(provider, transport.lastTxHash, 'session create');
  assertSucceeded(createReceipt, 'session create');
  console.log(`- create session ✓ (${session.id})`);

  let usage = initialSessionUsageState();
  usage = await applySessionUsage(transport, provider, ua2Address, session.id, usage, 1, 'session use #1');
  usage = await applySessionUsage(transport, provider, ua2Address, session.id, usage, 1, 'session use #2');
  console.log('- in-policy calls ✓');

  const violation = await transport.invoke(ua2Address, 'apply_session_usage', [
    session.id,
    toFelt(usage.callsUsed),
    toFelt(1),
    toFelt(usage.nonce),
  ]);
  const violationReceipt = await waitForReceipt(provider, violation.txHash, 'policy violation');
  assertReverted(violationReceipt, 'ERR_POLICY_CALLCAP', 'policy violation');
  console.log('- out-of-policy revert ✓ (ERR_POLICY_CALLCAP)');

  const revokeTx = await transport.invoke(ua2Address, 'revoke_session', [session.id]);
  const revokeReceipt = await waitForReceipt(provider, revokeTx.txHash, 'session revoke');
  assertSucceeded(revokeReceipt, 'session revoke');
  console.log('- revoke session ✓');

  console.log('E2E DEVNET ✓ complete');
}

type SessionUsageState = ReturnType<typeof initialSessionUsageState>;

async function applySessionUsage(
  transport: SncastTransport,
  provider: RpcProvider,
  ua2Address: Felt,
  sessionId: Felt,
  state: SessionUsageState,
  calls: number,
  label: string
): Promise<SessionUsageState> {
  const tx = await transport.invoke(ua2Address, 'apply_session_usage', [
    sessionId,
    toFelt(state.callsUsed),
    toFelt(calls),
    toFelt(state.nonce),
  ]);
  const receipt = await waitForReceipt(provider, tx.txHash, label);
  assertSucceeded(receipt, label);
  return updateSessionUsage(state, calls);
}

function buildSncastArgs(
  config: SncastConfig,
  address: Felt,
  entrypoint: string,
  calldata: Felt[]
): string[] {
  const args: string[] = ['--profile', config.profile];
  if (config.rpcUrl) {
    args.push('--rpc-url', config.rpcUrl);
  }
  args.push('invoke', '--account', config.account, '--address', address, '--function', entrypoint);
  if (calldata.length > 0) {
    args.push('--calldata', ...calldata);
  }
  args.push('--json');
  return args;
}

function runSncast(args: string[]): Promise<SncastResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('sncast', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

function parseSncastJson(output: string): Record<string, unknown> | null {
  const trimmed = output.trim();
  if (!trimmed) {
    return null;
  }
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    try {
      return JSON.parse(line) as Record<string, unknown>;
    } catch (err) {
      void err;
    }
  }
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch (err) {
    void err;
  }
  return null;
}

void main().catch((err) => {
  console.error('[ua2] e2e-devnet failed:', err);
  process.exitCode = 1;
});

import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { limits, makeSessionsManager, type SessionPolicyInput } from '@ua2/core';
import { Account } from 'starknet';

import {
  AccountCallTransport,
  assertReverted,
  assertSucceeded,
  deriveSessionKeyHash,
  ensureUa2Deployed,
  initialSessionUsageState,
  logReceipt,
  optionalEnv,
  readOwner,
  selectorFor,
  setupToolkit,
  toFelt,
  updateSessionUsage,
  waitForReceipt,
  normalizeHex,
  PROJECT_ROOT,
} from './shared.js';

type DevnetAddresses = {
  ua2Address: string;
  classHash: string;
  network: string;
  updatedAt: string;
};

type DeploymentInfo = Awaited<ReturnType<typeof ensureUa2Deployed>>;

const ADDRESSES_FILE = path.resolve(PROJECT_ROOT, '.ua2-devnet-addresses.json');
const RECEIPT_TIMEOUT_MS = 60_000;

async function main(): Promise<void> {
  console.log('[ua2] e2e devnet starting');

  const toolkit = await setupToolkit('devnet');

  const envAddress = optionalEnv([
    'UA2_DEVNET_PROXY_ADDR',
    'UA2_DEVNET_ADDR',
    'UA2_PROXY_ADDR',
    'UA2_ADDR',
  ]);

  const cached = envAddress ? undefined : await readCachedAddresses();

  let deployment = await pickDeployment(toolkit, envAddress, cached?.ua2Address);
  const ua2Address = normalizeHex(deployment.address);
  const source = envAddress ? 'env' : cached ? 'cache' : 'deploy';

  if (!envAddress) {
    await writeCachedAddresses({
      ua2Address,
      classHash: normalizeHex(deployment.classHash),
      network: toolkit.network,
      updatedAt: new Date().toISOString(),
    });
    const relPath = path.relative(PROJECT_ROOT, ADDRESSES_FILE);
    console.log(`[ua2] cached addresses written to ${relPath}`);
  }

  console.log(`[ua2] using UA² account ${ua2Address} (${source})`);

  const ownerOnChain = await readOwner(toolkit.provider, ua2Address);
  if (ownerOnChain.toLowerCase() !== toolkit.ownerPubKey.toLowerCase()) {
    console.warn(
      `[ua2] warning: on-chain owner ${ownerOnChain} differs from configured owner ${toolkit.ownerPubKey}`
    );
  }

  const ownerAccount = new Account(toolkit.provider, ua2Address, toolkit.ownerKey);
  const ownerTransport = new AccountCallTransport(ownerAccount);

  const sessions = makeSessionsManager({
    account: { address: ua2Address, chainId: toolkit.chainId },
    transport: ownerTransport,
    ua2Address,
  });

  const nowSeconds = Math.floor(Date.now() / 1000);
  const validAfter = nowSeconds - 30;
  const validUntil = validAfter + 2 * 60 * 60;
  const sessionTargetValue =
    optionalEnv(
      ['UA2_DEVNET_SESSION_TARGET', 'UA2_SESSION_TARGET', 'UA2_E2E_TARGET_ADDR'],
      toolkit.guardianAddress
    ) ?? toolkit.guardianAddress;
  const sessionTarget = toFelt(sessionTargetValue);
  const transferSelector = selectorFor('transfer');

  const policy: SessionPolicyInput = {
    validAfter,
    validUntil,
    limits: limits(1, 0),
    allow: {
      targets: [sessionTarget],
      selectors: [transferSelector],
    },
    active: true,
  };

  console.log('\n[1] create tight session policy');
  const session = await sessions.create(policy);
  if (!ownerTransport.lastTxHash) {
    throw new Error('add_session_with_allowlists did not emit a transaction hash');
  }
  const sessionReceipt = await waitForReceipt(
    toolkit.provider,
    ownerTransport.lastTxHash,
    'create session',
    RECEIPT_TIMEOUT_MS
  );
  assertSucceeded(sessionReceipt, 'create session');
  logReceipt('create session', ownerTransport.lastTxHash, sessionReceipt);

  const sessionKeyHash = deriveSessionKeyHash(session.pubkey);
  console.log(`[ua2] session key hash ${sessionKeyHash}`);

  let usage = initialSessionUsageState();

  console.log('[2] in-policy session call succeeds');
  usage = await expectSessionUsageSuccess(
    toolkit,
    ownerAccount,
    ua2Address,
    sessionKeyHash,
    usage,
    1,
    'in-policy session call'
  );

  console.log('[3] out-of-policy session call reverts (ERR_POLICY_CALLCAP)');
  await expectSessionUsageRevert(
    toolkit,
    ownerAccount,
    ua2Address,
    sessionKeyHash,
    usage,
    1,
    'out-of-policy session call',
    'ERR_POLICY_CALLCAP'
  );

  console.log('[4] revoke session');
  const revokeTx = await ownerAccount.execute({
    contractAddress: ua2Address,
    entrypoint: 'revoke_session',
    calldata: [sessionKeyHash],
  });
  const revokeReceipt = await waitForReceipt(
    toolkit.provider,
    revokeTx.transaction_hash,
    'revoke session',
    RECEIPT_TIMEOUT_MS
  );
  assertSucceeded(revokeReceipt, 'revoke session');
  logReceipt('revoke session', revokeTx.transaction_hash, revokeReceipt);

  console.log('[5] session call after revoke reverts (ERR_SESSION_INACTIVE)');
  await expectSessionUsageRevert(
    toolkit,
    ownerAccount,
    ua2Address,
    sessionKeyHash,
    usage,
    1,
    'post-revoke session call',
    'ERR_SESSION_INACTIVE'
  );

  console.log('\nUA² devnet e2e PASS ✅');
}

async function pickDeployment(
  toolkit: Awaited<ReturnType<typeof setupToolkit>>,
  envAddress?: string,
  cachedAddress?: string
): Promise<DeploymentInfo> {
  if (envAddress) {
    return ensureUa2Deployed(toolkit, envAddress);
  }

  if (cachedAddress) {
    const attached = await ensureUa2Deployed(toolkit, cachedAddress);
    if (attached.classHash !== '0x0') {
      return attached;
    }
    console.warn('[ua2] cached UA² address missing on-chain class hash; redeploying');
  }

  console.log('[ua2] deploying UA² account to devnet…');
  return ensureUa2Deployed(toolkit);
}

async function expectSessionUsageSuccess(
  toolkit: Awaited<ReturnType<typeof setupToolkit>>,
  owner: Account,
  ua2Address: string,
  sessionKeyHash: string,
  state: ReturnType<typeof initialSessionUsageState>,
  calls: number,
  label: string
) {
  const { receipt, txHash } = await sendApplySessionUsage(
    toolkit,
    owner,
    ua2Address,
    sessionKeyHash,
    state,
    calls,
    label
  );
  assertSucceeded(receipt, label);
  logReceipt(label, txHash, receipt);
  return updateSessionUsage(state, calls);
}

async function expectSessionUsageRevert(
  toolkit: Awaited<ReturnType<typeof setupToolkit>>,
  owner: Account,
  ua2Address: string,
  sessionKeyHash: string,
  state: ReturnType<typeof initialSessionUsageState>,
  calls: number,
  label: string,
  expectedReason: string
): Promise<void> {
  const { receipt, txHash } = await sendApplySessionUsage(
    toolkit,
    owner,
    ua2Address,
    sessionKeyHash,
    state,
    calls,
    label
  );
  assertReverted(receipt, expectedReason, label);
  logReceipt(label, txHash, receipt);
}

async function sendApplySessionUsage(
  toolkit: Awaited<ReturnType<typeof setupToolkit>>,
  owner: Account,
  ua2Address: string,
  sessionKeyHash: string,
  state: ReturnType<typeof initialSessionUsageState>,
  calls: number,
  label: string
) {
  const tx = await owner.execute({
    contractAddress: ua2Address,
    entrypoint: 'apply_session_usage',
    calldata: [
      sessionKeyHash,
      toFelt(state.callsUsed),
      toFelt(calls),
      toFelt(state.nonce),
    ],
  });
  const receipt = await waitForReceipt(
    toolkit.provider,
    tx.transaction_hash,
    label,
    RECEIPT_TIMEOUT_MS
  );
  return { receipt, txHash: tx.transaction_hash };
}

async function readCachedAddresses(): Promise<DevnetAddresses | undefined> {
  try {
    const raw = await fsPromises.readFile(ADDRESSES_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<DevnetAddresses>;
    if (!parsed.ua2Address) return undefined;
    return {
      ua2Address: normalizeHex(parsed.ua2Address),
      classHash: parsed.classHash ? normalizeHex(parsed.classHash) : '0x0',
      network: parsed.network ?? 'devnet',
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch (err: any) {
    if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw err;
  }
}

async function writeCachedAddresses(record: DevnetAddresses): Promise<void> {
  await fsPromises.mkdir(path.dirname(ADDRESSES_FILE), { recursive: true });
  await fsPromises.writeFile(
    ADDRESSES_FILE,
    `${JSON.stringify(record, null, 2)}\n`,
    'utf8'
  );
}

void main().catch((err) => {
  console.error('\n[ua2] e2e devnet failed:', err);
  process.exitCode = 1;
});

import { limits, makeSessionsManager, paymasters, type SessionPolicyInput } from '@ua2/core';
import type { AvnuMode } from '@ua2/paymasters';
import { Account, type Call } from 'starknet';

import {
  AccountCallTransport,
  assertReverted,
  assertSucceeded,
  deriveSessionKeyHash,
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
} from './shared.js';

const RECEIPT_TIMEOUT_MS = 240_000;
const PAYMASTER_URL = process.env.PAYMASTER_URL ?? 'https://sepolia.paymaster.avnu.fi';
const PAYMASTER_API_KEY = process.env.PAYMASTER_API_KEY;
const GAS_TOKEN = process.env.GAS_TOKEN;
const MODE_ENV = process.env.PM_MODE;
const MODE: AvnuMode = MODE_ENV === 'default' ? 'default' : 'sponsored';

let activePaymaster: ReturnType<typeof paymasters.avnu> | null = null;
let paymasterSelection: 'avnu' | 'noop' = 'noop';

async function main(): Promise<void> {
  console.log('[ua2] e2e sepolia (attach-only) starting');

  const toolkit = await setupToolkit('sepolia');

  if (MODE === 'default' && !GAS_TOKEN) {
    throw new Error('GAS_TOKEN is required when PM_MODE=default for AVNU paymaster usage.');
  }

  const noop = paymasters.noop();
  const avnu = paymasters.avnu({
    url: PAYMASTER_URL,
    apiKey: PAYMASTER_API_KEY,
    defaultGasToken: GAS_TOKEN,
  });

  if (await avnu.isAvailable()) {
    console.log(`[paymaster] AVNU available at ${PAYMASTER_URL} using mode=${MODE}`);
    activePaymaster = avnu;
    paymasterSelection = 'avnu';
  } else {
    console.warn('[paymaster] AVNU unavailable, falling back to Noop (fees paid by user)');
    console.warn(`[paymaster] fallback adapter: ${noop.name}`);
  }

  const ua2AddressRaw = optionalEnv([
    'UA2_SEPOLIA_PROXY_ADDR',
    'UA2_PROXY_ADDR',
    'UA2_ADDR',
  ]);
  if (!ua2AddressRaw) {
    throw new Error('UA2_PROXY_ADDR is required for Sepolia E2E runs.');
  }

  const ua2Address = normalizeHex(ua2AddressRaw);
  console.log(`[ua2] attaching to UA² account ${ua2Address}`);

  const ownerOnChain = await readOwner(toolkit.provider, ua2Address);
  if (ownerOnChain.toLowerCase() !== toolkit.ownerPubKey.toLowerCase()) {
    console.warn(
      `[ua2] warning: on-chain owner ${ownerOnChain} differs from configured owner ${toolkit.ownerPubKey}`
    );
  }

  const ownerAccount = new Account({
    provider: toolkit.provider,
    address: ua2Address,
    signer: toolkit.ownerKey,
  });
  const ownerTransport = new AccountCallTransport(ownerAccount);

  const sessions = makeSessionsManager({
    account: { address: ua2Address, chainId: toolkit.chainId },
    transport: ownerTransport,
    ua2Address,
  });

  const nowSeconds = Math.floor(Date.now() / 1000);
  const validAfter = nowSeconds - 60;
  const validUntil = validAfter + 30 * 60;
  const sessionTargetValue =
    optionalEnv(
      ['UA2_SEPOLIA_SESSION_TARGET', 'UA2_SESSION_TARGET', 'UA2_E2E_TARGET_ADDR'],
      toolkit.guardianAddress
    ) ?? toolkit.guardianAddress;
  const sessionTarget = toFelt(sessionTargetValue);
  const transferSelector = selectorFor('transfer');

  const policy: SessionPolicyInput = {
    validAfter,
    validUntil,
    limits: limits(1, 10n ** 15n),
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

  console.log('\nUA² sepolia e2e PASS ✅');
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
  const call: Call = {
    contractAddress: ua2Address,
    entrypoint: 'apply_session_usage',
    calldata: [
      sessionKeyHash,
      toFelt(state.callsUsed),
      toFelt(calls),
      toFelt(state.nonce),
    ],
  };

  const txHash = await executeWithPaymaster(owner, call, label);
  const receipt = await waitForReceipt(
    toolkit.provider,
    txHash,
    label,
    RECEIPT_TIMEOUT_MS
  );
  return { receipt, txHash };
}

async function executeWithPaymaster(owner: Account, call: Call, label: string): Promise<string> {
  if (paymasterSelection === 'avnu' && activePaymaster) {
    const result = await activePaymaster.sponsor(owner, [call], MODE, GAS_TOKEN);
    const hash = normalizeHex(result.transaction_hash);
    console.log(`[paymaster] Sponsored tx sent: ${hash} (${label})`);
    return hash;
  }

  console.log(`[paymaster] executing ${label} without sponsorship (Noop fallback)`);
  const response = await owner.execute(call);
  return normalizeHex(response.transaction_hash);
}

void main().catch((err) => {
  console.error('\n[ua2] e2e sepolia failed:', err);
  process.exitCode = 1;
});

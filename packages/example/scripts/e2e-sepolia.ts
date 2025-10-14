import { limits, makeSessionsManager, type SessionPolicyInput } from '@ua2/core';
import { Account } from 'starknet';

import {
  AccountCallTransport,
  assertReverted,
  assertSucceeded,
  initialSessionUsageState,
  optionalEnv,
  readOwner,
  selectorFor,
  setupToolkit,
  toFelt,
  updateSessionUsage,
  waitForReceipt,
  type Network,
} from './shared.js';

async function main(): Promise<void> {
  const network: Network = 'sepolia';
  const toolkit = await setupToolkit(network);

  const ua2Address = optionalEnv([
    `UA2_${network.toUpperCase()}_PROXY_ADDR`,
    'UA2_PROXY_ADDR',
  ]);
  if (!ua2Address) {
    throw new Error('UA2_PROXY_ADDR is required for Sepolia E2E runs.');
  }

  const normalizedAddress = ua2Address;
  const ownerAccount = new Account(toolkit.provider, normalizedAddress, toolkit.ownerKey);
  const ownerTransport = new AccountCallTransport(ownerAccount);

  const ownerBefore = await readOwner(toolkit.provider, normalizedAddress);
  if (ownerBefore.toLowerCase() !== toolkit.ownerPubKey.toLowerCase()) {
    console.warn(
      `[ua2] Warning: UA² owner on-chain (${ownerBefore}) does not match configured owner pubkey (${toolkit.ownerPubKey}).`
    );
  }

  console.log('E2E SEPOLIA');
  console.log(`- attach ✓ (${normalizedAddress})`);

  const sessions = makeSessionsManager({
    account: { address: normalizedAddress, chainId: toolkit.chainId },
    transport: ownerTransport,
    ua2Address: normalizedAddress,
  });

  const validAfter = Math.floor(Date.now() / 1000);
  const validUntil = validAfter + 2 * 60 * 60;
  const sessionTargetValue =
    optionalEnv(
      [`UA2_${network.toUpperCase()}_SESSION_TARGET`, 'UA2_SESSION_TARGET', 'UA2_E2E_TARGET_ADDR'],
      toolkit.guardianAddress
    ) ?? toolkit.guardianAddress;
  const sessionTarget = toFelt(sessionTargetValue);
  const transferSelector = selectorFor('transfer');

  const policy: SessionPolicyInput = {
    validAfter,
    validUntil,
    limits: limits(5, 10n ** 15n),
    allow: {
      targets: [sessionTarget],
      selectors: [transferSelector],
    },
  };

  const session = await sessions.create(policy);
  if (!ownerTransport.lastTxHash) {
    throw new Error('Session creation did not produce a transaction hash.');
  }
  const createReceipt = await waitForReceipt(toolkit.provider, ownerTransport.lastTxHash, 'session create');
  assertSucceeded(createReceipt, 'session create');
  logReceipt('create session', ownerTransport.lastTxHash, createReceipt);

  let usage = initialSessionUsageState();

  usage = await applySessionUsage(toolkit, ownerAccount, normalizedAddress, session.id, usage, 1, 'session use #1');
  usage = await applySessionUsage(toolkit, ownerAccount, normalizedAddress, session.id, usage, 1, 'session use #2');
  const third = await applySessionUsage(toolkit, ownerAccount, normalizedAddress, session.id, usage, 1, 'session use #3');
  usage = third;
  console.log('- call via session ✓');

  const revokeTx = await ownerAccount.execute({
    contractAddress: normalizedAddress,
    entrypoint: 'revoke_session',
    calldata: [session.id],
  });
  const revokeReceipt = await waitForReceipt(toolkit.provider, revokeTx.transaction_hash, 'session revoke');
  assertSucceeded(revokeReceipt, 'session revoke');
  logReceipt('revoke session', revokeTx.transaction_hash, revokeReceipt);

  const postRevokeTx = await ownerAccount.execute({
    contractAddress: normalizedAddress,
    entrypoint: 'apply_session_usage',
    calldata: [
      session.id,
      toFelt(usage.callsUsed),
      toFelt(1),
      toFelt(usage.nonce),
    ],
  });
  const postRevokeReceipt = await waitForReceipt(
    toolkit.provider,
    postRevokeTx.transaction_hash,
    'post-revoke session usage'
  );
  assertReverted(postRevokeReceipt, 'ERR_SESSION_INACTIVE', 'post revoke session use');
  logReceipt('post-revoke session', postRevokeTx.transaction_hash, postRevokeReceipt);

  await runGuardianRecovery(toolkit, normalizedAddress);
  console.log('- guardian recovery ✓');

  console.log('E2E SEPOLIA ✓ complete');
}

async function applySessionUsage(
  toolkit: Awaited<ReturnType<typeof setupToolkit>>,
  owner: Account,
  ua2Address: string,
  sessionId: string,
  state: ReturnType<typeof initialSessionUsageState>,
  calls: number,
  label: string
) {
  const tx = await owner.execute({
    contractAddress: ua2Address,
    entrypoint: 'apply_session_usage',
    calldata: [
      sessionId,
      toFelt(state.callsUsed),
      toFelt(calls),
      toFelt(state.nonce),
    ],
  });
  const receipt = await waitForReceipt(toolkit.provider, tx.transaction_hash, label);
  assertSucceeded(receipt, label);
  logReceipt(label, tx.transaction_hash, receipt);
  return updateSessionUsage(state, calls);
}

async function runGuardianRecovery(toolkit: Awaited<ReturnType<typeof setupToolkit>>, ua2Address: string) {
  const ownerAccount = new Account(toolkit.provider, ua2Address, toolkit.ownerKey);

  await sendAndAwait(toolkit, ownerAccount, ua2Address, 'add_guardian', [toolkit.guardianAddress], 'add guardian', [
    'ERR_GUARDIAN_EXISTS',
  ]);
  await sendAndAwait(toolkit, ownerAccount, ua2Address, 'set_guardian_threshold', [toFelt(1)], 'set guardian threshold');
  await sendAndAwait(toolkit, ownerAccount, ua2Address, 'set_recovery_delay', [toFelt(0)], 'set recovery delay');

  const guardianPropose = await toolkit.guardian.execute({
    contractAddress: ua2Address,
    entrypoint: 'propose_recovery',
    calldata: [toolkit.guardianPubKey],
  });
  const guardianProposeReceipt = await waitForReceipt(
    toolkit.provider,
    guardianPropose.transaction_hash,
    'guardian propose recovery'
  );
  assertSucceeded(guardianProposeReceipt, 'guardian propose recovery');
  logReceipt('guardian propose recovery', guardianPropose.transaction_hash, guardianProposeReceipt);

  const executeTx = await toolkit.guardian.execute({
    contractAddress: ua2Address,
    entrypoint: 'execute_recovery',
    calldata: [],
  });
  const executeReceipt = await waitForReceipt(toolkit.provider, executeTx.transaction_hash, 'execute recovery');
  assertSucceeded(executeReceipt, 'execute recovery');
  logReceipt('guardian execute recovery', executeTx.transaction_hash, executeReceipt);

  const ownerAfter = await readOwner(toolkit.provider, ua2Address);
  if (ownerAfter.toLowerCase() !== toolkit.guardianPubKey.toLowerCase()) {
    throw new Error(`Recovery did not update owner. expected ${toolkit.guardianPubKey}, got ${ownerAfter}`);
  }

  const recoveredOwner = new Account(toolkit.provider, ua2Address, toolkit.guardianKey);
  await sendAndAwait(
    toolkit,
    recoveredOwner,
    ua2Address,
    'rotate_owner',
    [toolkit.ownerPubKey],
    'rotate owner back'
  );
}

async function sendAndAwait(
  toolkit: Awaited<ReturnType<typeof setupToolkit>>,
  signer: Account,
  ua2Address: string,
  entrypoint: string,
  calldata: readonly string[],
  label: string,
  ignorableReasons: string[] = []
): Promise<void> {
  const tx = await signer.execute({
    contractAddress: ua2Address,
    entrypoint,
    calldata: [...calldata],
  });
  const receipt = await waitForReceipt(toolkit.provider, tx.transaction_hash, label);
  const execution = (receipt?.execution_status ?? '').toString();
  if (execution === 'REVERTED') {
    const reason = (receipt?.revert_reason ?? '').toString();
    if (ignorableReasons.some((expected) => reason.includes(expected))) {
      return;
    }
    throw new Error(`${label} failed: ${reason || 'unknown revert reason'}`);
  }
  assertSucceeded(receipt, label);
  logReceipt(label, tx.transaction_hash, receipt);
}

function logReceipt(label: string, txHash: string, receipt: any): void {
  const status = receipt?.finality_status ?? receipt?.status ?? 'UNKNOWN';
  const execution = receipt?.execution_status ?? 'UNKNOWN';
  console.log(
    `  • ${label}: tx=${txHash} finality=${status} execution=${execution}`
  );
}

void main().catch((err) => {
  console.error('[ua2] E2E sepolia failed:', err);
  process.exitCode = 1;
});

import { limits, makeSessionsManager, type SessionPolicyInput } from '@ua2/core';
import { Account } from 'starknet';

import {
  AccountCallTransport,
  assertReverted,
  assertSucceeded,
  ensureUa2Deployed,
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
  const network: Network = 'devnet';
  const toolkit = await setupToolkit(network);

  const attachedAddress = optionalEnv([
    `UA2_${network.toUpperCase()}_PROXY_ADDR`,
    'UA2_PROXY_ADDR',
  ]);

  const { address: ua2Address } = await ensureUa2Deployed(toolkit, attachedAddress);
  const ownerAccount = new Account(toolkit.provider, ua2Address, toolkit.ownerKey);
  const ownerTransport = new AccountCallTransport(ownerAccount);

  const ownerBefore = await readOwner(toolkit.provider, ua2Address);
  if (ownerBefore.toLowerCase() !== toolkit.ownerPubKey.toLowerCase()) {
    console.warn(
      `[ua2] Warning: UA² owner on-chain (${ownerBefore}) does not match configured owner pubkey (${toolkit.ownerPubKey}).`
    );
  }

  console.log('E2E DEVNET');
  console.log(`- deploy/attach ✓ (${ua2Address})`);

  const sessions = makeSessionsManager({
    account: { address: ua2Address, chainId: toolkit.chainId },
    transport: ownerTransport,
    ua2Address,
  });

  const expiresAt = Math.floor(Date.now() / 1000) + 2 * 60 * 60;
  const sessionTargetValue =
    optionalEnv(
      [`UA2_${network.toUpperCase()}_SESSION_TARGET`, 'UA2_SESSION_TARGET', 'UA2_E2E_TARGET_ADDR'],
      toolkit.guardianAddress
    ) ?? toolkit.guardianAddress;
  const sessionTarget = toFelt(sessionTargetValue);
  const transferSelector = selectorFor('transfer');

  const policy: SessionPolicyInput = {
    expiresAt,
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
  console.log(`- create session ✓ (${session.id})`);

  let usage = initialSessionUsageState();

  usage = await applySessionUsage(toolkit, ownerAccount, ua2Address, session.id, usage, 1, 'session use #1');
  usage = await applySessionUsage(toolkit, ownerAccount, ua2Address, session.id, usage, 1, 'session use #2');
  usage = await applySessionUsage(toolkit, ownerAccount, ua2Address, session.id, usage, 1, 'session use #3');
  console.log('- in-policy x3 ✓');

  const violationTx = await ownerAccount.execute({
    contractAddress: ua2Address,
    entrypoint: 'apply_session_usage',
    calldata: [
      session.id,
      toFelt(usage.callsUsed),
      toFelt(3),
      toFelt(usage.nonce),
    ],
  });
  const violationReceipt = await waitForReceipt(
    toolkit.provider,
    violationTx.transaction_hash,
    'policy violation'
  );
  assertReverted(violationReceipt, 'ERR_POLICY_CALLCAP', 'policy violation');
  console.log('- out-of-policy revert ✓ (ERR_POLICY_CALLCAP)');

  const revokeTx = await ownerAccount.execute({
    contractAddress: ua2Address,
    entrypoint: 'revoke_session',
    calldata: [session.id],
  });
  const revokeReceipt = await waitForReceipt(toolkit.provider, revokeTx.transaction_hash, 'session revoke');
  assertSucceeded(revokeReceipt, 'session revoke');

  const postRevokeTx = await ownerAccount.execute({
    contractAddress: ua2Address,
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
  console.log('- revoke + denied ✓');

  await runGuardianRecovery(toolkit, ua2Address);
  console.log('- guardian recovery ✓');

  console.log('E2E DEVNET ✓ complete');
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

  const executeTx = await toolkit.guardian.execute({
    contractAddress: ua2Address,
    entrypoint: 'execute_recovery',
    calldata: [],
  });
  const executeReceipt = await waitForReceipt(toolkit.provider, executeTx.transaction_hash, 'execute recovery');
  assertSucceeded(executeReceipt, 'execute recovery');

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
}

void main().catch((err) => {
  console.error('[ua2] E2E devnet failed:', err);
  process.exitCode = 1;
});

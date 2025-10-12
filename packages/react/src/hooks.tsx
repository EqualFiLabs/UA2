import { useCallback, useEffect, useMemo, useState } from 'react';
import { useUA2 } from './context';
import {
  NoopPaymaster,
  type AccountCall,
  type CallTransport,
  type Felt,
  type Paymaster,
  type Session,
  type SessionPolicyInput,
  type UA2Client,
  type SponsoredExecuteResult,
} from '@ua2/core';

/* ------------------ useAccount ------------------ */

export function useAccount(): {
  status: 'idle' | 'connecting' | 'ready' | 'error';
  client: UA2Client | null;
  address: Felt | null;
  error: Error | null;
  disconnect: () => Promise<void>;
} {
  const { status, client, error, disconnect } = useUA2();
  const address = client?.address ?? null;
  return { status, client, address, error, disconnect };
}

/* ------------------ useSessions ------------------ */

export function useSessions(): {
  sessions: Session[];
  create: (policy: SessionPolicyInput) => Promise<Session>;
  revoke: (sessionId: Felt) => Promise<void>;
  refresh: () => Promise<Session[]>;
  isReady: boolean;
} {
  const { client, status } = useUA2();
  const isReady = status === 'ready' && Boolean(client);
  const [sessions, setSessions] = useState<Session[]>([]);

  const refresh = useCallback(async () => {
    ensureClient(client);
    const next = await client.sessions.list();
    setSessions(next);
    return next;
  }, [client]);

  const create = useCallback(async (policy: SessionPolicyInput) => {
    ensureClient(client);
    const created = await client.sessions.create(policy);
    setSessions((prev) => [...prev, created]);
    return created;
  }, [client]);

  const revoke = useCallback(async (sessionId: Felt) => {
    ensureClient(client);
    await client.sessions.revoke(sessionId);
    setSessions((prev) =>
      prev.map((s) => (s.id === sessionId ? { ...s, policy: { ...s.policy, active: false } } : s))
    );
  }, [client]);

  useEffect(() => {
    if (!isReady) {
      setSessions([]);
      return;
    }
    refresh().catch(() => undefined);
  }, [isReady, refresh]);

  return { sessions, create, revoke, refresh, isReady };
}

/* ------------------ usePaymaster ------------------ */

type UsePaymasterArgs = {
  ua2Address: Felt;
  transport: CallTransport;
  paymaster?: Paymaster;
  entrypoint?: string;
};

export function usePaymaster({
  ua2Address,
  transport,
  paymaster: providedPaymaster,
  entrypoint,
}: UsePaymasterArgs): {
  execute: (calls: AccountCall[] | AccountCall, maxFee?: Felt) => Promise<SponsoredExecuteResult>;
  call: (to: Felt, selector: Felt, calldata?: Felt[], maxFee?: Felt) => Promise<SponsoredExecuteResult>;
  sponsorName: string;
} {
  const { client } = useUA2();
  ensureClient(client);

  const paymaster = useMemo(() => providedPaymaster ?? new NoopPaymaster(), [providedPaymaster]);

  const runner = useMemo(() => {
    return client.withPaymaster(paymaster, { ua2Address, transport, entrypoint });
  }, [client, ua2Address, transport, paymaster, entrypoint]);

  const execute = useCallback(
    async (calls: AccountCall[] | AccountCall, maxFee?: Felt) => runner.execute(calls, maxFee),
    [runner]
  );

  const call = useCallback(
    async (to: Felt, selector: Felt, calldata: Felt[] = [], maxFee?: Felt) =>
      runner.call(to, selector, calldata, maxFee),
    [runner]
  );

  return { execute, call, sponsorName: paymaster.name };
}

/* ------------------ helpers ------------------ */

function ensureClient(client: UA2Client | null | undefined): asserts client is UA2Client {
  if (!client) {
    throw new Error(
      'UA2 client not connected. Wrap component tree in <UA2Provider> and call connect().' 
    );
  }
}

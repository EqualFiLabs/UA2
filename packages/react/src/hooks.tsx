import { useCallback, useMemo } from 'react';
import { useUA2 } from './context';
import {
  NoopPaymaster,
  withPaymaster,
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
  list: () => Promise<Session[]>;
  create: (policy: SessionPolicyInput) => Promise<Session>;
  revoke: (sessionId: Felt) => Promise<void>;
  isReady: boolean;
} {
  const { client, status } = useUA2();
  const isReady = status === 'ready' && Boolean(client);

  const list = useCallback(async () => {
    ensureClient(client);
    return client.sessions.list();
  }, [client]);

  const create = useCallback(async (policy: SessionPolicyInput) => {
    ensureClient(client);
    return client.sessions.create(policy);
  }, [client]);

  const revoke = useCallback(async (sessionId: Felt) => {
    ensureClient(client);
    return client.sessions.revoke(sessionId);
  }, [client]);

  return { list, create, revoke, isReady };
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
  sponsorName: string;
} {
  const { client } = useUA2();
  ensureClient(client);

  const paymaster = useMemo(() => providedPaymaster ?? new NoopPaymaster(), [providedPaymaster]);

  const runner = useMemo(() => {
    return withPaymaster({
      account: client.account,
      ua2Address,
      transport,
      paymaster,
      entrypoint,
    });
  }, [client, ua2Address, transport, paymaster, entrypoint]);

  const execute = useCallback(
    async (calls: AccountCall[] | AccountCall, maxFee?: Felt) => runner.execute(calls, maxFee),
    [runner]
  );

  return { execute, sponsorName: paymaster.name };
}

/* ------------------ helpers ------------------ */

function ensureClient(client: UA2Client | null | undefined): asserts client is UA2Client {
  if (!client) {
    throw new Error(
      'UA2 client not connected. Wrap component tree in <UA2Provider> and call connect().' 
    );
  }
}

import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useEffect, useMemo } from 'react';
import { UA2Provider, useUA2 } from '../src/context';
import { useAccount, useSessions, usePaymaster } from '../src/hooks';
import type {
  AccountCall,
  AccountTransaction,
  CallTransport,
  ConnectOptions,
  Felt,
  Paymaster,
  SponsoredExecuteResult,
  SponsoredTx,
} from '@ua2/core';

declare global {
  interface Window {
    __sessLen?: number;
    __txHash?: Felt;
  }
}

/* ------------------ Test helpers ------------------ */

type SentCall = { addr: Felt; entry: string; data: Felt[] };

function mkFakeTransport() {
  const sent: SentCall[] = [];
  const transport: CallTransport = {
    async invoke(address: Felt, entrypoint: string, calldata: Felt[]) {
      sent.push({ addr: address, entry: entrypoint, data: [...calldata] });
      const txHash = (`0x${(sent.length + 0x100).toString(16)}`) as Felt;
      return { txHash };
    },
  };
  return { transport, sent };
}

const CONNECT_OPTS: ConnectOptions = {
  preferred: ['argent'],
  hints: {
    argent: { __available: true, __address: '0xACC', __chainId: '0xSEPOLIA' },
  },
};

/* ------------------ Components-under-test ------------------ */

function Demo() {
  const { status, error, connect, disconnect } = useUA2();
  const account = useAccount();
  const sessions = useSessions();

  useEffect(() => {
    connect(CONNECT_OPTS).catch(() => undefined);
  }, [connect]);

  return (
    <div>
      <div data-testid="status">{status}</div>
      <div data-testid="address">{account.address ?? ''}</div>
      <div data-testid="error">{error ? error.message : ''}</div>
      <button onClick={() => disconnect()}>disconnect</button>
      <button
        onClick={async () => {
          await sessions.create({
            expiresAt: 1_800_000_000,
            limits: { maxCalls: 1, maxValuePerCall: ['0x0', '0x0'] },
            allow: { targets: [], selectors: [] },
            active: true,
          });
        }}
      >
        create-session
      </button>
      <button
        onClick={async () => {
          const list = await sessions.refresh();
          window.__sessLen = list.length;
        }}
      >
        list-sessions
      </button>
      <div data-testid="session-count">{sessions.sessions.length}</div>
    </div>
  );
}

function PaymasterDemo({ ua2 }: { ua2: Felt }) {
  const { transport } = useMemo(() => mkFakeTransport(), []);
  const paymaster = useMemo<Paymaster>(
    () => ({
      name: 'test-sponsor',
      async sponsor(tx: AccountTransaction): Promise<SponsoredTx> {
        return {
          ...tx,
          sponsorData: ['0xCAFE'],
          sponsorName: 'test-sponsor',
        };
      },
    }),
    []
  );
  const { execute, sponsorName } = usePaymaster({ ua2Address: ua2, transport, paymaster });

  return (
    <div>
      <span data-testid="pm-name">{sponsorName}</span>
      <button
        onClick={async () => {
          const call: AccountCall = { to: '0x1', selector: '0x2', calldata: [] };
          const res: SponsoredExecuteResult = await execute(call);
          window.__txHash = res.txHash;
        }}
      >
        send
      </button>
    </div>
  );
}

/* ------------------ Tests ------------------ */

beforeEach(() => {
  delete window.__sessLen;
  delete window.__txHash;
});

describe('React hooks', () => {
  it('connects and exposes account via useAccount; sessions work', async () => {
    render(
      <UA2Provider>
        <Demo />
      </UA2Provider>
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(screen.getByTestId('status').textContent).toBe('ready');
    expect(screen.getByTestId('address').textContent?.toLowerCase()).toBe('0xacc');

    await act(async () => {
      screen.getByText('create-session').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      screen.getByText('list-sessions').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(window.__sessLen).toBe(1);
    expect(screen.getByTestId('session-count').textContent).toBe('1');
  });

  it('usePaymaster works when wrapped with UA2Provider + connected', async () => {
    function Root() {
      const { status, connect } = useUA2();
      useEffect(() => {
        connect(CONNECT_OPTS).catch(() => undefined);
      }, [connect]);

      if (status !== 'ready') {
        return <div data-testid="loading">loading</div>;
      }

      return <PaymasterDemo ua2="0xACC" />;
    }

    render(
      <UA2Provider>
        <Root />
      </UA2Provider>
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    await act(async () => {
      screen.getByText('send').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(window.__txHash).toMatch(/^0x/);
    expect(screen.getByTestId('pm-name').textContent).toBe('test-sponsor');
  });
});

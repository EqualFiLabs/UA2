import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@ua2/core', async () => {
  const actual = await vi.importActual<typeof import('@ua2/core')>('@ua2/core');
  return {
    ...actual,
    connect: vi.fn(),
  };
});

import App from './App.js';
import {
  connect as connectFn,
  makeSessionsManager,
  NoopPaymaster,
  type UA2Client,
  type Felt,
  type CallTransport,
  type SponsoredExecuteResult,
} from '@ua2/core';

type InvokeMock = Mock<
  [address: Felt, entrypoint: string, calldata: Felt[]],
  Promise<{ txHash: Felt }>
>;

function createClient(invokeMock: InvokeMock): {
  client: UA2Client;
  executeMock: Mock<[], Promise<SponsoredExecuteResult>>;
} {
  const transport = { invoke: invokeMock } satisfies CallTransport;
  const account = {
    address: '0xabc' as Felt,
    chainId: '0x1' as Felt,
    ua2Address: '0xabc' as Felt,
    entrypoint: '__execute__',
    transport,
  };

  const sessions = makeSessionsManager({ account, transport: account.transport, ua2Address: account.ua2Address });
  const executePaymasterMock = vi.fn<[], Promise<SponsoredExecuteResult>>(async () => ({
    txHash: '0xpay' as Felt,
    sponsored: true,
    sponsorName: 'demo',
  }));
  const runner = {
    execute: executePaymasterMock,
    call: vi.fn(),
    paymaster: new NoopPaymaster('demo'),
  };
  const withPaymasterMock = vi.fn(() => runner);

  const client: UA2Client = {
    connectorId: 'injected',
    connectorLabel: 'Injected',
    account,
    address: account.address,
    sessions,
    withPaymaster: withPaymasterMock as unknown as UA2Client['withPaymaster'],
    disconnect: vi.fn(async () => undefined),
  };

  return { client, executeMock: executePaymasterMock };
}

describe('App', () => {
  const connectMock = vi.mocked(connectFn);

  beforeEach(() => {
    connectMock.mockReset();
  });

  it('drives session, paymaster, and guardian flows through the UI', async () => {
    const invokeMock = vi.fn(async (_address: Felt, entrypoint: string, calldata: Felt[]) => {
      if (entrypoint === 'apply_session_usage') {
        const calls = BigInt(calldata[2]);
        if (calls > 3n) {
          throw new Error('policy violation');
        }
      }
      return { txHash: (`0x${entrypoint}`) as Felt };
    });
    const { client, executeMock } = createClient(invokeMock);
    connectMock.mockResolvedValue(client);

    render(<App />);

    const connectButton = await screen.findByRole('button', { name: /^connect$/i });
    fireEvent.click(connectButton);

    await waitFor(() => expect(connectMock).toHaveBeenCalled());
    await screen.findByText(/Connected address/i);

    // Create a session
    fireEvent.change(screen.getByLabelText(/Allowed target/i), { target: { value: '0xdead' } });
    fireEvent.change(screen.getByLabelText(/Allowed selector/i), { target: { value: '0xbeef' } });
    fireEvent.change(screen.getByLabelText(/Max calls/i), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText(/Expires in/i), { target: { value: '60' } });
    fireEvent.submit(screen.getByRole('button', { name: /create session/i }).closest('form')!);

    await screen.findByText(/Session created/i);
    await screen.findByText(/Known sessions/i);

    expect(invokeMock).toHaveBeenCalledWith('0xabc', 'add_session_with_allowlists', expect.any(Array));

    // Apply usage within policy
    const usageForm = screen.getByText(/Apply session usage/i).closest('form');
    fireEvent.submit(usageForm!);
    await screen.findByText(/Usage applied/i);
    expect(invokeMock).toHaveBeenCalledWith('0xabc', 'apply_session_usage', expect.any(Array));

    // Trigger a policy violation
    fireEvent.change(screen.getByLabelText(/Calls to apply/i), { target: { value: '5' } });
    fireEvent.submit(usageForm!);
    await screen.findByText(/policy violation/i);

    // Revoke the session
    fireEvent.click(screen.getByRole('button', { name: /Revoke session/i }));
    await screen.findByText(/Session revoked/i);
    expect(invokeMock).toHaveBeenCalledWith('0xabc', 'revoke_session', expect.any(Array));

    // Paymaster direct execute
    fireEvent.change(screen.getByLabelText(/Target contract/i), { target: { value: '0xfeed' } });
    fireEvent.change(screen.getByLabelText(/^Selector$/i), { target: { value: '0xcafe' } });
    fireEvent.change(screen.getByLabelText(/Calldata/), { target: { value: '0x1,0x2' } });
    fireEvent.click(screen.getByRole('button', { name: /Execute call/i }));
    await screen.findByText(/Direct execute sent/i);
    expect(invokeMock).toHaveBeenCalledWith('0xabc', '__execute__', expect.any(Array));

    // Sponsored execute
    fireEvent.click(screen.getByLabelText(/Use paymaster sponsorship/i));
    fireEvent.click(screen.getByRole('button', { name: /Execute call/i }));
    await screen.findByText(/Sponsored execute via demo/i);

    expect(executeMock).toHaveBeenCalled();

    // Guardian actions
    fireEvent.change(screen.getByLabelText(/Guardian address/i), { target: { value: '0x1' } });
    fireEvent.click(screen.getByRole('button', { name: /Add guardian/i }));
    await screen.findByText(/Guardian added/i);
    expect(invokeMock).toHaveBeenCalledWith('0xabc', 'add_guardian', ['0x1']);

    fireEvent.click(screen.getByRole('button', { name: /Set threshold/i }));
    await screen.findByText(/threshold updated/i);
    expect(invokeMock).toHaveBeenCalledWith('0xabc', 'set_guardian_threshold', ['0x1']);

    fireEvent.click(screen.getByRole('button', { name: /Set recovery delay/i }));
    await screen.findByText(/delay updated/i);
    expect(invokeMock).toHaveBeenCalledWith('0xabc', 'set_recovery_delay', ['0x0']);

    fireEvent.change(screen.getByLabelText(/Recovery target/i), { target: { value: '0x2' } });
    fireEvent.click(screen.getByRole('button', { name: /Propose recovery/i }));
    await screen.findByText(/Recovery proposed/i);
    expect(invokeMock).toHaveBeenCalledWith('0xabc', 'propose_recovery', ['0x2']);

    fireEvent.click(screen.getByRole('button', { name: /Confirm recovery/i }));
    await screen.findByText(/Recovery confirmed/i);
    expect(invokeMock).toHaveBeenCalledWith('0xabc', 'confirm_recovery', ['0x2']);

    fireEvent.click(screen.getByRole('button', { name: /Execute recovery/i }));
    await screen.findByText(/Recovery executed/i);
    expect(invokeMock).toHaveBeenCalledWith('0xabc', 'execute_recovery', []);

    fireEvent.click(screen.getByRole('button', { name: /Rotate owner/i }));
    await screen.findByText(/Owner rotated/i);
    expect(invokeMock).toHaveBeenCalledWith('0xabc', 'rotate_owner', ['0x2']);
  });
});

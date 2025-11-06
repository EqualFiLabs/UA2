import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { connect } from '../src/connect';

describe('Real connectors integration', () => {
  let originalWindow: any;

  beforeEach(() => {
    originalWindow = (globalThis as any).window;
  });

  afterEach(() => {
    (globalThis as any).window = originalWindow;
  });

  it('connects via the Argent provider and exposes a working transport', async () => {
    const executeSpy = vi.fn(async () => ({ transaction_hash: '0x123' }));
    const provider = {
      enable: vi.fn(async () => ({
        account: {
          address: '0xABC',
          execute: executeSpy,
        },
        selectedAddress: '0xABC',
      })),
      provider: {
        getChainId: vi.fn(async () => '0xSEPOLIA'),
      },
    };
    (globalThis as any).window = { starknet_argentX: provider };
    const client = await connect({ preferred: ['argent'] });
    expect(client.account.address).toBe('0xABC');
    expect(client.account.chainId).toBe('0xSEPOLIA');
    await client.account.transport!.invoke('0xAAA', 'test', ['0x1']);
    expect(executeSpy).toHaveBeenCalled();
  });
});

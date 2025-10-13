import { describe, it, expect } from 'vitest';
import { connect } from '../src/connect';
import type { ConnectOptions, Felt, CallTransport } from '../src/types';
import { ProviderUnavailableError } from '../src/errors';
import { NoopPaymaster } from '../src/paymasters';

describe('UA2.connect() provider selection', () => {
  it('chooses first available in preferred order', async () => {
    const opts: ConnectOptions = {
      preferred: ['braavos', 'argent'],
      fallback: false,
      hints: {
        braavos: { __available: true, __address: '0xBEEF1', __chainId: '0xSEPOLIA' },
        argent: { __available: true, __address: '0xDEAD1', __chainId: '0xSEPOLIA' }
      }
    };

    const client = await connect(opts);
    expect(client.connectorId).toBe('braavos');
    expect(client.address).toBe('0xBEEF1');
  });

  it('falls back when preferred are unavailable and fallback=true', async () => {
    const opts: ConnectOptions = {
      preferred: ['cartridge'], // mark unavailable
      fallback: true,
      hints: {
        cartridge: { __available: false },
        injected: { __available: true, __address: '0xFACE', __chainId: '0xSEPOLIA' }
      }
    };

    const client = await connect(opts);
    expect(client.connectorId).toBe('injected');
    expect(client.address).toBe('0xFACE');
  });

  it('throws when nothing is available', async () => {
    const opts: ConnectOptions = {
      preferred: ['argent', 'braavos'],
      fallback: false,
      hints: {
        argent: { __available: false },
        braavos: { __available: false }
      }
    };

    await expect(connect(opts)).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it('deduplicates preferred list', async () => {
    const opts: ConnectOptions = {
      preferred: ['argent', 'argent', 'braavos'],
      fallback: false,
      hints: {
        argent: { __available: true, __address: '0xA', __chainId: '0xSEPOLIA' }
      }
    };
    const client = await connect(opts);
    expect(client.connectorId).toBe('argent');
    expect(client.address).toBe('0xA');
  });

  it('exposes withPaymaster helper on client', async () => {
    const sent: Felt[][] = [];
    const transport: CallTransport = {
      async invoke(_address, _entrypoint, calldata) {
        sent.push([...calldata]);
        return { txHash: '0xF00' as Felt };
      },
    };

    const opts: ConnectOptions = {
      preferred: ['argent'],
      fallback: false,
      hints: {
        argent: {
          __available: true,
          __address: '0xACC',
          __chainId: '0xSEPOLIA',
        },
      },
    };

    const client = await connect(opts);
    const runner = client.withPaymaster(new NoopPaymaster(), {
      transport,
      ua2Address: client.address,
    });

    const res = await runner.execute({ to: '0x1', selector: '0x2', calldata: [] });
    expect(res.txHash).toBe('0xF00');
    expect(sent).toHaveLength(1);
  });
});

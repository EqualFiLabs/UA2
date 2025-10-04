import { describe, it, expect } from 'vitest';
import { connect } from '../src/connect';
import type { ConnectOptions } from '../src/types';

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

    await expect(connect(opts)).rejects.toThrow(/No available wallet connectors/);
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
});

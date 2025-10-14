import { describe, expect, it } from 'vitest';
import { NoopPaymaster, PaymasterDeniedError } from '../src/index.js';

const BASE_TX = {
  calls: [
    {
      to: '0xCA11',
      selector: '0xDEADBEEF',
      calldata: ['0x1', '0x2'],
    },
  ],
} as const;

describe('NoopPaymaster', () => {
  it('decorates the transaction when within limits', async () => {
    const paymaster = new NoopPaymaster({ name: 'demo', sponsorData: ['0xFE'] });
    const sponsored = await paymaster.sponsor(BASE_TX);

    expect(sponsored.calls).toEqual(BASE_TX.calls);
    expect(sponsored.maxFee).toBeDefined();
    expect(sponsored.sponsorData).toEqual(['0xFE']);
    expect(sponsored.sponsorName).toBe('demo');
  });

  it('rejects call batches that exceed the ceiling', async () => {
    const paymaster = new NoopPaymaster({ callCeiling: 1 });
    const tx = {
      ...BASE_TX,
      calls: [...BASE_TX.calls, BASE_TX.calls[0]],
    };

    await expect(paymaster.sponsor(tx)).rejects.toThrowError(PaymasterDeniedError);
    await expect(paymaster.sponsor(tx)).rejects.toThrow(
      /Call batch size 2 exceeds limit of 1/
    );
  });

  it('rejects calldata that exceeds the ceiling', async () => {
    const paymaster = new NoopPaymaster({ calldataCeiling: 1 });
    await expect(paymaster.sponsor(BASE_TX)).rejects.toThrow(
      /Calldata length 2 exceeds limit of 1/
    );
  });

  it('rejects fees above the ceiling', async () => {
    const paymaster = new NoopPaymaster({ feeCeiling: '0x5' });
    await expect(
      paymaster.sponsor({ ...BASE_TX, maxFee: '0x10' })
    ).rejects.toThrow(/exceeds sponsor ceiling/);
  });

  it('fills in a default maxFee when not provided', async () => {
    const paymaster = new NoopPaymaster({ feeCeiling: '0x42' });
    const sponsored = await paymaster.sponsor(BASE_TX);
    expect(sponsored.maxFee).toBe('0x42');
  });
});

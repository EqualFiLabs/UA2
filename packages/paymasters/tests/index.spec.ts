import { describe, expect, it } from 'vitest';
import { NoopPaymaster } from '../src/index.js';

describe('NoopPaymaster', () => {
  it('returns the transaction unchanged', async () => {
    const paymaster = new NoopPaymaster<string>();
    const tx = 'demo-transaction';
    await expect(paymaster.sponsor(tx)).resolves.toBe(tx);
  });
});

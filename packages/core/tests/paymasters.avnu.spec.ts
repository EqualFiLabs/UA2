import { describe, it, expect } from 'vitest';
import { paymasters, AvnuPaymaster } from '../src/index';

describe('Paymaster factory integration', () => {
  it('returns AvnuPaymaster from paymasters.from()', () => {
    const p = paymasters.from('avnu');
    expect(p).toBeInstanceOf(AvnuPaymaster);
  });
});

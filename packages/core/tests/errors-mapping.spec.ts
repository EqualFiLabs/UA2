import { describe, it, expect } from 'vitest';
import { mapContractError } from '../src/errors';

describe('Contract error mapping', () => {
  it('maps NOT_OWNER to a UA2Error with appropriate message', () => {
    const rawError = new Error('Execution reverted: NOT_OWNER');
    const err = mapContractError(rawError);
    expect(err.code).toBe('NOT_OWNER');
    expect(err.message).toContain('Caller is not the account owner');
  });
});

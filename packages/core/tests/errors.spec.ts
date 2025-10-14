import { describe, expect, it } from 'vitest';

import {
  mapContractError,
  PolicyViolationError,
  SessionExpiredError,
  UA2Error,
} from '../src/errors';

describe('mapContractError', () => {
  it('returns UA2Error instances unchanged', () => {
    const err = new SessionExpiredError('custom');
    expect(mapContractError(err)).toBe(err);
  });

  it('maps session lifecycle errors to SessionExpiredError', () => {
    const mapped = mapContractError('Execution reverted: ERR_SESSION_STALE');
    expect(mapped).toBeInstanceOf(SessionExpiredError);
    expect(mapped.message).toMatch(/owner rotation/i);
  });

  it('maps policy violations to PolicyViolationError', () => {
    const mapped = mapContractError({ message: 'Error: ERR_POLICY_TARGET_DENIED' });
    expect(mapped).toBeInstanceOf(PolicyViolationError);
    expect((mapped as PolicyViolationError).kind).toBe('target');
  });

  it('preserves revert codes for guardian errors', () => {
    const mapped = mapContractError('ERR_NOT_GUARDIAN');
    expect(mapped).toBeInstanceOf(UA2Error);
    expect(mapped.code).toBe('ERR_NOT_GUARDIAN');
    expect(mapped.message).toMatch(/not a registered guardian/i);
  });

  it('falls back to UnknownContractError when no code is present', () => {
    const mapped = mapContractError(new Error('something else')); // no ERR_* token
    expect(mapped).toBeInstanceOf(UA2Error);
    expect(mapped.code).toBe('UnknownContractError');
  });
});

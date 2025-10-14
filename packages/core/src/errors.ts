export class UA2Error extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = new.target?.name ?? 'UA2Error';
    this.code = code;
  }
}

export class ProviderUnavailableError extends UA2Error {
  constructor(message?: string) {
    super('ProviderUnavailable', message ?? 'No available wallet connectors.');
  }
}

export class SessionExpiredError extends UA2Error {
  constructor(message?: string) {
    super('SessionExpired', message ?? 'Session is inactive or expired.');
  }
}

export type PolicyViolationKind = 'selector' | 'target' | 'value' | 'calls';

export class PolicyViolationError extends UA2Error {
  readonly kind: PolicyViolationKind;
  readonly detail?: string;

  constructor(kind: PolicyViolationKind, detail?: string, message?: string) {
    super('PolicyViolation', message ?? `Session policy violation: ${kind}${detail ? ` (${detail})` : ''}.`);
    this.kind = kind;
    this.detail = detail;
  }
}

export class PaymasterDeniedError extends UA2Error {
  constructor(message?: string) {
    super('PaymasterDenied', message ?? 'Paymaster rejected the transaction.');
  }
}

type ErrorFactory = () => UA2Error;

const policyViolation = (kind: PolicyViolationKind, detail?: string, message?: string): ErrorFactory =>
  () => new PolicyViolationError(kind, detail, message);

const sessionExpired = (message: string): ErrorFactory => () => new SessionExpiredError(message);

const basic = (code: string, message: string): ErrorFactory => () => new UA2Error(code, message);

const CONTRACT_ERROR_FACTORIES: Record<string, ErrorFactory> = {
  ERR_SESSION_EXPIRED: sessionExpired('Session expired on-chain.'),
  ERR_SESSION_INACTIVE: sessionExpired('Session was revoked or is inactive.'),
  ERR_SESSION_NOT_READY: sessionExpired('Session is not yet valid (valid_after in the future).'),
  ERR_SESSION_STALE: sessionExpired('Session was invalidated by an owner rotation.'),
  ERR_POLICY_CALLCAP: policyViolation('calls', 'maxCalls exceeded'),
  ERR_POLICY_CALLCOUNT_MISMATCH: policyViolation('calls', 'call count mismatch with prior usage'),
  ERR_POLICY_SELECTOR_DENIED: policyViolation('selector'),
  ERR_POLICY_TARGET_DENIED: policyViolation('target'),
  ERR_VALUE_LIMIT_EXCEEDED: policyViolation('value', undefined, 'Transfer amount exceeds session maxValuePerCall.'),
  ERR_SESSION_TARGETS_LEN: basic('ERR_SESSION_TARGETS_LEN', 'Target allowlist length mismatch.'),
  ERR_SESSION_SELECTORS_LEN: basic('ERR_SESSION_SELECTORS_LEN', 'Selector allowlist length mismatch.'),
  ERR_BAD_SESSION_NONCE: basic('ERR_BAD_SESSION_NONCE', 'Session nonce mismatch. Recreate or refresh the session.'),
  ERR_BAD_VALID_WINDOW: basic('ERR_BAD_VALID_WINDOW', 'valid_until must be greater than valid_after.'),
  ERR_BAD_MAX_CALLS: basic('ERR_BAD_MAX_CALLS', 'max_calls must be greater than zero.'),
  ERR_SIGNATURE_MISSING: basic('ERR_SIGNATURE_MISSING', 'Signature array is empty.'),
  ERR_SESSION_SIG_INVALID: basic('ERR_SESSION_SIG_INVALID', 'Session signature did not verify.'),
  ERR_OWNER_SIG_INVALID: basic('ERR_OWNER_SIG_INVALID', 'Owner signature was invalid.'),
  ERR_GUARDIAN_SIG_INVALID: basic('ERR_GUARDIAN_SIG_INVALID', 'Guardian signature was invalid.'),
  ERR_GUARDIAN_EXISTS: basic('ERR_GUARDIAN_EXISTS', 'Guardian already exists in the set.'),
  ERR_NOT_GUARDIAN: basic('ERR_NOT_GUARDIAN', 'Caller is not a registered guardian.'),
  ERR_GUARDIAN_CALL_DENIED: basic('ERR_GUARDIAN_CALL_DENIED', 'Guardian signatures may only authorize recovery entrypoints.'),
  ERR_BAD_THRESHOLD: basic('ERR_BAD_THRESHOLD', 'Guardian threshold must be > 0 and ≤ current guardian count.'),
  ERR_RECOVERY_IN_PROGRESS: basic('ERR_RECOVERY_IN_PROGRESS', 'A recovery flow is already in progress.'),
  ERR_NO_RECOVERY: basic('ERR_NO_RECOVERY', 'No active recovery proposal exists.'),
  ERR_RECOVERY_MISMATCH: basic('ERR_RECOVERY_MISMATCH', 'Recovery call does not match the active proposal.'),
  ERR_ALREADY_CONFIRMED: basic('ERR_ALREADY_CONFIRMED', 'Guardian already confirmed this proposal.'),
  ERR_BEFORE_ETA: basic('ERR_BEFORE_ETA', 'Recovery timelock has not elapsed yet.'),
  ERR_NOT_ENOUGH_CONFIRMS: basic('ERR_NOT_ENOUGH_CONFIRMS', 'Not enough guardians have confirmed the proposal.'),
  ERR_NOT_OWNER: basic('ERR_NOT_OWNER', 'Caller is not the account owner.'),
  ERR_ZERO_OWNER: basic('ERR_ZERO_OWNER', 'Owner cannot be the zero felt.'),
  ERR_SAME_OWNER: basic('ERR_SAME_OWNER', 'New owner must differ from the current owner.'),
  ERR_UNSUPPORTED_AUTH_MODE: basic('ERR_UNSUPPORTED_AUTH_MODE', 'Authentication mode combination is not supported.'),
};

/**
 * Map a raw Starknet error/revert payload into a typed UA² error for ergonomics.
 * If the revert reason is unknown we fall back to a generic UA2Error so callers
 * still receive a deterministic error type.
 */
export function mapContractError(error: unknown): UA2Error {
  if (error instanceof UA2Error) {
    return error;
  }

  const message = extractMessage(error);
  const match = message.match(/ERR_[A-Z0-9_]+/);
  if (match) {
    const code = match[0];
    const factory = CONTRACT_ERROR_FACTORIES[code];
    if (factory) {
      return factory();
    }
    return new UA2Error(code, `Contract reverted with ${code}.`);
  }

  return new UA2Error('UnknownContractError', message || 'Unknown contract error.');
}

function extractMessage(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message ?? error.toString();
  if (typeof error === 'object') {
    const maybeMessage = (error as { message?: unknown }).message;
    if (typeof maybeMessage === 'string') return maybeMessage;
    try {
      return JSON.stringify(error);
    } catch {
      return '';
    }
  }
  return '';
}

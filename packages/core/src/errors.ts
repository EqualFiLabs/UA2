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

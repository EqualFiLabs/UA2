import crypto from 'node:crypto';
import type {
  AccountCall,
  CallTransport,
  Felt,
  Session,
  SessionPolicyCalldata,
  SessionPolicyInput,
  SessionsManager,
  UA2AccountLike,
  Uint256,
} from './types';
import { toUint256 } from './utils/u256';
import { toFelt } from './utils/felt';
import { PolicyViolationError, SessionExpiredError } from './errors';

/**
 * In-memory session store + deterministic calldata shaping.
 * Transport is currently optional/no-op; wire starknet.js later.
 */

type CtorArgs = {
  account: UA2AccountLike;
  transport?: CallTransport; // optional for now
  ua2Address?: Felt; // UA² Account contract address (when available)
};

export function makeSessionsManager(args: CtorArgs): SessionsManager {
  return new SessionsImpl(args);
}

class SessionsImpl implements SessionsManager {
  private readonly transport?: CallTransport;
  private readonly ua2?: Felt;

  private readonly sessions: Session[] = [];

  constructor({ account, transport, ua2Address }: CtorArgs) {
    void account; // reserved for future features (e.g., paymaster hints)
    this.transport = transport;
    this.ua2 = ua2Address;
  }

  async create(policy: SessionPolicyInput): Promise<Session> {
    const active = policy.active ?? true;
    const pubkey = genFeltKey();
    const sessionId = pubkey; // v0.1: use felt pubkey directly; can hash later
    const createdAt = Date.now();

    // Build calldata for Cairo's SessionPolicy struct and allowlists.
    const { policyCalldata, allowCalldata } = buildPolicyCalldata(policy, active);
    const calldata = buildAddSessionCalldata(pubkey, policyCalldata, allowCalldata);

    // If we have a transport + ua2 address, we could call add_session_with_allowlists here.
    // Keeping it local-only for now (no RPC in tests).
    if (this.transport && this.ua2) {
      await this.transport.invoke(this.ua2, 'add_session_with_allowlists', calldata);
    }

    const sess: Session = {
      id: sessionId,
      pubkey,
      policy,
      createdAt,
    };
    this.sessions.push(sess);
    return sess;
  }

  async revoke(sessionId: Felt): Promise<void> {
    // Mark local store only; on-chain call can be plugged via transport later.
    const s = this.sessions.find((x) => x.id === sessionId);
    if (s) s.policy = { ...s.policy, active: false };
    // Example (future):
    // await this.transport?.invoke(this.ua2!, 'revoke_session', [sessionId]);
  }

  async list(): Promise<Session[]> {
    // Return a shallow copy for immutability.
    return [...this.sessions];
  }
}

/* ------------------ Policy / Calldata helpers ------------------ */

function buildPolicyCalldata(inp: SessionPolicyInput, active: boolean): {
  policyCalldata: SessionPolicyCalldata;
  allowCalldata: {
    targets: Felt[];
    selectors: Felt[];
  };
} {
  const rawValidAfter = Math.max(0, Math.floor(inp.validAfter));
  const rawValidUntil = Math.max(0, Math.floor(inp.validUntil));
  const normalizedValidUntil = rawValidUntil <= rawValidAfter ? rawValidAfter + 1 : rawValidUntil;
  const valid_after = toFelt(BigInt(rawValidAfter));
  const valid_until = toFelt(BigInt(normalizedValidUntil));
  const max_calls = toFelt(inp.limits.maxCalls >>> 0);
  const calls_used = toFelt(0);
  const [low, high] = inp.limits.maxValuePerCall;
  const is_active = toFelt(active ? 1 : 0);

  const policyCalldata: SessionPolicyCalldata = {
    is_active,
    valid_after,
    valid_until,
    max_calls,
    calls_used,
    max_value_per_call_low: low,
    max_value_per_call_high: high,
  };

  const targets = (inp.allow.targets ?? []).map(toFelt);
  const selectors = (inp.allow.selectors ?? []).map(toFelt);

  return { policyCalldata, allowCalldata: { targets, selectors } };
}

function buildAddSessionCalldata(
  pubkey: Felt,
  policy: SessionPolicyCalldata,
  allow: { targets: Felt[]; selectors: Felt[] }
): Felt[] {
  const policyArray: Felt[] = [
    policy.valid_after,
    policy.valid_until,
    policy.max_calls,
    policy.max_value_per_call_low,
    policy.max_value_per_call_high,
  ];

  const targetsLen = toFelt(allow.targets.length);
  const selectorsLen = toFelt(allow.selectors.length);

  return [
    pubkey,
    ...policyArray,
    targetsLen,
    ...allow.targets,
    selectorsLen,
    ...allow.selectors,
  ];
}

/** Convenience builder for users: encode numeric string amount as Uint256. */
export function limits(maxCalls: number, maxValue: string | number | bigint): {
  maxCalls: number;
  maxValuePerCall: Uint256;
} {
  return { maxCalls, maxValuePerCall: toUint256(maxValue) };
}

/* ------------------ Session helpers ------------------ */

export interface SessionUseOptions {
  /** Override "now" in milliseconds (defaults to Date.now()). */
  now?: number;
}

export interface SessionUsage {
  session: Session;
  /** Ensure the provided calls comply with the session policy. */
  ensureAllowed(calls: AccountCall[] | AccountCall): void;
}

export async function useSession(
  manager: SessionsManager,
  sessionId: Felt,
  opts?: SessionUseOptions
): Promise<SessionUsage> {
  const list = await manager.list();
  const found = list.find((s) => s.id === sessionId);
  if (!found) {
    throw new SessionExpiredError(`Session ${sessionId} not found.`);
  }

  ensureSessionActive(found, opts?.now);

  return {
    session: found,
    ensureAllowed(calls: AccountCall[] | AccountCall) {
      ensureSessionActive(found, opts?.now);
      const arr = Array.isArray(calls) ? calls : [calls];
      ensurePolicy(found, arr);
    },
  };
}

function ensureSessionActive(session: Session, nowMs?: number) {
  if (session.policy.active === false) {
    throw new SessionExpiredError(`Session ${session.id} is inactive.`);
  }

  const nowSeconds = Math.floor((nowMs ?? Date.now()) / 1000);
  if (nowSeconds < session.policy.validAfter) {
    throw new SessionExpiredError(
      `Session ${session.id} not active until ${session.policy.validAfter}.`
    );
  }
  if (session.policy.validUntil <= nowSeconds) {
    throw new SessionExpiredError(
      `Session ${session.id} expired at ${session.policy.validUntil}.`
    );
  }
}

function ensurePolicy(session: Session, calls: AccountCall[]) {
  const { allow, limits } = session.policy;

  if (calls.length > limits.maxCalls) {
    throw new PolicyViolationError('calls', `${calls.length} > ${limits.maxCalls}`);
  }

  const allowedTargets = new Set((allow.targets ?? []).map((t) => toFelt(t)));
  const allowedSelectors = new Set((allow.selectors ?? []).map((s) => toFelt(s)));

  for (const call of calls) {
    if (allowedTargets.size > 0 && !allowedTargets.has(toFelt(call.to))) {
      throw new PolicyViolationError('target', call.to);
    }

    if (allowedSelectors.size > 0 && !allowedSelectors.has(toFelt(call.selector))) {
      throw new PolicyViolationError('selector', call.selector);
    }
  }
}

/* ------------------ Guard builder ------------------ */

export interface GuardBuilderInit {
  validAfter?: number;
  validUntil?: number;
  expiresAt?: number; // legacy alias for validUntil
  expiresInSeconds?: number;
  maxCalls?: number;
  maxValue?: string | number | bigint;
  targets?: Felt[];
  selectors?: Felt[];
  active?: boolean;
}

export interface GuardBuilder {
  validAfter(timestamp: number): GuardBuilder;
  validUntil(timestamp: number): GuardBuilder;
  target(addr: Felt): GuardBuilder;
  targets(addresses: Iterable<Felt>): GuardBuilder;
  selector(sel: Felt): GuardBuilder;
  selectors(values: Iterable<Felt>): GuardBuilder;
  maxCalls(count: number): GuardBuilder;
  maxValue(value: string | number | bigint): GuardBuilder;
  expiresAt(timestamp: number): GuardBuilder;
  expiresIn(seconds: number): GuardBuilder;
  active(flag: boolean): GuardBuilder;
  build(): SessionPolicyInput;
}

export function guard(init: GuardBuilderInit = {}): GuardBuilder {
  let validAfter = Math.max(0, Math.floor(init.validAfter ?? 0));
  let validUntil = resolveValidUntil(init, validAfter);
  let maxCallsCount = init.maxCalls ?? 1;
  let maxValueInput: string | number | bigint = init.maxValue ?? 0;
  let isActive = init.active ?? true;
  const targets = new Set((init.targets ?? []).map((t) => toFelt(t)));
  const selectors = new Set((init.selectors ?? []).map((s) => toFelt(s)));

  const builder: GuardBuilder = {
    validAfter(timestamp: number) {
      validAfter = Math.max(0, Math.floor(timestamp));
      validUntil = Math.max(validUntil, validAfter + 1);
      return builder;
    },
    validUntil(timestamp: number) {
      validUntil = normalizeValidUntil(timestamp, validAfter);
      return builder;
    },
    target(addr: Felt) {
      targets.add(toFelt(addr));
      return builder;
    },
    targets(addresses: Iterable<Felt>) {
      for (const addr of addresses) targets.add(toFelt(addr));
      return builder;
    },
    selector(sel: Felt) {
      selectors.add(toFelt(sel));
      return builder;
    },
    selectors(values: Iterable<Felt>) {
      for (const sel of values) selectors.add(toFelt(sel));
      return builder;
    },
    maxCalls(count: number) {
      maxCallsCount = Math.max(1, Math.floor(count));
      return builder;
    },
    maxValue(value: string | number | bigint) {
      maxValueInput = value;
      return builder;
    },
    expiresAt(timestamp: number) {
      validUntil = normalizeValidUntil(timestamp, validAfter);
      return builder;
    },
    expiresIn(seconds: number) {
      const now = Math.floor(Date.now() / 1000);
      validUntil = normalizeValidUntil(now + Math.max(0, Math.floor(seconds)), validAfter);
      return builder;
    },
    active(flag: boolean) {
      isActive = flag;
      return builder;
    },
    build(): SessionPolicyInput {
      return {
        validAfter,
        validUntil,
        limits: {
          maxCalls: maxCallsCount,
          maxValuePerCall: toUint256(maxValueInput),
        },
        allow: {
          targets: Array.from(targets),
          selectors: Array.from(selectors),
        },
        active: isActive,
      };
    },
  };

  return builder;
}

function resolveValidUntil(init: GuardBuilderInit, validAfter: number): number {
  if (typeof init.validUntil === 'number') {
    return normalizeValidUntil(init.validUntil, validAfter);
  }
  if (typeof init.expiresAt === 'number') {
    return normalizeValidUntil(init.expiresAt, validAfter);
  }
  if (typeof init.expiresInSeconds === 'number') {
    const now = Math.floor(Date.now() / 1000);
    return normalizeValidUntil(now + Math.max(0, Math.floor(init.expiresInSeconds)), validAfter);
  }
  const defaultExpirySeconds = Math.floor(Date.now() / 1000) + 3600; // 1 hour default
  return normalizeValidUntil(defaultExpirySeconds, validAfter);
}

function normalizeValidUntil(value: number, validAfter: number): number {
  const normalized = Math.max(0, Math.floor(value));
  return normalized <= validAfter ? validAfter + 1 : normalized;
}

export const sessions = {
  use: useSession,
  guard,
  limits,
};

/* ------------------ Key generation (dev-only) ------------------ */

/** Generate a 251-bit-ish felt hex as a "pubkey". Not a real Stark keypair. */
function genFeltKey(): Felt {
  // 32 bytes -> 256 bits; mask down a little to be friendly.
  const buf = crypto.randomBytes(32);
  // Force first nibble to <= 7 to avoid exceeding field prime in naive contexts.
  buf[0] = buf[0] & 0x7f;
  return ('0x' + buf.toString('hex')) as Felt;
}

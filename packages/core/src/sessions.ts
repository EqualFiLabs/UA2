import crypto from 'node:crypto';
import type {
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
    const keyHash = pubkey; // v0.1: use felt pubkey directly; can hash later
    const createdAt = Date.now();

    // Build calldata for Cairo's SessionPolicy struct and allowlists.
    const { policyCalldata, allowCalldata } = buildPolicyCalldata(policy, active);
    const calldata = buildAddSessionCalldata(pubkey, keyHash, policyCalldata, allowCalldata);

    // If we have a transport + ua2 address, we could call add_session_with_allowlists here.
    // Keeping it local-only for now (no RPC in tests).
    if (this.transport && this.ua2) {
      await this.transport.invoke(this.ua2, 'add_session_with_allowlists', calldata);
    }

    const sess: Session = {
      id: keyHash,
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
    if (s) (s.policy as any).active = false;
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
  const expires_at = toFelt(inp.expiresAt >>> 0); // as u64 -> felt
  const max_calls = toFelt(inp.limits.maxCalls >>> 0);
  const calls_used = toFelt(0);
  const [low, high] = inp.limits.maxValuePerCall;
  const is_active = toFelt(active ? 1 : 0);

  const policyCalldata: SessionPolicyCalldata = {
    is_active,
    expires_at,
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
  keyHash: Felt,
  policy: SessionPolicyCalldata,
  allow: { targets: Felt[]; selectors: Felt[] }
): Felt[] {
  const policyArray: Felt[] = [
    policy.is_active,
    policy.expires_at,
    policy.max_calls,
    policy.calls_used,
    policy.max_value_per_call_low,
    policy.max_value_per_call_high,
  ];

  const targetsLen = toFelt(allow.targets.length);
  const selectorsLen = toFelt(allow.selectors.length);

  return [
    pubkey,
    keyHash,
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

/* ------------------ Key generation (dev-only) ------------------ */

/** Generate a 251-bit-ish felt hex as a "pubkey". Not a real Stark keypair. */
function genFeltKey(): Felt {
  // 32 bytes -> 256 bits; mask down a little to be friendly.
  const buf = crypto.randomBytes(32);
  // Force first nibble to <= 7 to avoid exceeding field prime in naive contexts.
  buf[0] = buf[0] & 0x7f;
  return ('0x' + buf.toString('hex')) as Felt;
}

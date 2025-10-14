/**
 * Core types used across UA² SDK.
 */
export type Felt = string;

/** A minimal account surface we need right now. */
export interface UA2AccountLike {
  /** Contract/account address on Starknet (felt-formatted hex) */
  address: Felt;
  /** Chain id the account is connected to (felt-formatted hex) */
  chainId?: Felt;
  /** Optional human name for diagnostics */
  label?: string;
  /** Optional transport capable of submitting txs for this account. */
  transport?: CallTransport;
  /** Optional UA² contract address override when different from account. */
  ua2Address?: Felt;
  /** Optional entrypoint used for execution (defaults to '__execute__'). */
  entrypoint?: string;
}

/** Connector can detect availability and create an account session. */
export interface WalletConnector {
  /** Unique id e.g. 'argent', 'braavos', 'cartridge', 'injected' */
  readonly id: string;
  /** Human label for logs/UI */
  readonly label: string;

  /** Quick probe for availability (e.g., presence of window objects). */
  isAvailable(opts?: Record<string, unknown>): Promise<boolean>;

  /**
   * Establish a session and return an account handle.
   * `opts` can carry provider-specific hints; we keep it generic.
   */
  connect(opts?: Record<string, unknown>): Promise<UA2AccountLike>;
}

/** Options for UA2.connect(). */
export interface ConnectOptions {
  /**
   * List of connector ids to try in **priority order**.
   * Example: ['argent', 'braavos', 'cartridge', 'injected']
   */
  preferred: string[];

  /**
   * If true, fall back to any available connector not listed in `preferred`
   * (useful when a user only has a different injected wallet).
   */
  fallback?: boolean;

  /**
   * Extra hints for connectors. Keys are connector ids; values are custom maps.
   * Example:
   * {
   *   argent: { network: 'sepolia' },
   *   cartridge: { controllerUrl: '...' }
   * }
   */
  hints?: Record<string, Record<string, unknown>>;
}

/* ------------------ Sessions & Policy ------------------ */

/** Successful connection result. */
export interface UA2Client {
  /** Selected connector id */
  connectorId: string;
  /** Human label (e.g., 'Argent X') */
  connectorLabel: string;
  /** Connected account */
  account: UA2AccountLike;

  /** Convenience: address string */
  address: Felt;

  /** Sessions manager for session keys and policies. */
  sessions: SessionsManager;

  /** Create a paymaster-backed executor bound to this account. */
  withPaymaster(paymaster: Paymaster, ctx?: PaymasterContext): PaymasterRunner;

  /** Disconnect hook (no-op for now, placeholder for future sessions) */
  disconnect(): Promise<void>;
}

/** Uint256 encoded as two felts [low, high] in hex strings. */
export type Uint256 = readonly [Felt, Felt];

export interface SessionLimits {
  /** Max number of calls this session can perform total. */
  maxCalls: number;
  /** Maximum value per call in wei-style units, encoded as Uint256. */
  maxValuePerCall: Uint256;
}

export interface SessionAllow {
  /** Allowed contract addresses (as felts). */
  targets: Felt[];
  /** Allowed function selectors (as felts). */
  selectors: Felt[];
}

export interface SessionPolicyInput {
  /** Earliest timestamp the session can be used (seconds since epoch). */
  validAfter: number;
  /** Expiration timestamp (seconds since epoch). */
  validUntil: number;
  /** Limits per session. */
  limits: SessionLimits;
  /** Allowlist constraints. */
  allow: SessionAllow;
  /** Whether the session is active on creation. Default true. */
  active?: boolean;
  /** Number of calls already consumed by this session (mirrors on-chain `calls_used`). */
  callsUsed?: number;
}

/** The on-chain policy struct shape (Cairo ordering). */
export interface SessionPolicyCalldata {
  is_active: Felt;            // 0x0 or 0x1
  valid_after: Felt;          // u64 -> felt
  valid_until: Felt;          // u64 -> felt
  max_calls: Felt;            // u32 -> felt
  calls_used: Felt;           // u32 -> felt (init 0)
  max_value_per_call_low: Felt;
  max_value_per_call_high: Felt;
  // Arrays come separately as (len, items...)
}

/** Cairo struct with native JS types for ergonomics. */
export interface SessionPolicyStruct {
  is_active: boolean;
  valid_after: number;
  valid_until: number;
  max_calls: number;
  calls_used: number;
  max_value_per_call: Uint256;
}

/** Session policy resolved with defaults and counters for local mirrors. */
export interface SessionPolicyResolved extends SessionPolicyInput {
  active: boolean;
  callsUsed: number;
}

/** Returned by SDK when you create a session. */
export interface Session {
  /** Internal id = keyHash felt (same as supplied key or its hash). */
  id: Felt;
  /** Public session key felt (simplified for now). */
  pubkey: Felt;
  /** Policy you requested. */
  policy: SessionPolicyResolved;
  /** Created at (ms). */
  createdAt: number;
}

/** Sessions manager surface. */
export interface SessionsManager {
  /** Create a new session keypair and register policy on-chain (later). */
  create(policy: SessionPolicyInput): Promise<Session>;
  /** Revoke (deactivate) a session. */
  revoke(sessionId: Felt): Promise<void>;
  /** List locally known sessions. */
  list(): Promise<Session[]>;
  /** Load and validate a session for client-side policy enforcement. */
  use(sessionId: Felt, opts?: SessionUseOptions): Promise<SessionUsage>;
}

/* ------------------ Transport Abstraction (stub) ------------------ */

/** Account call (single) */
export interface AccountCall {
  to: Felt;
  selector: Felt;
  calldata: Felt[];
}

/** Batched transaction sent by the account */
export interface AccountTransaction {
  calls: AccountCall[];
  /** Optional gas/maxFee hint in felt hex */
  maxFee?: Felt;
}

/**
 * Call executor (placeholder for starknet.js Account).
 * We keep it minimal so unit tests don’t need a node or RPC.
 */
export interface CallTransport {
  /** Encode and "send" a call to a contract (no-op in tests). */
  invoke(address: Felt, entrypoint: string, calldata: Felt[]): Promise<{ txHash: Felt }>;
}

/* ------------------ Paymasters ------------------ */

export interface SponsoredTx extends AccountTransaction {
  /** Extra sponsor-provided data (opaque to UA² account). */
  sponsorData?: Felt[];
  /** Optional human-readable sponsor name/tag. */
  sponsorName?: string;
}

/** Minimal paymaster interface adapters must implement. */
export interface Paymaster {
  readonly name: string;
  /**
   * Sponsor a transaction (add metadata, set maxFee, etc.).
   * Return a SponsoredTx; may be identical to input (noop).
   */
  sponsor(tx: AccountTransaction): Promise<SponsoredTx>;
}

export interface PaymasterContext {
  transport?: CallTransport;
  ua2Address?: Felt;
  entrypoint?: string;
}

/* ------------------ Session usage helpers ------------------ */

export interface SessionUseOptions {
  /** Override "now" in milliseconds (defaults to Date.now()). */
  now?: number;
}

export interface SessionUsage {
  session: Session;
  /** Ensure the provided calls comply with the session policy. */
  ensureAllowed(calls: AccountCall[] | AccountCall): void;
}

export interface PaymasterRunner {
  execute(calls: AccountCall[] | AccountCall, maxFee?: Felt): Promise<SponsoredExecuteResult>;
  call(to: Felt, selector: Felt, calldata?: Felt[], maxFee?: Felt): Promise<SponsoredExecuteResult>;
  paymaster: Paymaster;
}

/** Result returned by a sponsored execute path. */
export interface SponsoredExecuteResult {
  txHash: Felt;
  sponsored: boolean;
  sponsorName?: string;
}

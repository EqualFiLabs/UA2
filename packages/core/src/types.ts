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
  /** Expiration timestamp (seconds since epoch). */
  expiresAt: number;
  /** Limits per session. */
  limits: SessionLimits;
  /** Allowlist constraints. */
  allow: SessionAllow;
  /** Whether the session is active on creation. Default true. */
  active?: boolean;
}

/** The on-chain policy struct shape (Cairo ordering). */
export interface SessionPolicyCalldata {
  is_active: Felt;            // 0x0 or 0x1
  expires_at: Felt;           // u64 -> felt
  max_calls: Felt;            // u32 -> felt
  calls_used: Felt;           // u32 -> felt (init 0)
  max_value_per_call_low: Felt;
  max_value_per_call_high: Felt;
  // Arrays come separately as (len, items...)
}

/** Returned by SDK when you create a session. */
export interface Session {
  /** Internal id = keyHash felt (same as supplied key or its hash). */
  id: Felt;
  /** Public session key felt (simplified for now). */
  pubkey: Felt;
  /** Policy you requested. */
  policy: SessionPolicyInput;
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

/** Result returned by a sponsored execute path. */
export interface SponsoredExecuteResult {
  txHash: Felt;
  sponsored: boolean;
  sponsorName?: string;
}

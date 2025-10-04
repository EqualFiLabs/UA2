/**
 * Minimal wallet/provider interfaces to avoid taking a runtime dependency
 * on starknet.js. Real adapters can wrap starknet.js accounts later.
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

  /** Disconnect hook (no-op for now, placeholder for future sessions) */
  disconnect(): Promise<void>;
}

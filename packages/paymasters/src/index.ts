export type FeltLike = string | bigint;

export interface AccountCall {
  to: FeltLike;
  selector: FeltLike;
  calldata: FeltLike[];
}

export interface AccountTransaction {
  calls: AccountCall[];
  maxFee?: FeltLike;
}

export interface SponsoredTransaction extends AccountTransaction {
  sponsorData?: FeltLike[];
  sponsorName?: string;
}

export interface Paymaster {
  readonly name: string;
  sponsor(tx: AccountTransaction): Promise<SponsoredTransaction>;
}

export class PaymasterDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymasterDeniedError';
  }
}

export type NoopPaymasterOptions = {
  /** Optional custom identifier for the sponsor. */
  name?: string;
  /** Maximum number of calls allowed per transaction. */
  callCeiling?: number;
  /** Maximum total calldata length (in felts) allowed across the batch. */
  calldataCeiling?: number;
  /** Maximum fee the sponsor is willing to cover. */
  feeCeiling?: FeltLike;
  /** Optional sponsor-provided opaque data. */
  sponsorData?: FeltLike[];
};

const DEFAULT_CALL_CEILING = 16;
const DEFAULT_CALLDATA_CEILING = 4096;
const DEFAULT_FEE_CEILING = BigInt('0x2386f26fc10000'); // 0.01 ETH in wei.

function ensureNonNegativeInteger(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new TypeError(`${name} must be a non-negative integer. Received: ${value}.`);
  }
  return value;
}

function toBigInt(value: FeltLike, label: string): bigint {
  try {
    return typeof value === 'bigint' ? value : BigInt(value);
  } catch (cause) {
    throw new PaymasterDeniedError(`Invalid ${label}: ${String(value)}.`);
  }
}

function formatFelt(value: bigint): string {
  return `0x${value.toString(16)}`;
}

function totalCalldataLength(calls: AccountCall[]): number {
  return calls.reduce((acc, call) => acc + call.calldata.length, 0);
}

export class NoopPaymaster implements Paymaster {
  readonly name: string;

  private readonly callCeiling: number;

  private readonly calldataCeiling: number;

  private readonly feeCeiling: bigint | undefined;

  private readonly sponsorData: FeltLike[] | undefined;

  constructor(options: NoopPaymasterOptions = {}) {
    this.name = options.name ?? 'noop';
    this.callCeiling = ensureNonNegativeInteger(
      options.callCeiling ?? DEFAULT_CALL_CEILING,
      'callCeiling'
    );
    this.calldataCeiling = ensureNonNegativeInteger(
      options.calldataCeiling ?? DEFAULT_CALLDATA_CEILING,
      'calldataCeiling'
    );
    this.feeCeiling = options.feeCeiling !== undefined
      ? toBigInt(options.feeCeiling, 'feeCeiling')
      : DEFAULT_FEE_CEILING;
    this.sponsorData = options.sponsorData;
  }

  async sponsor(tx: AccountTransaction): Promise<SponsoredTransaction> {
    const callCount = tx.calls.length;
    if (callCount > this.callCeiling) {
      throw new PaymasterDeniedError(
        `Call batch size ${callCount} exceeds limit of ${this.callCeiling}.`
      );
    }

    const calldataLength = totalCalldataLength(tx.calls);
    if (calldataLength > this.calldataCeiling) {
      throw new PaymasterDeniedError(
        `Calldata length ${calldataLength} exceeds limit of ${this.calldataCeiling}.`
      );
    }

    let maxFee = tx.maxFee;
    if (this.feeCeiling !== undefined) {
      if (maxFee === undefined) {
        maxFee = formatFelt(this.feeCeiling);
      } else {
        const parsed = toBigInt(maxFee, 'maxFee');
        if (parsed > this.feeCeiling) {
          throw new PaymasterDeniedError(
            `Requested maxFee ${formatFelt(parsed)} exceeds sponsor ceiling ${formatFelt(
              this.feeCeiling
            )}.`
          );
        }
        maxFee = typeof maxFee === 'bigint' ? maxFee : formatFelt(parsed);
      }
    }

    return {
      ...tx,
      maxFee,
      sponsorData: this.sponsorData,
      sponsorName: this.name,
    };
  }
}

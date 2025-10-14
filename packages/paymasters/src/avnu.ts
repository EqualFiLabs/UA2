import type { Account, Call } from "starknet";
import { PaymasterRpc } from "starknet";

/**
 * Minimal AVNU paymaster adapter.
 * Supports:
 *  - 'sponsored' (true gasless)
 *  - 'default' (user pays in gas token like USDC/USDT instead of STRK)
 */
export type AvnuMode = "sponsored" | "default";

export interface AvnuOptions {
  url?: string;          // e.g., 'https://sepolia.paymaster.avnu.fi'
  apiKey?: string;       // optional header
  defaultGasToken?: string; // ERC20 address if using 'default' mode (token fees)
}

export class AvnuPaymaster {
  readonly name = "avnu";
  private rpc: PaymasterRpc;
  private defaultGasToken?: string;

  constructor(opts?: AvnuOptions) {
    this.rpc = new PaymasterRpc({
      nodeUrl: opts?.url ?? "https://sepolia.paymaster.avnu.fi",
      headers: opts?.apiKey ? { "api-key": opts.apiKey } : undefined,
    });
    this.defaultGasToken = opts?.defaultGasToken;
  }

  /**
   * Health check – returns boolean; do not throw.
   */
  async isAvailable(): Promise<boolean> {
    try {
      return await this.rpc.isAvailable();
    } catch {
      return false;
    }
  }

  /**
   * Execute with AVNU sponsorship or token-fee mode.
   * - account: starknet.js Account
   * - calls: array of Calls
   * - mode: 'sponsored' | 'default'
   * - gasToken: ERC20 address for 'default' mode (falls back to defaultGasToken)
   */
  async sponsor(
    account: Account,
    calls: Call[],
    mode: AvnuMode = "sponsored",
    gasToken?: string
  ): Promise<{ transaction_hash: string }> {
    if (mode === "sponsored") {
      // true gasless
      return account.executePaymasterTransaction(calls, {
        feeMode: { mode: "sponsored" },
      });
    } else {
      const token = gasToken ?? this.defaultGasToken;
      if (!token) {
        throw new Error("gasToken is required for 'default' mode");
      }
      // Optionally estimate capped fees in token, then execute
      const feeEst = await account.estimatePaymasterTransactionFee(calls, {
        feeMode: { mode: "default", gasToken: token },
      });
      return account.executePaymasterTransaction(
        calls,
        { feeMode: { mode: "default", gasToken: token } },
        feeEst.suggested_max_fee_in_gas_token
      );
    }
  }
}

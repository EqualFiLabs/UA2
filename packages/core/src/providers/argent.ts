import type { WalletConnector, UA2AccountLike } from '../types';

/**
 * Argent X connector (minimal). We do a soft probe; real integration
 * can wrap starknet.js's injected provider later.
 */
export class ArgentConnector implements WalletConnector {
  readonly id = 'argent';
  readonly label = 'Argent X';

  async isAvailable(opts?: Record<string, unknown>): Promise<boolean> {
    // Soft detection:
    // - window.starknet_argentX (browser)
    // - explicit test hint: opts?.__available === true
    // Since tests run in node, rely on hints.
    if (opts && (opts as any).__available === true) return true;

    // @ts-ignore - window may not exist in Node
    const w = typeof window !== 'undefined' ? (window as any) : undefined;
    return Boolean(w?.starknet_argentX || w?.argentX);
  }

  async connect(opts?: Record<string, unknown>): Promise<UA2AccountLike> {
    // For now, simulate minimal session. Real adapter will request accounts.
    const address =
      (opts && (opts as any).__address) ||
      '0xARGENT_PLACEHOLDER';
    const chainId =
      (opts && (opts as any).__chainId) ||
      '0x5345504f4c4941'; // 'SEPOLIA' bytes as hex-ish placeholder

    return {
      address,
      chainId,
      label: this.label,
    };
  }
}

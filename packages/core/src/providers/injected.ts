import type { WalletConnector, UA2AccountLike } from '../types';

export class InjectedConnector implements WalletConnector {
  readonly id = 'injected';
  readonly label = 'Injected';

  async isAvailable(opts?: Record<string, unknown>): Promise<boolean> {
    if (opts && (opts as any).__available === true) return true;
    // @ts-ignore
    const w = typeof window !== 'undefined' ? (window as any) : undefined;
    return Boolean(w?.starknet || w?.starkware || w?.ethereum);
  }

  async connect(opts?: Record<string, unknown>): Promise<UA2AccountLike> {
    const address =
      (opts && (opts as any).__address) ||
      '0xINJECTED_PLACEHOLDER';
    const chainId =
      (opts && (opts as any).__chainId) ||
      '0x5345504f4c4941';

    return {
      address,
      chainId,
      label: this.label,
    };
  }
}

import type { WalletConnector, UA2AccountLike } from '../types';

export class CartridgeConnector implements WalletConnector {
  readonly id = 'cartridge';
  readonly label = 'Cartridge';

  async isAvailable(opts?: Record<string, unknown>): Promise<boolean> {
    if (opts && (opts as any).__available === true) return true;
    // Cartridge often exposes a Controller; we don't assume globals here.
    return false;
  }

  async connect(opts?: Record<string, unknown>): Promise<UA2AccountLike> {
    const address =
      (opts && (opts as any).__address) ||
      '0xCARTRIDGE_PLACEHOLDER';
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

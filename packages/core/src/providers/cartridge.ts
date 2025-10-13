import type { WalletConnector, UA2AccountLike } from '../types';
import { readBooleanHint, readStringHint, readTransportHint } from './hints';

export class CartridgeConnector implements WalletConnector {
  readonly id = 'cartridge';
  readonly label = 'Cartridge';

  async isAvailable(opts?: Record<string, unknown>): Promise<boolean> {
    if (readBooleanHint(opts, '__available') === true) return true;
    // Cartridge often exposes a Controller; we don't assume globals here.
    return false;
  }

  async connect(opts?: Record<string, unknown>): Promise<UA2AccountLike> {
    const address = readStringHint(opts, '__address') ?? '0xCARTRIDGE_PLACEHOLDER';
    const chainId = readStringHint(opts, '__chainId') ?? '0x5345504f4c4941';

    return {
      address,
      chainId,
      label: this.label,
      transport: readTransportHint(opts, '__transport'),
      ua2Address: readStringHint(opts, '__ua2Address'),
      entrypoint: readStringHint(opts, '__entrypoint'),
    };
  }
}

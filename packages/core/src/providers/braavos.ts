import type { WalletConnector, UA2AccountLike } from '../types';
import { getGlobalObject, readBooleanHint, readStringHint, readTransportHint } from './hints';

export class BraavosConnector implements WalletConnector {
  readonly id = 'braavos';
  readonly label = 'Braavos';

  async isAvailable(opts?: Record<string, unknown>): Promise<boolean> {
    if (readBooleanHint(opts, '__available') === true) return true;
    const w = getGlobalObject();
    return Boolean(w?.starknet_braavos || w?.braavos);
  }

  async connect(opts?: Record<string, unknown>): Promise<UA2AccountLike> {
    const address = readStringHint(opts, '__address') ?? '0xBRAAVOS_PLACEHOLDER';
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

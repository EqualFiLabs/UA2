import type { WalletConnector, UA2AccountLike } from '../types';
import { getGlobalObject, readBooleanHint, readStringHint } from './hints';

export class InjectedConnector implements WalletConnector {
  readonly id = 'injected';
  readonly label = 'Injected';

  async isAvailable(opts?: Record<string, unknown>): Promise<boolean> {
    if (readBooleanHint(opts, '__available') === true) return true;
    const w = getGlobalObject();
    return Boolean(w?.starknet || w?.starkware || w?.ethereum);
  }

  async connect(opts?: Record<string, unknown>): Promise<UA2AccountLike> {
    const address = readStringHint(opts, '__address') ?? '0xINJECTED_PLACEHOLDER';
    const chainId = readStringHint(opts, '__chainId') ?? '0x5345504f4c4941';

    return {
      address,
      chainId,
      label: this.label,
    };
  }
}

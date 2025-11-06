import { Account } from 'starknet';
import type { WalletConnector, UA2AccountLike } from '../types';
import { getGlobalObject, readBooleanHint, readStringHint, readTransportHint } from './hints';

/**
 * Generic injected StarkNet connector backed by starknet.js.
 * Detects window.starknet and uses it to create an account.
 */
export class InjectedConnector implements WalletConnector {
  readonly id = 'injected';
  readonly label = 'Injected';

  async isAvailable(opts?: Record<string, unknown>): Promise<boolean> {
    if (readBooleanHint(opts, '__available') === true) return true;
    const w = getGlobalObject() as any;
    return Boolean(w?.starknet);
  }

  async connect(opts?: Record<string, unknown>): Promise<UA2AccountLike> {
    const hintAddr = readStringHint(opts, '__address');
    if (hintAddr) {
      return {
        address: hintAddr,
        chainId: readStringHint(opts, '__chainId'),
        label: this.label,
        transport: readTransportHint(opts, '__transport'),
        ua2Address: readStringHint(opts, '__ua2Address'),
        entrypoint: readStringHint(opts, '__entrypoint'),
      };
    }
    const w = getGlobalObject() as any;
    const provider = w?.starknet;
    if (!provider) {
      throw new Error('Injected StarkNet provider not found');
    }
    const wallet = await provider.enable();
    const signer = wallet?.account?.signer ?? provider?.signer;
    const account =
      wallet?.account ??
      (signer ? new Account(provider.provider, wallet.selectedAddress, signer) : undefined);
    if (!account) {
      throw new Error('Injected StarkNet account not available');
    }
    const fallbackAddress = wallet?.selectedAddress ?? wallet?.accounts?.[0];
    const address: string = account.address ?? fallbackAddress;
    if (!address) {
      throw new Error('Injected StarkNet address unavailable');
    }
    let chainId: string | undefined;
    try {
      chainId = await provider.provider.getChainId();
    } catch {
      chainId = undefined;
    }
    const transport = {
      async invoke(addr: string, entry: string, calldata: string[]) {
        const { transaction_hash } = await account.execute(
          { contractAddress: addr, entrypoint: entry, calldata },
          { maxFee: undefined }
        );
        return { txHash: transaction_hash as string };
      },
    };
    return {
      address,
      chainId,
      label: this.label,
      transport,
      ua2Address: readStringHint(opts, '__ua2Address'),
      entrypoint: readStringHint(opts, '__entrypoint'),
    };
  }
}

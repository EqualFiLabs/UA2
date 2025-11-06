import { Account } from 'starknet';
import type { WalletConnector, UA2AccountLike } from '../types';
import { getGlobalObject, readBooleanHint, readStringHint, readTransportHint } from './hints';

/**
 * Cartridge connector backed by starknet.js.
 * Attempts to detect a Cartridge provider or falls back to a generic StarkNet provider.
 */
export class CartridgeConnector implements WalletConnector {
  readonly id = 'cartridge';
  readonly label = 'Cartridge';

  async isAvailable(opts?: Record<string, unknown>): Promise<boolean> {
    if (readBooleanHint(opts, '__available') === true) return true;
    const w = getGlobalObject() as any;
    return Boolean(w?.cartridge || w?.starknet);
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
    const provider = w?.cartridge || w?.starknet;
    if (!provider) {
      throw new Error('Cartridge provider not found');
    }
    const wallet = await provider.enable();
    const signer = wallet?.account?.signer ?? provider?.signer;
    const account =
      wallet?.account ??
      (signer ? new Account(provider.provider, wallet.selectedAddress, signer) : undefined);
    if (!account) {
      throw new Error('Cartridge account not available');
    }
    const fallbackAddress = wallet?.selectedAddress ?? wallet?.accounts?.[0];
    const address: string = account.address ?? fallbackAddress;
    if (!address) {
      throw new Error('Cartridge address unavailable');
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

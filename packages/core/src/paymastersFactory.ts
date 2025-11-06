import { PaymasterDeniedError } from './errors';
import { NoopPaymaster, AvnuPaymaster } from './paymasters';
import type { Paymaster } from './types';

class CartridgePaymaster extends NoopPaymaster {
  constructor(tag?: string) {
    super({ name: tag ? `cartridge:${tag}` : 'cartridge' });
  }
}

class StarknetReactPaymaster extends NoopPaymaster {
  constructor(tag?: string) {
    super({ name: tag ? `starknet-react:${tag}` : 'starknet-react' });
  }
}

type PaymasterAdapter = Paymaster | AvnuPaymaster;

function normalizeId(id: string): [string, string | undefined] {
  const [base, ...rest] = id.split(':');
  return [base.toLowerCase(), rest.length > 0 ? rest.join(':') : undefined];
}

export function paymasterFrom(id: string): PaymasterAdapter {
  const trimmed = id.trim();
  if (!trimmed) {
    throw new PaymasterDeniedError('Paymaster id must be a non-empty string.');
  }

  const [base, tag] = normalizeId(trimmed);

  switch (base) {
    case 'noop':
      return new NoopPaymaster({ name: tag ? `noop:${tag}` : 'noop' });
    case 'cartridge':
      return new CartridgePaymaster(tag);
    case 'starknet-react':
      return new StarknetReactPaymaster(tag);
    case 'avnu':
      // Instantiate the Avnu paymaster. Tags are unused for Avnu.
      return new AvnuPaymaster();
    default:
      throw new PaymasterDeniedError(`Unknown paymaster adapter: ${id}`);
  }
}

export const paymasters = {
  from: paymasterFrom,
};

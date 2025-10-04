import type {
  ConnectOptions,
  UA2Client,
  WalletConnector,
  UA2AccountLike,
} from './types';

import { ArgentConnector } from './providers/argent';
import { BraavosConnector } from './providers/braavos';
import { CartridgeConnector } from './providers/cartridge';
import { InjectedConnector } from './providers/injected';
import { makeSessionsManager } from './sessions';

const ALL_CONNECTORS: Record<string, () => WalletConnector> = {
  argent: () => new ArgentConnector(),
  braavos: () => new BraavosConnector(),
  cartridge: () => new CartridgeConnector(),
  injected: () => new InjectedConnector(),
};

function unique<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

/**
 * Try a list of connector ids in order, probing availability and returning the first
 * successful connection. If `fallback` is true, we'll try any other known connectors
 * that are available but not listed in `preferred`.
 */
export async function connect(opts: ConnectOptions): Promise<UA2Client> {
  const preferred = unique(opts.preferred ?? []);
  const hints = opts.hints ?? {};
  const fallback = Boolean(opts.fallback);

  const tried: string[] = [];

  // Try preferred in order
  for (const id of preferred) {
    const ctor = ALL_CONNECTORS[id];
    if (!ctor) continue;
    const c = ctor();
    tried.push(id);
    if (await c.isAvailable(hints[id])) {
      const account = await c.connect(hints[id]);
      return mkClient(c, account);
    }
  }

  // Fallback: try remaining connectors (stable order)
  if (fallback) {
    for (const id of Object.keys(ALL_CONNECTORS)) {
      if (tried.includes(id)) continue;
      const c = ALL_CONNECTORS[id]();
      if (await c.isAvailable(hints[id])) {
        const account = await c.connect(hints[id]);
        return mkClient(c, account);
      }
    }
  }

  const msg =
    preferred.length > 0
      ? `No available wallet connectors. Tried preferred: [${preferred.join(', ')}]${fallback ? ' with fallback' : ''}.`
      : 'No available wallet connectors.';
  throw new Error(msg);
}

function mkClient(
  connector: WalletConnector,
  account: UA2AccountLike
): UA2Client {
  return {
    connectorId: connector.id,
    connectorLabel: connector.label,
    account,
    address: account.address,
    sessions: makeSessionsManager({ account }),
    async disconnect() {
      // No-ops for now; real adapters can tear down sessions if needed.
      return;
    },
  };
}

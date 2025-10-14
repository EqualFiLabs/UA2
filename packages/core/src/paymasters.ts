import { NoopPaymaster } from '@ua2/paymasters';
import { AvnuPaymaster, type AvnuOptions } from '@ua2/paymasters';

export const paymasters = {
  noop: () => new NoopPaymaster(),
  avnu: (opts?: AvnuOptions) => new AvnuPaymaster(opts),
};

export type { AvnuOptions } from '@ua2/paymasters';
export { NoopPaymaster, AvnuPaymaster };

export interface Paymaster<T = unknown> {
  readonly name: string;
  sponsor(tx: T): Promise<T>;
}

export class NoopPaymaster<T = unknown> implements Paymaster<T> {
  readonly name = 'noop';

  async sponsor(tx: T): Promise<T> {
    return tx;
  }
}

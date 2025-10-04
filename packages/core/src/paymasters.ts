import type {
  AccountCall,
  AccountTransaction,
  CallTransport,
  Felt,
  Paymaster,
  SponsoredExecuteResult,
  SponsoredTx,
  UA2AccountLike,
} from './types';
import { toFelt } from './utils/felt';

/**
 * Default No-Op paymaster. Returns the same tx unchanged.
 * Useful for tests or when you want an opt-in toggle with no sponsor.
 */
export class NoopPaymaster implements Paymaster {
  readonly name = 'noop';
  async sponsor(tx: AccountTransaction): Promise<SponsoredTx> {
    return { ...tx, sponsorName: this.name };
  }
}

type WithPaymasterArgs = {
  /** The connected L2 account executing txs. */
  account: UA2AccountLike;
  /** UA² Account contract address to receive the __execute__ (or wrapper) call. */
  ua2Address: Felt;
  /** Transport that actually submits the tx. */
  transport: CallTransport;
  /** Paymaster adapter to use. */
  paymaster: Paymaster;
  /**
   * Optional entrypoint name on the UA² account used to execute calls.
   * For MVP, we keep `'__execute__'` as a placeholder. Adapt as needed.
   */
  entrypoint?: string;
};

/**
 * Wrap a transport with a paymaster: sponsor the tx and then execute it via the UA² account.
 * Returns a small runner with a single `execute()` method.
 */
export function withPaymaster(args: WithPaymasterArgs) {
  const entrypoint = args.entrypoint ?? '__execute__';

  async function execute(calls: AccountCall[] | AccountCall, maxFee?: Felt): Promise<SponsoredExecuteResult> {
    const batch: AccountTransaction = {
      calls: Array.isArray(calls) ? calls : [calls],
      maxFee,
    };

    // 1) Let the paymaster decorate/sponsor the tx
    const sponsored = await args.paymaster.sponsor(batch);

    // 2) Shape calldata for UA² account execution ABI
    //    [ num_calls,
    //      to_0, selector_0, len_0, ...calldata_0,
    //      ...,
    //      sponsor_len, ...sponsorData ]
    const flat: Felt[] = [];
    flat.push(toFelt(sponsored.calls.length));
    for (const c of sponsored.calls) {
      flat.push(
        toFelt(c.to),
        toFelt(c.selector),
        toFelt(c.calldata.length),
        ...c.calldata.map((x) => toFelt(x))
      );
    }
    const sponsorData = sponsored.sponsorData ?? [];
    flat.push(toFelt(sponsorData.length), ...sponsorData.map((x) => toFelt(x)));

    // 3) Invoke the account contract
    const { txHash } = await args.transport.invoke(args.ua2Address, entrypoint, flat);

    return {
      txHash,
      sponsored: sponsorData.length > 0 || !!sponsored.sponsorName || !!sponsored.maxFee,
      sponsorName: sponsored.sponsorName ?? args.paymaster.name,
    };
  }

  return { execute };
}

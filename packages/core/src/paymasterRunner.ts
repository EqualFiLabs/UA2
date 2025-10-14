import type {
  AccountCall,
  AccountTransaction,
  CallTransport,
  Felt,
  Paymaster,
  PaymasterRunner,
  SponsoredExecuteResult,
  UA2AccountLike,
} from './types';
import { toFelt } from './utils/felt';

/**
 * Wrap a transport with a paymaster: sponsor the tx and then execute it via the UA² account.
 * Returns a small runner with a single `execute()` method.
 */
export function withPaymaster(args: {
  account: UA2AccountLike;
  ua2Address: Felt;
  transport: CallTransport;
  paymaster: Paymaster;
  entrypoint?: string;
}): PaymasterRunner {
  const entrypoint = args.entrypoint ?? '__execute__';

  async function execute(calls: AccountCall[] | AccountCall, maxFee?: Felt): Promise<SponsoredExecuteResult> {
    const batch: AccountTransaction = {
      calls: Array.isArray(calls) ? calls : [calls],
      maxFee,
    };

    // 1) Let the paymaster decorate/sponsor the tx
    const sponsored = await args.paymaster.sponsor(batch);

    // 2) Shape calldata for UA² account execution ABI
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

  async function call(
    to: Felt,
    selector: Felt,
    calldata: Felt[] = [],
    maxFee?: Felt
  ): Promise<SponsoredExecuteResult> {
    const callObj: AccountCall = { to, selector, calldata };
    return execute(callObj, maxFee);
  }

  return { execute, call, paymaster: args.paymaster };
}

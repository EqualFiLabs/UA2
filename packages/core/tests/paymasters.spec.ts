import { describe, it, expect } from 'vitest';
import { withPaymaster } from '../src/paymasterRunner';
import { NoopPaymaster } from '../src/paymasters';
import { paymasterFrom } from '../src/paymastersFactory';
import { PaymasterDeniedError } from '../src/errors';
import type {
  AccountCall,
  AccountTransaction,
  CallTransport,
  Felt,
  Paymaster,
  SponsoredTx,
  UA2AccountLike,
} from '../src/types';

function mkFakeTransport() {
  const sent: { addr: string; entry: string; data: string[] }[] = [];
  const transport: CallTransport = {
    async invoke(address, entrypoint, calldata) {
      sent.push({ addr: address, entry: entrypoint, data: [...calldata] });
      return { txHash: ('0x' + (sent.length + 0x1000).toString(16)) as Felt };
    },
  };
  return { transport, sent };
}

describe('paymasters', () => {
  const ua2Address = '0xACC0';
  const account: UA2AccountLike = { address: ua2Address, chainId: '0xSEPOLIA', label: 'test' };

  it('executes with NoopPaymaster and shapes calldata', async () => {
    const { transport, sent } = mkFakeTransport();
    const pm = new NoopPaymaster();
    const runner = withPaymaster({ account, ua2Address, transport, paymaster: pm });

    const call: AccountCall = {
      to: '0xDEAD',
      selector: '0x1234',
      calldata: ['0xAA', '0xBB'],
    };

    const res = await runner.execute(call);
    expect(res.txHash).toMatch(/^0x/);
    expect(res.sponsored).toBe(true);
    expect(res.sponsorName).toBe('noop');

    const resViaCall = await runner.call('0xDEAD', '0x1234', ['0xAA', '0xBB']);
    expect(resViaCall.txHash).toMatch(/^0x/);
    expect(runner.paymaster.name).toBe('noop');

    expect(sent.length).toBe(2);
    const last = sent[sent.length - 1];
    expect(last.addr).toBe(ua2Address);
    expect(last.entry).toBe('__execute__');
    expect(last.data).toEqual(['0x1', '0xdead', '0x1234', '0x2', '0xaa', '0xbb', '0x0']);
  });

  it('custom paymaster injects sponsorData and maxFee', async () => {
    const { transport, sent } = mkFakeTransport();

    const custom: Paymaster = {
      name: 'test-sponsor',
      async sponsor(tx: AccountTransaction): Promise<SponsoredTx> {
        return {
          ...tx,
          maxFee: '0x123',
          sponsorData: ['0xCAFE', '0xBEEF'],
          sponsorName: 'test-sponsor',
        };
      },
    };

    const runner = withPaymaster({ account, ua2Address, transport, paymaster: custom });

    const calls: AccountCall[] = [
      { to: '0x1', selector: '0x2', calldata: [] },
      { to: '0x3', selector: '0x4', calldata: ['0x7'] },
    ];

    const res = await runner.execute(calls, '0x999');
    expect(res.sponsored).toBe(true);
    expect(res.sponsorName).toBe('test-sponsor');

    const last = sent[sent.length - 1];
    expect(last.data.slice(-3)).toEqual(['0x2', '0xcafe', '0xbeef']);
  });

  it('marks execution as unsponsored when paymaster adds no metadata', async () => {
    const { transport, sent } = mkFakeTransport();

    const silent: Paymaster = {
      name: 'empty',
      async sponsor(tx: AccountTransaction): Promise<SponsoredTx> {
        return { ...tx };
      },
    };

    const runner = withPaymaster({ account, ua2Address, transport, paymaster: silent });
    const res = await runner.execute({ to: '0x1', selector: '0x2', calldata: [] });

    expect(res.sponsored).toBe(false);
    expect(res.sponsorName).toBe('empty');
    expect(sent.length).toBe(1);
    expect(sent[0].data.slice(-1)[0]).toBe('0x0');
  });

  it('propagates sponsor rejections with documented error', async () => {
    const { transport, sent } = mkFakeTransport();
    const expected = new PaymasterDeniedError('sponsor offline');

    const failing: Paymaster = {
      name: 'fail',
      async sponsor(): Promise<SponsoredTx> {
        throw expected;
      },
    };

    const runner = withPaymaster({ account, ua2Address, transport, paymaster: failing });

    await expect(
      runner.execute({ to: '0x1', selector: '0x2', calldata: [] })
    ).rejects.toBe(expected);
    expect(sent.length).toBe(0);
  });

  it('paymaster factory returns adapters and errors for unknown ids', async () => {
    const noop = paymasterFrom('noop:test');
    const sponsored = await noop.sponsor({ calls: [], maxFee: undefined });
    expect(noop.name).toBe('noop:test');
    expect(sponsored.sponsorName).toBe('noop:test');

    const cartridge = paymasterFrom('cartridge');
    expect(cartridge.name).toBe('cartridge');

    const starknetReact = paymasterFrom('starknet-react:demo');
    expect(starknetReact.name).toBe('starknet-react:demo');

    expect(() => paymasterFrom('unknown')).toThrow(PaymasterDeniedError);
  });
});

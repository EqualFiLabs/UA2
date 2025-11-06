import { describe, it, expect } from 'vitest';
import { makeSessionsManager, sessions } from '../src/sessions';

describe('Sessions manager with on-chain calls', () => {
  it('invokes add_session_with_allowlists and revoke_session via transport', async () => {
    const sent: { addr: string; entry: string; data: string[] }[] = [];
    const transport = {
      async invoke(addr: string, entry: string, data: string[]) {
        sent.push({ addr, entry, data });
        return { txHash: '0xTX' };
      },
    };
    const manager = makeSessionsManager({
      account: { address: '0xACC', chainId: '0xSEPOLIA', label: 'test', transport, ua2Address: '0xACC' },
      transport,
      ua2Address: '0xACC',
    });

    const policy = sessions.guard().build();
    const s = await manager.create(policy);
    expect(sent.length).toBe(1);
    expect(sent[0].entry).toBe('add_session_with_allowlists');

    await manager.revoke(s.id);
    expect(sent.length).toBe(2);
    expect(sent[1].entry).toBe('revoke_session');
  });
});

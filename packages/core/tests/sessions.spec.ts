import { describe, it, expect } from 'vitest';
import { connect } from '../src/connect';
import { limits } from '../src/sessions';
import type { ConnectOptions, SessionPolicyInput } from '../src/types';
import { toUint256 } from '../src/utils/u256';

describe('Sessions API', () => {
  const baseOpts: ConnectOptions = {
    preferred: ['argent'],
    hints: {
      argent: { __available: true, __address: '0xACC', __chainId: '0xSEPOLIA' }
    }
  };

  it('creates a session with correct policy shaping', async () => {
    const client = await connect(baseOpts);

    const pol: SessionPolicyInput = {
      expiresAt: 1_700_000_000, // seconds
      limits: limits(10, '10000000000000000'), // 0.01 ETH-ish
      allow: {
        targets: ['0xDEAD', '0xBEEF'],
        selectors: ['0x1234', '0x5678']
      },
      active: true
    };

    const session = await client.sessions.create(pol);
    expect(session.id).toMatch(/^0x[0-9a-f]+$/i);
    expect(session.pubkey).toMatch(/^0x[0-9a-f]+$/i);
    expect(session.policy.limits.maxCalls).toBe(10);

    const u = toUint256('10000000000000000');
    expect(pol.limits.maxValuePerCall[0]).toBe(u[0]);
    expect(pol.limits.maxValuePerCall[1]).toBe(u[1]);

    const list = await client.sessions.list();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(session.id);
  });

  it('revokes a session locally (active=false)', async () => {
    const client = await connect(baseOpts);

    const s = await client.sessions.create({
      expiresAt: 1_800_000_000,
      limits: limits(1, 0),
      allow: { targets: [], selectors: [] },
      active: true
    });

    await client.sessions.revoke(s.id);
    const list = await client.sessions.list();
    expect(list[0].policy.active).toBe(false);
  });
});

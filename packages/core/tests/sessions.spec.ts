import { describe, it, expect } from 'vitest';
import { connect } from '../src/connect';
import { limits, guard, useSession } from '../src/sessions';
import type { ConnectOptions, SessionPolicyInput, AccountCall } from '../src/types';
import { PolicyViolationError, SessionExpiredError } from '../src/errors';
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

  it('useSession validates active policy and throws on violations', async () => {
    const client = await connect(baseOpts);

    const allowedCall: AccountCall = {
      to: '0xDEAD',
      selector: '0x1234',
      calldata: [],
    };

    const policy = guard({
      targets: [allowedCall.to],
      selectors: [allowedCall.selector],
      maxCalls: 2,
      expiresInSeconds: 3600,
    }).build();

    const session = await client.sessions.create(policy);
    const usage = await useSession(client.sessions, session.id);
    expect(usage.session.id).toBe(session.id);

    expect(() => usage.ensureAllowed(allowedCall)).not.toThrow();
    expect(() =>
      usage.ensureAllowed({ ...allowedCall, to: '0xBEEF' })
    ).toThrowError(PolicyViolationError);

    await client.sessions.revoke(session.id);
    await expect(useSession(client.sessions, session.id)).rejects.toBeInstanceOf(SessionExpiredError);

    const expired = await client.sessions.create({
      expiresAt: Math.floor(Date.now() / 1000) - 1,
      limits: limits(1, 0),
      allow: { targets: [], selectors: [] },
      active: true,
    });

    await expect(useSession(client.sessions, expired.id)).rejects.toBeInstanceOf(SessionExpiredError);
  });

  it('guard builder shapes policies with defaults', () => {
    const policy = guard({ maxValue: '10', expiresInSeconds: 10 })
      .target('0x1')
      .selector('0x2')
      .build();

    expect(policy.allow.targets).toContain('0x1');
    expect(policy.allow.selectors).toContain('0x2');
    expect(policy.limits.maxCalls).toBeGreaterThanOrEqual(1);
    expect(policy.limits.maxValuePerCall[0]).toBeDefined();
    expect(policy.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});

import { describe, it, expect } from 'vitest';
import { connect } from '../src/connect';
import { limits, guard, useSession, makeSessionsManager } from '../src/sessions';
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
      validAfter: 0,
      validUntil: 1_700_000_000, // seconds
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

  it('encodes allowlist calldata when transport is available', async () => {
    const sent: { addr: string; entry: string; data: string[] }[] = [];
    const transport = {
      async invoke(addr: string, entry: string, data: string[]) {
        sent.push({ addr, entry, data: [...data] });
        return { txHash: '0x777' as const };
      },
    };

    const manager = makeSessionsManager({
      account: { address: '0xACC', chainId: '0xSEPOLIA', label: 'test' },
      transport,
      ua2Address: '0xacc0',
    });

    const policy: SessionPolicyInput = {
      validAfter: 0,
      validUntil: 1_888_888_888,
      limits: limits(3, '0x10'),
      allow: {
        targets: ['0xDEAD', '0xBEEF'],
        selectors: ['0xCAFE'],
      },
      active: true,
    };

    await manager.create(policy);

    expect(sent.length).toBe(1);
    const call = sent[0];
    expect(call.addr).toBe('0xacc0');
    expect(call.entry).toBe('add_session_with_allowlists');

    const data = call.data;
    expect(data[1]).toBe('0x1'); // active flag
    expect(data.slice(1, 8)).toEqual([
      '0x1',
      '0x0',
      '0x70962838',
      '0x3',
      '0x0',
      '0x10',
      '0x0',
    ]);
    expect(data[8]).toBe('0x2');
    expect(data.slice(9, 11)).toEqual(['0xdead', '0xbeef']);
    expect(data[11]).toBe('0x1');
    expect(data[12]).toBe('0xcafe');
  });

  it('revokes a session locally (active=false)', async () => {
    const client = await connect(baseOpts);

    const s = await client.sessions.create({
      validAfter: 0,
      validUntil: 1_800_000_000,
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
    const usage = await client.sessions.use(session.id);
    expect(usage.session.id).toBe(session.id);

    expect(() => usage.ensureAllowed(allowedCall)).not.toThrow();
    usage.session.policy.callsUsed = usage.session.policy.limits.maxCalls;
    expect(() => usage.ensureAllowed(allowedCall)).toThrowError(PolicyViolationError);
    usage.session.policy.callsUsed = 0;
    expect(() =>
      usage.ensureAllowed({ ...allowedCall, to: '0xBEEF' })
    ).toThrowError(PolicyViolationError);

    await client.sessions.revoke(session.id);
    await expect(useSession(client.sessions, session.id)).rejects.toBeInstanceOf(SessionExpiredError);

    const expired = await client.sessions.create({
      validAfter: 0,
      validUntil: Math.floor(Date.now() / 1000) - 1,
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
    expect(policy.validUntil).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });
});

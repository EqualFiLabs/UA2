import { describe, expect, it } from 'vitest';
import { connect, UA2 } from '../src/index.js';

describe('index exports', () => {
  it('exposes connect function', () => {
    expect(typeof connect).toBe('function');
  });

  it('exposes UA2 helpers', () => {
    expect(typeof UA2.connect).toBe('function');
    expect(typeof UA2.paymasters.noop).toBe('function');
    expect(typeof UA2.paymasters.avnu).toBe('function');
    expect(typeof UA2.sessions.guard).toBe('function');
  });
});

import { describe, expect, it } from 'vitest';
import { connect } from '../src/index.js';

describe('index exports', () => {
  it('exposes connect function', () => {
    expect(typeof connect).toBe('function');
  });
});

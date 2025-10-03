import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDummy } from '../src/index.js';

describe('useDummy', () => {
  it('returns a stable dummy object', () => {
    const { result, rerender } = renderHook(() => useDummy());

    expect(result.current).toEqual({ ok: true });
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

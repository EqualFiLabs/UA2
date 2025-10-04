/**
 * Felt helpers (string hex normalization).
 */

import type { Felt } from '../types';

export function toFelt(x: number | bigint | string): Felt {
  if (typeof x === 'number') return ('0x' + BigInt(x).toString(16)) as Felt;
  if (typeof x === 'bigint') return ('0x' + x.toString(16)) as Felt;
  const s = x.toLowerCase();
  return s.startsWith('0x') ? (s as Felt) : (('0x' + BigInt(s).toString(16)) as Felt);
}

/** Left-pad a felt hex (no 0x stripping) to even length (nibbles). */
export function hexPadFelt(h: Felt): Felt {
  let s = h.startsWith('0x') ? h.slice(2) : h;
  if (s.length % 2 === 1) s = '0' + s;
  return ('0x' + s) as Felt;
}

/**
 * Minimal Uint256 helpers — encode a decimal/hex string into [low, high] felts.
 */

import type { Uint256, Felt } from '../types';

function bigIntFrom(value: string | number | bigint): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  const s = value.toString().toLowerCase();
  return s.startsWith('0x') ? BigInt(s) : BigInt(s);
}

export function toUint256(value: string | number | bigint): Uint256 {
  const v = bigIntFrom(value);
  const mask = (1n << 128n) - 1n;
  const low = v & mask;
  const high = v >> 128n;
  const lowHex = '0x' + low.toString(16);
  const highHex = '0x' + high.toString(16);
  return [lowHex, highHex] as const;
}

export function uint256ToHexParts(u: Uint256): { low: Felt; high: Felt } {
  return { low: u[0], high: u[1] };
}

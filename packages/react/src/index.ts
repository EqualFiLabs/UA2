import { useMemo } from 'react';

export interface UseDummyResult {
  ok: boolean;
}

export function useDummy(): UseDummyResult {
  return useMemo(() => ({ ok: true }), []);
}

import type { CallTransport } from '../types';

type HintRecord = Record<string, unknown> | undefined;

export type BooleanHintKey = '__available';
export type StringHintKey = '__address' | '__chainId' | '__ua2Address' | '__entrypoint';
export type TransportHintKey = '__transport';

export function readBooleanHint(opts: HintRecord, key: BooleanHintKey): boolean | undefined {
  const value = opts?.[key];
  return typeof value === 'boolean' ? value : undefined;
}

export function readStringHint(opts: HintRecord, key: StringHintKey): string | undefined {
  const value = opts?.[key];
  return typeof value === 'string' ? value : undefined;
}

export function readTransportHint(opts: HintRecord, key: TransportHintKey): CallTransport | undefined {
  const value = opts?.[key];
  if (!value || typeof value !== 'object') return undefined;
  const maybe = value as CallTransport;
  return typeof maybe.invoke === 'function' ? maybe : undefined;
}

export function getGlobalObject(): Record<string, unknown> | undefined {
  if (typeof globalThis === 'undefined') return undefined;

  const scope = globalThis as Record<string, unknown>;
  const maybeWindow = scope.window;

  if (maybeWindow && typeof maybeWindow === 'object') {
    return maybeWindow as Record<string, unknown>;
  }

  return scope;
}

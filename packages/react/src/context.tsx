import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { connect as ua2Connect, type ConnectOptions, type UA2Client } from '@ua2/core';

export type UA2Status = 'idle' | 'connecting' | 'ready' | 'error';

export interface UA2ContextValue {
  status: UA2Status;
  client: UA2Client | null;
  error: Error | null;
  connect: (opts: ConnectOptions) => Promise<UA2Client>;
  disconnect: () => Promise<void>;
}

const UA2Context = createContext<UA2ContextValue | null>(null);

interface ProviderProps {
  children: ReactNode;
}

export function UA2Provider({ children }: ProviderProps): JSX.Element {
  const [status, setStatus] = useState<UA2Status>('idle');
  const [client, setClient] = useState<UA2Client | null>(null);
  const [error, setError] = useState<Error | null>(null);

  const connect = useCallback(async (opts: ConnectOptions) => {
    setStatus('connecting');
    setError(null);
    try {
      const next = await ua2Connect(opts);
      setClient(next);
      setStatus('ready');
      return next;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setError(error);
      setStatus('error');
      throw error;
    }
  }, []);

  const disconnect = useCallback(async () => {
    const current = client;
    if (!current) {
      setStatus('idle');
      setError(null);
      return;
    }

    try {
      await current.disconnect();
      setClient(null);
      setStatus('idle');
      setError(null);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      setClient(null);
      setStatus('error');
      setError(error);
      throw error;
    }
  }, [client]);

  const value = useMemo<UA2ContextValue>(
    () => ({ status, client, error, connect, disconnect }),
    [status, client, error, connect, disconnect]
  );

  return <UA2Context.Provider value={value}>{children}</UA2Context.Provider>;
}

export function useUA2(): UA2ContextValue {
  const ctx = useContext(UA2Context);
  if (!ctx) {
    throw new Error('useUA2 must be used within a <UA2Provider>');
  }
  return ctx;
}

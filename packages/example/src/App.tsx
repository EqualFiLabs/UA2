import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  UA2Provider,
  useUA2,
  useSessions,
  type Session,
  type UA2Client,
  type SessionPolicyInput,
} from '@ua2/react';
import { limits, toFelt, NoopPaymaster, type Felt } from '@ua2/core';

type HintsRecord = Record<string, Record<string, unknown>>;

type SessionWorkspaceProps = {
  client: UA2Client;
};

type SessionListProps = {
  sessions: Session[];
  revoke: (id: Felt) => Promise<void>;
  refresh: () => Promise<Session[]>;
  client: UA2Client;
};

type SessionUsagePanelProps = {
  sessions: Session[];
  client: UA2Client;
};

type PaymasterControlsProps = {
  client: UA2Client;
};

type GuardianControlsProps = {
  client: UA2Client;
};

const cardClass = 'card';
const sectionTitleClass = 'section-title';
const sectionDescriptionClass = 'section-description';
const labelClass = 'form-label';
const inputClass = 'form-input';
const textareaClass = 'form-textarea';
const selectClass = 'form-select';
const checkboxClass = 'form-checkbox';
const primaryButtonClass = 'button button-primary';
const secondaryButtonClass = 'button button-secondary';
const pillClass = 'pill';

function parsePreferred(input: string): string[] {
  return input
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function parseHints(input: string): HintsRecord {
  if (!input.trim()) return {};
  const parsed = JSON.parse(input);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Hints must be a JSON object keyed by connector id.');
  }
  return parsed as HintsRecord;
}

function StatusCard(): JSX.Element {
  const { status, error, client } = useUA2();
  const address = client?.address;

  const statusTone =
    status === 'ready'
      ? 'pill--ready'
      : status === 'connecting'
        ? 'pill--connecting'
        : 'pill--idle';

  return (
    <section className={`${cardClass} stack stack-xl`} aria-live="polite">
      <div className="status-header">
        <h2 className={sectionTitleClass}>UA² Status</h2>
        <span className={`${pillClass} ${statusTone}`}>{status}</span>
      </div>
      <div className="stack stack-sm text-small text-muted">
        {address ? (
          <p className="text-success text-medium">Connected address: {address}</p>
        ) : (
          <p>Connect a wallet to explore the session playground.</p>
        )}
        {error ? (
          <p role="alert" className="text-small text-strong text-error">
            Last error: {error.message}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function ConnectPanel(): JSX.Element {
  const { status, connect, disconnect, client } = useUA2();
  const [preferred, setPreferred] = useState('injected');
  const [fallback, setFallback] = useState(true);
  const [hintsText, setHintsText] = useState(
    JSON.stringify(
      {
        injected: {
          __available: true,
        },
      },
      null,
      2,
    ),
  );
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [hintError, setHintError] = useState<string | null>(null);

  async function handleConnect(evt: FormEvent<HTMLFormElement>): Promise<void> {
    evt.preventDefault();
    setHintError(null);
    setFeedback(null);
    const preferredList = parsePreferred(preferred);
    try {
      const hints = parseHints(hintsText);
      setBusy(true);
      await connect({
        preferred: preferredList.length > 0 ? preferredList : ['injected'],
        fallback,
        hints,
      });
      setFeedback('Wallet connected successfully.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('Hints')) {
        setHintError(message);
      } else {
        setFeedback(`Connect failed: ${message}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect(): Promise<void> {
    setBusy(true);
    setFeedback(null);
    try {
      await disconnect();
      setFeedback('Disconnected.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setFeedback(`Disconnect failed: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`${cardClass} stack stack-xxl`}>
      <div>
        <h2 className={sectionTitleClass}>Wallet connection</h2>
        <p className={sectionDescriptionClass}>
          Provide connector preferences and optional hints. The playground defaults to the injected connector and
          marks it as available so scripted demos can wire up custom transports.
        </p>
      </div>
      <form className="stack stack-xxl" onSubmit={handleConnect}>
        <div className="stack stack-lg">
          <div className="stack stack-sm">
            <label className={labelClass} htmlFor="preferred-connectors">
              Preferred connectors (comma separated)
            </label>
            <input
              className={inputClass}
              id="preferred-connectors"
              value={preferred}
              onChange={(event) => setPreferred(event.target.value)}
              placeholder="injected,argent"
            />
          </div>
          <div className="stack stack-sm">
            <label className={labelClass} htmlFor="hints-json">
              Connector hints (JSON)
            </label>
            <textarea
              className={textareaClass}
              id="hints-json"
              value={hintsText}
              onChange={(event) => setHintsText(event.target.value)}
            />
            {hintError ? (
              <p role="alert" className="text-small text-medium text-error">
                {hintError}
              </p>
            ) : null}
          </div>
        </div>
        <label className="checkbox-row">
          <input
            className={checkboxClass}
            type="checkbox"
            checked={fallback}
            onChange={(event) => setFallback(event.target.checked)}
          />
          Allow fallback to any available connector
        </label>
        <div className="button-group">
          <button className={primaryButtonClass} type="submit" disabled={busy || status === 'connecting'}>
            {busy && status !== 'ready' ? 'Connecting…' : 'Connect'}
          </button>
          <button className={secondaryButtonClass} type="button" onClick={handleDisconnect} disabled={busy || !client}>
            Disconnect
          </button>
        </div>
      </form>
      {feedback ? (
        <p aria-live="polite" className="text-small text-medium text-success">
          {feedback}
        </p>
      ) : null}
    </section>
  );
}

type SessionCreateFormProps = {
  create: (policy: SessionPolicyInput) => Promise<Session>;
  isReady: boolean;
};

function SessionCreateForm({ create, isReady }: SessionCreateFormProps): JSX.Element {
  const [target, setTarget] = useState('');
  const [selector, setSelector] = useState('');
  const [maxCalls, setMaxCalls] = useState('5');
  const [maxValue, setMaxValue] = useState('1000000000000000');
  const [expiresMinutes, setExpiresMinutes] = useState('120');
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(evt: FormEvent<HTMLFormElement>): Promise<void> {
    evt.preventDefault();
    if (!isReady) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const parsedMaxCalls = Number(maxCalls);
      if (!Number.isFinite(parsedMaxCalls) || parsedMaxCalls <= 0) {
        throw new Error('Max calls must be a positive number.');
      }
      const parsedExpires = Number(expiresMinutes);
      if (!Number.isFinite(parsedExpires) || parsedExpires <= 0) {
        throw new Error('Expiry must be a positive number of minutes.');
      }
      const maxValueBigInt = BigInt(maxValue);
      const validAfter = Math.floor(Date.now() / 1000);
      const policy = {
        validAfter,
        validUntil: validAfter + parsedExpires * 60,
        limits: limits(parsedMaxCalls, maxValueBigInt),
        allow: {
          targets: target.trim() ? [target.trim()] : [],
          selectors: selector.trim() ? [selector.trim()] : [],
        },
        active,
      };
      const created = await create(policy);
      setMessage(`Session created: ${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack stack-xxl section-divider" onSubmit={handleSubmit}>
      <div>
        <h3 className="section-heading">Create session</h3>
      </div>
      <div className="form-grid">
        <div className="stack stack-sm">
          <label className={labelClass} htmlFor="session-target">
            Allowed target (felt hex)
          </label>
          <input
            className={inputClass}
            id="session-target"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
            placeholder="0x..."
          />
        </div>
        <div className="stack stack-sm">
          <label className={labelClass} htmlFor="session-selector">
            Allowed selector (felt hex)
          </label>
          <input
            className={inputClass}
            id="session-selector"
            value={selector}
            onChange={(event) => setSelector(event.target.value)}
            placeholder="0x..."
          />
        </div>
        <div className="stack stack-sm">
          <label className={labelClass} htmlFor="session-max-calls">
            Max calls
          </label>
          <input
            className={inputClass}
            id="session-max-calls"
            type="number"
            min={1}
            value={maxCalls}
            onChange={(event) => setMaxCalls(event.target.value)}
          />
        </div>
        <div className="stack stack-sm">
          <label className={labelClass} htmlFor="session-max-value">
            Max value per call (wei)
          </label>
          <input
            className={inputClass}
            id="session-max-value"
            value={maxValue}
            onChange={(event) => setMaxValue(event.target.value)}
          />
        </div>
        <div className="stack stack-sm">
          <label className={labelClass} htmlFor="session-expiry">
            Expires in (minutes)
          </label>
          <input
            className={inputClass}
            id="session-expiry"
            type="number"
            min={1}
            value={expiresMinutes}
            onChange={(event) => setExpiresMinutes(event.target.value)}
          />
        </div>
        <label className="checkbox-row">
          <input
            className={checkboxClass}
            type="checkbox"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
          />
          Start active
        </label>
      </div>
      <button className={primaryButtonClass} type="submit" disabled={!isReady || busy}>
        {busy ? 'Creating…' : 'Create session'}
      </button>
      {message ? (
        <p aria-live="polite" className="text-small text-medium text-success">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-small text-strong text-error">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function SessionList({ sessions, revoke, refresh, client }: SessionListProps): JSX.Element {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const transport = client.account.transport;
  const ua2Address = client.account.ua2Address ?? client.address;

  async function handleRefresh(): Promise<void> {
    setMessage(null);
    setError(null);
    try {
      await refresh();
      setMessage('Sessions refreshed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRevoke(session: Session): Promise<void> {
    if (!transport) {
      setError('Connected wallet does not expose a transport capable of revoking sessions.');
      return;
    }
    setBusyId(session.id);
    setMessage(null);
    setError(null);
    try {
      await transport.invoke(ua2Address, 'revoke_session', [session.id]);
      await revoke(session.id);
      setMessage(`Session revoked: ${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="stack stack-lg">
      <div className="section-header">
        <h3 className="section-heading">Known sessions</h3>
        <button className={secondaryButtonClass} type="button" onClick={handleRefresh}>
          Refresh
        </button>
      </div>
      {sessions.length === 0 ? (
        <p className="text-small text-muted">No sessions created yet.</p>
      ) : (
        <ul className="stack stack-md">
          {sessions.map((session) => (
            <li
              key={session.id}
              className="session-item"
            >
              <div className="session-item__header">
                <strong className="text-success text-strong">{session.id}</strong>
                <span className="meta-text">
                  status: {session.policy.active === false ? 'inactive' : 'active'}
                </span>
              </div>
              <div className="session-note">
                Expires at: {session.policy.validUntil} · Max calls: {session.policy.limits.maxCalls}
              </div>
              <button
                className={`${secondaryButtonClass} session-item__action`}
                type="button"
                onClick={() => void handleRevoke(session)}
                disabled={busyId === session.id}
              >
                {busyId === session.id ? 'Revoking…' : 'Revoke session'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {message ? (
        <p aria-live="polite" className="text-small text-medium text-success">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-small text-strong text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function SessionUsagePanel({ sessions, client }: SessionUsagePanelProps): JSX.Element {
  const transport = client.account.transport;
  const ua2Address = client.account.ua2Address ?? client.address;
  const [sessionId, setSessionId] = useState<string>('');
  const [callsUsed, setCallsUsed] = useState('0');
  const [callsToUse, setCallsToUse] = useState('1');
  const [nonce, setNonce] = useState('0');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (sessions.length === 0) {
      setSessionId('');
      return;
    }
    if (!sessions.some((session) => session.id === sessionId)) {
      setSessionId(sessions[0].id);
    }
  }, [sessions, sessionId]);

  async function handleApply(evt: FormEvent<HTMLFormElement>): Promise<void> {
    evt.preventDefault();
    if (!transport) {
      setError('Connected wallet does not expose a transport capable of applying usage.');
      return;
    }
    if (!sessionId) {
      setError('Select a session to apply usage.');
      return;
    }

    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const used = BigInt(callsUsed || '0');
      const delta = BigInt(callsToUse || '0');
      const nonceValue = BigInt(nonce || '0');
      const calldata = [sessionId, toFelt(used), toFelt(delta), toFelt(nonceValue)];
      const result = await transport.invoke(ua2Address, 'apply_session_usage', calldata);
      setMessage(`Usage applied. Tx hash: ${result.txHash}`);
      setCallsUsed((prev) => (BigInt(prev || '0') + delta).toString());
      setNonce((prev) => (BigInt(prev || '0') + 1n).toString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (sessions.length === 0) {
    return (
      <section className="empty-state">
        <h3 className="section-subheading">Apply usage</h3>
        <p className="spacer-sm">Create a session to enable usage tracking.</p>
      </section>
    );
  }

  return (
    <section className="stack stack-xl">
      <h3 className="section-heading">Apply usage</h3>
      <form className="stack stack-xxl" onSubmit={handleApply}>
        <div className="form-grid">
          <div className="stack stack-sm">
            <label className={labelClass} htmlFor="usage-session">
              Session
            </label>
            <select
              className={selectClass}
              id="usage-session"
              value={sessionId}
              onChange={(event) => setSessionId(event.target.value)}
            >
              <option value="" disabled>
                Select session
              </option>
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.id}
                </option>
              ))}
            </select>
          </div>
          <div className="stack stack-sm">
            <label className={labelClass} htmlFor="usage-used">
              Calls used
            </label>
            <input
              className={inputClass}
              id="usage-used"
              type="number"
              min={0}
              value={callsUsed}
              onChange={(event) => setCallsUsed(event.target.value)}
            />
          </div>
          <div className="stack stack-sm">
            <label className={labelClass} htmlFor="usage-delta">
              Calls to apply
            </label>
            <input
              className={inputClass}
              id="usage-delta"
              type="number"
              min={0}
              value={callsToUse}
              onChange={(event) => setCallsToUse(event.target.value)}
            />
          </div>
          <div className="stack stack-sm">
            <label className={labelClass} htmlFor="usage-nonce">
              Nonce
            </label>
            <input
              className={inputClass}
              id="usage-nonce"
              type="number"
              min={0}
              value={nonce}
              onChange={(event) => setNonce(event.target.value)}
            />
          </div>
        </div>
        <button className={primaryButtonClass} type="submit" disabled={busy}>
          {busy ? 'Submitting…' : 'Apply session usage'}
        </button>
      </form>
      {message ? (
        <p aria-live="polite" className="text-small text-medium text-success">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-small text-strong text-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function SessionWorkspace({ client }: SessionWorkspaceProps): JSX.Element {
  const { sessions, create, revoke, refresh, isReady } = useSessions();

  return (
    <section className={`${cardClass} stack stack-xxxl span-two`}>
      <div>
        <h2 className={sectionTitleClass}>Sessions</h2>
        <p className={sectionDescriptionClass}>
          Create short-lived session keys and apply usage to test policy limits. These controls mirror the E2E scripts so you
          can exercise the happy path, policy violations, and revocation flows directly from the browser.
        </p>
      </div>
      <SessionCreateForm create={create} isReady={isReady} />
      <SessionList sessions={sessions} revoke={revoke} refresh={refresh} client={client} />
      <SessionUsagePanel sessions={sessions} client={client} />
    </section>
  );
}

function PaymasterControls({ client }: PaymasterControlsProps): JSX.Element {
  const transport = client.account.transport;
  const ua2Address = client.account.ua2Address ?? client.address;
  const entrypoint = client.account.entrypoint ?? '__execute__';
  const [useSponsor, setUseSponsor] = useState(false);
  const [contractAddress, setContractAddress] = useState('');
  const [selector, setSelector] = useState('');
  const [calldata, setCalldata] = useState('');
  const [maxFee, setMaxFee] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const paymaster = useMemo(
    () => new NoopPaymaster({ name: useSponsor ? 'demo-sponsor' : 'direct' }),
    [useSponsor]
  );

  const paymasterRunner = useMemo(() => {
    if (!transport) return null;
    return client.withPaymaster(paymaster, { ua2Address, transport, entrypoint });
  }, [client, paymaster, transport, ua2Address, entrypoint]);

  function parseCalldata(input: string): Felt[] {
    if (!input.trim()) return [];
    return input
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
      .map((value) => toFelt(value));
  }

  async function handleSubmit(evt: FormEvent<HTMLFormElement>): Promise<void> {
    evt.preventDefault();
    if (!transport) {
      setError('Connected wallet does not expose a transport.');
      return;
    }
    if (!contractAddress.trim() || !selector.trim()) {
      setError('Provide both a target contract and selector.');
      return;
    }

    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const call = {
        to: toFelt(contractAddress.trim()),
        selector: toFelt(selector.trim()),
        calldata: parseCalldata(calldata),
      };
      if (useSponsor) {
        if (!paymasterRunner) {
          throw new Error('Paymaster runner unavailable.');
        }
        const maxFeeFelt = maxFee.trim() ? toFelt(maxFee.trim()) : undefined;
        const result = await paymasterRunner.execute(call, maxFeeFelt);
        setMessage(
          `Sponsored execute via ${result.sponsorName ?? paymaster.name}. Tx hash: ${result.txHash}. Sponsored: ${result.sponsored ? 'yes' : 'no'}`,
        );
      } else {
        const flattened: Felt[] = [
          toFelt(1),
          call.to,
          call.selector,
          toFelt(call.calldata.length),
          ...call.calldata,
          toFelt(0),
        ];
        const result = await transport.invoke(ua2Address, entrypoint, flattened);
        setMessage(`Direct execute sent. Tx hash: ${result.txHash}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!transport) {
    return (
      <section className={`${cardClass} stack stack-lg`}>
        <h2 className={sectionTitleClass}>Paymaster execution</h2>
        <p className={sectionDescriptionClass}>
          Your connector must expose a transport to demonstrate sponsored calls.
        </p>
      </section>
    );
  }

  return (
    <section className={`${cardClass} stack stack-xxl`}>
      <div>
        <h2 className={sectionTitleClass}>Paymaster execution</h2>
        <p className={sectionDescriptionClass}>
          Toggle between direct execution and sponsored calls. Sponsored mode uses the UA² paymaster runner and reports sponsor
          metadata from the configured adapter.
        </p>
      </div>
      <form className="stack stack-xxl" onSubmit={handleSubmit}>
        <div className="form-grid">
          <div className="stack stack-sm">
            <label className={labelClass} htmlFor="paymaster-to">
              Target contract
            </label>
            <input
              className={inputClass}
              id="paymaster-to"
              value={contractAddress}
              onChange={(event) => setContractAddress(event.target.value)}
              placeholder="0x..."
            />
          </div>
          <div className="stack stack-sm">
            <label className={labelClass} htmlFor="paymaster-selector">
              Selector
            </label>
            <input
              className={inputClass}
              id="paymaster-selector"
              value={selector}
              onChange={(event) => setSelector(event.target.value)}
              placeholder="0x..."
            />
          </div>
          <div className="stack stack-sm">
            <label className={labelClass} htmlFor="paymaster-calldata">
              Calldata (comma separated)
            </label>
            <input
              className={inputClass}
              id="paymaster-calldata"
              value={calldata}
              onChange={(event) => setCalldata(event.target.value)}
              placeholder="0x1,0x2"
            />
          </div>
          <div className="stack stack-sm">
            <label className={labelClass} htmlFor="paymaster-maxfee">
              Max fee (optional)
            </label>
            <input
              className={inputClass}
              id="paymaster-maxfee"
              value={maxFee}
              onChange={(event) => setMaxFee(event.target.value)}
              placeholder="0x0"
            />
          </div>
        </div>
        <label className="checkbox-row">
          <input
            className={checkboxClass}
            type="checkbox"
            checked={useSponsor}
            onChange={(event) => setUseSponsor(event.target.checked)}
          />
          Use paymaster sponsorship
        </label>
        <button className={primaryButtonClass} type="submit" disabled={busy}>
          {busy ? 'Submitting…' : 'Execute call'}
        </button>
      </form>
      {message ? (
        <p aria-live="polite" className="text-small text-medium text-success">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-small text-strong text-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function GuardianControls({ client }: GuardianControlsProps): JSX.Element {
  const transport = client.account.transport;
  const ua2Address = client.account.ua2Address ?? client.address;
  const [guardianAddress, setGuardianAddress] = useState('');
  const [threshold, setThreshold] = useState('1');
  const [recoveryDelay, setRecoveryDelay] = useState('0');
  const [recoveryTarget, setRecoveryTarget] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function invoke(entrypoint: string, calldata: Felt[]): Promise<void> {
    if (!transport) {
      throw new Error('Connected wallet does not expose a transport for guardian actions.');
    }
    await transport.invoke(ua2Address, entrypoint, calldata);
  }

  async function handleAction(
    action: 'add' | 'remove' | 'threshold' | 'delay' | 'propose' | 'confirm' | 'execute' | 'rotate',
  ) {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      switch (action) {
        case 'add':
          if (!guardianAddress.trim()) {
            throw new Error('Guardian address is required.');
          }
          await invoke('add_guardian', [toFelt(guardianAddress.trim())]);
          setMessage('Guardian added.');
          break;
        case 'remove':
          if (!guardianAddress.trim()) {
            throw new Error('Guardian address is required.');
          }
          await invoke('remove_guardian', [toFelt(guardianAddress.trim())]);
          setMessage('Guardian removed.');
          break;
        case 'threshold': {
          const numericThreshold = Number(threshold);
          if (!Number.isFinite(numericThreshold) || numericThreshold <= 0) {
            throw new Error('Guardian threshold must be a positive number.');
          }
          await invoke('set_guardian_threshold', [toFelt(numericThreshold)]);
          setMessage('Guardian threshold updated.');
          break;
        }
        case 'delay': {
          const numericDelay = Number(recoveryDelay);
          if (!Number.isFinite(numericDelay) || numericDelay < 0) {
            throw new Error('Recovery delay must be zero or positive.');
          }
          await invoke('set_recovery_delay', [toFelt(numericDelay)]);
          setMessage('Recovery delay updated.');
          break;
        }
        case 'propose':
          if (!recoveryTarget.trim()) {
            throw new Error('Recovery target is required.');
          }
          await invoke('propose_recovery', [toFelt(recoveryTarget.trim())]);
          setMessage('Recovery proposed.');
          break;
        case 'confirm':
          if (!recoveryTarget.trim()) {
            throw new Error('Recovery target is required.');
          }
          await invoke('confirm_recovery', [toFelt(recoveryTarget.trim())]);
          setMessage('Recovery confirmed.');
          break;
        case 'execute':
          await invoke('execute_recovery', []);
          setMessage('Recovery executed.');
          break;
        case 'rotate':
          if (!recoveryTarget.trim()) {
            throw new Error('Recovery target is required.');
          }
          await invoke('rotate_owner', [toFelt(recoveryTarget.trim())]);
          setMessage('Owner rotated.');
          break;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!transport) {
    return (
      <section className={`${cardClass} stack stack-lg`}>
        <h2 className={sectionTitleClass}>Guardian recovery</h2>
        <p className={sectionDescriptionClass}>
          Your connector must supply a transport to drive guardian recovery flows.
        </p>
      </section>
    );
  }

  return (
    <section className={`${cardClass} stack stack-xxl`}>
      <div>
        <h2 className={sectionTitleClass}>Guardian recovery</h2>
        <p className={sectionDescriptionClass}>
          Manage guardians, thresholds, and execute recovery steps. The workflow mirrors the E2E suite that adds a guardian,
          configures policies, proposes recovery, and rotates the owner back.
        </p>
      </div>
      <div className="form-grid">
        <div className="stack stack-sm">
          <label className={labelClass} htmlFor="guardian-address">
            Guardian address
          </label>
          <input
            className={inputClass}
            id="guardian-address"
            value={guardianAddress}
            onChange={(event) => setGuardianAddress(event.target.value)}
            placeholder="0x..."
          />
        </div>
        <div className="stack stack-sm">
          <label className={labelClass} htmlFor="guardian-threshold">
            Guardian threshold
          </label>
          <input
            className={inputClass}
            id="guardian-threshold"
            type="number"
            min={1}
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
          />
        </div>
        <div className="stack stack-sm">
          <label className={labelClass} htmlFor="guardian-delay">
            Recovery delay (seconds)
          </label>
          <input
            className={inputClass}
            id="guardian-delay"
            type="number"
            min={0}
            value={recoveryDelay}
            onChange={(event) => setRecoveryDelay(event.target.value)}
          />
        </div>
        <div className="stack stack-sm">
          <label className={labelClass} htmlFor="guardian-target">
            Recovery target / new owner
          </label>
          <input
            className={inputClass}
            id="guardian-target"
            value={recoveryTarget}
            onChange={(event) => setRecoveryTarget(event.target.value)}
            placeholder="0x..."
          />
        </div>
      </div>
      <div className="button-group">
        <button className={secondaryButtonClass} type="button" disabled={busy} onClick={() => void handleAction('add')}>
          Add guardian
        </button>
        <button className={secondaryButtonClass} type="button" disabled={busy} onClick={() => void handleAction('remove')}>
          Remove guardian
        </button>
        <button className={secondaryButtonClass} type="button" disabled={busy} onClick={() => void handleAction('threshold')}>
          Set threshold
        </button>
        <button className={secondaryButtonClass} type="button" disabled={busy} onClick={() => void handleAction('delay')}>
          Set recovery delay
        </button>
        <button className={secondaryButtonClass} type="button" disabled={busy} onClick={() => void handleAction('propose')}>
          Propose recovery
        </button>
        <button className={secondaryButtonClass} type="button" disabled={busy} onClick={() => void handleAction('confirm')}>
          Confirm recovery
        </button>
        <button className={secondaryButtonClass} type="button" disabled={busy} onClick={() => void handleAction('execute')}>
          Execute recovery
        </button>
        <button className={secondaryButtonClass} type="button" disabled={busy} onClick={() => void handleAction('rotate')}>
          Rotate owner
        </button>
      </div>
      {message ? (
        <p aria-live="polite" className="text-small text-medium text-success">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-small text-strong text-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function DemoWorkspace(): JSX.Element {
  const { status, client } = useUA2();

  return (
    <div className="workspace-grid">
      <StatusCard />
      <ConnectPanel />
      {status === 'ready' && client ? (
        <>
          <SessionWorkspace client={client} />
          <PaymasterControls client={client} />
          <GuardianControls client={client} />
        </>
      ) : (
        <section className={`${cardClass} stack stack-lg span-two`}>
          <h2 className={sectionTitleClass}>Getting started</h2>
          <p className={sectionDescriptionClass}>
            Connect a wallet to unlock the session manager, paymaster playground, and guardian workflows.
          </p>
        </section>
      )}
    </div>
  );
}

function App(): JSX.Element {
  return (
    <main className="app-shell">
      <div className="app-ambient app-ambient--gradient" />
      <div className="app-ambient app-ambient--glow" aria-hidden>
        <div className="app-ambient__orb app-ambient__orb--emerald" />
        <div className="app-ambient__orb app-ambient__orb--sky" />
      </div>
      <div className="app-shell__content">
        <header className="hero-intro">
          <span className="hero-badge">
            UA² Playground
          </span>
          <h1 className="hero-title">
            Session-aware wallet orchestration made tangible.
          </h1>
          <p className="hero-subtitle">
            Explore connection flows, session policies, sponsored execution, and guardian recovery in a single immersive demo
            experience. Every control maps to an end-to-end test so you can rehearse complex scenarios with confidence.
          </p>
        </header>
        <UA2Provider>
          <DemoWorkspace />
        </UA2Provider>
        <footer className="app-footer">
          Hand-tuned dark theme · No utility framework required · Optimized for rapid experimentation.
        </footer>
      </div>
    </main>
  );
}

export default App;

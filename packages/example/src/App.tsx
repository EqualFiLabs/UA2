import { UA2Provider, useUA2 } from '@ua2/react';

function StatusCard(): JSX.Element {
  const { status, error } = useUA2();

  return (
    <section style={{ border: '1px solid #ccc', borderRadius: '8px', padding: '1rem' }}>
      <h2>UA² Status</h2>
      <p>Connection state: {status}</p>
      {error ? <p style={{ color: 'crimson' }}>Last error: {error.message}</p> : null}
    </section>
  );
}

function App(): JSX.Element {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', margin: '2rem', maxWidth: '32rem' }}>
      <h1>UA² SDK Demo</h1>
      <p>
        This minimal example shows the <code>UA2Provider</code> and <code>useUA2</code> hook in read-only
        mode. Integrate wallet connectors by calling <code>connect()</code> with your preferred options.
      </p>
      <UA2Provider>
        <StatusCard />
      </UA2Provider>
    </main>
  );
}

export default App;

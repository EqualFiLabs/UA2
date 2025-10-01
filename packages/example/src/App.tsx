import { version } from '@ua2/core';
import { useDummy } from '@ua2/react';

function App(): JSX.Element {
  const dummy = useDummy();

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', margin: '2rem' }}>
      <h1>UA² SDK Demo</h1>
      <p>Core SDK version: {version()}</p>
      <p>Dummy hook status: {dummy.ok ? 'ready' : 'unknown'}</p>
    </main>
  );
}

export default App;

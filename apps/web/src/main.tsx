import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WEB_TITLE } from './index.ts';
import { ImportClient } from './import/client.ts';
import type { ImportSnapshot } from './import/client.ts';
import './style.css';

function App() {
  const client = useRef<ImportClient | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [state, setState] = useState<ImportSnapshot | null>(null);
  useEffect(() => {
    const current = new ImportClient();
    client.current = current;
    window.socialprune = { getImportSnapshot: () => current.snapshot };
    const unsubscribe = current.subscribe(setState);
    return () => {
      unsubscribe();
      current.dispose();
      client.current = null;
    };
  }, []);
  const busy = state?.phase === 'importing' || state?.phase === 'aborting';
  // German and English strings arrive with the Phase 2b review UI.
  return (
    <main>
      <h1>{WEB_TITLE}</h1>
      <p>
        Import ZIP files from your platform data export. Files stay on this
        device.
      </p>
      <p>
        This early version reads exports only. It does not mark or delete posts.
      </p>
      <label htmlFor="archives">Export ZIP files</label>
      <input
        id="archives"
        type="file"
        accept=".zip,application/zip"
        multiple
        disabled={busy}
        onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
      />
      <div className="actions">
        <button
          type="button"
          disabled={!state || busy || !files.length}
          onClick={() => client.current?.start(files)}
        >
          Import
        </button>
        <button
          type="button"
          disabled={state?.phase !== 'importing'}
          onClick={() => client.current?.abort()}
        >
          Abort
        </button>
      </div>
      <p
        role="status"
        data-testid="import-state"
        data-phase={state?.phase ?? 'idle'}
      >
        {state?.phase ?? 'idle'}: {state?.receivedItems ?? 0} items received
      </p>
      {state?.message && <p role="alert">{state.message}</p>}
      {state?.phase === 'aborted' && (
        <p>The import was aborted. Its partial items were discarded.</p>
      )}
      {state?.summary && (
        <section aria-label="Import summary">
          <h2>Import result: {state.summary.status}</h2>
          {state.summary.records.map((record) => (
            <section key={record.id}>
              <h3>
                {record.platform}: {record.itemCount} items
              </h3>
              <ul>
                {record.accounts.map((account) => (
                  <li key={account.key}>
                    {account.handle ?? account.key}:{' '}
                    {
                      state.items.filter(
                        (item) =>
                          item.platform === record.platform &&
                          item.account.key === account.key,
                      ).length
                    }{' '}
                    items
                  </li>
                ))}
              </ul>
              <ul>
                {record.diagnostics.map((diagnostic, index) => (
                  <li key={index}>
                    {diagnostic.category}: {diagnostic.status} (
                    {diagnostic.count})
                    {diagnostic.message ? `, ${diagnostic.message}` : ''}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </section>
      )}
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

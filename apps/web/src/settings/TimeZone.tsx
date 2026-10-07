import { useEffect, useState } from 'react';
import type { WorkspaceClient } from '../workspace/client.ts';
import { useT } from '../i18n/index.ts';
import styles from '../app/Shell.module.css';

const zones = [
  ...new Set(['UTC', ...Intl.supportedValuesOf('timeZone')]),
].sort();
export function TimeZone({
  client,
  value,
  onChanged,
}: {
  client: WorkspaceClient;
  value: string | null;
  onChanged: (value: string | null) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(
    value ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(false),
    [saved, setSaved] = useState(false);
  useEffect(
    () =>
      setSelected(value ?? Intl.DateTimeFormat().resolvedOptions().timeZone),
    [value],
  );
  async function change(zone: string | null) {
    setBusy(true);
    setError(false);
    setSaved(false);
    try {
      const reply = await client.request({
        type: 'setTimeZone',
        requestId: crypto.randomUUID(),
        timeZone: zone,
      });
      if (reply.type !== 'settingsChanged')
        throw new Error('Time-zone setting failed.');
      onChanged(reply.timeZone);
      setSelected(
        reply.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
      setSaved(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  const matching = zones.filter((zone) =>
    zone.toLowerCase().includes(query.toLowerCase()),
  );
  const visible = matching.includes(selected)
    ? matching
    : [selected, ...matching];
  return (
    <section aria-label={t('settings.timeZone')}>
      <p>
        {t(value ? 'settings.zoneChosen' : 'settings.zoneBrowser', {
          zone: value ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        })}
      </p>
      <label className={styles.field}>
        {t('settings.searchZones')}
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <label className={styles.field}>
        {t('settings.timeZone')}
        <select
          value={selected}
          disabled={busy}
          onChange={(event) => {
            setSelected(event.target.value);
            setSaved(false);
          }}
        >
          {visible.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </label>
      <div className={styles.actions}>
        <button
          disabled={busy}
          onClick={() => {
            void change(selected);
          }}
        >
          {t('settings.saveZone')}
        </button>
        <button
          disabled={busy}
          onClick={() => {
            void change(null);
          }}
        >
          {t('settings.browserZone')}
        </button>
      </div>
      {saved && <p role="status">{t('settings.zoneSaved')}</p>}
      {error && <p role="alert">{t('workspace.storageError')}</p>}
    </section>
  );
}

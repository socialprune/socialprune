import { useEffect, useState } from 'react';
import { backupParts } from '@socialprune/core/workspace/backup';
import type { WorkspaceSummary } from '@socialprune/core/workspace/protocol';
import type { WorkspaceClient } from '../workspace/client.ts';
import { useT } from '../i18n/index.ts';
import { useIntl } from 'react-intl';
import styles from '../app/Shell.module.css';

interface RestorePreview {
  name: string;
  items: number;
  decisions: number;
  outcomes: number;
  assessments: number;
  accounts: string[];
  kind: string;
  schema: number;
}
async function preview(file: File): Promise<RestorePreview> {
  const reader = file.stream().getReader();
  async function* chunks() {
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) return;
        yield part.value;
      }
    } finally {
      reader.releaseLock();
    }
  }
  const accounts = new Set<string>();
  const result: RestorePreview = {
    name: file.name,
    items: 0,
    decisions: 0,
    outcomes: 0,
    assessments: 0,
    accounts: [],
    kind: 'personal',
    schema: 0,
  };
  for await (const part of backupParts(chunks())) {
    if (part.type === 'header' && part.name === 'kind')
      result.kind = String(part.value);
    if (part.type === 'header' && part.name === 'schemaVersion')
      result.schema = Number(part.value);
    if (part.type !== 'record') continue;
    if (part.name === 'items') {
      result.items++;
      const value = part.value as { account?: { key?: string } };
      if (value.account?.key) accounts.add(value.account.key);
    }
    if (part.name === 'decisionEvents') result.decisions++;
    if (part.name === 'outcomeEvents') result.outcomes++;
    if (part.name === 'assessments') result.assessments++;
  }
  result.accounts = [...accounts];
  return result;
}
export function Backup({
  client,
  onRestored,
}: {
  client: WorkspaceClient;
  onRestored?: () => void;
}) {
  const t = useT(),
    intl = useIntl();
  const [summary, setSummary] = useState<WorkspaceSummary | null>(
    client.summary,
  );
  const [file, setFile] = useState<File | null>(null);
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(
    null,
  );
  const [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false),
    [status, setStatus] = useState('');
  const [backupAge, setBackupAge] = useState<number | null>(null);
  useEffect(() => {
    void client
      .open()
      .then(async (reply) => {
        if (reply.type !== 'opened') {
          setFailed(true);
          return;
        }
        setSummary(reply.summary);
        const history = await client.request({
          type: 'history',
          requestId: crypto.randomUUID(),
          limit: 200,
        });
        if (history.type === 'historyEntries')
          setBackupAge(
            history.entries.filter(
              ({ time }) =>
                !reply.summary.lastBackupAt ||
                time > reply.summary.lastBackupAt,
            ).length,
          );
      })
      .catch(() => setFailed(true));
  }, [client]);
  async function download() {
    setBusy(true);
    setFailed(false);
    setStatus('');
    try {
      await client.downloadBackup();
      const reply = await client.open();
      if (reply.type === 'opened') setSummary(reply.summary);
      setBackupAge(0);
      setStatus(t('backup.saved'));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  async function choose(value: File | null) {
    setFile(value);
    setRestorePreview(null);
    setStatus('');
    setFailed(false);
    if (!value) return;
    setBusy(true);
    try {
      setRestorePreview(await preview(value));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  async function restore() {
    if (!file || !restorePreview) return;
    setBusy(true);
    setFailed(false);
    try {
      await client.flushCommands();
      const reply = await client.request({
        type: 'restore',
        requestId: crypto.randomUUID(),
        file,
      });
      if (reply.type !== 'opened') throw new Error('Restore failed.');
      setSummary(reply.summary);
      setFile(null);
      setRestorePreview(null);
      setStatus(t('backup.restored'));
      onRestored?.();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label={t('backup.title')}>
      <p>{t('backup.description')}</p>
      <p>{t('backup.cleared')}</p>
      <p>
        {summary?.lastBackupAt
          ? t('backup.last', {
              date: intl.formatDate(summary.lastBackupAt, {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
            })
          : t('backup.never')}
      </p>
      <p>{t('backup.warning')}</p>
      {backupAge !== null && backupAge > 0 && (
        <p>{t('backup.changesSince', { count: backupAge })}</p>
      )}
      <button
        disabled={busy}
        onClick={() => {
          void download();
        }}
      >
        {t('workspace.backup')}
      </button>
      <h2>{t('backup.restoreTitle')}</h2>
      <p>{t('backup.restoreDescription')}</p>
      <label className={styles.field}>
        {t('backup.file')}
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={(event) => {
            void choose(event.target.files?.[0] ?? null);
          }}
        />
      </label>
      {restorePreview && (
        <div className={styles.panel}>
          <h3>{t('backup.preview')}</h3>
          <p>{restorePreview.name}</p>
          <p>
            {t('backup.previewCounts', {
              items: restorePreview.items,
              decisions: restorePreview.decisions,
              outcomes: restorePreview.outcomes,
              assessments: restorePreview.assessments,
              accounts: restorePreview.accounts.length,
            })}
          </p>
          <p>
            {t('backup.previewKind', {
              kind: restorePreview.kind,
              version: restorePreview.schema,
            })}
          </p>
          <p>{t('backup.replaceNotice')}</p>
          <div className={styles.actions}>
            <button
              disabled={busy}
              onClick={() => {
                void restore();
              }}
            >
              {t('backup.confirm')}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setFile(null);
                setRestorePreview(null);
              }}
            >
              {t('bulk.cancel')}
            </button>
          </div>
        </div>
      )}
      {busy && <p role="status">{t('backup.working')}</p>}
      {status && <p role="status">{status}</p>}
      {failed && <p role="alert">{t('backup.failed')}</p>}
    </section>
  );
}

import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import { useT } from '../i18n/index.ts';
import type { Locale } from '../i18n/index.ts';
import type { WorkspaceClient } from '../workspace/client.ts';
import type {
  WorkspaceSummary,
  WorkspaceNotification,
} from '@socialprune/core/workspace/protocol';
import { buildId } from 'virtual:sp-build-info';
import { version } from '../../package.json';
import styles from '../app/Shell.module.css';
import { TimeZone } from './TimeZone.tsx';
import { Dialog } from '@base-ui/react/dialog';
import reviewStyles from '../review/Review.module.css';

export function Settings({
  client,
  locale,
  changeLocale,
  onDeleted,
  beforeDelete,
}: {
  client: WorkspaceClient;
  locale: Locale;
  changeLocale: (locale: Locale) => void;
  onDeleted?: () => void;
  beforeDelete?: () => Promise<void>;
}) {
  const t = useT(),
    intl = useIntl();
  const [summary, setSummary] = useState<WorkspaceSummary | null>(
    client.summary,
  );
  const [storage, setStorage] = useState<Extract<
    WorkspaceNotification,
    { type: 'storageState' }
  > | null>(client.storage);
  const [theme, setTheme] = useState(
    document.documentElement.dataset.theme ?? 'system',
  );
  const [density, setDensity] = useState(
    document.documentElement.dataset.density ?? 'comfortable',
  );
  const [singleKeys, setSingleKeys] = useState(
    localStorage.getItem('sp-single-keys') !== 'off',
  );
  const [busy, setBusy] = useState(false),
    [persistMessage, setPersistMessage] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false),
    [deleteError, setDeleteError] = useState(false),
    [backedUp, setBackedUp] = useState(false);
  useEffect(() => {
    const unsubscribe = client.subscribe((message) => {
      if (message.type === 'storageState') setStorage(message);
    });
    void client
      .open()
      .then((reply) => {
        if (reply.type === 'opened') setSummary(reply.summary);
        else setDeleteError(true);
      })
      .catch(() => setDeleteError(true));
    return unsubscribe;
  }, [client]);
  async function persist() {
    setBusy(true);
    try {
      const allowed = await client.requestPersistentStorage();
      setPersistMessage(
        t(allowed ? 'settings.persistAllowed' : 'settings.persistDenied'),
      );
      await client.request({
        type: 'revision',
        requestId: crypto.randomUUID(),
      });
    } catch {
      setPersistMessage(t('settings.persistDenied'));
    } finally {
      setBusy(false);
    }
  }
  async function backupFirst() {
    setBusy(true);
    try {
      await client.downloadBackup();
      setBackedUp(true);
    } catch {
      setDeleteError(true);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!summary) return;
    setBusy(true);
    setDeleteError(false);
    try {
      await beforeDelete?.();
      await client.flushCommands();
      const reply = await client.request({
        type: 'deleteWorkspace',
        requestId: crypto.randomUUID(),
        workspaceId: summary.workspaceId,
      });
      if (reply.type !== 'workspaceDeleted')
        throw new Error('Workspace deletion failed.');
      setDeleteOpen(false);
      setSummary(null);
      onDeleted?.();
      location.hash = '#/';
    } catch {
      setDeleteError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label={t('nav.settings')}>
      <label className={styles.field}>
        {t('settings.language')}
        <select
          value={locale}
          onChange={(event) => changeLocale(event.target.value as Locale)}
        >
          <option value="en" lang="en">
            English
          </option>
          <option value="de" lang="de">
            Deutsch
          </option>
        </select>
      </label>
      <label className={styles.field}>
        {t('settings.appearance')}
        <select
          value={theme}
          onChange={(event) => {
            const value = event.target.value;
            setTheme(value);
            if (value === 'system')
              delete document.documentElement.dataset.theme;
            else document.documentElement.dataset.theme = value;
            localStorage.setItem('sp-theme', value);
          }}
        >
          <option value="system">{t('settings.system')}</option>
          <option value="light">{t('settings.light')}</option>
          <option value="dark">{t('settings.dark')}</option>
        </select>
      </label>
      <label className={styles.field}>
        {t('settings.density')}
        <select
          value={density}
          onChange={(event) => {
            const value = event.target.value;
            setDensity(value);
            document.documentElement.dataset.density = value;
            localStorage.setItem('sp-density', value);
          }}
        >
          <option value="comfortable">{t('settings.comfortable')}</option>
          <option value="compact">{t('settings.compact')}</option>
        </select>
      </label>
      <label className={styles.field}>
        {t('review.singleKeys')}
        <select
          value={singleKeys ? 'on' : 'off'}
          onChange={(event) => {
            const enabled = event.target.value === 'on';
            setSingleKeys(enabled);
            localStorage.setItem('sp-single-keys', enabled ? 'on' : 'off');
          }}
        >
          <option value="on">{t('review.on')}</option>
          <option value="off">{t('review.off')}</option>
        </select>
      </label>
      <h2>{t('settings.timeZone')}</h2>
      {summary && (
        <TimeZone
          client={client}
          value={summary.timeZone}
          onChanged={(timeZone) =>
            setSummary((value) => (value ? { ...value, timeZone } : null))
          }
        />
      )}
      <h2>{t('settings.storage')}</h2>
      {storage && (
        <>
          <p>
            {t('settings.storageUsage', {
              usage: intl.formatNumber(storage.usage / 1024 ** 2, {
                maximumFractionDigits: 1,
              }),
              quota: intl.formatNumber(storage.quota / 1024 ** 2, {
                maximumFractionDigits: 1,
              }),
            })}
          </p>
          <p>
            {t(
              storage.persisted
                ? 'settings.persisted'
                : 'settings.notPersisted',
            )}
          </p>
        </>
      )}
      {deleteError && !deleteOpen && (
        <p role="alert">{t('workspace.storageError')}</p>
      )}
      <button
        disabled={busy}
        onClick={() => {
          void persist();
        }}
      >
        {t('settings.persistAction')}
      </button>
      {persistMessage && <p role="status">{persistMessage}</p>}
      <p>{t('backup.cleared')}</p>
      <a href="#/backup">{t('workspace.backup')}</a>
      <h2>{t('settings.deleteTitle')}</h2>
      <button disabled={!summary || busy} onClick={() => setDeleteOpen(true)}>
        {t('settings.deleteTitle')}
      </button>
      <h2>{t('settings.version')}</h2>
      <p>{version}</p>
      <p>{t('settings.build', { id: buildId })}</p>
      <Dialog.Root open={deleteOpen} onOpenChange={setDeleteOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className={reviewStyles.backdrop} />
          <Dialog.Popup className={reviewStyles.dialog}>
            <Dialog.Title>{t('settings.deleteTitle')}</Dialog.Title>
            <Dialog.Description>
              {t('settings.deleteDescription')}
            </Dialog.Description>
            <button
              disabled={busy}
              onClick={() => {
                void backupFirst();
              }}
            >
              {t('settings.backupFirst')}
            </button>
            {backedUp && <p role="status">{t('backup.saved')}</p>}
            <div className={styles.actions}>
              <button
                disabled={busy}
                onClick={() => {
                  void remove();
                }}
              >
                {t('settings.confirmDelete')}
              </button>
              <Dialog.Close disabled={busy}>{t('bulk.cancel')}</Dialog.Close>
            </div>
            {deleteError && <p role="alert">{t('workspace.storageError')}</p>}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}

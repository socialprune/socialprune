import { useEffect, useState } from 'react';
import type {
  DesktopBridge,
  DesktopDataFolder,
} from '@socialprune/core/workspace/desktop-protocol';
import { useT } from '../i18n/index.ts';
import { command } from './bridge.ts';
import styles from './Desktop.module.css';
import { folderMessages } from './messages.ts';
import { DataRemoval } from './DataRemoval.tsx';

export function DesktopSettings({
  bridge,
  restored,
  failed,
}: {
  bridge: DesktopBridge;
  restored: () => void;
  failed: (error: unknown) => void;
}) {
  const t = useT();
  const [folder, setFolder] = useState<DesktopDataFolder | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    void command(bridge, { type: 'dataFolderInfo' })
      .then((reply) => {
        if (active && reply.type === 'dataFolderInfo') setFolder(reply.folder);
      })
      .catch(failed);
    return () => {
      active = false;
    };
  }, [bridge, failed]);
  async function backup(type: 'backupExport' | 'backupRestore') {
    setBusy(true);
    try {
      const reply =
        type === 'backupExport'
          ? await command(bridge, { type })
          : await command(bridge, { type });
      if (reply.type !== 'backupExported' && reply.type !== 'backupRestored')
        return;
      if (reply.result.status === 'cancelled')
        setNotice(t('desktop.cancelled'));
      else if (reply.result.status === 'exported')
        setNotice(
          t('desktop.backupExported', {
            bytes: reply.result.bytes,
            files: reply.result.mediaFiles,
          }),
        );
      else {
        setNotice(t('desktop.backupRestored', { items: reply.result.items }));
        restored();
      }
    } catch (error) {
      failed(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={styles.panel} data-testid="desktop-settings">
      <h2>{t('desktop.folder')}</h2>
      {folder ? (
        <>
          <p data-testid="data-folder">{folder.path}</p>
          <p>
            {t(folder.storeBuild ? 'desktop.storeNote' : 'desktop.directNote')}
          </p>
          <dl>
            {folder.folders.map(({ kind, bytes }) => (
              <div key={kind}>
                <dt>{t(folderMessages[kind])}</dt>
                <dd>{t('desktop.bytes', { bytes })}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p>{t('gate.preparing')}</p>
      )}
      <div className={styles.actions}>
        <button
          onClick={() => {
            void command(bridge, { type: 'dataFolderOpen' }).catch(failed);
          }}
        >
          {t('desktop.folderOpen')}
        </button>
        <button
          disabled={busy}
          onClick={() => {
            void backup('backupExport');
          }}
        >
          {t('desktop.backupExport')}
        </button>
        <button
          disabled={busy}
          onClick={() => {
            void backup('backupRestore');
          }}
        >
          {t('desktop.backupRestore')}
        </button>
      </div>
      <p role="status">{busy ? t('desktop.busy') : notice}</p>
      <DataRemoval />
    </section>
  );
}

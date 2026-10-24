import { useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { useT } from '../i18n/index.ts';
import {
  DATA_REMOVAL_REPLY_EVENT,
  DATA_REMOVAL_REQUEST_EVENT,
  DataRemovalReplySchema,
} from '../../../desktop/src/data-removal-protocol.ts';
import type {
  DataRemovalReply,
  DataRemovalRequest,
} from '../../../desktop/src/data-removal-protocol.ts';
import styles from './Desktop.module.css';
import { folderMessages } from './messages.ts';

export function DataRemoval() {
  const t = useT(),
    intl = useIntl();
  const [reply, setReply] = useState<DataRemovalReply | null>(null);
  const [signedOut, setSignedOut] = useState(false),
    [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<string | null>(null);
  const locale = intl.locale === 'de' ? 'de' : 'en';
  const required = locale === 'de' ? 'ENTFERNEN' : 'REMOVE';
  useEffect(() => {
    const receive = (event: Event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== 'string')
        return;
      try {
        const result = DataRemovalReplySchema.safeParse(
          JSON.parse(event.detail),
        );
        if (!result.success || result.data.id !== pending.current) return;
        pending.current = null;
        setBusy(false);
        setReply(result.data);
      } catch {
        /* Untrusted events never grant file capabilities. */
      }
    };
    window.addEventListener(DATA_REMOVAL_REPLY_EVENT, receive);
    return () => window.removeEventListener(DATA_REMOVAL_REPLY_EVENT, receive);
  }, []);
  const send = (request: DataRemovalRequest) => {
    pending.current = request.id;
    setBusy(true);
    window.dispatchEvent(
      new CustomEvent(DATA_REMOVAL_REQUEST_EVENT, {
        detail: JSON.stringify(request),
      }),
    );
  };
  return (
    <section className={styles.panel} aria-label={t('desktop.removal.title')}>
      <h2>{t('desktop.removal.title')}</h2>
      <p>{t('desktop.removal.warning')}</p>
      <button
        disabled={busy}
        onClick={() => {
          setSignedOut(false);
          setPhrase('');
          send({ type: 'preview', id: crypto.randomUUID() });
        }}
      >
        {t('desktop.removal.preview')}
      </button>
      {reply?.type === 'failed' && (
        <p role="alert">
          {t(
            reply.code === 'busy'
              ? 'desktop.removal.busy'
              : reply.code === 'stale'
                ? 'desktop.removal.stale'
                : 'desktop.removal.failed',
          )}
        </p>
      )}
      {reply?.type === 'preview' && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label={t('desktop.removal.title')}
        >
          <p>{reply.root}</p>
          <p>{t('desktop.removal.scope')}</p>
          <dl>
            {reply.groups.map((group) => (
              <div key={group.kind}>
                <dt>
                  {t(
                    group.kind === 'settings'
                      ? 'desktop.removal.settings'
                      : folderMessages[group.kind],
                  )}
                </dt>
                <dd>{t('desktop.bytes', { bytes: group.bytes })}</dd>
              </div>
            ))}
          </dl>
          <ul>
            {reply.rows.map((row) => (
              <li key={row.name}>
                {row.name} ({intl.formatNumber(row.bytes)} B),{' '}
                {t(
                  row.disposition === 'remove'
                    ? 'desktop.removal.willRemove'
                    : 'desktop.removal.retained',
                )}
                {row.reason === 'link' ? `, ${t('desktop.removal.link')}` : ''}
              </li>
            ))}
          </ul>
          <label className={styles.tick}>
            <input
              type="checkbox"
              checked={signedOut}
              onChange={(event) => setSignedOut(event.target.checked)}
            />
            {t('desktop.removal.signout')}
          </label>
          <label className={styles.field}>
            {t('desktop.removal.type', { word: required })}
            <input
              value={phrase}
              autoComplete="off"
              onChange={(event) => setPhrase(event.target.value)}
            />
          </label>
          <div className={styles.actions}>
            <button
              disabled={busy || !signedOut || phrase !== required}
              onClick={() =>
                send({
                  type: 'confirm',
                  id: crypto.randomUUID(),
                  token: reply.token,
                  signedOut: true,
                  phrase: required,
                  locale,
                })
              }
            >
              {t('desktop.removal.confirm')}
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setReply(null);
                setPhrase('');
                setSignedOut(false);
              }}
            >
              {t('bulk.cancel')}
            </button>
          </div>
        </div>
      )}
      {busy && <p role="status">{t('desktop.busy')}</p>}
      {reply?.type === 'result' && (
        <p role="status">
          {t(
            reply.failures
              ? 'desktop.removal.partial'
              : 'desktop.removal.complete',
          )}
        </p>
      )}
    </section>
  );
}

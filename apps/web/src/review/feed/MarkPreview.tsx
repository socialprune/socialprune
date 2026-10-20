import { Dialog } from '@base-ui/react/dialog';
import { Bookmark, Info, ShieldCheck } from 'lucide-react';
import { useIntl } from 'react-intl';
import { useT } from '../../i18n/index.ts';
import type { MarkPreviewModel } from './types.ts';
import styles from './Feed.module.css';

export function MarkPreview({
  open,
  preview,
  zone = 'Europe/Berlin',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  preview: MarkPreviewModel;
  zone?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT(),
    intl = useIntl();
  const pending = preview.state === 'loading' || preview.state === 'error';
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={styles.backdrop} />
        <Dialog.Popup className={styles.dialog}>
          <div className={styles.dialogHeading}>
            <Bookmark size={24} aria-hidden="true" />
            <Dialog.Title>
              {t('markPreview.title', { count: preview.count })}
            </Dialog.Title>
          </div>
          <Dialog.Description>
            {t('markPreview.account', { account: preview.account })}
          </Dialog.Description>
          {preview.state === 'changed' && (
            <p role="status" className={styles.unchecked}>
              {t('markPreview.changed')}
            </p>
          )}
          {preview.state === 'loading' && (
            <p role="status">{t('bulk.preparing')}</p>
          )}
          {preview.state === 'error' && (
            <p role="alert">{t('markPreview.error')}</p>
          )}
          <p>
            {t('markPreview.criteria', {
              criteria: preview.criteria,
              level: preview.level,
            })}
          </p>
          <div className={styles.exclusions}>
            <ShieldCheck size={20} aria-hidden="true" />
            <div>
              <p>{t('markPreview.held', { count: preview.held })}</p>
              <p>{t('markPreview.kept', { count: preview.kept })}</p>
              <p>
                {t(
                  preview.laterExcluded === false
                    ? 'markPreview.unclearIncluded'
                    : 'markPreview.unclear',
                  { count: preview.unclear },
                )}
              </p>
            </div>
          </div>
          <p className={styles.meta}>
            {t('markPreview.sources', {
              sources: intl.formatList(
                preview.sources.map((source) =>
                  t('markPreview.sourceCount', source),
                ),
              ),
            })}
          </p>
          <p className={styles.platformNotice}>
            <Info size={20} aria-hidden="true" />
            <span>
              {t(
                preview.platform === 'instagram'
                  ? 'markPreview.nextInstagram'
                  : 'markPreview.nextX',
              )}
            </span>
          </p>
          <details className={styles.sample}>
            <summary>
              {t('bulk.sample', { count: preview.sample.length })}
            </summary>
            <ol>
              {preview.sample.map((post) => (
                <li key={post.id}>
                  <time dateTime={post.createdAt}>
                    {intl.formatDate(post.createdAt, {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      timeZone: zone,
                    })}
                  </time>
                  <p dir="auto">{post.text}</p>
                </li>
              ))}
            </ol>
          </details>
          <div className={styles.dialogActions}>
            <button
              disabled={pending || !preview.count}
              className={styles.finalButton}
              onClick={onConfirm}
            >
              {t('markPreview.confirm', { count: preview.count })}
            </button>
            <button onClick={onCancel}>{t('bulk.cancel')}</button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

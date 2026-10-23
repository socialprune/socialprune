import { Dialog } from '@base-ui/react/dialog';
import type {
  BulkPreview,
  ReviewRow,
} from '@socialprune/core/workspace/protocol';
import { useT } from '../i18n/index.ts';
import { actionMessage, decisionMessage } from './model.ts';
import styles from './Review.module.css';

export interface BulkDialogProps {
  open: boolean;
  preview: BulkPreview | null;
  account: string;
  filterDescription: string;
  overwrite: boolean;
  loading: boolean;
  replacement: 'stale' | 'expired' | null;
  error: string | null;
  onOverwrite: (value: boolean) => void;
  onConfirm: () => void;
  onCancel: () => void;
  renderSources: (row: ReviewRow) => React.ReactNode;
}
export function BulkDialog(props: BulkDialogProps) {
  const t = useT();
  const preview = props.preview;
  const action = preview?.value ?? 'delete';
  const total = preview?.total ?? 0;
  const count = preview?.willChange ?? 0;
  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className={styles.backdrop} />
        <Dialog.Popup className={styles.dialog}>
          <Dialog.Title>
            {t('bulk.title', {
              count: total,
              action: t(actionMessage[action]),
            })}
          </Dialog.Title>
          <Dialog.Description>
            {t('bulk.description', {
              account: props.account,
              filter: props.filterDescription,
            })}
          </Dialog.Description>
          {props.replacement && (
            <p role="status">
              {t(props.replacement === 'stale' ? 'bulk.stale' : 'bulk.expired')}
            </p>
          )}
          {props.loading && <p role="status">{t('bulk.preparing')}</p>}
          {preview && (
            <>
              {preview.selection && (
                <p>
                  {t('bulk.selectionCount', {
                    requested: preview.selection.requested,
                    inView: preview.selection.inView,
                    notInView: preview.selection.notInView,
                  })}
                </p>
              )}
              <p>{t('bulk.counts', { count, unchanged: preview.unchanged })}</p>
              <ul>
                {(['undecided', 'later', 'keep', 'delete'] as const).map(
                  (value) => (
                    <li key={value}>
                      {t('bulk.currentValue', {
                        value: t(decisionMessage[value]),
                        count: preview.byCurrentValue[value],
                      })}
                    </li>
                  ),
                )}
              </ul>
              <label className={styles.overwrite}>
                <input
                  type="checkbox"
                  checked={props.overwrite}
                  disabled={props.loading}
                  onChange={(event) => props.onOverwrite(event.target.checked)}
                />{' '}
                {t('bulk.overwrite', {
                  count:
                    preview.byCurrentValue.keep + preview.byCurrentValue.delete,
                })}
              </label>
              <p>{t('bulk.platformNotice')}</p>
              <details>
                <summary>
                  {t('bulk.sample', { count: preview.sample.length })}
                </summary>
                <ul className={styles.sample}>
                  {preview.sample.map((row) => (
                    <li key={row.id}>
                      <p dir="auto">{row.text || t('review.noText')}</p>
                      {props.renderSources(row)}
                    </li>
                  ))}
                </ul>
              </details>
            </>
          )}
          {props.error && <p role="alert">{props.error}</p>}
          <div className={styles.actions}>
            <button
              disabled={props.loading || !preview || !count}
              onClick={props.onConfirm}
            >
              {t('bulk.confirm', { count, action: t(actionMessage[action]) })}
            </button>
            <button onClick={props.onCancel}>{t('bulk.cancel')}</button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

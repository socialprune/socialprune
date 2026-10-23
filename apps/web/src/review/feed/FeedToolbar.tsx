import { Menu } from '@base-ui/react/menu';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Ellipsis,
  Keyboard,
  List,
  Rows3,
  Undo2,
} from 'lucide-react';
import { useT } from '../../i18n/index.ts';
import controls from './Controls.module.css';
import styles from './FeedWorkspace.module.css';

export function FeedToolbar({
  accounts,
  accountKey,
  busy,
  single,
  previousDisabled,
  nextDisabled,
  onAccount,
  onSingle,
  onMove,
  onUndo,
  onHelp,
}: {
  accounts: readonly { key: string; handle: string | null }[];
  accountKey: string;
  busy: boolean;
  single: boolean;
  previousDisabled: boolean;
  nextDisabled: boolean;
  onAccount: (key: string) => void;
  onSingle: () => void;
  onMove: (direction: -1 | 1) => void;
  onUndo: () => void;
  onHelp: () => void;
}) {
  const t = useT();
  return (
    <div className={styles.toolbar} data-feed-toolbar>
      <label className={styles.accountField}>
        <span className={styles.srOnly}>{t('review.account')}</span>
        <select
          aria-label={t('review.account')}
          value={accountKey}
          disabled={busy}
          onChange={(event) => onAccount(event.target.value)}
        >
          {accounts.map((account) => (
            <option key={account.key} value={account.key}>
              @{account.handle ?? account.key}
            </option>
          ))}
        </select>
        <ChevronDown size={16} aria-hidden="true" />
      </label>
      {single && (
        <div className={styles.singleNavigation}>
          <button
            className={controls.quiet}
            aria-label={t('proto.previousCard')}
            disabled={previousDisabled || busy}
            onClick={() => onMove(-1)}
          >
            <ArrowLeft size={18} aria-hidden="true" />
          </button>
          <button
            className={controls.quiet}
            aria-label={t('proto.nextCard')}
            disabled={nextDisabled || busy}
            onClick={() => onMove(1)}
          >
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        </div>
      )}
      <Menu.Root>
        <Menu.Trigger
          className={controls.quiet}
          aria-label={t('reviewFeed.options')}
        >
          <Ellipsis size={22} aria-hidden="true" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner
            sideOffset={8}
            align="end"
            className={styles.menuPositioner}
          >
            <Menu.Popup className={styles.menu}>
              <Menu.Item render={<a href="#/review/list" />}>
                <List size={18} aria-hidden="true" />
                {t('reviewFeed.list')}
              </Menu.Item>
              <Menu.Item onClick={onSingle}>
                <Rows3 size={18} aria-hidden="true" />
                {t(single ? 'feed.all' : 'feed.single')}
              </Menu.Item>
              <Menu.Item disabled={busy} onClick={onUndo}>
                <Undo2 size={18} aria-hidden="true" />
                {t('review.undo')}
              </Menu.Item>
              <Menu.Item onClick={onHelp}>
                <Keyboard size={18} aria-hidden="true" />
                {t('review.keyboard')}
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}

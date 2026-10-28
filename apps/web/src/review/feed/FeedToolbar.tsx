import { Menu } from '@base-ui/react/menu';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Check,
  Ellipsis,
  Keyboard,
  List,
  Rows3,
  Undo2,
} from 'lucide-react';
import { useT } from '../../i18n/index.ts';
import controls from './Controls.module.css';
import styles from './FeedWorkspace.module.css';
import type { FeedSort } from '@socialprune/core/criteria';

export function FeedToolbar({
  accounts,
  accountKey,
  sort,
  sortOptions,
  onSort,
  busy,
  single,
  previousDisabled,
  nextDisabled,
  onAccount,
  onSingle,
  onMove,
  onUndo,
  onHelp,
  onBack,
  backDisabled,
}: {
  accounts: readonly { key: string; handle: string | null }[];
  accountKey: string;
  sort: FeedSort;
  sortOptions: readonly FeedSort[];
  onSort: (sort: FeedSort) => void;
  busy: boolean;
  single: boolean;
  previousDisabled: boolean;
  nextDisabled: boolean;
  onAccount: (key: string) => void;
  onSingle: () => void;
  onMove: (direction: -1 | 1) => void;
  onUndo: () => void;
  onHelp: () => void;
  onBack: () => void;
  backDisabled: boolean;
}) {
  const t = useT();
  const selectedSort = sortOptions.includes(sort) ? sort : 'newest';
  const sortLabel = (option: FeedSort) =>
    t(
      (
        {
          newest: 'reviewFeed.sortNewest',
          oldest: 'reviewFeed.sortOldest',
          likes: 'reviewFeed.sortLikes',
          reposts: 'reviewFeed.sortReposts',
        } as const
      )[option],
    );
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
      <div
        className={styles.modeSwitch}
        role="group"
        aria-label={t('reviewFeed.mode')}
      >
        <button
          className={controls.quiet}
          aria-pressed={single}
          onClick={() => {
            if (!single) onSingle();
          }}
        >
          {t('feed.single')}
        </button>
        <button
          className={controls.quiet}
          aria-pressed={!single}
          onClick={() => {
            if (single) onSingle();
          }}
        >
          {t('reviewFeed.listMode')}
        </button>
      </div>
      <label className={styles.sortField}>
        <span>{t('reviewFeed.sort')}</span>
        <select
          aria-label={t('reviewFeed.sort')}
          value={selectedSort}
          disabled={busy}
          onChange={(event) => onSort(event.target.value as FeedSort)}
        >
          {sortOptions.map((option) => (
            <option key={option} value={option}>
              {sortLabel(option)}
            </option>
          ))}
        </select>
      </label>
      {single && (
        <div className={styles.singleNavigation}>
          <button
            className={controls.quiet}
            aria-label={t('reviewFeed.backHint')}
            disabled={backDisabled}
            onClick={onBack}
          >
            <Undo2 size={18} aria-hidden="true" />
            {t('reviewFeed.back')}
          </button>
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
              <Menu.RadioGroup
                className={styles.mobileSort}
                aria-label={t('reviewFeed.sort')}
                value={selectedSort}
                onValueChange={(value) => onSort(value as FeedSort)}
              >
                <Menu.GroupLabel className={styles.sortHeading}>
                  {t('reviewFeed.sort')}
                </Menu.GroupLabel>
                {sortOptions.map((option) => (
                  <Menu.RadioItem
                    key={option}
                    value={option}
                    disabled={busy}
                    closeOnClick
                  >
                    <span className={styles.sortIndicator}>
                      <Menu.RadioItemIndicator>
                        <Check size={16} aria-hidden="true" />
                      </Menu.RadioItemIndicator>
                    </span>
                    {sortLabel(option)}
                  </Menu.RadioItem>
                ))}
                <Menu.Separator className={styles.sortSeparator} />
              </Menu.RadioGroup>
              <Menu.Item render={<a href="#/review/list" />}>
                <List size={18} aria-hidden="true" />
                {t('reviewFeed.list')}
              </Menu.Item>
              <Menu.Item className={styles.mobileMode} onClick={onSingle}>
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

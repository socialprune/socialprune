import type { QueryFilter } from '@socialprune/core/workspace/protocol';
import { useT } from '../i18n/index.ts';
import { categoryID } from './model.ts';
import { inputDate, templateFilter, templateMessage } from './filters.ts';
import type { Template } from './filters.ts';
import styles from './Review.module.css';

export function Filters({
  filter,
  template,
  zone,
  onFilter,
  onTemplate,
}: {
  filter: QueryFilter;
  template: Template;
  zone: string;
  onFilter: (filter: QueryFilter) => void;
  onTemplate: (template: Template) => void;
}) {
  const t = useT();
  return (
    <details className={styles.filters}>
      <summary>{t('review.moreFilters')}</summary>
      <div className={styles.filterFields}>
        <label className={styles.field}>
          {t('review.template')}
          <select
            value={template}
            onChange={(event) => {
              const value = event.target.value as Template;
              onTemplate(value);
              onFilter(templateFilter(value, zone));
            }}
          >
            {Object.entries(templateMessage).map(([value, id]) => (
              <option key={value} value={value}>
                {t(id)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          {t('review.kindFilter')}
          <select
            value={filter.kinds?.[0] ?? 'all'}
            onChange={(event) =>
              onFilter({
                ...filter,
                kinds:
                  event.target.value === 'all'
                    ? undefined
                    : [
                        event.target.value as NonNullable<
                          QueryFilter['kinds']
                        >[number],
                      ],
              })
            }
          >
            <option value="all">{t('review.all')}</option>
            {(['post', 'reply', 'quote', 'repost', 'comment'] as const).map(
              (value) => (
                <option key={value} value={value}>
                  {t(
                    (
                      {
                        post: 'review.post',
                        reply: 'review.reply',
                        quote: 'review.quote',
                        repost: 'review.repost',
                        comment: 'review.comment',
                      } as const
                    )[value],
                  )}
                </option>
              ),
            )}
          </select>
        </label>
        <label className={styles.field}>
          {t('review.outcomeFilter')}
          <select
            value={filter.outcomes?.[0] ?? 'all'}
            onChange={(event) =>
              onFilter({
                ...filter,
                outcomes:
                  event.target.value === 'all'
                    ? undefined
                    : [
                        event.target.value as NonNullable<
                          QueryFilter['outcomes']
                        >[number],
                      ],
              })
            }
          >
            <option value="all">{t('review.all')}</option>
            <option value="unknown">{t('review.outcomeUnknown')}</option>
            <option value="deleted-by-user">
              {t('review.outcomeDeleted')}
            </option>
            <option value="skipped">{t('review.outcomeSkipped')}</option>
          </select>
        </label>
        <label className={styles.field}>
          {t('review.riskFilter')}
          <select
            value={
              filter.risk?.unknown === 'only'
                ? 'none'
                : (filter.risk?.min ?? 'all')
            }
            onChange={(event) =>
              onFilter({
                ...filter,
                risk:
                  event.target.value === 'all'
                    ? undefined
                    : event.target.value === 'none'
                      ? { min: 0, max: 3, unknown: 'only' }
                      : {
                          min: Number(event.target.value),
                          max: 3,
                          unknown: 'exclude',
                        },
              })
            }
          >
            <option value="all">{t('review.all')}</option>
            <option value="none">{t('review.noSuggestionsFilter')}</option>
            <option value="0">{t('review.riskNone')}</option>
            <option value="1">{t('review.riskLow')}</option>
            <option value="2">{t('review.riskMedium')}</option>
            <option value="3">{t('review.riskHigh')}</option>
          </select>
        </label>
        <label className={styles.field}>
          {t('review.categoryFilter')}
          <select
            value={filter.categories?.[0] ?? 'all'}
            onChange={(event) =>
              onFilter({
                ...filter,
                categories:
                  event.target.value === 'all'
                    ? undefined
                    : [event.target.value],
              })
            }
          >
            <option value="all">{t('review.all')}</option>
            {[
              'toxic',
              'personal-attack',
              'political',
              'sexual',
              'drugs-illegal',
              'personal-info',
              'embarrassing',
              'empty',
              'harmless',
              'unclear',
            ].map((value) => (
              <option key={value} value={value}>
                {t(categoryID(value))}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          {t('review.sourceFilter')}
          <select
            value={filter.sources?.[0] ?? 'all'}
            onChange={(event) =>
              onFilter({
                ...filter,
                sources:
                  event.target.value === 'all'
                    ? undefined
                    : [
                        event.target.value as NonNullable<
                          QueryFilter['sources']
                        >[number],
                      ],
              })
            }
          >
            <option value="all">{t('review.all')}</option>
            <option value="agent">{t('review.sourceAgent')}</option>
            <option value="fixture">{t('review.example')}</option>
            <option value="rules">{t('review.sourceRules')}</option>
            <option value="model">{t('review.sourceModel')}</option>
          </select>
        </label>
        <label className={styles.field}>
          {t('review.dateFrom')}
          <input
            type="date"
            value={filter.dates?.from ?? ''}
            onChange={(event) =>
              onFilter({
                ...filter,
                dates: {
                  from: inputDate(event.target.value),
                  to: filter.dates?.to ?? null,
                },
              })
            }
          />
        </label>
        <label className={styles.field}>
          {t('review.dateTo')}
          <input
            type="date"
            value={filter.dates?.to ?? ''}
            onChange={(event) =>
              onFilter({
                ...filter,
                dates: {
                  from: filter.dates?.from ?? null,
                  to: inputDate(event.target.value),
                },
              })
            }
          />
        </label>
        <label className={styles.field}>
          {t('review.likesMinimum')}
          <input
            type="number"
            min="0"
            value={filter.likes?.min ?? ''}
            onChange={(event) =>
              onFilter({
                ...filter,
                likes:
                  event.target.value === ''
                    ? undefined
                    : {
                        min: Number(event.target.value),
                        max: null,
                        unknown: 'exclude',
                      },
              })
            }
          />
        </label>
        <label className={styles.field}>
          {t('review.likesMaximum')}
          <input
            type="number"
            min="0"
            value={filter.likes?.max ?? ''}
            onChange={(event) =>
              onFilter({
                ...filter,
                likes: {
                  min: filter.likes?.min ?? null,
                  max:
                    event.target.value === ''
                      ? null
                      : Number(event.target.value),
                  unknown: filter.likes?.unknown ?? 'include',
                },
              })
            }
          />
        </label>
        <label className={styles.field}>
          {t('review.repostsMinimum')}
          <input
            type="number"
            min="0"
            value={filter.reposts?.min ?? ''}
            onChange={(event) =>
              onFilter({
                ...filter,
                reposts: {
                  min:
                    event.target.value === ''
                      ? null
                      : Number(event.target.value),
                  max: filter.reposts?.max ?? null,
                  unknown: 'exclude',
                },
              })
            }
          />
        </label>
        <label className={styles.field}>
          {t('review.repostsMaximum')}
          <input
            type="number"
            min="0"
            value={filter.reposts?.max ?? ''}
            onChange={(event) =>
              onFilter({
                ...filter,
                reposts: {
                  min: filter.reposts?.min ?? null,
                  max:
                    event.target.value === ''
                      ? null
                      : Number(event.target.value),
                  unknown: filter.reposts?.unknown ?? 'include',
                },
              })
            }
          />
        </label>
        <label className={styles.field}>
          {t('review.unknownEngagement')}
          <select
            value={filter.likes?.unknown ?? 'include'}
            onChange={(event) =>
              onFilter({
                ...filter,
                likes: {
                  min: filter.likes?.min ?? null,
                  max: filter.likes?.max ?? null,
                  unknown: event.target.value as 'include' | 'exclude' | 'only',
                },
              })
            }
          >
            <option value="include">{t('review.includeUnknown')}</option>
            <option value="exclude">{t('review.excludeUnknown')}</option>
            <option value="only">{t('review.onlyUnknown')}</option>
          </select>
        </label>
        <label className={styles.field}>
          {t('review.unknownReposts')}
          <select
            value={filter.reposts?.unknown ?? 'include'}
            onChange={(event) =>
              onFilter({
                ...filter,
                reposts: {
                  min: filter.reposts?.min ?? null,
                  max: filter.reposts?.max ?? null,
                  unknown: event.target.value as 'include' | 'exclude' | 'only',
                },
              })
            }
          >
            <option value="include">{t('review.includeUnknown')}</option>
            <option value="exclude">{t('review.excludeUnknown')}</option>
            <option value="only">{t('review.onlyUnknown')}</option>
          </select>
        </label>
        <p>{t('review.filterZone', { zone })}</p>
      </div>
    </details>
  );
}

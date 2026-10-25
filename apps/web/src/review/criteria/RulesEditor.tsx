import { useId } from 'react';
import { Trash2 } from 'lucide-react';
import { useT } from '../../i18n/index.ts';
import type { KeepRuleModel } from './types.ts';
import styles from './Criteria.module.css';

export function RulesEditor({
  rules,
  busy = false,
  onChange,
  onAdd,
  onRemove,
  onDraftChange,
  onCommit,
}: {
  rules: readonly KeepRuleModel[];
  busy?: boolean;
  onChange: (rule: KeepRuleModel) => void;
  onAdd: (kind: KeepRuleModel['kind']) => void;
  onRemove: (id: string) => void;
  onDraftChange?: (rule: KeepRuleModel) => void;
  onCommit?: () => void;
}) {
  const t = useT(),
    id = useId();
  function ruleName(rule: KeepRuleModel) {
    if (rule.kind === 'top-tenth') return t('keepRules.top');
    if (rule.kind === 'date') return `${t('keepRules.date')}: ${rule.value}`;
    return t(
      rule.kind === 'likes' ? 'reviewFeed.ruleLikes' : 'reviewFeed.ruleReposts',
      { count: Number(rule.value) },
    );
  }
  return (
    <section className={styles.rules} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t('keepRules.title')}</h2>
      <p className={styles.intro}>{t('keepRules.intro')}</p>
      {rules.map((rule) => (
        <div className={styles.rule} key={rule.id}>
          <div className={styles.ruleLine}>
            <label className={styles.ruleToggle}>
              <input
                type="checkbox"
                disabled={busy}
                checked={rule.enabled}
                onChange={(event) =>
                  onChange({ ...rule, enabled: event.target.checked })
                }
              />
              <span>{ruleName(rule)}</span>
            </label>
            {rule.kind === 'top-tenth' ? (
              <span className={styles.help}>
                {t('keepRules.threshold', { count: Number(rule.value) })}
              </span>
            ) : (
              <input
                className={styles.ruleValue}
                type={rule.kind === 'date' ? 'date' : 'number'}
                aria-label={t(
                  rule.kind === 'date'
                    ? 'keepRules.dateValue'
                    : rule.kind === 'likes'
                      ? 'keepRules.likesValue'
                      : 'keepRules.repostsValue',
                )}
                value={rule.value}
                min={rule.kind === 'date' ? undefined : 0}
                step={rule.kind === 'date' ? undefined : 1}
                disabled={busy || !rule.enabled}
                aria-invalid={!!rule.error}
                aria-describedby={
                  rule.error ? `${id}-${rule.id}-error` : undefined
                }
                onChange={(event) =>
                  (onDraftChange ?? onChange)({
                    ...rule,
                    value: event.target.value,
                  })
                }
                onBlur={onCommit}
              />
            )}
            <span className={styles.heldCount}>
              {t('keepRules.held', { count: rule.held })}
            </span>
            {rule.kind !== 'top-tenth' && (
              <button
                className={styles.iconButton}
                disabled={busy}
                aria-label={t('keepRules.remove', {
                  rule: ruleName(rule),
                })}
                onClick={() => onRemove(rule.id)}
              >
                <Trash2 size={18} aria-hidden="true" />
              </button>
            )}
          </div>
          {(rule.kind === 'likes' || rule.kind === 'reposts') && (
            <label className={styles.unknown}>
              <input
                type="checkbox"
                disabled={busy || !rule.enabled}
                checked={!!rule.unknown}
                onChange={(event) =>
                  onChange({ ...rule, unknown: event.target.checked })
                }
              />
              {t('keepRules.unknown')}
            </label>
          )}
          {rule.error && (
            <p
              role="alert"
              id={`${id}-${rule.id}-error`}
              className={styles.error}
            >
              {rule.error}
            </p>
          )}
        </div>
      ))}
      <div className={styles.addRule}>
        <label>
          {t('keepRules.add')}
          <select
            disabled={busy || rules.length >= 16}
            value=""
            onChange={(event) => {
              if (event.target.value)
                onAdd(event.target.value as KeepRuleModel['kind']);
            }}
          >
            <option value="">{t('keepRules.choose')}</option>
            {!rules.some((rule) => rule.kind === 'top-tenth') && (
              <option value="top-tenth">{t('keepRules.top')}</option>
            )}
            <option value="likes">{t('keepRules.likes')}</option>
            <option value="reposts">{t('keepRules.reposts')}</option>
            <option value="date">{t('keepRules.date')}</option>
          </select>
        </label>
      </div>
      <details className={styles.ruleHelp}>
        <summary>{t('keepRules.how')}</summary>
        <p className={styles.help}>{t('keepRules.combine')}</p>
        <p className={styles.help}>{t('keepRules.instagram')}</p>
      </details>
    </section>
  );
}

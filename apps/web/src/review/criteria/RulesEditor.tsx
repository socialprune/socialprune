import { useId } from 'react';
import { ShieldCheck, Trash2, Plus } from 'lucide-react';
import { useT } from '../../i18n/index.ts';
import type { KeepRuleModel } from './types.ts';
import styles from './Criteria.module.css';

export function RulesEditor({
  rules,
  busy = false,
  onChange,
  onAdd,
  onRemove,
}: {
  rules: readonly KeepRuleModel[];
  busy?: boolean;
  onChange: (rule: KeepRuleModel) => void;
  onAdd: (kind: KeepRuleModel['kind']) => void;
  onRemove: (id: string) => void;
}) {
  const t = useT(),
    id = useId();
  return (
    <section className={styles.rules} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>
        <ShieldCheck size={22} aria-hidden="true" />
        {t('keepRules.title')}
      </h2>
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
              <span>
                {t(
                  rule.kind === 'top-tenth'
                    ? 'keepRules.top'
                    : rule.kind === 'likes'
                      ? 'keepRules.likes'
                      : rule.kind === 'reposts'
                        ? 'keepRules.reposts'
                        : 'keepRules.date',
                )}
              </span>
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
                  onChange({ ...rule, value: event.target.value })
                }
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
                  rule: t(
                    rule.kind === 'likes'
                      ? 'keepRules.likes'
                      : rule.kind === 'reposts'
                        ? 'keepRules.reposts'
                        : 'keepRules.date',
                  ),
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
            <option value="likes">{t('keepRules.likes')}</option>
            <option value="reposts">{t('keepRules.reposts')}</option>
            <option value="date">{t('keepRules.date')}</option>
          </select>
        </label>
        <Plus size={18} aria-hidden="true" />
      </div>
      <p className={styles.help}>{t('keepRules.combine')}</p>
      <p className={styles.help}>{t('keepRules.instagram')}</p>
    </section>
  );
}

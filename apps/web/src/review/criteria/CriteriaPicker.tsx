import { useId } from 'react';
import { useIntl } from 'react-intl';
import { Plus, X, ArrowRight } from 'lucide-react';
import { useT } from '../../i18n/index.ts';
import type { CriteriaModel } from './types.ts';
import styles from './Criteria.module.css';

export function CriteriaPicker({
  model,
  onToggle,
  onLevel,
  onOwnLabel,
  onOwnDescription,
  onAdd,
  onRemove,
  onOfferRule,
  presetsOnly = false,
}: {
  model: CriteriaModel;
  onToggle: (id: string, selected: boolean) => void;
  onLevel: (level: 0 | 1 | 2) => void;
  onOwnLabel: (value: string) => void;
  onOwnDescription: (value: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onOfferRule: () => void;
  presetsOnly?: boolean;
}) {
  const t = useT(),
    intl = useIntl(),
    id = useId();
  const customCount = model.options.filter((option) => option.custom).length;
  return (
    <section className={styles.picker} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{t('criteriaPicker.title')}</h2>
      <p className={styles.intro}>{t('criteriaPicker.intro')}</p>
      <fieldset className={styles.options} disabled={model.busy}>
        <legend className={styles.srOnly}>{t('criteriaPicker.title')}</legend>
        {model.options.map((option) => (
          <div
            key={option.id}
            className={styles.option}
            data-selected={option.selected}
          >
            <label>
              <input
                type="checkbox"
                checked={option.selected}
                disabled={option.noRoom}
                onChange={(event) => onToggle(option.id, event.target.checked)}
                aria-describedby={`${id}-${option.id}-help`}
              />
              <span className={styles.optionText}>
                <span className={styles.optionTitle}>
                  {option.label}
                  <span className={styles.hitCount}>
                    {intl.formatNumber(option.hits)}
                  </span>
                </span>
                <span className={styles.help} id={`${id}-${option.id}-help`}>
                  {option.description}
                </span>
                {!!option.unchecked && (
                  <span className={styles.unchecked}>
                    {t('criteriaPicker.unchecked', { count: option.unchecked })}
                  </span>
                )}
                {option.custom && (
                  <span className={styles.help}>{t('reviewFeed.own')}</span>
                )}
                {option.earlier && (
                  <span className={styles.help}>
                    {t('criteriaPicker.earlier')}
                  </span>
                )}
                {option.noRoom && (
                  <span className={styles.help}>
                    {t('criteriaPicker.noRoom')}
                  </span>
                )}
              </span>
            </label>
            {(option.custom || option.earlier) && (
              <button
                className={styles.iconButton}
                aria-label={t('criteriaPicker.remove', { label: option.label })}
                onClick={() => onRemove(option.id)}
              >
                <X size={18} aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
      </fieldset>
      {!presetsOnly && (
        <section className={styles.own} aria-labelledby={`${id}-own-title`}>
          <h3 id={`${id}-own-title`}>{t('criteriaPicker.own')}</h3>
          <p className={styles.help} id={`${id}-own-hint`}>
            {t('criteriaPicker.ownHint')}
          </p>
          <label className={styles.field}>
            {t('criteriaPicker.label')}
            <input
              value={model.ownLabel}
              maxLength={60}
              disabled={model.busy || customCount >= 8}
              placeholder={t('criteriaPicker.placeholder')}
              aria-describedby={`${id}-own-hint${model.ownError ? ` ${id}-error` : ''}`}
              aria-invalid={!!model.ownError}
              onChange={(event) => onOwnLabel(event.target.value)}
            />
          </label>
          <label className={styles.field}>
            {t('criteriaPicker.description')}
            <textarea
              value={model.ownDescription}
              maxLength={300}
              rows={2}
              disabled={model.busy || customCount >= 8}
              onChange={(event) => onOwnDescription(event.target.value)}
            />
          </label>
          {model.ownError && (
            <p id={`${id}-error`} role="alert" className={styles.error}>
              {model.ownError}
            </p>
          )}
          {model.limitOffer && (
            <div className={styles.ruleOffer}>
              <p>{t('criteriaPicker.limit')}</p>
              <button onClick={onOfferRule}>
                {model.limitOffer}
                <ArrowRight size={18} aria-hidden="true" />
              </button>
            </div>
          )}
          <div className={styles.ownActions}>
            <button
              disabled={
                model.busy ||
                customCount >= 8 ||
                !model.ownLabel.trim() ||
                !model.ownDescription.trim() ||
                !!model.limitOffer ||
                !!model.ownError
              }
              onClick={onAdd}
            >
              <Plus size={18} aria-hidden="true" />
              {t('criteriaPicker.add')}
            </button>
            <span className={styles.help}>
              {t('criteriaPicker.customCount', { count: customCount })}
            </span>
          </div>
        </section>
      )}
      <fieldset className={styles.level} disabled={model.busy}>
        <legend>{t('criteriaPicker.level')}</legend>
        {(
          [
            'criteriaPicker.every',
            'criteriaPicker.low',
            'criteriaPicker.medium',
          ] as const
        ).map((message, index) => (
          <label key={message}>
            <input
              type="radio"
              name={`${id}-level`}
              checked={model.level === index}
              onChange={() => onLevel(index as 0 | 1 | 2)}
            />
            {t(message)}
          </label>
        ))}
      </fieldset>
      <p className={styles.total}>
        {t('criteriaPicker.total', {
          count: model.suggested,
          held: model.held,
        })}
      </p>
    </section>
  );
}

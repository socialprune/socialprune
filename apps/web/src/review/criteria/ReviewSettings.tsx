import { useRef, useState } from 'react';
import {
  PRESETS,
  CRITERIA_SELECTED_MAX,
  defaultCriteria,
} from '@socialprune/core/criteria';
import type { CriteriaSettings, KeepRule } from '@socialprune/core/criteria';
import type { WorkspaceClient } from '../../workspace/client.ts';
import type {
  WorkspaceSummary,
  PlanCounts,
} from '@socialprune/core/workspace/protocol';
import { useT } from '../../i18n/index.ts';
import { categoryMessage } from '../model.ts';
import { criterionLabel } from '../feed/adapt.ts';
import { CriteriaPicker } from './CriteriaPicker.tsx';
import { RulesEditor } from './RulesEditor.tsx';
import {
  contentLimitOffer,
  ruleModels,
  storedRules,
  toggleCriterion,
} from './model.ts';
import type { KeepRuleModel } from './types.ts';
import styles from './Criteria.module.css';
import { demoCriteriaExamples } from '../../workspace/demo-criteria-examples.ts';
import { useIntl } from 'react-intl';
const definitions = {
  toxic: 'reviewFeed.definition.toxic',
  'personal-attack': 'reviewFeed.definition.personal-attack',
  political: 'reviewFeed.definition.political',
  sexual: 'reviewFeed.definition.sexual',
  'drugs-illegal': 'reviewFeed.definition.drugs-illegal',
  'personal-info': 'reviewFeed.definition.personal-info',
  embarrassing: 'reviewFeed.definition.embarrassing',
  empty: 'reviewFeed.definition.empty',
  racist: 'reviewFeed.definition.racist',
  misogynistic: 'reviewFeed.definition.misogynistic',
  'group-hostility': 'reviewFeed.definition.group-hostility',
  'politically-incorrect': 'reviewFeed.definition.politically-incorrect',
} as const;

export function ReviewSettings({
  client,
  summary,
  counts,
  accountKey,
  onDone,
  onChanged,
}: {
  client: WorkspaceClient;
  summary: WorkspaceSummary;
  counts: PlanCounts;
  accountKey: string;
  onDone: () => void;
  onChanged: (counts: PlanCounts) => void;
}) {
  const t = useT();
  const lang = useIntl().locale.startsWith('de') ? 'de' : 'en';
  const [criteria, setCriteria] = useState<CriteriaSettings>(
    summary.criteria ?? defaultCriteria(),
  );
  const [categories, setCategories] = useState(summary.categories ?? []);
  const [currentCounts, setCounts] = useState(counts);
  const [rules, setRules] = useState(() =>
    ruleModels(summary.keepRules ?? [], counts.held, counts.popularThreshold),
  );
  const [ownLabel, setOwnLabel] = useState(''),
    [ownDescription, setOwnDescription] = useState('');
  const [editingId, setEditing] = useState<string>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  const committedCriteria = useRef(criteria);
  const committedRules = useRef(summary.keepRules ?? []);
  const rulesRef = useRef<HTMLDivElement>(null);
  const offer = contentLimitOffer(`${ownLabel} ${ownDescription}`);
  async function persist(
    nextCriteria: CriteriaSettings,
    nextRules?: KeepRule[],
    remove?: string[],
  ) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const reply = nextRules
        ? await client.setKeepRules(nextRules)
        : await client.setCriteria(nextCriteria, remove);
      if (reply.type !== 'settingsChanged')
        throw new Error('Settings request rejected');
      const savedCriteria = reply.criteria ?? nextCriteria;
      committedCriteria.current = savedCriteria;
      committedRules.current =
        reply.keepRules ?? nextRules ?? committedRules.current;
      setCriteria(savedCriteria);
      setCategories(reply.categories ?? categories);
      const fresh = await client.planCounts(accountKey);
      if (fresh.type !== 'planCounts')
        throw new Error('Counts request rejected');
      const result: PlanCounts = fresh;
      setCounts(result);
      setRules(
        ruleModels(
          committedRules.current,
          result.held,
          result.popularThreshold,
        ),
      );
      onChanged(result);
      return true;
    } catch {
      setCriteria(committedCriteria.current);
      setRules(
        ruleModels(
          committedRules.current,
          currentCounts.held,
          currentCounts.popularThreshold,
        ),
      );
      setError(t('review.storageError'));
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const options = [
    ...PRESETS.filter(
      (preset) => preset.id !== 'harmless' && preset.id !== 'unclear',
    ).map((preset) => ({
      id: preset.id,
      label: t(categoryMessage[preset.id]),
      description: t(definitions[preset.id as keyof typeof definitions]),
      selected: criteria.selected.includes(preset.id),
      hits: currentCounts.hits[preset.id] ?? 0,
      unchecked: currentCounts.unchecked[preset.id] ?? 0,
      noRoom: !categories.includes(preset.id),
    })),
    ...categories
      .filter(
        (id) =>
          id !== 'harmless' &&
          id !== 'unclear' &&
          !PRESETS.some((preset) => preset.id === id),
      )
      .map((id) => {
        const custom = criteria.custom.find((entry) => entry.id === id);
        return {
          id,
          label: custom?.label ?? criterionLabel(id, summary, t),
          description: custom?.description ?? t('criteriaPicker.earlier'),
          selected: criteria.selected.includes(id),
          hits: currentCounts.hits[id] ?? 0,
          unchecked: currentCounts.unchecked[id] ?? 0,
          custom: !!custom,
          earlier: !custom,
        };
      }),
  ].map((option) => ({
    ...option,
    selectionBlocked: criteria.selected.length >= CRITERIA_SELECTED_MAX,
  }));
  function toggle(id: string, selected: boolean) {
    const next = toggleCriterion(criteria, id, selected);
    if (next && !lock.current) {
      setCriteria(next);
      void persist(next);
    }
  }
  function remove(id: string) {
    void persist(
      {
        ...criteria,
        selected: criteria.selected.filter((value) => value !== id),
        custom: criteria.custom.filter((value) => value.id !== id),
      },
      undefined,
      [id],
    );
    if (editingId === id) {
      setEditing(undefined);
      setOwnLabel('');
      setOwnDescription('');
    }
  }
  async function addOwn() {
    if (offer || !ownLabel.trim() || !ownDescription.trim()) return;
    const custom = editingId
      ? criteria.custom.map((entry) =>
          entry.id === editingId
            ? {
                ...entry,
                label: ownLabel.trim(),
                description: ownDescription.trim(),
              }
            : entry,
        )
      : [
          ...criteria.custom,
          {
            id: `custom-${criteria.nextCustom}`,
            label: ownLabel.trim(),
            description: ownDescription.trim(),
            createdAt: new Date().toISOString(),
          },
        ];
    const selected = editingId
      ? criteria.selected
      : [...criteria.selected, `custom-${criteria.nextCustom}`];
    if (selected.length > CRITERIA_SELECTED_MAX || custom.length > 8) return;
    const saved = await persist({
      ...criteria,
      selected,
      custom,
      nextCustom: editingId ? criteria.nextCustom : criteria.nextCustom + 1,
    });
    if (saved) {
      setEditing(undefined);
      setOwnLabel('');
      setOwnDescription('');
    }
  }
  function saveRules(next: KeepRuleModel[]) {
    setRules(next);
    const stored = storedRules(next);
    if (stored) void persist(criteria, stored);
  }
  function addRule(kind: KeepRuleModel['kind'], value?: string) {
    if (rules.length >= 16) return;
    saveRules([
      ...rules,
      {
        id: crypto.randomUUID(),
        kind,
        enabled: true,
        value:
          value ??
          (kind === 'date' ? new Date().toISOString().slice(0, 10) : '10'),
        held: 0,
        unknown: false,
      },
    ]);
    rulesRef.current?.scrollIntoView({ block: 'start' });
  }
  const models = rules.map((rule) => ({
    ...rule,
    ...(!storedRules([rule]) ? { error: t('keepRules.invalid') } : {}),
  }));
  return (
    <div className={styles.settings}>
      <div className={styles.settingsScroll} data-criteria-scroll>
        <div className={styles.settingsGrid}>
          <div>
            <CriteriaPicker
              showTotal={false}
              model={{
                options,
                level: criteria.level,
                ownLabel,
                ownDescription,
                editingId,
                ownRoom:
                  categories.length < 32 &&
                  criteria.selected.length < CRITERIA_SELECTED_MAX,
                busy,
                suggested: currentCounts.tabs.suggested,
                held: currentCounts.tabs.held,
                limitOffer: offer ? t('keepRules.add') : undefined,
                selectionLimit:
                  criteria.selected.length >= CRITERIA_SELECTED_MAX
                    ? t('criteriaPicker.selectionLimit', {
                        count: CRITERIA_SELECTED_MAX,
                      })
                    : undefined,
              }}
              onToggle={toggle}
              onLevel={(level) => {
                if (!lock.current) {
                  const next = { ...criteria, level };
                  setCriteria(next);
                  void persist(next);
                }
              }}
              onOwnLabel={setOwnLabel}
              onOwnDescription={setOwnDescription}
              onAdd={() => void addOwn()}
              onRemove={remove}
              onEdit={(id) => {
                const entry = criteria.custom.find((entry) => entry.id === id)!;
                setEditing(id);
                setOwnLabel(entry.label);
                setOwnDescription(entry.description);
              }}
              onCancelEdit={() => {
                setEditing(undefined);
                setOwnLabel('');
                setOwnDescription('');
              }}
              onOfferRule={() => {
                if (offer) {
                  addRule(offer.kind, offer.value);
                  setOwnLabel('');
                  setOwnDescription('');
                }
              }}
            />
            {summary.kind === 'demo' && (
              <aside className={styles.examples}>
                <h3>{t('criteriaPicker.examples')}</h3>
                <ul>
                  {demoCriteriaExamples.map((example) => (
                    <li key={example.id}>
                      <strong>{example.label[lang]}</strong>{' '}
                      {example.text[lang]}
                    </li>
                  ))}
                </ul>
              </aside>
            )}
          </div>
          <div ref={rulesRef} className={styles.rulesColumn}>
            <RulesEditor
              rules={models}
              busy={busy}
              onChange={(rule) =>
                saveRules(
                  rules.map((entry) => (entry.id === rule.id ? rule : entry)),
                )
              }
              onDraftChange={(rule) =>
                setRules(
                  rules.map((entry) => (entry.id === rule.id ? rule : entry)),
                )
              }
              onCommit={() => saveRules(rules)}
              onAdd={addRule}
              onRemove={(id) =>
                saveRules(rules.filter((rule) => rule.id !== id))
              }
            />
          </div>
        </div>
      </div>
      <footer className={styles.settingsFooter} data-criteria-footer>
        <div className={styles.receipt}>
          <p className={styles.liveTotal}>
            {t('criteriaPicker.total', {
              count: currentCounts.tabs.suggested,
              held: currentCounts.tabs.held,
            })}
          </p>
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          <div className={styles.saveStatus} role="status" aria-live="polite">
            {busy
              ? t('criteriaPicker.saving')
              : !error &&
                !models.some((rule) => rule.error) &&
                t('criteriaPicker.saved')}
          </div>
        </div>
        <button
          className={styles.done}
          disabled={busy || models.some((rule) => rule.error)}
          onClick={onDone}
        >
          {t('reviewFeed.applyCriteria')}
        </button>
      </footer>
    </div>
  );
}

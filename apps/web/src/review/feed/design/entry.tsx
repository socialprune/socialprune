import '@socialprune/core/browser-init';
import { createRoot } from 'react-dom/client';
import { useLayoutEffect, useRef, useState } from 'react';
import { IntlProvider } from 'react-intl';
import { CSPProvider } from '@base-ui/react/csp-provider';
import {
  ArrowLeft,
  ChevronRight,
  SlidersHorizontal,
  Sprout,
} from 'lucide-react';
import { catalogs, useT } from '../../../i18n/index.ts';
import '../../../styles/tokens.css';
import { ReviewFeed } from '../ReviewFeed.tsx';
import { FeedCard } from '../FeedCard.tsx';
import { MarkPreview } from '../MarkPreview.tsx';
import { CriteriaPicker } from '../../criteria/CriteriaPicker.tsx';
import { RulesEditor } from '../../criteria/RulesEditor.tsx';
import type { KeepRuleModel } from '../../criteria/types.ts';
import type { FeedDecision, FeedTab } from '../types.ts';
import {
  counts,
  criteriaExample,
  examples,
  previewExample,
  rulesExample,
  SHEET_SENTINEL,
  instagramCard,
} from './examples.ts';
import type { SheetLocale } from './examples.ts';
import styles from './Sheet.module.css';

const params = new URLSearchParams(location.search);
const locale: SheetLocale = params.get('lang') === 'en' ? 'en' : 'de';
const platform = params.get('platform') === 'instagram' ? 'instagram' : 'x';
document.documentElement.lang = locale;
document.documentElement.dataset['theme'] =
  params.get('theme') === 'dark' ? 'dark' : 'light';
const words =
  locale === 'de'
    ? {
        banner:
          'Designvorschau mit erfundenen Beiträgen. Hier wird nichts gespeichert.',
        feed: 'Feed',
        edit: 'Kriterien & Regeln',
        states: 'Alle Zustände',
        back: 'Zurück zum Feed',
        edited: 'Änderungen ansehen',
        scope: 'Deine Durchsicht',
        exclusions: 'Deine Ausnahmen bleiben',
        rules: 'Regeln bearbeiten',
        keys: 'Tasten auf der fokussierten Karte',
        source: 'Beispiele, keine KI-Ergebnisse',
        export: 'Zahlen aus dem Export vom 20. Oktober 2026',
        unchecked: 'Politisch',
        checked: 'Designvorschau: Prüfung angefragt. Es läuft kein Modell.',
        marked:
          'Designvorschau: Vormerken bestätigt. Es wurde nichts gespeichert.',
        delete: 'Designvorschau: Das Löschen startet hier nicht.',
        conversation:
          'Designvorschau: Die vorhandene Unterhaltung steht bereits über der Karte.',
        own: 'Alter Arbeitgeber',
        ownDescription: 'Witze über meinen früheren Arbeitsplatz.',
        invalid: 'Gib eine ganze Zahl ab null ein.',
        ruleOffer: 'Regel ab 10 Gefällt mir anlegen',
        error: 'Gib einen Namen und eine Beschreibung ein.',
        loading: 'Laden',
        empty: 'Leer',
        failed: 'Fehler',
        decided: 'Entschieden',
        changed: 'Geänderte Vorschau',
        ready: 'Vorschau öffnen',
        keep: 'Behalten',
        account: 'Konto',
        none: 'Noch keine Kriterien ausgewählt',
      }
    : {
        banner: 'Design preview with invented posts. Nothing is stored here.',
        feed: 'Feed',
        edit: 'Criteria & rules',
        states: 'All states',
        back: 'Back to feed',
        edited: 'See changes',
        scope: 'Your review',
        exclusions: 'Your exceptions stay',
        rules: 'Edit rules',
        keys: 'Keys on the focused card',
        source: 'Examples, not AI results',
        export: 'Figures from the export of 20 October 2026',
        unchecked: 'Political',
        checked: 'Design preview: check requested. No model is running.',
        marked: 'Design preview: mark confirmed. Nothing was stored.',
        delete: 'Design preview: deletion does not start here.',
        conversation:
          'Design preview: the available conversation is already above the card.',
        own: 'Old employer',
        ownDescription: 'Jokes about my former workplace.',
        invalid: 'Enter a whole number of zero or more.',
        ruleOffer: 'Add a rule from 10 likes',
        error: 'Enter a name and description.',
        loading: 'Loading',
        empty: 'Empty',
        failed: 'Error',
        decided: 'Decided',
        changed: 'Changed preview',
        ready: 'Open preview',
        keep: 'Keep',
        account: 'Account',
        none: 'No criteria selected yet',
      };

function Sheet() {
  const t = useT();
  const [surface, setSurface] = useState(params.get('surface') ?? 'feed');
  const [tab, setTab] = useState<FeedTab>(
    (params.get('tab') as FeedTab) || 'suggested',
  );
  const [cards, setCards] = useState(() => examples(locale));
  const [criteria, setCriteria] = useState(() => {
    const model = criteriaExample(locale);
    return params.get('first') === 'true'
      ? {
          ...model,
          options: model.options.map((option) => ({
            ...option,
            selected: false,
          })),
        }
      : model;
  });
  const [rules, setRules] = useState(rulesExample);
  const [preview, setPreview] = useState(() => previewExample(locale));
  const [previewOpen, setPreviewOpen] = useState(
    params.get('surface') === 'preview',
  );
  const [notice, setNotice] = useState('');
  const [count, setCount] = useState(() =>
    params.get('first') === 'true'
      ? { ...counts, suggested: 0, held: 0 }
      : counts,
  );
  const [state, setState] = useState('ready');
  const editorRef = useRef<HTMLDivElement>(null);
  const editorFooterRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const scroll = editorRef.current,
      footer = editorFooterRef.current;
    if (!scroll || !footer) return;
    const update = () => {
      scroll.style.paddingBottom = `${footer.getBoundingClientRect().height}px`;
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(footer);
    return () => observer.disconnect();
  }, [surface]);
  const summary =
    criteria.options
      .filter((option) => option.selected)
      .map((option) => option.label)
      .join(', ') || words.none;
  function decide(id: string, value: FeedDecision) {
    const previous = Object.values(cards)
      .flat()
      .find((card) => card.id === id)?.decision;
    if (!previous || previous === value) return;
    setCards(
      (prior) =>
        Object.fromEntries(
          Object.entries(prior).map(([key, entries]) => [
            key,
            entries.map((card) =>
              card.id === id
                ? {
                    ...card,
                    decision: value,
                    decidedAt: '2026-10-20T12:00:00Z',
                    markedVia: 'single' as const,
                  }
                : card,
            ),
          ]),
        ) as ReturnType<typeof examples>,
    );
    if (value === 'keep') {
      setCount((prior) => ({
        ...prior,
        suggested: prior.suggested - 1,
        kept: prior.kept + 1,
      }));
      setNotice(t('reviewFeed.keptNotice', { count: count.suggested - 1 }));
    } else if (value === 'undecided' && previous === 'keep') {
      setCount((prior) => ({
        ...prior,
        suggested: prior.suggested + 1,
        kept: prior.kept - 1,
      }));
      setNotice(
        t('reviewFeed.localOnly', {
          platform: platform === 'x' ? 'X' : 'Instagram',
        }),
      );
    } else
      setNotice(
        t('reviewFeed.localOnly', {
          platform: platform === 'x' ? 'X' : 'Instagram',
        }),
      );
  }
  function changeRule(rule: KeepRuleModel) {
    const valid = rule.kind === 'date' || /^\d+$/.test(rule.value);
    setRules((prior) =>
      prior.map((value) =>
        value.id === rule.id
          ? { ...rule, error: valid ? undefined : words.invalid }
          : value,
      ),
    );
  }
  return (
    <CSPProvider disableStyleElements>
      <div data-design-sheet={SHEET_SENTINEL} className={styles.sheet}>
        <div className={styles.designBar}>
          <Sprout size={22} aria-hidden="true" />
          <strong>SocialPrune</strong>
          <span>{words.banner}</span>
          <nav aria-label="Design">
            <button
              aria-pressed={surface === 'feed'}
              onClick={() => {
                setSurface('feed');
                setPreviewOpen(false);
              }}
            >
              {words.feed}
            </button>
            <button
              aria-pressed={surface === 'criteria'}
              onClick={() => {
                setSurface('criteria');
                setPreviewOpen(false);
              }}
            >
              {words.edit}
            </button>
            <button
              aria-pressed={surface === 'states'}
              onClick={() => {
                setSurface('states');
                setPreviewOpen(false);
              }}
            >
              {words.states}
            </button>
          </nav>
        </div>
        <main className={styles.layout}>
          {surface === 'criteria' ? (
            <div className={styles.editor}>
              <div
                ref={editorRef}
                className={styles.editorScroll}
                data-editor-scroll
              >
                <div className={styles.editorHeader}>
                  <button onClick={() => setSurface('feed')}>
                    <ArrowLeft size={18} aria-hidden="true" />
                    {words.back}
                  </button>
                  <span dir="ltr">@demo_birch</span>
                </div>
                <h1>{words.edit}</h1>
                <CriteriaPicker
                  model={criteria}
                  onToggle={(id, selected) =>
                    setCriteria((prior) => ({
                      ...prior,
                      options: prior.options.map((option) =>
                        option.id === id ? { ...option, selected } : option,
                      ),
                    }))
                  }
                  onLevel={(level) =>
                    setCriteria((prior) => ({ ...prior, level }))
                  }
                  onOwnLabel={(ownLabel) =>
                    setCriteria((prior) => ({
                      ...prior,
                      ownLabel,
                      limitOffer:
                        /\d+/.test(ownLabel) &&
                        /likes|gefällt|reposts/i.test(ownLabel)
                          ? words.ruleOffer
                          : undefined,
                    }))
                  }
                  onOwnDescription={(ownDescription) =>
                    setCriteria((prior) => ({ ...prior, ownDescription }))
                  }
                  onAdd={() =>
                    setCriteria((prior) => ({
                      ...prior,
                      ownLabel: '',
                      ownDescription: '',
                      options: [
                        ...prior.options,
                        {
                          id: `custom-${prior.options.filter((option) => option.custom).length + 1}`,
                          label: prior.ownLabel,
                          description: prior.ownDescription,
                          selected: true,
                          hits: 0,
                          unchecked: 12400,
                          custom: true,
                        },
                      ],
                    }))
                  }
                  onRemove={(id) =>
                    setCriteria((prior) => ({
                      ...prior,
                      options: prior.options.filter(
                        (option) => option.id !== id,
                      ),
                    }))
                  }
                  onOfferRule={() => {
                    setRules((prior) => [
                      ...prior,
                      {
                        id: `offered-${prior.length}`,
                        kind: 'likes',
                        value: '10',
                        held: 380,
                        enabled: true,
                      },
                    ]);
                    setCriteria((prior) => ({
                      ...prior,
                      ownLabel: '',
                      limitOffer: undefined,
                    }));
                  }}
                />
                <RulesEditor
                  rules={rules}
                  onChange={changeRule}
                  onRemove={(id) =>
                    setRules((prior) => prior.filter((rule) => rule.id !== id))
                  }
                  onAdd={(kind) =>
                    setRules((prior) => [
                      ...prior,
                      {
                        id: `rule-${prior.length}`,
                        kind,
                        value: kind === 'date' ? '2024-01-01' : '10',
                        enabled: true,
                        held: 0,
                      },
                    ])
                  }
                />
              </div>
              <div
                ref={editorFooterRef}
                className={styles.editorFooter}
                data-editor-footer
              >
                <button onClick={() => setSurface('feed')}>
                  {words.edited}
                  <ChevronRight size={18} aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : (
            <div className={styles.mainColumn}>
              {surface === 'states' && (
                <div className={styles.stateTools}>
                  <h1>{words.states}</h1>
                  {[
                    ['ready', words.decided],
                    ['loading', words.loading],
                    ['empty', words.empty],
                    ['error', words.failed],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      aria-pressed={state === key}
                      onClick={() => setState(key!)}
                    >
                      {label}
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      setPreview((prior) => ({ ...prior, state: 'changed' }));
                      setPreviewOpen(true);
                    }}
                  >
                    {words.changed}
                  </button>
                  <button
                    onClick={() => {
                      setPreview((prior) => ({ ...prior, state: 'loading' }));
                      setPreviewOpen(true);
                    }}
                  >
                    {words.ready}: {words.loading}
                  </button>
                  <button
                    onClick={() => {
                      setPreview((prior) => ({ ...prior, state: 'error' }));
                      setPreviewOpen(true);
                    }}
                  >
                    {words.ready}: {words.failed}
                  </button>
                </div>
              )}
              <ReviewFeed
                account={platform === 'instagram' ? 'demo_fern' : 'demo_birch'}
                platform={platform}
                hasCriteria={params.get('first') !== 'true'}
                laterExcluded={params.get('later') !== 'include'}
                criteria={summary}
                counts={count}
                cards={
                  state === 'empty'
                    ? []
                    : surface === 'states'
                      ? cards.all
                      : platform === 'instagram'
                        ? [instagramCard(locale, tab === 'marked')]
                        : cards[tab]
                }
                tab={surface === 'states' ? 'all' : tab}
                busy={state === 'loading'}
                error={state === 'error'}
                notice={notice}
                unchecked={
                  surface === 'states'
                    ? undefined
                    : { count: 248, criterion: words.unchecked }
                }
                onTab={(next) => {
                  setTab(next);
                  setSurface('feed');
                }}
                onCriteria={() => setSurface('criteria')}
                onCheck={() => setNotice(words.checked)}
                onRetry={() => setState('ready')}
                onDecision={decide}
                onPreview={() => {
                  setPreview((prior) => ({
                    ...prior,
                    count: count.suggested,
                    criteria: summary,
                    state: 'ready',
                  }));
                  setPreviewOpen(true);
                }}
                onDelete={() => setNotice(words.delete)}
                onConversation={() => setNotice(words.conversation)}
              />
              {surface === 'states' && state === 'ready' && (
                <section className={styles.additional}>
                  <h2>{words.decided}</h2>
                  <FeedCard
                    card={{
                      ...cards.suggested[0]!,
                      id: 'invented-busy',
                      busy: true,
                    }}
                    position={1}
                    total={1}
                    onDecision={decide}
                  />
                </section>
              )}
            </div>
          )}
          <aside className={styles.side}>
            <h2>{words.scope}</h2>
            <p className={styles.account}>@demo_birch</p>
            <p>{summary}</p>
            <div className={styles.summaryLine}>
              <ShieldMark />
              <span>{t('reviewFeed.heldCount', { count: count.held })}</span>
            </div>
            <button onClick={() => setSurface('criteria')}>
              <SlidersHorizontal size={18} aria-hidden="true" />
              {words.rules}
            </button>
            <hr />
            <h3>{words.keys}</h3>
            <p>{t('reviewFeed.keys')}</p>
            <p className={styles.meta}>{words.export}</p>
            <p className={styles.meta}>{words.source}</p>
          </aside>
        </main>
        <MarkPreview
          open={previewOpen}
          preview={{
            ...preview,
            account: platform === 'instagram' ? 'demo_fern' : preview.account,
            platform,
            laterExcluded: params.get('later') !== 'include',
          }}
          onCancel={() => setPreviewOpen(false)}
          onConfirm={() => {
            setPreviewOpen(false);
            setNotice(words.marked);
          }}
        />
      </div>
    </CSPProvider>
  );
}
function ShieldMark() {
  return <SlidersHorizontal size={18} aria-hidden="true" />;
}
createRoot(document.getElementById('root')!).render(
  <IntlProvider locale={locale} messages={catalogs[locale]}>
    <Sheet />
  </IntlProvider>,
);

import { useEffect, useState } from 'react';
import { Tabs } from '@base-ui/react/tabs';
import { guideDate, guideFacts } from '@socialprune/core/guide/check';
import type { GuideFact, PlatformGuide } from '@socialprune/core/guide/types';
import { guides } from '../app/guide.ts';
import { useT } from '../i18n/index.ts';
import type { Locale } from '../i18n/index.ts';
import { buildReminder, defaultReminderDate } from './reminder.ts';
import styles from './Guide.module.css';

const REPORT_URL = 'https://github.com/socialprune/socialprune/issues/new';
const GUIDE_URL = 'https://socialprune.github.io/socialprune/#/guide/';
const platformIds = { x: 'guide.x', instagram: 'guide.instagram' } as const;

function Fact({ fact, locale }: { fact: GuideFact; locale: Locale }) {
  return <p data-fact-id={fact.id}>{fact.text[locale]}</p>;
}

function GuideDetails({
  guide,
  locale,
}: {
  guide: PlatformGuide<'x' | 'instagram'>;
  locale: Locale;
}) {
  const t = useT();
  const platform = t(platformIds[guide.platform]);
  const startSource =
    locale === 'de'
      ? (guide.startUrl.sourceDe ?? guide.startUrl.source)
      : guide.startUrl.source;
  const key = `sp-guide-${guide.platform}`;
  const [date, setDate] = useState(() => {
    try {
      const saved = localStorage.getItem(`${key}-date`);
      if (saved && guideDate(saved) !== null) return saved;
    } catch {
      /* The reminder still works without persistent preferences. */
    }
    return defaultReminderDate(
      new Date(),
      guide.waiting.typicalDays?.max ?? null,
    );
  });
  const [step, setStep] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(`${key}-step`));
      if (Number.isInteger(saved) && saved >= 0 && saved <= guide.steps.length)
        return saved;
    } catch {
      /* The current page retains progress in memory. */
    }
    return 0;
  });
  const [device, setDevice] = useState('desktop');
  useEffect(() => {
    try {
      localStorage.setItem(`${key}-date`, date);
      localStorage.setItem(`${key}-step`, String(step));
    } catch {
      /* Persistence is optional, never a prerequisite for the guide. */
    }
  }, [key, date, step]);
  const dates = guideFacts(guide).map(({ verifiedOn }) => verifiedOn);
  const checkedOn = dates.every((value): value is string => value !== null)
    ? [...dates].sort()[0]
    : null;
  const download = () => {
    const content = buildReminder(date, {
      summary: t('guide.calendarSummary', { platform }),
      description: t('guide.calendarDescription', {
        url: `${GUIDE_URL}${guide.platform}`,
      }),
    });
    const url = URL.createObjectURL(
      new Blob([content], { type: 'text/calendar;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `socialprune-${guide.platform}-reminder.ics`;
    link.click();
    // Keep the URL live until the browser has consumed the download click.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  return (
    <article
      className={styles.guide}
      data-testid="platform-guide"
      data-platform={guide.platform}
    >
      <h2>{platform}</h2>
      <Fact fact={guide.startUrl} locale={locale} />
      <a href={startSource.url} target="_blank" rel="noopener noreferrer">
        {t('guide.help', { platform })}
      </a>
      {guide.paths && (
        <Tabs.Root
          value={device}
          onValueChange={(value) => setDevice(String(value))}
        >
          <Tabs.List aria-label={t('guide.device')} className={styles.tabs}>
            <Tabs.Tab value="desktop">{t('guide.desktop')}</Tabs.Tab>
            <Tabs.Tab value="mobile">{t('guide.mobile')}</Tabs.Tab>
          </Tabs.List>
          {(['desktop', 'mobile'] as const).map((path) => (
            <Tabs.Panel key={path} value={path}>
              <ol>
                {guide.paths![path].map((fact) => (
                  <li key={fact.id}>
                    <Fact fact={fact} locale={locale} />
                  </li>
                ))}
              </ol>
            </Tabs.Panel>
          ))}
        </Tabs.Root>
      )}
      <ol data-testid="guide-steps" className={styles.steps}>
        {guide.steps.map((fact) => (
          <li key={fact.id}>
            <Fact fact={fact} locale={locale} />
          </li>
        ))}
        <li>
          <h3>{t('guide.options')}</h3>
          <ul>
            {guide.options.map((fact) => (
              <li key={fact.id}>
                <Fact fact={fact} locale={locale} />
              </li>
            ))}
          </ul>
        </li>
      </ol>
      <label className={styles.field}>
        {t('guide.progress')}
        <select
          value={step}
          onChange={(event) => setStep(Number(event.target.value))}
        >
          <option value={0}>{t('guide.notStarted')}</option>
          {guide.steps.map((fact, index) => (
            <option key={fact.id} value={index + 1}>
              {t('guide.step', { number: index + 1 })}
            </option>
          ))}
        </select>
      </label>
      <h3>{t('guide.waiting')}</h3>
      <Fact fact={guide.waiting} locale={locale} />
      <Fact fact={guide.downloadWindow} locale={locale} />
      <Fact fact={guide.htmlExportHint} locale={locale} />
      <section className={styles.reminder} aria-label={t('guide.reminder')}>
        <label className={styles.field}>
          {t('guide.reminderDate')}
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <p>{t('guide.reminderHint')}</p>
        <button disabled={guideDate(date) === null} onClick={download}>
          {t('guide.reminder')}
        </button>
      </section>
      <footer>
        <p data-testid="guide-verification">
          {checkedOn
            ? t('guide.checked', {
                date: new Intl.DateTimeFormat(
                  locale === 'de' ? 'de-DE' : 'en-GB',
                  { dateStyle: 'long', timeZone: 'UTC' },
                ).format(new Date(`${checkedOn}T00:00:00Z`)),
              })
            : t('guide.notChecked')}
        </p>
        <p>
          {t('guide.reportHint', { platform })}{' '}
          <a href={REPORT_URL} target="_blank" rel="noopener noreferrer">
            {t('guide.report')}
          </a>
        </p>
        <details>
          <summary>{t('guide.sources')}</summary>
          <ul className={styles.sources}>
            {guideFacts(guide).map((fact) => {
              const source =
                locale === 'de' ? (fact.sourceDe ?? fact.source) : fact.source;
              return (
                <li key={fact.id}>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {source.publisher} · {source.title}
                  </a>
                  <p>{t('guide.retrieved', { date: fact.retrievedOn })}</p>
                </li>
              );
            })}
          </ul>
        </details>
      </footer>
    </article>
  );
}

export function Guide({ route, locale }: { route: string; locale: Locale }) {
  const t = useT();
  const guide = guides.find(({ platform }) => route === `/guide/${platform}`);
  return (
    <section data-guide-count={guides.length}>
      <h2>{t('guide.choose')}</h2>
      <div className={styles.choice}>
        {guides.map(({ platform }) => (
          <a
            key={platform}
            href={`#/guide/${platform}`}
            aria-current={guide?.platform === platform ? 'page' : undefined}
          >
            {t(platformIds[platform])}
          </a>
        ))}
      </div>
      {guide && (
        <GuideDetails key={guide.platform} guide={guide} locale={locale} />
      )}
    </section>
  );
}

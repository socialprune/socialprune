import type { GuideFact, PlatformGuide } from './types.ts';

export interface GuideCheckOptions {
  today: string;
  maxAgeDays: number;
  release: boolean;
}

export interface GuideFinding {
  platform: string | null;
  factId: string | null;
  code:
    | 'invalid-options'
    | 'no-guides'
    | 'no-steps'
    | 'invalid-id'
    | 'duplicate-id'
    | 'missing-text'
    | 'invalid-source'
    | 'invalid-date'
    | 'future-date'
    | 'unverified'
    | 'stale';
  field?: string;
}

const DAY_MS = 86_400_000;
const HELP_HOSTS = new Set([
  'help.x.com',
  'help.instagram.com',
  'www.facebook.com',
]);

/** Calendar dates only: Date.parse alone also accepts impossible dates. */
export function guideDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000'))
    return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp
    : null;
}

export function guideFacts(guide: PlatformGuide): readonly GuideFact[] {
  return [
    guide.startUrl,
    ...guide.steps,
    ...guide.options,
    guide.waiting,
    guide.downloadWindow,
    guide.htmlExportHint,
    ...(guide.paths?.desktop ?? []),
    ...(guide.paths?.mobile ?? []),
  ];
}

function helpSource(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      HELP_HOSTS.has(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      (url.hostname !== 'www.facebook.com' ||
        url.pathname.startsWith('/help/instagram/'))
    );
  } catch {
    return false;
  }
}

/** Pure, browser-clean validation. Reading sources and checking facts stay manual. */
export function checkGuides(
  guides: readonly PlatformGuide[],
  options: GuideCheckOptions,
): GuideFinding[] {
  const today = guideDate(options.today);
  if (
    today === null ||
    !Number.isInteger(options.maxAgeDays) ||
    options.maxAgeDays < 0
  ) {
    return [{ platform: null, factId: null, code: 'invalid-options' }];
  }
  const findings: GuideFinding[] = [];
  if (!guides.length)
    findings.push({ platform: null, factId: null, code: 'no-guides' });
  const ids = new Set<string>();
  for (const guide of guides) {
    const add = (
      code: GuideFinding['code'],
      factId: string | null,
      field?: string,
    ) => {
      findings.push({
        platform: guide.platform,
        factId,
        code,
        ...(field ? { field } : {}),
      });
    };
    if (!guide.steps.length) add('no-steps', null);
    for (const fact of guideFacts(guide)) {
      if (!fact.id.trim()) add('invalid-id', fact.id);
      else if (ids.has(fact.id)) add('duplicate-id', fact.id);
      ids.add(fact.id);
      for (const language of ['en', 'de'] as const) {
        if (!fact.text[language].trim()) add('missing-text', fact.id, language);
      }
      if (!helpSource(fact.source.url))
        add('invalid-source', fact.id, 'source.url');
      if (fact.sourceDe && !helpSource(fact.sourceDe.url))
        add('invalid-source', fact.id, 'sourceDe.url');
      for (const field of ['retrievedOn', 'verifiedOn'] as const) {
        const value = fact[field];
        if (field === 'verifiedOn' && value === null) {
          if (options.release) add('unverified', fact.id, field);
          continue;
        }
        const date = typeof value === 'string' ? guideDate(value) : null;
        if (date === null) add('invalid-date', fact.id, field);
        else if (date > today) add('future-date', fact.id, field);
        else if (
          field === 'verifiedOn' &&
          options.release &&
          (today - date) / DAY_MS > options.maxAgeDays
        ) {
          add('stale', fact.id, field);
        }
      }
    }
  }
  return findings;
}

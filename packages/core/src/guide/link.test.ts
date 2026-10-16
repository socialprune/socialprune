import { expect, test } from 'vitest';
import { REPORT_URL, resolveGuideLink } from '@socialprune/core/guide/link';
import type { GuideFact, PlatformGuide } from './types.ts';
import { DesktopRequestSchema } from '../workspace/desktop-protocol.ts';
import { xGuide } from '../../../adapter-x/src/guide.ts';
import { instagramGuide } from '../../../adapter-instagram/src/guide.ts';

const guides = [xGuide, instagramGuide];

// Enumerate the input fields, not the resolver's guideFacts projection.
function inputFacts(guide: PlatformGuide): GuideFact[] {
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

const fact = (id: string): GuideFact => ({
  id: `x.${id}`,
  text: { en: 'Generated guide fact.', de: 'Erzeugter Anleitungsschritt.' },
  source: {
    url: `https://help.x.com/en/generated-${id}`,
    publisher: 'Generated',
    title: 'Generated help',
  },
  sourceDe: {
    url: `https://help.x.com/de/generated-${id}`,
    publisher: 'Generated',
    title: 'Erzeugte Hilfe',
  },
  retrievedOn: '2026-10-16',
  verifiedOn: null,
});
const sample = (): PlatformGuide<'x'> => ({
  platform: 'x',
  startUrl: fact('start'),
  steps: [fact('step-one'), fact('step-two')],
  options: [fact('option-one'), fact('option-two')],
  waiting: { ...fact('waiting'), typicalDays: null },
  downloadWindow: { ...fact('download-window'), days: null },
  htmlExportHint: fact('html'),
  paths: { desktop: [fact('desktop')], mobile: [fact('mobile')] },
});

test('every real guide fact ID fits openLink and resolves its own English or German source', () => {
  for (const guide of guides) {
    for (const fact of inputFacts(guide)) {
      for (const locale of ['en', 'de'] as const) {
        const link = {
          kind: 'guide-source',
          platform: guide.platform,
          factId: fact.id,
          locale,
        } as const;
        expect(
          DesktopRequestSchema.parse({
            requestId: 'generated-guide-link',
            type: 'openLink',
            link,
          }),
        ).toEqual({
          requestId: 'generated-guide-link',
          type: 'openLink',
          link,
        });
        expect(resolveGuideLink(guides, link), `${fact.id}/${locale}`).toBe(
          locale === 'de' && fact.sourceDe
            ? fact.sourceDe.url
            : fact.source.url,
        );
      }
    }
  }
});

test('every fact field is searched, with distinct generated URLs and no input mutation', () => {
  const guide = sample();
  const before = structuredClone(guide);
  for (const fact of inputFacts(guide)) {
    for (const locale of ['en', 'de'] as const) {
      expect(
        resolveGuideLink([guide], {
          kind: 'guide-source',
          platform: 'x',
          factId: fact.id,
          locale,
        }),
        `${fact.id}/${locale}`,
      ).toBe(locale === 'de' ? fact.sourceDe!.url : fact.source.url);
    }
  }
  expect(guide).toEqual(before);
});

test('absent facts or platforms never resolve another guide or an untrusted ID as a URL', () => {
  const guide = sample();
  delete guide.paths;
  for (const [available, platform, factId] of [
    [[], 'x', guide.startUrl.id],
    [[guide], 'instagram', guide.startUrl.id],
    [[guide], 'x', 'x.unknown'],
    [[guide], 'x', 'x.desktop'],
    [[guide], 'x', 'x.mobile'],
    [guides, 'x', instagramGuide.startUrl.id],
    [guides, 'instagram', xGuide.startUrl.id],
    [guides, 'x', 'https://help.x.com/en/generated'],
  ] as const)
    expect(
      resolveGuideLink(available, {
        kind: 'guide-source',
        platform,
        factId,
        locale: 'en',
      }),
    ).toBeNull();
});

test('guide link red control: guide sources reject non-help destinations in either language', () => {
  for (const url of [
    'https://example.invalid/generated',
    'http://help.x.com/en/generated',
    'https://x.com/generated/status/123',
    'https://www.instagram.com/p/generated/',
    'https://github.com/socialprune/socialprune/issues/new',
    'https://help.x.com.example.invalid/generated',
    'https://example.invalid/?next=https://help.x.com/',
    'https://www.facebook.com/help/123/',
    'https://www.facebook.com/help/instagram-extra/123/',
    'https://help.x.com:444/generated',
    'https://user:password@help.x.com/generated',
    ['javascript', 'alert(1)'].join(':'),
    'file:///generated',
    'not a URL',
  ]) {
    const guide = sample();
    guide.startUrl.source.url = url;
    for (const locale of ['en', 'de'] as const) {
      if (locale === 'de') guide.startUrl.sourceDe!.url = url;
      expect(
        resolveGuideLink([guide], {
          kind: 'guide-source',
          platform: 'x',
          factId: guide.startUrl.id,
          locale,
        }),
        `${locale}/${url}`,
      ).toBeNull();
    }
    delete guide.startUrl.sourceDe;
    expect(
      resolveGuideLink([guide], {
        kind: 'guide-source',
        platform: 'x',
        factId: guide.startUrl.id,
        locale: 'de',
      }),
      `fallback/${url}`,
    ).toBeNull();
  }
});

test('all allowed help hosts resolve, and an invalid German source cannot fall back to English', () => {
  for (const url of [
    'https://help.x.com/en/generated',
    'https://help.instagram.com/123/?locale=de_DE',
    'https://www.facebook.com/help/instagram/123/',
  ]) {
    const guide = sample();
    guide.startUrl.source.url = url;
    delete guide.startUrl.sourceDe;
    for (const locale of ['en', 'de'] as const)
      expect(
        resolveGuideLink([guide], {
          kind: 'guide-source',
          platform: 'x',
          factId: guide.startUrl.id,
          locale,
        }),
      ).toBe(url);
    guide.startUrl.sourceDe = {
      ...guide.startUrl.source,
      url: 'https://example.invalid/generated',
    };
    expect(
      resolveGuideLink([guide], {
        kind: 'guide-source',
        platform: 'x',
        factId: guide.startUrl.id,
        locale: 'de',
      }),
    ).toBeNull();
  }
});

test('guide-report resolves only the fixed existing report URL through the public core subpath', () => {
  // Existing report destination in apps/web/src/guide/Guide.tsx.
  const expected = 'https://github.com/socialprune/socialprune/issues/new';
  expect(REPORT_URL).toBe(expected);
  expect(resolveGuideLink([], { kind: 'guide-report' })).toBe(expected);
  expect(
    resolveGuideLink(guides, {
      kind: 'platform-post',
      url: 'https://x.com/generated/status/123',
    }),
  ).toBeNull();
  expect(import.meta.resolve('@socialprune/core/guide/link')).toBe(
    new URL('./link.ts', import.meta.url).href,
  );
});

import { expect, expectTypeOf, test } from 'vitest';
import type { GuideFact, PlatformGuide } from '@socialprune/core/guide/types';

test('guide types carry bilingual text and dated sources without guide content', () => {
  const fact: GuideFact = {
    id: 'synthetic-fact',
    text: { en: 'Generated test text.', de: 'Erzeugter Testtext.' },
    source: {
      url: 'https://example.invalid/generated-source',
      publisher: 'Synthetic publisher',
      title: 'Generated source title',
    },
    verifiedOn: '2026-10-07',
  };
  const guide: PlatformGuide = {
    platform: 'x',
    startUrl: fact,
    steps: [fact],
    options: [fact],
    waiting: { ...fact, typicalDays: null },
    downloadWindow: { ...fact, days: null },
    htmlExportHint: fact,
  };
  expectTypeOf<GuideFact['text']>().toEqualTypeOf<{
    en: string;
    de: string;
  }>();
  expectTypeOf<PlatformGuide['waiting']['typicalDays']>().toEqualTypeOf<{
    min: number;
    max: number;
  } | null>();
  expectTypeOf<PlatformGuide['downloadWindow']['days']>().toEqualTypeOf<
    number | null
  >();
  expectTypeOf<PlatformGuide['platform']>().toEqualTypeOf<'x' | 'instagram'>();
  expect(guide.waiting.typicalDays).toBeNull();
  expect(guide.downloadWindow.days).toBeNull();
  expect(guide.startUrl).toBe(fact);
});

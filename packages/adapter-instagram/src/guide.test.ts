import { expect, test } from 'vitest';
import { checkGuides } from '@socialprune/core/guide/check';
import { instagramGuide } from '@socialprune/adapter-instagram/guide';

test('Instagram guide data passes ordinary checks without inferred platform facts', () => {
  expect(
    checkGuides([instagramGuide], {
      today: '2026-10-08',
      maxAgeDays: 120,
      release: false,
    }),
  ).toEqual([]);
  expect(instagramGuide.waiting.typicalDays).toBeNull();
  expect(instagramGuide.downloadWindow.days).toBeNull();
  expect(instagramGuide.startUrl.text.en).toContain('HTTP 400');
  expect(instagramGuide.startUrl.text.de).toContain('HTTP 400');
  expect(instagramGuide.startUrl.verifiedOn).toBeNull();
  expect(
    checkGuides([instagramGuide], {
      today: '2026-10-08',
      maxAgeDays: 120,
      release: true,
    }).every(({ code }) => code === 'unverified'),
  ).toBe(true);
});

test('Instagram guide text contains no fetch-conversion artifacts', () => {
  const facts = [
    instagramGuide.startUrl,
    ...instagramGuide.steps,
    ...instagramGuide.options,
    instagramGuide.waiting,
    instagramGuide.downloadWindow,
    instagramGuide.htmlExportHint,
    ...(instagramGuide.paths?.desktop ?? []),
    ...(instagramGuide.paths?.mobile ?? []),
  ];
  for (const fact of facts) {
    for (const text of Object.values(fact.text)) {
      expect(text, fact.id).not.toContain('>x<');
      expect(text, fact.id).not.toContain('&gt;');
    }
  }
});

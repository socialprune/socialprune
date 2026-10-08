import { expect, test } from 'vitest';
import { checkGuides } from '@socialprune/core/guide/check';
import { xGuide } from '@socialprune/adapter-x/guide';

test('X guide data passes ordinary checks without pretending to be human-verified', () => {
  expect(
    checkGuides([xGuide], {
      today: '2026-10-08',
      maxAgeDays: 120,
      release: false,
    }),
  ).toEqual([]);
  expect(xGuide.waiting.typicalDays).toBeNull();
  expect(xGuide.downloadWindow.days).toBeNull();
  expect(xGuide.waiting.text.en).toContain('X says');
  expect(xGuide.waiting.text.de).toContain('X gibt an');
  expect(xGuide.startUrl.source.title).toBe(
    'How to download your X archive | X Help Center',
  );
  expect(xGuide.startUrl.sourceDe?.title).toBe(
    'So lädst du dein X Archiv herunter | X Hilfe-Center',
  );
  expect(xGuide.startUrl.verifiedOn).toBeNull();
  expect(
    checkGuides([xGuide], {
      today: '2026-10-08',
      maxAgeDays: 120,
      release: true,
    }).every(({ code }) => code === 'unverified'),
  ).toBe(true);
});

test('X guide text contains no fetch-conversion artifacts', () => {
  const facts = [
    xGuide.startUrl,
    ...xGuide.steps,
    ...xGuide.options,
    xGuide.waiting,
    xGuide.downloadWindow,
    xGuide.htmlExportHint,
    ...(xGuide.paths?.desktop ?? []),
    ...(xGuide.paths?.mobile ?? []),
  ];
  for (const fact of facts) {
    for (const text of Object.values(fact.text)) {
      expect(text, fact.id).not.toContain('>x<');
      expect(text, fact.id).not.toContain('&gt;');
    }
  }
});

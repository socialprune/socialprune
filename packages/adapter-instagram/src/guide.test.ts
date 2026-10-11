import { expect, test } from 'vitest';
import { checkGuides } from '@socialprune/core/guide/check';
import { instagramGuide } from '@socialprune/adapter-instagram/guide';

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

test('Instagram guide has fresh researched facts but remains human-unverified', () => {
  expect(
    checkGuides([instagramGuide], {
      today: '2026-10-11',
      maxAgeDays: 120,
      release: false,
    }),
  ).toEqual([]);
  expect(instagramGuide.waiting.typicalDays).toBeNull();
  expect(instagramGuide.downloadWindow.days).toBe(4);
  for (const fact of facts) {
    expect(fact.retrievedOn, fact.id).toBe('2026-10-11');
    expect(fact.verifiedOn, fact.id).toBeNull();
    expect(fact.sourceDe, fact.id).toBeUndefined();
  }
  expect(
    checkGuides([instagramGuide], {
      today: '2026-10-11',
      maxAgeDays: 120,
      release: true,
    }),
  ).toEqual(
    facts.map(({ id }) => ({
      platform: 'instagram',
      factId: id,
      code: 'unverified',
      field: 'verifiedOn',
    })),
  );
});

test('Instagram steps and provenance follow the supplied public help evidence', () => {
  expect(instagramGuide.steps.map(({ id }) => id)).toEqual([
    'instagram.request',
    'instagram.delivery',
  ]);
  expect(instagramGuide.startUrl.source.url).toBe(
    'https://www.facebook.com/help/instagram/181231772500920/',
  );
  expect(instagramGuide.steps[0]!.source.url).toBe(
    'https://www.facebook.com/help/instagram/android-app/181231772500920',
  );
  expect(instagramGuide.options[0]!.source.url).toBe(
    'https://www.facebook.com/help/instagram/7130835797039956?locale=en_GB',
  );
  for (const label of [
    '"More"',
    '"Settings"',
    '"Meta Account"',
    '"Your information and permissions"',
    '"Start export"',
  ]) {
    for (const text of Object.values(instagramGuide.startUrl.text))
      expect(text).toContain(label);
  }
  for (const label of [
    '"Meta Account"',
    '"Your information and permissions"',
    '"Export your information"',
    '"Create export"',
    '"Next"',
    '"Export to device"',
    '"Start export"',
    '"Accounts Center"',
  ]) {
    for (const text of Object.values(instagramGuide.steps[0]!.text))
      expect(text).toContain(label);
  }
  expect(instagramGuide.waiting.text.en).toContain('Meta says');
  expect(instagramGuide.waiting.text.de).toContain('Meta gibt an');
  for (const text of Object.values(instagramGuide.waiting.text))
    expect(text).toContain('30');
  for (const text of Object.values(instagramGuide.downloadWindow.text))
    expect(text).toContain('4');
  expect(instagramGuide.startUrl.text.de).toContain(
    'die deutschen Namen sind noch nicht bestätigt',
  );
  expect(instagramGuide.options[0]!.text.en).toContain('Edits');
  expect(instagramGuide.options[0]!.text.de).toContain('Edits');
  for (const text of facts.flatMap(({ text }) => Object.values(text))) {
    expect(text).not.toContain('HTTP 400');
    expect(text).not.toContain('"All time"');
  }
});

test('Instagram guide text contains no fetch-conversion artifacts', () => {
  for (const fact of facts) {
    for (const text of Object.values(fact.text)) {
      expect(text, fact.id).not.toContain('>x<');
      expect(text, fact.id).not.toContain('&gt;');
    }
  }
});

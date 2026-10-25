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

test('Instagram guide carries the maintainer confirmation and passes release checks', () => {
  expect(
    checkGuides([instagramGuide], {
      today: '2026-10-25',
      maxAgeDays: 120,
      release: false,
    }),
  ).toEqual([]);
  expect(instagramGuide.waiting.typicalDays).toBeNull();
  expect(instagramGuide.downloadWindow.days).toBe(4);
  expect(facts).toHaveLength(9);
  for (const fact of facts) {
    expect(fact.retrievedOn, fact.id).toBe('2026-10-25');
    expect(fact.verifiedOn, fact.id).toBe('2026-10-25');
    if (['instagram.start', 'instagram.download-window'].includes(fact.id)) {
      expect(fact.sourceDe?.url, fact.id).toBe(
        'https://www.facebook.com/help/instagram/181231772500920/?locale=de_DE',
      );
    } else if (fact.id === 'instagram.request') {
      expect(fact.sourceDe?.url).toBe(
        'https://www.facebook.com/help/instagram/android-app/181231772500920?locale=de_DE',
      );
    } else expect(fact.sourceDe, fact.id).toBeUndefined();
  }
  expect(
    checkGuides([instagramGuide], {
      today: '2026-10-25',
      maxAgeDays: 120,
      release: true,
    }),
  ).toEqual([]);
});

test('Instagram steps and provenance follow the supplied public help evidence', () => {
  expect(instagramGuide.steps.map(({ id }) => id)).toEqual([
    'instagram.request',
    'instagram.delivery',
  ]);
  expect(instagramGuide.startUrl.source.url).toBe(
    'https://www.facebook.com/help/instagram/181231772500920',
  );
  expect(instagramGuide.steps[0]!.source.url).toBe(
    'https://www.facebook.com/help/instagram/android-app/181231772500920',
  );
  expect(instagramGuide.options[0]!.source.url).toBe(
    'https://www.facebook.com/help/instagram/7130835797039956?locale=en_GB',
  );
  for (const fact of [
    instagramGuide.steps[1]!,
    instagramGuide.waiting,
    instagramGuide.downloadWindow,
  ]) {
    expect(fact.source.url, fact.id).toBe(
      'https://www.facebook.com/help/instagram/181231772500920?locale=en_GB',
    );
  }
  for (const label of [
    '"More"',
    '"Settings"',
    '"Meta Account"',
    '"Your information and permissions"',
    '"Start export"',
  ]) {
    expect(instagramGuide.startUrl.text.en).toContain(label);
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
    expect(instagramGuide.steps[0]!.text.en).toContain(label);
  }
  expect(instagramGuide.waiting.text.en).toContain('Meta says');
  expect(instagramGuide.waiting.text.de).toContain('Meta gibt an');
  for (const text of Object.values(instagramGuide.waiting.text))
    expect(text).toContain('30');
  for (const text of Object.values(instagramGuide.downloadWindow.text))
    expect(text).toContain('4');
  for (const [de, en] of [
    ['Mehr', 'More'],
    ['Einstellungen', 'Settings'],
    ['Meta-Konto', 'Meta Account'],
    [
      'Deine Informationen und Berechtigungen',
      'Your information and permissions',
    ],
    ['Deine Informationen exportieren', 'Export your information'],
    ['Export erstellen', 'Create export'],
    ['Weiter', 'Next'],
    ['Zu Gerät exportieren', 'Export to device'],
    ['Export starten', 'Start export'],
    ['Kontenübersicht', 'Accounts Center'],
  ]) {
    const label = `„${de}“ („${en}“)`;
    expect(instagramGuide.startUrl.text.de).toContain(label);
    if (de !== 'Mehr' && de !== 'Einstellungen') {
      expect(instagramGuide.steps[0]!.text.de).toContain(label);
    }
    expect(instagramGuide.startUrl.text.de.split(label)).toHaveLength(2);
  }
  for (const text of Object.values(instagramGuide.startUrl.text)) {
    expect(text).toContain('≡');
    expect(text).not.toMatch(
      /observed|beobachtet|25 October|25\. Oktober|only the|ohne Text/,
    );
  }
  expect(instagramGuide.downloadWindow.text.de).toContain(
    '„Verfügbare Downloads“ („Available downloads“)',
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

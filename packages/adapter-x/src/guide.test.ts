import { expect, test } from 'vitest';
import { checkGuides, guideFacts } from '@socialprune/core/guide/check';
import { xGuide } from '@socialprune/adapter-x/guide';

test('X guide data carries the maintainer confirmation and passes release checks', () => {
  expect(
    checkGuides([xGuide], {
      today: '2026-10-25',
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
  expect(xGuide.startUrl.verifiedOn).toBe('2026-10-25');
  expect(guideFacts(xGuide)).toHaveLength(13);
  for (const fact of guideFacts(xGuide)) {
    expect(fact.retrievedOn, fact.id).toBe('2026-10-25');
    expect(fact.verifiedOn, fact.id).toBe('2026-10-25');
  }
  expect(
    checkGuides([xGuide], {
      today: '2026-10-25',
      maxAgeDays: 120,
      release: true,
    }),
  ).toEqual([]);
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

test('X computer guide preserves the differing public EN and DE help paths', () => {
  const desktop = xGuide.paths!.desktop[0]!;
  expect(desktop.id).toBe('x.desktop-missing');
  expect(desktop.source.url).toBe(
    'https://help.x.com/en/managing-your-account/accessing-your-x-data',
  );
  expect(desktop.sourceDe).toEqual({
    url: 'https://help.x.com/de/managing-your-account/accessing-your-x-data',
    publisher: 'X',
    title: 'Auf X Daten zugreifen und herunterladen | X Hilfe-Center',
  });
  for (const [de, en] of [
    ['Mehr', 'More'],
    ['Einstellungen und Datenschutz', 'Settings and privacy'],
    ['Einstellungen', 'Settings'],
    ['Daten und Berechtigungen', 'Data and permissions'],
    ['Deine X Daten', 'Your X data'],
    ['Archiv anfordern', 'Request archive'],
  ]) {
    const label = `„${de}“ („${en}“)`;
    expect(desktop.text.de).toContain(label);
    expect(desktop.text.de.split(label)).toHaveLength(2);
  }
  expect(desktop.text.de).toContain('„Account“');
  expect(desktop.text.de).toContain('„Daten und Berechtigungen“');
  expect(desktop.text.de).toContain('„Deine X Daten“');
  expect(desktop.text.de).toContain('öffentlichen englischen Archivhilfe');
  expect(desktop.text.de).toContain(
    'deutschen Downloadanleitung nicht gelesen',
  );
  expect(desktop.text.de).toContain('Bestätige dein Passwort');
  for (const label of [
    'Your account',
    'Download an archive of your data',
    'Request archive',
  ])
    expect(desktop.text.en).toContain(label);
  expect(desktop.text.en).toContain('Confirm your password');
  expect(desktop.text.en).toContain(
    'German help page describes a different route',
  );
  for (const text of Object.values(desktop.text)) {
    expect(text).not.toMatch(/observed|beobachtet|25 October|25\. Oktober/);
  }
  expect(desktop.verifiedOn).toBe('2026-10-25');
});

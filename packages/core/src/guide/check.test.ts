import { describe, expect, it } from 'vitest';
import { checkGuides } from '@socialprune/core/guide/check';
import type { GuideFact, PlatformGuide } from '@socialprune/core/guide/types';

const options = { today: '2026-10-08', maxAgeDays: 120, release: false };
const fact = (id: string): GuideFact => ({
  id,
  text: { en: 'Generated English fact.', de: 'Erzeugter deutscher Text.' },
  source: {
    url: 'https://help.x.com/en/generated-test',
    publisher: 'Generated',
    title: 'Generated help',
  },
  retrievedOn: '2026-10-08',
  verifiedOn: '2026-10-08',
});
const sample = (): PlatformGuide => ({
  platform: 'x',
  startUrl: fact('start'),
  steps: [fact('step')],
  options: [fact('option')],
  waiting: { ...fact('waiting'), typicalDays: null },
  downloadWindow: { ...fact('window'), days: null },
  htmlExportHint: fact('html'),
});

describe('platform-free guide check', () => {
  it('accepts bilingual facts with valid dates in ordinary and release checks', () => {
    expect(checkGuides([sample()], options)).toEqual([]);
    expect(checkGuides([sample()], { ...options, release: true })).toEqual([]);
  });

  it('a null human verification date is the sole release failure', () => {
    const guide = sample();
    guide.waiting.verifiedOn = null;
    expect(checkGuides([guide], options)).toEqual([]);
    expect(checkGuides([guide], { ...options, release: true })).toEqual([
      {
        platform: 'x',
        factId: 'waiting',
        code: 'unverified',
        field: 'verifiedOn',
      },
    ]);
  });

  it('admits exactly the public help hosts and Meta Instagram path', () => {
    for (const url of [
      'https://help.x.com/de/generated-test',
      'https://help.instagram.com/123/?locale=de_DE',
      'https://www.facebook.com/help/instagram/123/',
    ]) {
      const guide = sample();
      guide.startUrl.source.url = url;
      expect(checkGuides([guide], options), url).toEqual([]);
    }
    for (const url of [
      'http://help.x.com/en/generated-test',
      'https://x.com/settings/account',
      'https://instagram.com/',
      'https://help.x.com.example.invalid/',
      'https://example.invalid/?next=https://help.x.com/',
      'https://www.facebook.com/help/123/',
      'https://www.facebook.com/help/instagram-extra/123/',
      'https://help.x.com:444/',
      'https://user:password@help.x.com/',
      'not a URL',
    ]) {
      const guide = sample();
      guide.startUrl.source.url = url;
      expect(checkGuides([guide], options), url).toMatchObject([
        { code: 'invalid-source' },
      ]);
    }
  });

  it('requires both nonblank languages, steps and unique fact IDs across guides', () => {
    const guide = sample();
    guide.startUrl.text.en = ' ';
    guide.startUrl.text.de = '\n';
    guide.steps = [];
    guide.htmlExportHint.id = guide.waiting.id;
    expect(checkGuides([guide], options).map(({ code }) => code)).toEqual([
      'no-steps',
      'missing-text',
      'missing-text',
      'duplicate-id',
    ]);
    expect(
      checkGuides([sample(), sample()], options).filter(
        ({ code }) => code === 'duplicate-id',
      ),
    ).toHaveLength(6);
    guide.startUrl.id = ' ';
    expect(checkGuides([guide], options)).toContainEqual({
      platform: 'x',
      factId: ' ',
      code: 'invalid-id',
    });
    expect(checkGuides([], options)).toEqual([
      { platform: null, factId: null, code: 'no-guides' },
    ]);
  });

  it('rejects impossible and noncalendar dates, including unreleased data', () => {
    for (const value of [
      '2026-02-29',
      '2026-04-31',
      '2026-13-01',
      '2026-10-8',
      '0000-01-01',
      '',
      '2026-10-08T00:00:00Z',
    ]) {
      for (const field of ['retrievedOn', 'verifiedOn'] as const) {
        const guide = sample();
        guide.startUrl[field] = value;
        expect(checkGuides([guide], options), value).toContainEqual({
          platform: 'x',
          factId: 'start',
          code: 'invalid-date',
          field,
        });
      }
    }
    const leap = sample();
    leap.startUrl.retrievedOn = '2024-02-29';
    expect(checkGuides([leap], options)).toEqual([]);
  });

  it('enforces the exact age boundary and rejects future dates', () => {
    const guide = sample();
    guide.startUrl.verifiedOn = '2026-06-10'; // Exactly 120 calendar days.
    expect(checkGuides([guide], { ...options, release: true })).toEqual([]);
    guide.startUrl.verifiedOn = '2026-06-09';
    expect(checkGuides([guide], options)).toEqual([]);
    expect(checkGuides([guide], { ...options, release: true })).toContainEqual({
      platform: 'x',
      factId: 'start',
      code: 'stale',
      field: 'verifiedOn',
    });
    guide.startUrl.verifiedOn = '2026-10-09';
    expect(checkGuides([guide], options)).toContainEqual({
      platform: 'x',
      factId: 'start',
      code: 'future-date',
      field: 'verifiedOn',
    });
    guide.startUrl.retrievedOn = '2026-10-09';
    expect(checkGuides([guide], options)).toContainEqual({
      platform: 'x',
      factId: 'start',
      code: 'future-date',
      field: 'retrievedOn',
    });
  });

  it('checks device-path facts too and fails closed on invalid options', () => {
    const guide = sample();
    guide.startUrl.sourceDe = {
      ...guide.startUrl.source,
      url: 'https://help.x.com/de/generated-test',
    };
    expect(checkGuides([guide], options)).toEqual([]);
    guide.startUrl.sourceDe.url = 'https://x.com/';
    expect(checkGuides([guide], options)).toContainEqual({
      platform: 'x',
      factId: 'start',
      code: 'invalid-source',
      field: 'sourceDe.url',
    });
    delete guide.startUrl.sourceDe;
    guide.paths = { desktop: [fact('desktop')], mobile: [fact('mobile')] };
    guide.paths.mobile[0]!.verifiedOn = null;
    expect(checkGuides([guide], { ...options, release: true })).toContainEqual({
      platform: 'x',
      factId: 'mobile',
      code: 'unverified',
      field: 'verifiedOn',
    });
    for (const maxAgeDays of [-1, 1.5, NaN, Infinity]) {
      expect(checkGuides([guide], { ...options, maxAgeDays })).toEqual([
        { platform: null, factId: null, code: 'invalid-options' },
      ]);
    }
    expect(checkGuides([guide], { ...options, today: '2026-02-30' })).toEqual([
      { platform: null, factId: null, code: 'invalid-options' },
    ]);
  });
});

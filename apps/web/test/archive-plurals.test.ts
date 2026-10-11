import { createIntl } from 'react-intl';
import { describe, expect, it } from 'vitest';
import de from '../src/i18n/de.json';
import en from '../src/i18n/en.json';

type CountMessage =
  | 'proto.archiveEntries'
  | 'proto.activeLabel'
  | 'proto.thread'
  | 'proto.ageNumber'
  | 'proto.mostLikes'
  | 'proto.lolCount';

function countFormatter(locale: 'de' | 'en') {
  const intl = createIntl({ locale, messages: locale === 'de' ? de : en });
  // Match useT's runtime boundary: React Intl's registered-ID overload cannot
  // express one function over this union. The assertions test ICU output.
  const format = intl.formatMessage as unknown as (
    descriptor: { id: CountMessage },
    values: { count: number },
  ) => string;
  return {
    intl,
    format: (id: CountMessage, count: number) => format({ id }, { count }),
  };
}

describe('archive and recap plural copy', () => {
  it('uses literal German singular forms without changing invariant labels', () => {
    const { intl, format } = countFormatter('de');
    expect(`${intl.formatNumber(1)} ${format('proto.archiveEntries', 1)}`).toBe(
      '1 Eintrag',
    );
    expect(format('proto.activeLabel', 1)).toBe(
      'dein aktivstes Jahr · 1 Eintrag',
    );
    expect(format('proto.thread', 1)).toBe('Dein Thread · 1 Beitrag');
    expect(format('proto.ageNumber', 1)).toBe('1 Jahr');
    expect(format('proto.mostLikes', 1)).toBe(
      'Gefällt mir beim beliebtesten Eintrag',
    );
    expect(format('proto.lolCount', 1)).toBe('Mal das Wort „lol“');
    for (const count of [0, 2]) {
      expect(format('proto.archiveEntries', count)).toBe('Einträge');
      expect(format('proto.mostLikes', count)).toBe(
        'Gefällt mir beim beliebtesten Eintrag',
      );
      expect(format('proto.lolCount', count)).toBe('Mal das Wort „lol“');
    }
    expect(format('proto.activeLabel', 0)).toBe(
      'dein aktivstes Jahr · 0 Einträge',
    );
    expect(format('proto.activeLabel', 2)).toBe(
      'dein aktivstes Jahr · 2 Einträge',
    );
    expect(format('proto.ageNumber', 2)).toBe('2 Jahre');
  });
  it('uses literal English singular forms and plural forms for zero or multiple', () => {
    const { intl, format } = countFormatter('en');
    expect(`${intl.formatNumber(1)} ${format('proto.archiveEntries', 1)}`).toBe(
      '1 entry',
    );
    expect(format('proto.activeLabel', 1)).toBe('your busiest year · 1 entry');
    expect(format('proto.thread', 1)).toBe('Your thread · 1 post');
    expect(format('proto.ageNumber', 1)).toBe('1 year');
    expect(format('proto.mostLikes', 1)).toBe('like on the most liked entry');
    expect(format('proto.lolCount', 1)).toBe('occurrence of the word “lol”');
    for (const count of [0, 2]) {
      expect(format('proto.archiveEntries', count)).toBe('entries');
      expect(format('proto.mostLikes', count)).toBe(
        'likes on the most liked entry',
      );
      expect(format('proto.lolCount', count)).toBe(
        'occurrences of the word “lol”',
      );
    }
    expect(format('proto.activeLabel', 0)).toBe(
      'your busiest year · 0 entries',
    );
    expect(format('proto.activeLabel', 2)).toBe(
      'your busiest year · 2 entries',
    );
    expect(format('proto.ageNumber', 2)).toBe('2 years');
  });
});

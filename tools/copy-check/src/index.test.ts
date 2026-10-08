import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { copyKind, inspectCopy, inspectText } from './index.ts';

describe('ADR-011 vocabulary, independent fixture oracles', () => {
  it('reports every forbidden fixture sentence, including German compounds', async () => {
    const cases = JSON.parse(
      await readFile(
        new URL('./fixtures/forbidden.json', import.meta.url),
        'utf8',
      ),
    ) as string[];
    expect(cases.length).toBeGreaterThan(40);
    for (const sentence of cases) {
      expect(inspectText(sentence), sentence).toHaveLength(1);
    }
    expect(inspectText('Für deine Sicherheit')[0]?.text).toBe('Sicherheit');
    expect(
      inspectText('SICHERHEITSFUNKTION UNENTDECKBAREM UMGEHUNGEN'),
    ).toHaveLength(3);
  });

  it('allows every backup word and Markdown exemption from independent input', async () => {
    const cases = JSON.parse(
      await readFile(
        new URL('./fixtures/allowed.json', import.meta.url),
        'utf8',
      ),
    ) as string[];
    expect(cases).toHaveLength(16);
    expect(inspectCopy('README.md', cases.join('\n'))).toEqual([]);
    expect(inspectText('sichere')).toHaveLength(1);
    expect(inspectText('Sicherheitskopien')).toHaveLength(1);
    expect(inspectText('Backup Sicherungskopien gesichert')).toEqual([]);
  });

  it('matches whole Unicode words and whole official phrases', () => {
    expect(inspectText('éSAFE safeé saferThing upload_file')).toEqual([]);
    expect(inspectText('(SAFE)!\nDELETES\tEVERYTHING')).toHaveLength(2);
    expect(inspectText('officially official exportation')).toHaveLength(1);
    expect(inspectText('offizielle Datenexporte')).toHaveLength(1);
    expect(inspectText('official data export official tool')).toHaveLength(1);
  });
});

describe('scope and Markdown parsing', () => {
  it('covers every specified source and excludes only non-message tests', () => {
    for (const path of [
      'apps/web/src/i18n/de.json',
      'apps/cli/src/cli/errors.ts',
      'apps/cli/src/commands/import.ts',
      'packages/core/src/guide/x.ts',
      'packages/core/src/guide/reminder.ics',
      'packages/adapter-x/src/guide.ts',
      'packages/adapter-instagram/src/guide.ts',
      'skills/socialprune/SKILL.md',
      'README.md',
      'docs/LESSONS_ARCHIVE.md',
      'docs/architecture/adrs/ADR-011-internationalization.md',
    ]) {
      expect(copyKind(path), path).not.toBeNull();
    }
    for (const path of [
      'AGENTS.md',
      '.kilo/rules/human-writing-style.md',
      'tools/copy-check/src/fixtures/forbidden.json',
      'apps/cli/src/cli/errors.test.ts',
      'packages/core/src/guide/types.d.ts',
      'packages/adapter-x/src/guide.test.ts',
      'packages/adapter-instagram/src/guide.test.ts',
      'PLAN.md',
      'private/export.json',
      'fixtures/synthetic/classify/items.jsonl',
    ]) {
      expect(copyKind(path), path).toBeNull();
    }
  });

  it('skips code spans, fences and link targets, but checks link text', () => {
    const content = [
      '`safe` and ``use `upload` here``',
      '```text',
      'guaranteed',
      '```',
      '~~~',
      'sicher',
      '~~~',
      '[Download](https://example.invalid/upload(foo)/safe)',
      '[safe](https://example.invalid/backup)',
      'An unmatched `safety is prose.',
    ].join('\n');
    expect(
      inspectCopy('README.md', content).map((entry) => entry.text),
    ).toEqual(['safe', 'safety']);
    expect(inspectCopy('README.md', content)[0]?.line).toBe(9);
  });

  it('exempts only the named design section, not the rest of the document', () => {
    const text = [
      '## Content',
      '### Forbidden words',
      'safe',
      '#### Examples',
      'sicher',
      '### Copy examples',
      'safe',
    ].join('\n');
    expect(inspectCopy('docs/design/README.md', text)).toMatchObject([
      { line: 7, text: 'safe' },
    ]);
    expect(inspectCopy('docs/another.md', text)).toHaveLength(3);
  });

  it('ignores reference and autolink destinations, never their labels', () => {
    const text = [
      '[Download][platform]',
      '[platform]: https://example.invalid/safe "upload target"',
      '<https://example.invalid/safety>',
      '[guaranteed][platform]',
    ].join('\n');
    expect(inspectCopy('README.md', text)).toMatchObject([
      { line: 4, text: 'guaranteed' },
    ]);
  });

  it('checks catalog values after JSON decoding, including code-looking text', () => {
    expect(
      inspectCopy('apps/web/src/i18n/en.json', '{"id":"`safe`"}'),
    ).toHaveLength(1);
    expect(
      inspectCopy('apps/web/src/i18n/en.json', '{"id":"s\\u0061fe"}'),
    ).toHaveLength(1);
    expect(() =>
      inspectCopy('apps/web/src/i18n/en.json', '{"id":null}'),
    ).toThrow();
  });

  it('checks CLI strings and guide template fragments without Markdown skips', () => {
    expect(
      inspectCopy(
        'apps/cli/src/cli/errors.ts',
        "export const message = 'Proceed safely'; // safe is not a message",
      ),
    ).toHaveLength(1);
    expect(
      inspectCopy(
        'packages/core/src/guide/reminder.ts',
        'export const text = `SUMMARY:Für deine Sicherheit\\nDESCRIPTION:${name} ist sicher`;',
      ).map((entry) => entry.text),
    ).toEqual(['Sicherheit', 'sicher']);
    expect(
      inspectCopy('packages/core/src/guide/reminder.ics', 'SUMMARY:hochladen'),
    ).toHaveLength(1);
    expect(
      inspectCopy('apps/cli/src/cli/errors.ts', "const message = '`safe`';"),
    ).toHaveLength(1);
  });

  it('rejects a forbidden word in either adapter guide and calendar catalog text', () => {
    for (const path of [
      'packages/adapter-x/src/guide.ts',
      'packages/adapter-instagram/src/guide.ts',
    ]) {
      expect(
        inspectCopy(
          path,
          "export const fact = { text: { en: 'A safe export', de: 'Erzeugter Text' } };",
        ),
        path,
      ).toMatchObject([{ path, text: 'safe', rule: 'forbidden-word' }]);
      expect(
        inspectCopy(
          path,
          "export const fact = { text: { en: 'A data export', de: 'Erzeugter Text' } };",
        ),
        path,
      ).toEqual([]);
    }
    expect(
      inspectCopy(
        'apps/web/src/i18n/en.json',
        '{"guide.calendarSummary":"Check your safe export"}',
      ),
    ).toMatchObject([{ text: 'safe' }]);
  });
});

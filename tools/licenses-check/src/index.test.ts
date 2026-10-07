import { describe, expect, it } from 'vitest';
import {
  checkLicenses,
  licenseAllowed,
  parseExceptions,
  parseInventory,
} from './index.ts';

describe('ADR-002 license expressions', () => {
  it.each(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'Apache-2.0'])(
    'allows %s',
    (license) => expect(licenseAllowed(license)).toBe(true),
  );

  it.each([
    'GPL-3.0-only',
    'LGPL-3.0-only',
    'AGPL-3.0-only',
    'MPL-2.0',
    'BlueOak-1.0.0',
    'Apache-2.0 WITH LLVM-exception',
    'SEE LICENSE IN LICENSE.txt',
    'UNKNOWN',
    'UNKNOWN OR MIT',
    'Unlicensed',
    'MIT OR',
    'MIT nonsense',
    'MIT / ISC',
    '(MIT',
    'MIT)',
    '',
    null,
  ])('rejects %s', (license) => expect(licenseAllowed(license)).toBe(false));

  it('applies OR, AND, parentheses and operator precedence', () => {
    expect(licenseAllowed('GPL-3.0-only OR MIT')).toBe(true);
    expect(licenseAllowed('MIT AND GPL-3.0-only')).toBe(false);
    expect(licenseAllowed('MIT AND ISC')).toBe(true);
    expect(licenseAllowed('MIT OR GPL-3.0-only AND MPL-2.0')).toBe(true);
    expect(licenseAllowed('(MIT OR GPL-3.0-only) AND MPL-2.0')).toBe(false);
    expect(licenseAllowed('(MIT AND ISC) OR MPL-2.0')).toBe(true);
  });
});

describe('pnpm inventory and exact-version exceptions', () => {
  it('uses entry metadata, never its grouping label, and counts every version', () => {
    const inventory = parseInventory({
      MIT: [
        { name: 'allowed', versions: ['1.0.0', '1.1.0'], license: 'ISC' },
        { name: 'planted-gpl', versions: ['2.0.0'], license: 'GPL-3.0-only' },
        { name: 'missing', versions: ['1.0.0'] },
      ],
    });
    const result = checkLicenses(inventory);
    expect(result.packages).toBe(4);
    expect(result.counts).toEqual({
      ISC: 2,
      'GPL-3.0-only': 1,
      '<missing>': 1,
    });
    expect(result.failures.map((entry) => entry.name)).toEqual([
      'missing',
      'planted-gpl',
    ]);
  });

  it('accepts only the listed package and version with an ADR reference', () => {
    const exceptions = parseExceptions([
      {
        name: 'candidate',
        version: '1.0.0',
        adr: 'docs/architecture/adrs/ADR-002-dependency-licenses.md',
      },
    ]);
    const report = checkLicenses(
      [
        { name: 'candidate', version: '1.0.0', license: 'BlueOak-1.0.0' },
        { name: 'candidate', version: '1.0.1', license: 'BlueOak-1.0.0' },
      ],
      exceptions,
    );
    expect(report.exceptions).toBe(1);
    expect(report.failures).toEqual([
      { name: 'candidate', version: '1.0.1', license: 'BlueOak-1.0.0' },
    ]);
  });

  it('requires recorded text for missing or indirect metadata', () => {
    const exception = {
      name: 'candidate',
      version: '1.0.0',
      adr: 'docs/architecture/adrs/ADR-002-dependency-licenses.md',
    };
    for (const license of [null, 'UNKNOWN', 'SEE LICENSE IN LICENSE']) {
      const entry = { name: 'candidate', version: '1.0.0', license };
      expect(checkLicenses([entry], [exception]).failures).toEqual([entry]);
      expect(
        checkLicenses([entry], [{ ...exception, licenseText: 'Read text.' }])
          .failures,
      ).toEqual([]);
    }
  });

  it('rejects vacuous, malformed or contradictory input', () => {
    for (const value of [{}, [], { MIT: [] }, { MIT: [{}] }]) {
      expect(() => parseInventory(value)).toThrow();
    }
    expect(() =>
      parseInventory({
        MIT: [{ name: 'a', versions: ['1.0.0'], license: 'MIT' }],
        ISC: [{ name: 'a', versions: ['1.0.0'], license: 'ISC' }],
      }),
    ).toThrow();
    expect(() =>
      parseExceptions([{ name: 'a', version: '*', adr: 'ADR-002' }]),
    ).toThrow();
    expect(parseExceptions([])).toEqual([]);
  });
});

export const ALLOWED_LICENSES = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'Apache-2.0',
]);

export interface LicensedPackage {
  name: string;
  version: string;
  license: string | null;
}

export interface LicenseException {
  name: string;
  version: string;
  adr: string;
  licenseText?: string;
}

export interface LicenseReport {
  packages: number;
  counts: Record<string, number>;
  exceptions: number;
  failures: LicensedPackage[];
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function licenseAllowed(expression: string | null): boolean {
  if (
    !expression ||
    /SEE LICENSE IN|\b(?:unknown|unlicensed|noassertion|none)\b/i.test(
      expression,
    )
  ) {
    return false;
  }
  const tokens = expression.match(/[A-Za-z0-9][A-Za-z0-9.+-]*|[()]/g) ?? [];
  if (tokens.join('') !== expression.replace(/\s/g, '')) return false;
  let cursor = 0;
  function atom(): boolean {
    const token = tokens[cursor++];
    if (token === '(') {
      const result = or();
      if (tokens[cursor++] !== ')') throw new Error('Unclosed expression.');
      return result;
    }
    if (!token || ['OR', 'AND', 'WITH', ')'].includes(token)) {
      throw new Error('Expected a license identifier.');
    }
    if (tokens[cursor] === 'WITH') {
      cursor++;
      const exception = tokens[cursor++];
      if (!exception || ['OR', 'AND', 'WITH', '(', ')'].includes(exception)) {
        throw new Error('Expected an SPDX exception.');
      }
      return ALLOWED_LICENSES.has(`${token} WITH ${exception}`);
    }
    return ALLOWED_LICENSES.has(token);
  }
  function and(): boolean {
    let result = atom();
    while (tokens[cursor] === 'AND') {
      cursor++;
      const right = atom();
      result = result && right;
    }
    return result;
  }
  function or(): boolean {
    let result = and();
    while (tokens[cursor] === 'OR') {
      cursor++;
      const right = and();
      result = result || right;
    }
    return result;
  }
  try {
    const result = or();
    return cursor === tokens.length && result;
  } catch {
    return false;
  }
}

export function parseInventory(value: unknown): LicensedPackage[] {
  if (!record(value) || Object.keys(value).length === 0) {
    throw new Error('License inventory must contain groups.');
  }
  const packages = new Map<string, LicensedPackage>();
  for (const group of Object.values(value)) {
    if (!Array.isArray(group)) throw new Error('Invalid license group.');
    for (const entry of group as unknown[]) {
      if (
        !record(entry) ||
        typeof entry.name !== 'string' ||
        entry.name.length === 0 ||
        !Array.isArray(entry.versions) ||
        entry.versions.length === 0
      ) {
        throw new Error('Invalid package identity.');
      }
      const license =
        typeof entry.license === 'string' && entry.license.trim()
          ? entry.license.trim()
          : null;
      for (const version of entry.versions as unknown[]) {
        if (typeof version !== 'string' || !version) {
          throw new Error('Invalid package version.');
        }
        const id = `${entry.name}@${version}`;
        const previous = packages.get(id);
        if (previous && previous.license !== license) {
          throw new Error(`Conflicting license metadata for ${id}.`);
        }
        packages.set(id, { name: entry.name, version, license });
      }
    }
  }
  if (packages.size === 0) throw new Error('License inventory is empty.');
  return [...packages.values()].sort((a, b) =>
    `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
  );
}

export function parseExceptions(value: unknown): LicenseException[] {
  if (!Array.isArray(value)) throw new Error('Exceptions must be an array.');
  const seen = new Set<string>();
  return value.map((entry: unknown) => {
    if (
      !record(entry) ||
      Object.keys(entry).some(
        (key) => !['name', 'version', 'adr', 'licenseText'].includes(key),
      ) ||
      typeof entry.name !== 'string' ||
      !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(entry.name) ||
      typeof entry.version !== 'string' ||
      !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(
        entry.version,
      ) ||
      typeof entry.adr !== 'string' ||
      !/^docs\/architecture\/adrs\/ADR-\d{3}-[a-z0-9-]+\.md$/.test(entry.adr) ||
      (entry.licenseText !== undefined &&
        (typeof entry.licenseText !== 'string' || !entry.licenseText.trim()))
    ) {
      throw new Error('Invalid exact-version exception or ADR reference.');
    }
    const key = `${entry.name}@${entry.version}`;
    if (seen.has(key)) throw new Error(`Duplicate exception for ${key}.`);
    seen.add(key);
    return {
      name: entry.name,
      version: entry.version,
      adr: entry.adr,
      ...(typeof entry.licenseText === 'string'
        ? { licenseText: entry.licenseText }
        : {}),
    };
  });
}

export function checkLicenses(
  packages: readonly LicensedPackage[],
  exceptions: readonly LicenseException[] = [],
): LicenseReport {
  const report: LicenseReport = {
    packages: packages.length,
    counts: {},
    exceptions: 0,
    failures: [],
  };
  for (const entry of packages) {
    const label = entry.license ?? '<missing>';
    report.counts[label] = (report.counts[label] ?? 0) + 1;
    if (licenseAllowed(entry.license)) continue;
    const exception = exceptions.find(
      (candidate) =>
        candidate.name === entry.name && candidate.version === entry.version,
    );
    const missingText =
      !entry.license ||
      /SEE LICENSE IN|\b(?:unknown|unlicensed|noassertion|none)\b/i.test(
        entry.license,
      );
    if (exception && (!missingText || exception.licenseText)) {
      report.exceptions++;
    } else {
      report.failures.push(entry);
    }
  }
  return report;
}

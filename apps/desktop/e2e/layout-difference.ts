import { isDeepStrictEqual } from 'node:util';

// These are schema field names and semantic path classes, never paths or
// registry value contents. Unknown keys/markers are grouped, not echoed.
const fields = [
  ['install', 'program-folder'],
  ['data', 'data-folder'],
  ['installExists', 'program-folder'],
  ['dataExists', 'data-folder'],
  ['registrationExists', 'uninstall-registration'],
  ['updateExists', 'program-folder'],
  ['shortcuts', 'start-menu-shortcut'],
  ['existingShortcuts', 'start-menu-shortcut'],
  ['registrations', 'uninstall-registration'],
  ['uninstallCommand', 'program-folder'],
  ['quietUninstallCommand', 'program-folder'],
] as const;
const markers = [
  ['uninstall-root:Registry64', 'registry-container'],
  ['uninstall-root:Registry32', 'registry-container'],
  ['known-folder:LocalApplicationData', 'known-folder'],
  ['known-folder:Programs', 'known-folder'],
  ['start-menu:Programs', 'start-menu-container'],
  ['registration:SocialPrune', 'uninstall-registration'],
  ['registration-value:UninstallString', 'uninstall-registration'],
  ['registration-value:QuietUninstallString', 'uninstall-registration'],
  ['program-folder', 'program-folder'],
  ['data-folder', 'data-folder'],
] as const;
function isLayout(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    'installExists' in value &&
    typeof value.installExists === 'boolean' &&
    'registrationExists' in value &&
    typeof value.registrationExists === 'boolean'
  );
}
function describe(value: unknown, pathClass: string) {
  return {
    type:
      value === undefined
        ? 'absent'
        : value === null
          ? 'null'
          : Array.isArray(value)
            ? 'array'
            : typeof value,
    pathClass,
  };
}
export function layoutDifference(actual: unknown, expected: unknown) {
  if (!isLayout(actual) || !isLayout(expected)) return null;
  const differences: {
    field: string;
    actual: { type: string; pathClass: string };
    expected: { type: string; pathClass: string };
  }[] = [];
  for (const [field, pathClass] of fields)
    if (!isDeepStrictEqual(actual[field], expected[field]))
      differences.push({
        field,
        actual: describe(actual[field], pathClass),
        expected: describe(expected[field], pathClass),
      });
  const a = Array.isArray(actual.absent) ? (actual.absent as unknown[]) : [];
  const b = Array.isArray(expected.absent)
    ? (expected.absent as unknown[])
    : [];
  for (const [marker, pathClass] of markers) {
    if (a.includes(marker) !== b.includes(marker))
      differences.push({
        field: 'absent.' + marker,
        actual: { type: a.includes(marker) ? 'marker' : 'absent', pathClass },
        expected: { type: b.includes(marker) ? 'marker' : 'absent', pathClass },
      });
  }
  const known = new Set<string>(markers.map(([marker]) => marker));
  if (
    !isDeepStrictEqual(
      a.filter((value) => typeof value !== 'string' || !known.has(value)),
      b.filter((value) => typeof value !== 'string' || !known.has(value)),
    )
  )
    differences.push({
      field: 'absent.other',
      actual: describe(actual.absent, 'diagnostic-marker'),
      expected: describe(expected.absent, 'diagnostic-marker'),
    });
  if (
    !isDeepStrictEqual(actual.absent, expected.absent) &&
    !differences.some((row) => row.field.startsWith('absent.'))
  )
    differences.push({
      field: 'absent.order-or-shape',
      actual: describe(actual.absent, 'diagnostic-marker'),
      expected: describe(expected.absent, 'diagnostic-marker'),
    });
  const names = new Set<string>([...fields.map(([name]) => name), 'absent']);
  const rest = (value: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(value).filter(([name]) => !names.has(name)),
    );
  if (!isDeepStrictEqual(rest(actual), rest(expected)))
    differences.push({
      field: 'other-layout-fields',
      actual: describe(rest(actual), 'unknown'),
      expected: describe(rest(expected), 'unknown'),
    });
  return { fields: differences };
}

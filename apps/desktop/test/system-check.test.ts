import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import * as system from '../packaging/system-check.ts';
import { WINDOWS_QUERY_TIMEOUT_MS } from '../packaging/windows-powershell.ts';

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const row = (
  name: string,
  values: Record<string, string>,
  strict = false,
  appReference = false,
) => ({
  name,
  count: 1,
  strict,
  appReference,
  fields: Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, hash(value)]),
  ),
});
const empty = () => ({
  version: 2,
  services: [],
  tasks: [],
  runKeys: [],
  firewall: [],
  startup: [],
  listeners: [],
});
const compare = (before: object, after: object) =>
  system.assertSystemUnchanged(
    before as system.SystemSnapshot,
    after as system.SystemSnapshot,
  );

test('snapshot limit retains at least three times the measured restricted maximum and the cold-query floor', () => {
  const measuredMax = Math.max(44_131, 18_354, 16_475);
  expect(system.SYSTEM_SNAPSHOT_TIMEOUT_MS).toBe(
    Math.max(
      WINDOWS_QUERY_TIMEOUT_MS,
      Math.ceil((measuredMax * 3) / 1000) * 1000,
    ),
  );
  expect(
    system.SYSTEM_SNAPSHOT_TIMEOUT_MS / measuredMax,
  ).toBeGreaterThanOrEqual(3);
});

test('a system-owned StartMode-only change is a persistent field-name diagnostic, not app damage', () => {
  const before = {
    ...empty(),
    services: [
      row('BITS', { StartMode: 'Manual', PathName: 'Windows service' }),
    ],
  };
  const after = {
    ...empty(),
    services: [row('BITS', { StartMode: 'Auto', PathName: 'Windows service' })],
  };
  expect(compare(before, after)).toEqual([
    {
      inventory: 'services',
      name: 'BITS',
      fields: ['StartMode'],
      reason: 'unattributed-system-configuration',
    },
  ]);
  expect(JSON.stringify(compare(before, after))).not.toMatch(
    /Manual|Auto|Windows service|[a-f0-9]{64}/,
  );
});

test('either old or new app attribution refuses service and task configuration changes', () => {
  for (const inventory of ['services', 'tasks'] as const)
    for (const old of [false, true]) {
      const field = inventory === 'services' ? 'PathName' : 'Actions';
      const before = {
        ...empty(),
        [inventory]: [
          row(
            'invented',
            {
              [field]: old
                ? 'C:\\Users\\Generated\\AppData\\Local\\Programs\\SocialPrune\\SocialPrune.exe'
                : 'Windows',
            },
            false,
            old,
          ),
        ],
      };
      const after = {
        ...empty(),
        [inventory]: [
          row(
            'invented',
            {
              [field]: old
                ? 'Windows'
                : '<Exec><Command>SocialPrune.exe</Command></Exec>',
            },
            false,
            !old,
          ),
        ],
      };
      expect(() => compare(before, after)).toThrow(
        `SYSTEM_CHANGED:${inventory}`,
      );
    }
});

test('a diagnostic and a rejected change both survive the same comparison', () => {
  const before = {
    ...empty(),
    services: [row('BITS', { StartMode: 'Manual' })],
    runKeys: [row('HKCU', { Value: 'before' }, true)],
  };
  const after = {
    ...empty(),
    services: [row('BITS', { StartMode: 'Auto' })],
    runKeys: [row('HKCU', { Value: 'after' }, true)],
  };
  const result = system.compareSystemSnapshots(
    before as system.SystemSnapshot,
    after as system.SystemSnapshot,
  );
  expect(result.diagnostics).toEqual([
    {
      inventory: 'services',
      name: 'BITS',
      fields: ['StartMode'],
      reason: 'unattributed-system-configuration',
    },
  ]);
  expect(result.failures).toEqual([
    {
      inventory: 'runKeys',
      name: 'HKCU',
      fields: ['Value'],
      reason: 'user-writable',
    },
  ]);
});

test('an unchanged snapshot ignores foreign sockets but refuses ownership metadata drift', () => {
  const before = {
    ...empty(),
    services: [row('generated', { StartMode: 'Manual' })],
  };
  expect(compare(before, { ...before, listeners: ['tcp|foreign'] })).toEqual(
    [],
  );
  expect(() =>
    compare(before, {
      ...empty(),
      services: [{ ...before.services[0], strict: true }],
    }),
  ).toThrow('SYSTEM_CHANGED:services');
  expect(() =>
    compare(before, {
      ...empty(),
      services: [{ ...before.services[0], appReference: true }],
    }),
  ).toThrow('SYSTEM_CHANGED:services');
});

test('added and removed names fail in all inventories without a named allowlist', () => {
  for (const inventory of [
    'services',
    'tasks',
    'runKeys',
    'firewall',
    'startup',
  ] as const) {
    const snapshot = {
      ...empty(),
      [inventory]: [row('invented', { Configuration: 'generated' })],
    };
    expect(() => compare(empty(), snapshot)).toThrow(
      `SYSTEM_CHANGED:${inventory}`,
    );
    expect(() => compare(snapshot, empty())).toThrow(
      `SYSTEM_CHANGED:${inventory}`,
    );
  }
});

test('any configuration change on a user-writable surface fails, independent of attribution', () => {
  for (const inventory of [
    'services',
    'tasks',
    'runKeys',
    'firewall',
    'startup',
  ] as const) {
    const before = {
      ...empty(),
      [inventory]: [row('HKCU-or-user-owned', { Value: 'old' }, true)],
    };
    const after = {
      ...empty(),
      [inventory]: [row('HKCU-or-user-owned', { Value: 'new' }, false)],
    };
    expect(() => compare(before, after)).toThrow(`SYSTEM_CHANGED:${inventory}`);
  }
});

test('unattributed task, machine Run, firewall and common-startup changes identify only changed fields', () => {
  for (const inventory of [
    'tasks',
    'runKeys',
    'firewall',
    'startup',
  ] as const) {
    const before = {
      ...empty(),
      [inventory]: [row('Windows-owned', { Actions: 'same', Triggers: 'old' })],
    };
    const after = {
      ...empty(),
      [inventory]: [row('Windows-owned', { Actions: 'same', Triggers: 'new' })],
    };
    expect(compare(before, after)).toEqual([
      {
        inventory,
        name: 'Windows-owned',
        fields: ['Triggers'],
        reason: 'unattributed-system-configuration',
      },
    ]);
  }
});

test('unknown row shape, duplicate identity and multiplicity changes never pass', () => {
  const a = row('generated', { Value: 'one' });
  expect(() => compare({ ...empty(), services: [a, a] }, empty())).toThrow();
  expect(() =>
    compare(
      { ...empty(), services: [a] },
      { ...empty(), services: [{ ...a, count: 2 }] },
    ),
  ).toThrow('SYSTEM_CHANGED:services');
  expect(() =>
    compare({ ...empty(), services: [{ name: 'missing-fields' }] }, empty()),
  ).toThrow();
});

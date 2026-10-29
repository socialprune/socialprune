import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, vi } from 'vitest';
import { buildCommand } from '@stricli/core';
import { executeCli } from './adapter.ts';
import { createNodeContext } from './node-context.ts';
import {
  normalizeExitCode,
  CLI_ERRORS,
  CliError,
  errorObject,
  INSTAGRAM_STOP_MESSAGES,
  instagramStopMessages,
} from './errors.ts';
import { ContextStop } from '../browser/instagram/report.ts';
import * as registry from './registry.ts';
import { contextFailure } from '../browser/instagram/copy.ts';
import { checkPage } from '../browser/instagram/selectors.ts';
import type { Page } from 'playwright-core';
import { commandRegistry } from './registry.ts';
import { plainText } from './output.ts';
import { capturedContext } from './test/context.ts';
import type { CliContext } from './context.ts';
import type { PlatformGuide } from '@socialprune/core/guide/types';
import { CliResultSchema } from './schemas.ts';
import { xGuide } from '@socialprune/adapter-x/guide';
import { instagramGuide } from '@socialprune/adapter-instagram/guide';

const archive = fileURLToPath(
  new URL(
    '../../../../fixtures/synthetic/x/current-minimal/archive/',
    import.meta.url,
  ),
);
const schemaRoot = new URL(
  '../../../../packages/core/schemas/',
  import.meta.url,
);
const report = {
  files: [],
  otherFiles: [],
  skippedPrivate: 0,
  rejectedEntries: 0,
};
const services: CliContext['services'] = {
  guides: [],
  describeStructure() {
    return Promise.resolve(report);
  },
  listSchemas() {
    return Promise.resolve([
      { id: 'https://example.invalid/item', path: 'schemas/item.schema.json' },
    ]);
  },
};

test.each(['en', 'de'] as const)(
  'Instagram list-timeout envelope and human line report the list failure in %s',
  async (lang) => {
    const failure = contextFailure(
      new ContextStop('PLATFORM_CHECK', 'list-timeout'),
      lang,
    );
    const entries = commandRegistry();
    const command = buildCommand({
      parameters: { flags: { json: { kind: 'boolean', default: false } } },
      docs: { brief: 'Generated failure probe' },
      func() {
        throw failure;
      },
    });
    const lookup = vi.spyOn(registry, 'commandRegistry').mockReturnValue([
      {
        ...entries[0]!,
        path: ['context', 'instagram'],
        command,
        envelope: true,
      },
    ]);
    try {
      for (const json of [false, true]) {
        const capture = capturedContext(services);
        expect(
          await executeCli(
            ['context', 'instagram', ...(json ? ['--json'] : [])],
            capture.context,
          ),
        ).toBe(1);
        const message =
          lang === 'de'
            ? 'Die gefilterte Instagram-Kommentarliste konnte nicht zuverlässig gelesen werden. Der Lauf wurde gestoppt.'
            : 'The filtered Instagram comments list could not be read reliably. The run stopped.';
        expect(JSON.parse(capture.stdout.join(''))).toMatchObject({
          status: 'error',
          error: {
            code: 'PLATFORM_CHECK',
            message,
            exitCode: 1,
            retryable: false,
          },
        });
        expect(capture.stderr.join('')).toBe(`PLATFORM_CHECK: ${message}\n`);
        expect(capture.stderr.join('')).not.toMatch(
          /login|challenge|lock|limit|Anmeldung|Sperre/iu,
        );
      }
    } finally {
      lookup.mockRestore();
    }
  },
);

test.each(['en', 'de'] as const)(
  'Instagram login keeps the real platform-page failure unchanged for %s',
  async (lang) => {
    const stopped = await checkPage({
      isClosed: () => false,
      url: () => 'https://www.instagram.com/accounts/login/',
    } as unknown as Page).catch((error: unknown) => error);
    expect(stopped).toMatchObject({ code: 'PLATFORM_CHECK', token: 'login' });
    const failure = contextFailure(stopped, lang);
    const entries = commandRegistry();
    const command = buildCommand({
      parameters: { flags: { json: { kind: 'boolean', default: false } } },
      docs: { brief: 'Generated login probe' },
      func() {
        throw failure;
      },
    });
    const lookup = vi.spyOn(registry, 'commandRegistry').mockReturnValue([
      {
        ...entries[0]!,
        path: ['context', 'instagram'],
        command,
        envelope: true,
      },
    ]);
    try {
      const capture = capturedContext(services);
      expect(
        await executeCli(['context', 'instagram', '--json'], capture.context),
      ).toBe(1);
      expect(JSON.parse(capture.stdout.join(''))).toMatchObject({
        error: { code: 'PLATFORM_CHECK', ...CLI_ERRORS.PLATFORM_CHECK },
      });
      expect(capture.stderr.join('')).toBe(
        `PLATFORM_CHECK: ${CLI_ERRORS.PLATFORM_CHECK.message}\n`,
      );
    } finally {
      lookup.mockRestore();
    }
  },
);

test('Instagram stop metadata cannot override another command, an unknown token, language, code or raw exception', async () => {
  const entries = commandRegistry();
  for (const [path, failure] of [
    [
      ['delete', 'x'],
      Object.assign(new CliError('PLATFORM_CHECK'), {
        instagramStop: { token: 'list-timeout', lang: 'en' },
      }),
    ],
    [
      ['context', 'instagram'],
      Object.assign(new CliError('PLATFORM_CHECK'), {
        instagramStop: { token: 'Generated private decoy', lang: 'en' },
      }),
    ],
    [
      ['context', 'instagram'],
      Object.assign(new CliError('PLATFORM_CHECK'), {
        instagramStop: {
          token: 'list-timeout',
          lang: 'Generated private decoy',
        },
      }),
    ],
    [
      ['context', 'instagram'],
      Object.assign(new CliError('PLATFORM_CHECK'), {
        instagramStop: {
          token: 'list-timeout',
          lang: 'en',
          text: 'Generated private decoy',
        },
      }),
    ],
    [
      ['context', 'instagram'],
      Object.assign(new CliError('PLATFORM_CHECK'), {
        instagramStop: { token: '__proto__', lang: 'en' },
      }),
    ],
    [['context', 'instagram'], new Error('Generated private decoy')],
  ] as const) {
    const command = buildCommand({
      parameters: { flags: { json: { kind: 'boolean', default: false } } },
      docs: { brief: 'Generated error projection probe' },
      func() {
        throw failure;
      },
    });
    const lookup = vi.spyOn(registry, 'commandRegistry').mockReturnValue([
      {
        ...entries[0]!,
        path: [...path],
        command,
        envelope: true,
        failureCode: 'CONTEXT_FAILED',
      },
    ]);
    try {
      const capture = capturedContext(services);
      expect(await executeCli([...path, '--json'], capture.context)).toBe(1);
      const expected =
        failure instanceof CliError
          ? errorObject(failure.code)
          : errorObject('CONTEXT_FAILED');
      expect(JSON.parse(capture.stdout.join(''))).toMatchObject({
        error: expected,
      });
      expect(capture.stderr.join('')).toBe(
        `${expected.code}: ${expected.message}\n`,
      );
      expect(capture.stdout.join('') + capture.stderr.join('')).not.toContain(
        'Generated private decoy',
      );
    } finally {
      lookup.mockRestore();
    }
  }
  expect(
    errorObject('INVALID_ARGUMENTS', undefined, undefined, {
      token: 'list-timeout',
      lang: 'en',
    }),
  ).toEqual(errorObject('INVALID_ARGUMENTS'));
});

test.each(['en', 'de'] as const)(
  'Instagram platform notices and unknown page tokens keep their original message in %s',
  async (lang) => {
    const entries = commandRegistry();
    for (const token of [
      'login',
      'challenge',
      'checkpoint',
      'locked',
      'rate-limit',
      'notice-error',
      'http-429',
      'rate-signal',
      'unexpected-page',
    ] as const) {
      const failure = contextFailure(
        new ContextStop('PLATFORM_CHECK', token),
        lang,
      );
      const command = buildCommand({
        parameters: { flags: { json: { kind: 'boolean', default: false } } },
        docs: { brief: 'Generated platform stop probe' },
        func() {
          throw failure;
        },
      });
      const lookup = vi.spyOn(registry, 'commandRegistry').mockReturnValue([
        {
          ...entries[0]!,
          path: ['context', 'instagram'],
          command,
          envelope: true,
        },
      ]);
      try {
        const capture = capturedContext(services);
        expect(
          await executeCli(['context', 'instagram', '--json'], capture.context),
        ).toBe(1);
        expect(JSON.parse(capture.stdout.join(''))).toMatchObject({
          error: { code: 'PLATFORM_CHECK', ...CLI_ERRORS.PLATFORM_CHECK },
        });
        expect(capture.stderr.join('')).toBe(
          `PLATFORM_CHECK: ${CLI_ERRORS.PLATFORM_CHECK.message}\n`,
        );
      } finally {
        lookup.mockRestore();
      }
    }
  },
);

test.each(['en', 'de'] as const)(
  'all closed non-platform Instagram stop projections validate and preserve the code in %s',
  (lang) => {
    for (const [code] of Object.entries(CLI_ERRORS)) {
      for (const token of Object.keys(INSTAGRAM_STOP_MESSAGES)) {
        const failure = contextFailure(
          new ContextStop(
            code as keyof typeof CLI_ERRORS,
            token as keyof typeof INSTAGRAM_STOP_MESSAGES,
          ),
          lang,
        );
        const projected = errorObject(
          failure.code,
          undefined,
          undefined,
          failure.instagramStop,
        );
        expect(
          CliResultSchema.safeParse({
            schemaVersion: 1,
            command: 'context.instagram',
            status: 'error',
            error: projected,
            warnings: [],
          }).success,
        ).toBe(true);
        const valid = instagramStopMessages(failure.code).includes(
          INSTAGRAM_STOP_MESSAGES[
            token as keyof typeof INSTAGRAM_STOP_MESSAGES
          ][lang],
        );
        expect(projected.message).toBe(
          valid
            ? INSTAGRAM_STOP_MESSAGES[
                token as keyof typeof INSTAGRAM_STOP_MESSAGES
              ][lang]
            : errorObject(failure.code).message,
        );
        expect(projected.code).toBe(code);
      }
    }
  },
);

test.each([
  ['missing positional', ['structure']],
  ['unknown flag', ['structure', archive, '--bad']],
  ['unknown route', ['unknown']],
  ['unknown platform', ['guide', 'other']],
  ['missing guide', ['guide']],
  ['bad language', ['guide', 'x', '--lang', 'fr']],
  ['schemas positional', ['schemas', archive]],
  ['schemas flag', ['schemas', '--bad']],
  ['bad flag with help', ['structure', '--bad', '--help']],
  ['bad root flag with help', ['--bad', '--help']],
  ['reserved scan', ['scan']],
  ['reserved mcp', ['mcp']],
  ['review missing workspace', ['review', '--dry-run']],
] as const)('%s is one fixed JSON failure with exit 2', async (_name, args) => {
  const capture = capturedContext(services);
  expect(await executeCli([...args, '--json'], capture.context)).toBe(2);
  expect(capture.stdout).toHaveLength(1);
  expect(CliResultSchema.parse(JSON.parse(capture.stdout[0]!))).toMatchObject({
    schemaVersion: 1,
    status: 'error',
    error: { exitCode: 2, retryable: false },
  });
  expect(capture.stderr.join('')).not.toContain(archive);
  expect(capture.opened).toEqual([]);
});

test('normalizes all framework outcomes and preserves public exit values', () => {
  expect([-5, -4].map(normalizeExitCode)).toEqual([2, 2]);
  expect([0, 1, 2, 3, 4].map(normalizeExitCode)).toEqual([0, 1, 2, 3, 4]);
  expect([-10, -3, -2, -1, 5, NaN].map(normalizeExitCode)).toEqual([
    1, 1, 1, 1, 1, 1,
  ]);
});

test('machine help uses the command registry and includes no decision capability', async () => {
  const capture = capturedContext(services);
  expect(await executeCli(['--help', '--json'], capture.context)).toBe(0);
  expect(capture.stdout).toHaveLength(1);
  const parsed = JSON.parse(capture.stdout[0]!) as {
    data: {
      commands: { path: string[]; options: { name: string }[] }[];
      exitCodes: unknown;
    };
  };
  expect(parsed.data.commands.map((entry) => entry.path)).toEqual(
    commandRegistry().map((entry) => entry.path),
  );
  expect(parsed.data.commands.map((entry) => entry.path)).toEqual([
    ['context', 'instagram'],
    ['originals', 'fill', 'x'],
    ['browser', 'setup'],
    ['browser', 'forget'],
    ['delete', 'x'],
    ['delete', 'instagram'],
    ['originals', 'fetch'],
    ['guide'],
    ['structure'],
    ['schemas'],
    ['scan', 'source'],
    ['scan', 'check'],
    ['scan', 'run'],
    ['mcp'],
    ['batch', 'next'],
    ['labels', 'submit'],
    ['review'],
    ['import'],
    ['summary'],
    ['backup', 'export'],
    ['backup', 'restore'],
    ['export', 'clicklist'],
  ]);
  for (const entry of parsed.data.commands) {
    expect(entry.options.some((option) => option.name === 'json')).toBe(true);
    expect(
      entry.path.some((part) => ['approve', 'decide', 'mark'].includes(part)),
    ).toBe(false);
  }
  expect(parsed.data.exitCodes).toEqual({
    0: 'done',
    1: 'runtime error',
    2: 'wrong usage',
    3: 'input format not readable by this version',
    4: 'partial read',
  });
  expect(capture.stderr).toEqual([]);
});

test('help on a command targets its registry entry without reading an archive', async () => {
  const capture = capturedContext({
    ...services,
    describeStructure: () => {
      throw new Error('Help must not read data.');
    },
  });
  expect(
    await executeCli(['structure', '--help', '--json'], capture.context),
  ).toBe(0);
  expect(JSON.parse(capture.stdout.join(''))).toMatchObject({
    data: { commandPath: ['structure'], commands: [{ path: ['structure'] }] },
  });
});

test('review help is available while mcp remains reserved', async () => {
  for (const args of [
    ['review', '--help'],
    ['review', '--help', '--json'],
  ]) {
    const capture = capturedContext(services);
    expect(await executeCli(args, capture.context)).toBe(0);
    expect(capture.stdout.join('')).not.toContain('NOT_AVAILABLE');
    expect(capture.stdout.join('')).toContain(
      'decisions come only from the page',
    );
    expect(capture.opened).toEqual([]);
  }
  expect(
    commandRegistry()
      .filter((entry) => !entry.available)
      .map((entry) => entry.path),
  ).toEqual([['guide'], ['mcp']]);
});

test('structure emits one envelope without workspace, warnings or stderr notice', async () => {
  const capture = capturedContext(services);
  expect(
    await executeCli(['structure', archive, '--json'], capture.context),
  ).toBe(0);
  expect(capture.stdout).toHaveLength(1);
  expect(JSON.parse(capture.stdout[0]!)).toEqual({
    schemaVersion: 1,
    command: 'structure',
    status: 'ok',
    data: report,
    warnings: [],
  });
  expect(capture.stderr).toEqual([]);
});

test('human structure strips ANSI and embedded controls while JSON preserves data', async () => {
  const untrusted = 'key\u001b[31m_red\u001b[0m\u0000\u0007\r\t\n\u009b\u202e';
  const plantedReport = {
    ...report,
    files: [
      {
        pattern: untrusted,
        count: 1,
        assignments: [untrusted],
        parsed: 1,
        unparsed: 0,
        errors: [],
        paths: [{ path: untrusted, types: ['string' as const] }],
      },
    ],
  };
  const capture = capturedContext({
    ...services,
    describeStructure() {
      return Promise.resolve(plantedReport);
    },
  });
  expect(await executeCli(['structure', archive], capture.context)).toBe(0);
  expect(capture.stdout.join('')).toContain('key_red');
  for (const control of [
    '\u001b',
    '\u0000',
    '\u0007',
    '\r',
    '\t',
    '\u009b',
    '\u202e',
  ])
    expect(capture.stdout.join('')).not.toContain(control);
  expect(plainText(untrusted)).toBe('key_red');
  const json = capturedContext({
    ...services,
    describeStructure() {
      return Promise.resolve(plantedReport);
    },
  });
  expect(await executeCli(['structure', archive, '--json'], json.context)).toBe(
    0,
  );
  expect(JSON.parse(json.stdout.join(''))).toEqual({
    schemaVersion: 1,
    command: 'structure',
    status: 'ok',
    data: plantedReport,
    warnings: [],
  });
  expect(plainText('Grüße')).toBe('Grüße');
});

test('guide consumes injected shared guide facts in the selected language', async () => {
  const fact = {
    id: 'invented',
    text: { en: 'Invented English fact', de: 'Erfundener deutscher Text' },
    source: {
      url: 'https://example.invalid/guide',
      publisher: 'Invented',
      title: 'Invented source',
    },
    retrievedOn: '2026-10-08',
    verifiedOn: '2026-10-07',
  };
  const guide: PlatformGuide = {
    platform: 'x',
    startUrl: fact,
    steps: [fact],
    options: [],
    waiting: { ...fact, typicalDays: null },
    downloadWindow: { ...fact, days: null },
    htmlExportHint: fact,
    paths: {
      desktop: [
        {
          ...fact,
          id: 'generated-desktop',
          text: {
            en: 'Generated computer steps.',
            de: 'Erzeugte Computerschritte.',
          },
        },
      ],
      mobile: [
        {
          ...fact,
          id: 'generated-mobile',
          text: { en: 'Generated phone steps.', de: 'Erzeugte Handyschritte.' },
          sourceDe: {
            ...fact.source,
            url: 'https://example.invalid/de/generated-help',
          },
        },
      ],
    },
  };
  const capture = capturedContext({ ...services, guides: [guide] });
  expect(
    await executeCli(['guide', 'x', '--lang', 'de'], capture.context),
  ).toBe(0);
  expect(capture.stdout.join('')).toContain(fact.text.de);
  expect(capture.stdout.join('')).not.toContain(fact.text.en);
  expect(capture.stdout.join('')).toContain(guide.paths!.desktop[0]!.text.de);
  expect(capture.stdout.join('')).toContain(guide.paths!.mobile[0]!.text.de);
  expect(capture.stdout.join('')).toContain(
    guide.paths!.mobile[0]!.sourceDe!.url,
  );
  expect(capture.stdout.join('')).toContain(`Geprüft am ${fact.verifiedOn}`);
  for (const [lang, message] of [
    ['en', 'Not yet checked by a person'],
    ['de', 'Noch nicht von einer Person geprüft'],
  ]) {
    const unverified = capturedContext({
      ...services,
      guides: [{ ...guide, startUrl: { ...fact, verifiedOn: null } }],
    });
    expect(
      await executeCli(['guide', 'x', '--lang', lang!], unverified.context),
    ).toBe(0);
    expect(unverified.stdout.join('')).toContain(message);
    expect(unverified.stdout.join('')).not.toContain('null');
  }
  const json = capturedContext({ ...services, guides: [guide] });
  expect(await executeCli(['guide', 'x', '--json'], json.context)).toBe(0);
  expect(JSON.parse(json.stdout.join(''))).toMatchObject({
    command: 'guide',
    data: { platform: 'x', lang: 'en', guide },
  });
});

test('production guide returns adapter data with the maintainer confirmation date', async () => {
  const capture = capturedContext(services);
  const node = createNodeContext(
    capture.context.io.stdout,
    capture.context.io.stderr,
  );
  const guides = [xGuide, instagramGuide];
  for (const guide of guides) {
    expect(await executeCli(['guide', guide.platform, '--json'], node)).toBe(0);
  }
  expect(capture.stdout.map((text): unknown => JSON.parse(text))).toEqual(
    guides.map((guide) => ({
      schemaVersion: 1,
      command: 'guide',
      status: 'ok',
      data: { platform: guide.platform, lang: 'en', guide },
      warnings: [],
    })),
  );
  expect(capture.stderr).toEqual([]);
});

test.each([xGuide, instagramGuide])(
  'production $platform guide prints human-check status in EN and DE',
  async (guide) => {
    for (const [lang, message] of [
      ['en', 'Checked on 2026-10-25'],
      ['de', 'Geprüft am 2026-10-25'],
    ] as const) {
      const capture = capturedContext(services);
      const node = createNodeContext(
        capture.context.io.stdout,
        capture.context.io.stderr,
      );
      expect(
        await executeCli(['guide', guide.platform, '--lang', lang], node),
      ).toBe(0);
      expect(capture.stdout.join('')).toContain(message);
      expect(capture.stdout.join('')).toContain(guide.startUrl.text[lang]);
      expect(capture.stdout.join('')).not.toContain('GUIDE_UNAVAILABLE');
      expect(capture.stderr).toEqual([]);
    }
  },
);

test('schemas lists precisely the current shipped schema files', async () => {
  const capture = capturedContext(services);
  const node = createNodeContext(
    capture.context.io.stdout,
    capture.context.io.stderr,
  );
  expect(await executeCli(['schemas', '--json'], node)).toBe(0);
  const expected = [];
  for (const file of (await readdir(schemaRoot, { recursive: true }))
    .filter((file) => file.endsWith('.schema.json'))
    .sort()) {
    const path = file.replaceAll('\\', '/');
    const schema = JSON.parse(
      await readFile(new URL(path, schemaRoot), 'utf8'),
    ) as { $id: string };
    expected.push({ id: schema.$id, path: `schemas/${path}` });
  }
  const cliRoot = new URL('../../schemas/', import.meta.url);
  for (const file of (await readdir(cliRoot)).filter((file) =>
    file.endsWith('.schema.json'),
  )) {
    const schema = JSON.parse(
      await readFile(new URL(file, cliRoot), 'utf8'),
    ) as { $id: string };
    expected.push({ id: schema.$id, path: `schemas/${file}` });
  }
  expected.sort((left, right) => left.path.localeCompare(right.path));
  expect(JSON.parse(capture.stdout.join(''))).toMatchObject({
    command: 'schemas',
    data: { schemas: expected },
  });
  expect(capture.stderr).toEqual([]);
}, 60_000);

test.each(['approve', 'decide', 'delete', 'mark'])(
  'unregistered %s has no capability',
  async (name) => {
    const capture = capturedContext(services);
    expect(await executeCli([name, '--json'], capture.context)).toBe(2);
    expect(JSON.parse(capture.stdout.join(''))).toMatchObject({
      error: { code: 'INVALID_ARGUMENTS' },
    });
  },
);

test('an aborted command uses a fixed error and performs no service work', async () => {
  const capture = capturedContext(services);
  const abort = new AbortController();
  abort.abort(new Error('Private reason'));
  expect(
    await executeCli(['schemas', '--json'], {
      ...capture.context,
      signal: abort.signal,
    }),
  ).toBe(1);
  expect(JSON.parse(capture.stdout.join(''))).toMatchObject({
    error: { code: 'CANCELLED' },
  });
  expect(capture.stderr.join('')).not.toContain('Private reason');
});

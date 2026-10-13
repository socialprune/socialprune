import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Item } from '@socialprune/core';
import { executeCli } from '../cli/adapter.ts';
import { createNodeContext } from '../cli/node-context.ts';
import { SQLiteStore } from '../workspace/sqlite-store.ts';

const browser = vi.hoisted(() => ({
  validate: vi.fn(),
  installed: vi.fn(),
  deletion: vi.fn(),
  fill: vi.fn(),
}));
vi.mock('../browser/profile.ts', () => ({
  validateProfile: browser.validate,
  installedBrowser: browser.installed,
}));
vi.mock('../browser/runner.ts', () => ({ runBrowser: browser.deletion }));
vi.mock('../browser/x/fill/run.ts', () => ({ runFill: browser.fill }));

const staleMessage =
  'The plan changed. Make a new dry run and use its plan hash.';
const missingMessage =
  'The export holds no account name. Pass --handle with the X name of the account signed in to the dedicated profile.';
const commands = [
  { path: ['delete', 'x'], runner: browser.deletion },
  { path: ['originals', 'fill', 'x'], runner: browser.fill },
];
beforeEach(() => {
  vi.resetAllMocks();
  browser.installed.mockResolvedValue('generated-browser');
  browser.deletion.mockResolvedValue({ completed: 0, endReason: 'done' });
  browser.fill.mockResolvedValue({ completed: 0, endReason: 'done' });
});

async function invoke(args: string[]) {
  const stdout: string[] = [],
    stderr: string[] = [];
  const context = {
    ...createNodeContext(
      { write: (text) => stdout.push(text) },
      { write: (text) => stderr.push(text) },
    ),
    stdoutIsTerminal: true,
  };
  const code = await executeCli(args, context);
  return {
    code,
    stdout: stdout.join(''),
    stderr: stderr.join(''),
    envelope: (stdout.join('').startsWith('{')
      ? JSON.parse(stdout.join(''))
      : {}) as {
      data: { accountName: string; planHash: string };
      error?: { code: string; message: string; exitCode: number };
    },
  };
}
async function inputs(variant: 'missing-account' | 'current-minimal') {
  const root = new URL(
    `../../../../fixtures/synthetic/x/${variant}/`,
    import.meta.url,
  );
  const expected = JSON.parse(
    await readFile(new URL('expected.json', root), 'utf8'),
  ) as { items: Item[] };
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-handle-'));
  const workspace = join(directory, 'workspace');
  const imported = await invoke([
    'import',
    fileURLToPath(new URL('archive/', root)),
    '--workspace',
    workspace,
    '--json',
  ]);
  expect(imported.code).toBe(0);
  const store = await SQLiteStore.open(join(workspace, 'socialprune.sqlite'), {
    readOnly: true,
  });
  try {
    expect(
      (await store.read((tx) => tx.items.get(expected.items[0]!.id)))!.item
        .account,
    ).toEqual(expected.items[0]!.account);
  } finally {
    await store.close();
  }
  const known = JSON.parse(
    await readFile(
      new URL(
        '../../../../fixtures/synthetic/x/current-minimal/expected.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as { items: Item[] };
  return {
    workspace,
    account: expected.items[0]!.account,
    handle: known.items[0]!.account.handle!,
    items: expected.items,
    args: [
      '--workspace',
      workspace,
      '--account',
      expected.items[0]!.account.key,
    ],
    close: () => rm(directory, { recursive: true, force: true }),
  };
}

for (const command of commands) {
  const name = command.path.join(' ');
  test(`${name}: missing account name has exit 2 before profile validation, not STALE_PLAN`, async () => {
    const h = await inputs('missing-account');
    try {
      const dry = await invoke([
        ...command.path,
        ...h.args,
        '--dry-run',
        '--json',
      ]);
      expect(dry.code).toBe(0);
      const run = await invoke([
        ...command.path,
        ...h.args,
        '--profile',
        'generated-dedicated-profile',
        '--plan',
        dry.envelope.data.planHash,
      ]);
      expect(run.envelope.error).toEqual({
        code: 'ACCOUNT_NAME_MISSING',
        message: missingMessage,
        exitCode: 2,
        retryable: false,
      });
      expect(run.code).toBe(2);
      expect(browser.validate).not.toHaveBeenCalled();
      expect(command.runner).not.toHaveBeenCalled();
    } finally {
      await h.close();
    }
  });
  for (const verify of command.path[0] === 'delete' ? [false, true] : [false])
    test(`${name}${verify ? ' --verify' : ''}: --handle agrees across dry run and run and reaches runner`, async () => {
      const h = await inputs('missing-account');
      try {
        const args = [
          ...command.path,
          ...h.args,
          '--handle',
          `@${h.handle.toUpperCase()}`,
        ];
        const dry = await invoke([...args, '--dry-run', '--json']);
        expect(dry.code).toBe(0);
        const run = await invoke([
          ...args,
          '--profile',
          'generated-dedicated-profile',
          ...(verify ? ['--verify'] : ['--plan', dry.envelope.data.planHash]),
        ]);
        expect(run.code).toBe(0);
        expect(command.runner).toHaveBeenCalledOnce();
        expect(command.runner.mock.calls[0]![0]).toMatchObject({
          plan: {
            handle: h.handle.toUpperCase(),
            hash: dry.envelope.data.planHash,
          },
        });
        if (verify)
          expect(command.runner.mock.calls[0]![0]).toMatchObject({
            verify: true,
          });
      } finally {
        await h.close();
      }
    });
  for (const variant of ['missing-account', 'current-minimal'] as const)
    for (const flag of [false, true])
      test(`${name}: ${variant} flag=${flag} dry-run provenance, no name or text in JSON, unchanged hash`, async () => {
        const h = await inputs(variant);
        try {
          const base = [...command.path, ...h.args, '--dry-run'];
          const args = [
            ...base,
            ...(flag ? ['--handle', `@${h.handle.toUpperCase()}`] : []),
          ];
          const dry = await invoke([...args, '--json']);
          expect(dry.code).toBe(0);
          expect(dry.envelope.data.accountName).toBe(
            h.account.handle ? 'export' : flag ? 'flag' : 'missing',
          );
          expect(dry.stdout.toLowerCase()).not.toContain(
            h.handle.toLowerCase(),
          );
          for (const item of h.items)
            expect(dry.stdout).not.toContain(item.text);
          const unflagged = await invoke([...base, '--json']);
          expect(unflagged.code).toBe(0);
          expect(dry.envelope.data.planHash).toBe(
            unflagged.envelope.data.planHash,
          );
          const human = await invoke(args);
          expect(human.code).toBe(0);
          expect(human.stdout + human.stderr).toContain(
            h.account.handle
              ? 'The account name comes from the export.'
              : flag
                ? 'The account name comes from --handle.'
                : 'The export holds no account name; the run will need --handle with the X name of the account signed in to the dedicated profile.',
          );
        } finally {
          await h.close();
        }
      });
  for (const mode of [
    'dry',
    'run',
    ...(command.path[0] === 'delete' ? ['verify'] : []),
  ])
    test(`${name} ${mode}: differing export and flag refuses before browser launch`, async () => {
      const h = await inputs('current-minimal');
      try {
        const modeFlags =
          mode === 'dry'
            ? ['--dry-run', '--json']
            : [
                '--profile',
                'generated-dedicated-profile',
                ...(mode === 'verify' ? ['--verify'] : ['--plan', 'changed']),
              ];
        const result = await invoke([
          ...command.path,
          ...h.args,
          '--handle',
          `${h.handle.slice(0, -1)}x`,
          ...modeFlags,
        ]);
        expect(result.code).toBe(1);
        expect(result.envelope.error?.code).toBe('ACCOUNT_MISMATCH');
        expect(browser.validate).not.toHaveBeenCalled();
        expect(command.runner).not.toHaveBeenCalled();
      } finally {
        await h.close();
      }
    });
  for (const handle of [
    '',
    '@',
    '@@name',
    'two words',
    'x'.repeat(16),
    'na-me',
    'näme',
    'name\n',
  ])
    test(`${name}: invalid --handle ${JSON.stringify(handle)} rejects without opening a workspace`, async () => {
      const result = await invoke([
        ...command.path,
        '--workspace',
        'generated-missing-workspace',
        '--account',
        'generated-account',
        '--handle',
        handle,
        '--dry-run',
        '--json',
      ]);
      expect(result.code).toBe(2);
      expect(result.envelope.error?.code).toBe('INVALID_ARGUMENTS');
      expect(command.runner).not.toHaveBeenCalled();
    });
  test(`${name}: changed plan still fails with the command-neutral STALE_PLAN message`, async () => {
    const h = await inputs('missing-account');
    try {
      const result = await invoke([
        ...command.path,
        ...h.args,
        '--handle',
        h.handle,
        '--profile',
        'generated-dedicated-profile',
        '--plan',
        'changed',
      ]);
      expect(result.code).toBe(1);
      expect(result.envelope.error?.code).toBe('STALE_PLAN');
      expect(result.envelope.error?.message).toBe(staleMessage);
      expect(browser.validate).not.toHaveBeenCalled();
      expect(command.runner).not.toHaveBeenCalled();
    } finally {
      await h.close();
    }
  });
}
test('delete x --verify: missing account name refuses before profile validation', async () => {
  const h = await inputs('missing-account');
  try {
    const result = await invoke([
      'delete',
      'x',
      ...h.args,
      '--profile',
      'generated-dedicated-profile',
      '--verify',
    ]);
    expect(result.code).toBe(2);
    expect(result.envelope.error?.code).toBe('ACCOUNT_NAME_MISSING');
    expect(browser.validate).not.toHaveBeenCalled();
    expect(browser.deletion).not.toHaveBeenCalled();
  } finally {
    await h.close();
  }
});

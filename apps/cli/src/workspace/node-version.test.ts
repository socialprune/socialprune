import { expect, test } from 'vitest';
import { executeCli } from '../cli/adapter.ts';
import { capturedContext } from '../cli/test/context.ts';
import { requireWorkspaceNode } from './node-version.ts';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createNodeContext } from '../cli/node-context.ts';

const cases = [
  ['review', '--workspace', 'generated'],
  ['review', '--workspace', 'generated', '--dry-run'],
  ['import', 'generated.zip', '--workspace', 'generated'],
  ['summary', '--workspace', 'generated'],
  ['batch', 'next', '--workspace', 'generated', '--share-with-agent'],
  ['labels', 'submit', 'generated.json', '--workspace', 'generated'],
  [
    'labels',
    'submit',
    'generated.json',
    '--workspace',
    'generated',
    '--dry-run',
  ],
  ['backup', 'export', '--workspace', 'generated', '--out', 'generated.json'],
  ['backup', 'restore', 'generated.json', '--workspace', 'generated'],
  [
    'export',
    'clicklist',
    '--workspace',
    'generated',
    '--account',
    'x:generated',
    '--out',
    'generated.csv',
  ],
];
test('injectable Node floor refuses every workspace route before any service call', async () => {
  for (const args of cases) {
    const capture = capturedContext({
      guides: [],
      describeStructure: () => {
        throw new Error('not used');
      },
      listSchemas: () => Promise.resolve([]),
    });
    let called = false;
    const workspace = new Proxy(
      {},
      {
        get() {
          called = true;
          throw new Error('called workspace service');
        },
      },
    );
    const context = {
      ...capture.context,
      nodeVersion: '24.14.1',
      services: { ...capture.context.services, workspace },
    };
    expect(
      await executeCli([...args, '--json'], context as typeof capture.context),
    ).toBe(1);
    expect(called).toBe(false);
    expect(JSON.parse(capture.stdout.join(''))).toMatchObject({
      status: 'error',
      error: {
        code: 'NODE_TOO_OLD',
        exitCode: 1,
        retryable: false,
        message:
          'SocialPrune needs Node.js 24.15 or newer for workspaces. You have 24.14.1.',
      },
    });
    expect(capture.stdout).toHaveLength(1);
  }
  expect(() => requireWorkspaceNode('24.15.0')).not.toThrow();
  for (const version of ['24.14.1', '23.99.0', 'untrusted'])
    expect(() => requireWorkspaceNode(version)).toThrow();
  expect(() =>
    expect(() => requireWorkspaceNode('24.15.0')).toThrow(),
  ).toThrow();
});

test('older injected Node keeps help schemas structure and guide paths free of SQLite', async () => {
  const fixture = fileURLToPath(
    new URL(
      '../../../../fixtures/synthetic/x/current-minimal/archive/',
      import.meta.url,
    ),
  );
  const capture = capturedContext(
    createNodeContext({ write() {} }, { write() {} }).services,
  );
  for (const args of [
    ['--help'],
    ['schemas'],
    ['structure', fixture],
    ['guide', 'x'],
    ['guide', 'instagram'],
    ['review', '--help'],
    ['batch', 'next', '--help'],
    ['labels', 'submit', '--help'],
  ]) {
    const node = createNodeContext(
      capture.context.io.stdout,
      capture.context.io.stderr,
    );
    const code = await executeCli(args, { ...node, nodeVersion: '24.14.1' });
    expect(code).toBe(0);
  }
  const loader = new URL('./test/forbid-sqlite.ts', import.meta.url).href;
  const cli = fileURLToPath(new URL('../main.ts', import.meta.url));
  for (const args of [
    ['--help'],
    ['schemas'],
    ['structure', fixture],
    ['guide', 'x'],
    ['guide', 'instagram'],
    ['review', '--help'],
    ['batch', 'next', '--help'],
    ['labels', 'submit', '--help'],
  ]) {
    const result = spawnSync(
      process.execPath,
      ['--import', loader, cli, ...args],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    if (args[0] === 'guide') {
      expect(result.status, `${args.join(' ')}: ${result.stderr}`).toBe(0);
      expect(result.stdout).toContain('Not yet checked by a person');
    } else {
      expect([0, 2], `${args.join(' ')}: ${result.stderr}`).toContain(
        result.status,
      );
    }
    expect(result.stderr).not.toContain('forbids loading SQLite');
    expect(result.stderr).not.toContain('ExperimentalWarning');
  }
  // Prove the same loader rejects a direct SQLite import.
  const negative = spawnSync(
    process.execPath,
    [
      '--import',
      loader,
      '--input-type=module',
      '-e',
      "await import('node:sqlite')",
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  expect(negative.status).toBe(1);
  expect(negative.stderr).toContain('forbids loading SQLite');
}, 60_000);

import { mkdtemp, readFile, rm, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, test, vi } from 'vitest';
import { SQLiteStore } from '../../workspace/sqlite-store.ts';
import { instagramFixture } from '../../../e2e/fake-instagram/fixture.ts';
import { executeCli } from '../../cli/adapter.ts';
import { createNodeContext } from '../../cli/node-context.ts';
import { networkRecorder } from '../../cli/test/network-recorder.ts';

const browser = vi.hoisted(() => ({
  validate: vi.fn(),
  installed: vi.fn(),
  run: vi.fn(),
}));
vi.mock('../profile.ts', () => ({
  validateProfile: browser.validate,
  installedBrowser: browser.installed,
}));
vi.mock('./run.ts', () => ({ runContext: browser.run }));
test('CLI dry run preserves database bytes, emits counts only; invalid orders and fake runtime flags never reach profile or driver', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sp-ig-command-')),
    fixture = await instagramFixture();
  const path = join(directory, 'socialprune.sqlite'),
    store = await SQLiteStore.open(path, { initial: fixture.workspace });
  await store.close();
  const args = [
    'context',
    'instagram',
    '--workspace',
    directory,
    '--account',
    fixture.items[0]!.account.key,
  ];
  const invoke = async (flags: string[]) => {
    const stdout: string[] = [],
      stderr: string[] = [];
    const code = await executeCli(
      [...args, ...flags],
      createNodeContext(
        { write: (text) => stdout.push(text) },
        { write: (text) => stderr.push(text) },
      ),
    );
    return { code, stdout: stdout.join(''), stderr: stderr.join('') };
  };
  const recorder = networkRecorder();
  try {
    const before = createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
    const dry = await invoke(['--dry-run', '--json']);
    expect(dry.code).toBe(0);
    const result = JSON.parse(dry.stdout) as {
      data: { planHash: string; planned: number };
    };
    expect(result.data.planned).toBe(1);
    for (const value of [
      fixture.items[0]!.text,
      fixture.items[0]!.account.handle!,
      fixture.items[0]!.reference.ownerHandle!,
    ])
      expect(dry.stdout).not.toContain(value);
    expect(
      createHash('sha256')
        .update(await readFile(path))
        .digest('hex'),
    ).toBe(before);
    expect(await readdir(directory)).toEqual(['socialprune.sqlite']);
    const order = join(directory, 'order.json');
    for (const [value, error] of [
      [
        {
          scope: 'context-instagram',
          account: fixture.items[0]!.account.handle,
          givenAt: '2026-10-15T12:00:00.000Z',
          words: 'Read generated comments',
        },
        'CANARY_REQUIRED',
      ],
      [{ scope: 'delete-x' }, 'CONTEXT_ORDER_INVALID'],
    ] as const) {
      await writeFile(order, JSON.stringify(value));
      const failed = await invoke([
        '--json',
        '--order',
        order,
        '--profile',
        'never-access-this-generated-profile',
        '--plan',
        result.data.planHash,
      ]);
      expect(failed.stdout).toContain(error);
      expect(browser.validate).not.toHaveBeenCalled();
      expect(browser.run).not.toHaveBeenCalled();
    }
    for (const flag of [
      '--origin=http://127.0.0.1:4401',
      '--interval-ms=1',
      '--headless',
      '--response-timeout-ms=1',
    ])
      expect((await invoke(['--dry-run', '--json', flag])).stdout).toContain(
        'INVALID_ARGUMENTS',
      );
    expect(
      (
        await invoke([
          '--json',
          '--profile',
          'generated',
          '--plan',
          result.data.planHash,
        ])
      ).stdout,
    ).toContain('NOT_INTERACTIVE');
    expect(recorder.calls).toEqual([]);
  } finally {
    recorder.restore();
    await rm(directory, { recursive: true, force: true });
  }
});

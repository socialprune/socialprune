import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  mkdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import type { WorkspaceV2 } from '@socialprune/core';
import { readWorkspace } from '@socialprune/core/workspace/store';
import {
  createMemoryStore,
  MemoryStoreBacking,
} from '@socialprune/core/workspace/memory-store';
import { createBackup } from '@socialprune/core/workspace/backup';
import { executeCli } from '../cli/adapter.ts';
import { createNodeContext } from '../cli/node-context.ts';
import { capturedContext } from '../cli/test/context.ts';
import { CliResultSchema } from '../cli/schemas.ts';
import { browserWorkspace } from './test/inputs.ts';
import { SQLiteStore } from './sqlite-store.ts';
import { writeChunks } from './files.ts';

const archive = fileURLToPath(
  new URL(
    '../../../../fixtures/synthetic/x/current-minimal/archive/',
    import.meta.url,
  ),
);
const expectedFile = fileURLToPath(
  new URL(
    '../../../../fixtures/synthetic/x/current-minimal/expected.json',
    import.meta.url,
  ),
);

async function invoke(args: string[], json = true) {
  const capture = capturedContext(
    createNodeContext({ write() {} }, { write() {} }).services,
  );
  const node = createNodeContext(
    capture.context.io.stdout,
    capture.context.io.stderr,
  );
  const code = await executeCli([...args, ...(json ? ['--json'] : [])], {
    ...node,
    now: capture.context.now,
  });
  expect(capture.stdout).toHaveLength(1);
  const result = CliResultSchema.parse(JSON.parse(capture.stdout.join('')));
  return { code, result, capture };
}
async function load(workspace: string): Promise<WorkspaceV2> {
  const store = await SQLiteStore.open(join(workspace, 'socialprune.sqlite'), {
    readOnly: true,
  });
  try {
    return await store.read(readWorkspace);
  } finally {
    await store.close();
  }
}
async function browserBackup(file: string) {
  const store = createMemoryStore(new MemoryStoreBacking(browserWorkspace()));
  try {
    const backup = createBackup(store, {
      now: new Date('2026-10-07T00:00:00Z'),
    });
    const chunks: Uint8Array[] = [];
    for await (const chunk of backup.chunks) chunks.push(chunk);
    await writeFile(file, Buffer.concat(chunks));
    await backup.complete();
  } finally {
    await store.close();
  }
}

test('real import, summary and rerun retain independent fixture items without decisions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-c2-commands-'));
  const workspace = join(directory, 'workspace');
  const fixture = JSON.parse(await readFile(expectedFile, 'utf8')) as {
    items: WorkspaceV2['items'];
  };
  try {
    const first = await invoke(
      ['import', archive, '--workspace', workspace],
      false,
    );
    expect(first.code).toBe(0);
    expect(first.result).toMatchObject({
      command: 'import',
      status: 'ok',
      data: { added: fixture.items.length, items: fixture.items.length },
    });
    expect(first.capture.stderr.join('')).toContain('Imported');
    const data = await load(workspace);
    expect(data.items).toEqual(fixture.items);
    expect(data.decisionEvents).toEqual([]);
    expect(data.outcomeEvents).toEqual([]);
    const summary = await invoke(['summary', '--workspace', workspace]);
    expect(summary.code).toBe(0);
    expect(summary.result).toMatchObject({
      command: 'summary',
      data: {
        counts: { items: fixture.items.length },
        decisions: { undecided: fixture.items.length },
      },
    });
    for (const item of fixture.items)
      expect(summary.capture.stdout.join('')).not.toContain(item.text);
    const rerun = await invoke(['import', archive, '--workspace', workspace]);
    expect(rerun.code).toBe(0);
    expect(rerun.result).toMatchObject({ data: { added: 0 } });
    expect((await load(workspace)).items).toEqual(fixture.items);
    expect((await load(workspace)).imports).toHaveLength(2);
    // Planted prior content is independent input to the merge conflict branch.
    const prior = await SQLiteStore.open(join(workspace, 'socialprune.sqlite'));
    try {
      await prior.write(async (tx) => {
        const stored = await tx.items.get(fixture.items[0]!.id);
        await tx.items.put({
          ...stored!,
          item: { ...stored!.item, text: 'Generated earlier text conflicts.' },
        });
      });
    } finally {
      await prior.close();
    }
    const conflicting = await invoke([
      'import',
      archive,
      '--workspace',
      workspace,
    ]);
    expect(conflicting.code).toBe(4);
    expect(conflicting.result).toMatchObject({
      status: 'partial',
      data: { conflicts: 1 },
    });
    expect((await load(workspace)).items[0]!.text).toBe(
      'Generated earlier text conflicts.',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('all writers dry-run with full counts, no creation and unchanged database/output bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-c2-dry-'));
  const workspace = join(directory, 'workspace');
  const missing = join(directory, 'missing');
  const backup = join(directory, 'browser.json');
  const out = join(directory, 'unchanged.json');
  try {
    await browserBackup(backup);
    expect(
      (await invoke(['import', archive, '--workspace', missing, '--dry-run']))
        .code,
    ).toBe(0);
    expect(await readdir(directory)).toEqual(['browser.json']);
    expect(
      (
        await invoke([
          'backup',
          'restore',
          backup,
          '--workspace',
          missing,
          '--dry-run',
        ])
      ).code,
    ).toBe(0);
    expect(await readdir(directory)).toEqual(['browser.json']);
    expect(
      (await invoke(['backup', 'restore', backup, '--workspace', workspace]))
        .code,
    ).toBe(0);
    await writeFile(out, 'GENERATED_OUTPUT_MUST_NOT_CHANGE');
    const before = await readFile(join(workspace, 'socialprune.sqlite'));
    const inventory = (await readdir(workspace)).sort();
    const summary = await invoke(['summary', '--workspace', workspace]);
    for (const args of [
      ['import', archive, '--workspace', workspace, '--dry-run'],
      ['backup', 'export', '--workspace', workspace, '--out', out, '--dry-run'],
      ['backup', 'restore', backup, '--workspace', workspace, '--dry-run'],
      [
        'export',
        'clicklist',
        '--workspace',
        workspace,
        '--account',
        'x:generated',
        '--out',
        out,
        '--dry-run',
      ],
    ]) {
      const result = await invoke(args);
      expect(result.code, args.join(' ')).toBe(0);
      expect(result.result).toMatchObject({
        status: 'ok',
        data: { dryRun: true },
      });
      if (args[0] === 'backup' && args[1] === 'export') {
        if (
          result.result.status === 'error' ||
          summary.result.status === 'error'
        )
          throw new Error('Expected dry-run and summary success.');
        expect(result.result.workspace).toEqual(summary.result.workspace);
      }
      expect(await readFile(join(workspace, 'socialprune.sqlite'))).toEqual(
        before,
      );
      expect((await readdir(workspace)).sort()).toEqual(inventory);
      expect(await readFile(out, 'utf8')).toBe(
        'GENERATED_OUTPUT_MUST_NOT_CHANGE',
      );
    }
    // A negative boundary checks actual bytes, and rejects an injected change.
    expect(() => expect(Buffer.from('CHANGED')).toEqual(before)).toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

test('browser-format backup restores and CLI roundtrip keeps ordered events, submissions and derived state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-c2-roundtrip-'));
  const workspace = join(directory, 'workspace');
  const second = join(directory, 'second');
  const browser = join(directory, 'browser.json');
  const cliBackup = join(directory, 'cli.json');
  try {
    await browserBackup(browser);
    const input = JSON.parse(await readFile(browser, 'utf8')) as WorkspaceV2;
    expect(
      (await invoke(['backup', 'restore', browser, '--workspace', workspace]))
        .code,
    ).toBe(0);
    expect(await load(workspace)).toEqual(input);
    const source = await SQLiteStore.open(
      join(workspace, 'socialprune.sqlite'),
    );
    try {
      expect(await source.read((tx) => tx.state.get('x:101'))).toEqual({
        itemId: 'x:101',
        decision: 'delete',
        outcome: 'skipped',
      });
      expect(await source.read((tx) => tx.state.get('x:102'))).toEqual({
        itemId: 'x:102',
        decision: 'keep',
        outcome: 'unknown',
      });
      expect((await source.read((tx) => tx.runtime.get())).lastEventSeq).toBe(
        3,
      );
    } finally {
      await source.close();
    }
    expect(
      (
        await invoke([
          'backup',
          'export',
          '--workspace',
          workspace,
          '--out',
          cliBackup,
        ])
      ).code,
    ).toBe(0);
    expect(JSON.parse(await readFile(cliBackup, 'utf8'))).toEqual(input);
    expect(
      (await invoke(['backup', 'restore', cliBackup, '--workspace', second]))
        .code,
    ).toBe(0);
    expect(await load(second)).toEqual(input);
    const summary = await invoke(['summary', '--workspace', second]);
    expect(summary.result).toMatchObject({
      data: {
        decisions: { delete: 1, keep: 1, later: 0, undecided: 0 },
        outcomes: { skipped: 1, unknown: 1, 'deleted-by-user': 0 },
        assessments: [{ kind: 'agent', name: 'generated-agent', count: 1 }],
        decisionSources: [
          { via: 'web-review', count: 1 },
          { via: 'local-review', count: 1 },
        ],
        counts: { submissions: 1 },
        withoutAgentAssessment: 1,
      },
    });
    const replacement = await invoke([
      'backup',
      'restore',
      cliBackup,
      '--workspace',
      workspace,
    ]);
    expect(replacement.code).toBe(0);
    if (replacement.result.status === 'error')
      throw new Error('Expected restored file.');
    const previous = (replacement.result.data as { previousFile: string })
      .previousFile;
    expect(previous).toBe(
      join(workspace, 'socialprune.2026-10-07T00-00-00.000Z.previous.sqlite'),
    );
    const old = await SQLiteStore.open(previous, { readOnly: true });
    try {
      expect(await old.read(readWorkspace)).toEqual(input);
    } finally {
      await old.close();
    }
    expect(
      (await readdir(workspace)).some((name) =>
        name.startsWith('socialprune.restore-'),
      ),
    ).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('invalid/schema-newer restore never changes active bytes, never opens a supplied SQLite file, and removes staging', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-c2-invalid-'));
  const workspace = join(directory, 'workspace');
  const backup = join(directory, 'browser.json');
  const invalid = join(directory, 'invalid.json');
  try {
    await browserBackup(backup);
    expect(
      (await invoke(['backup', 'restore', backup, '--workspace', workspace]))
        .code,
    ).toBe(0);
    const before = await readFile(join(workspace, 'socialprune.sqlite'));
    const input = JSON.parse(await readFile(backup, 'utf8')) as WorkspaceV2;
    for (const [value, code, exit] of [
      [{ ...input, schemaVersion: 99 }, 'BACKUP_SCHEMA_UNSUPPORTED', 3],
      [
        { ...input, counts: { ...input.counts, items: 999 } },
        'BACKUP_INVALID',
        1,
      ],
      [
        {
          ...input,
          decisionEvents: input.decisionEvents.map((event) => ({
            ...event,
            previous: 'keep',
          })),
        },
        'BACKUP_INVALID',
        1,
      ],
      [{ ...input, submissions: [] }, 'BACKUP_INVALID', 1],
    ] as const) {
      await writeFile(invalid, JSON.stringify(value));
      const result = await invoke([
        'backup',
        'restore',
        invalid,
        '--workspace',
        workspace,
      ]);
      expect(result.code).toBe(exit);
      expect(result.result).toMatchObject({ error: { code } });
      expect(await readFile(join(workspace, 'socialprune.sqlite'))).toEqual(
        before,
      );
      expect(await readdir(workspace)).toEqual(['socialprune.sqlite']);
    }
    const dbInput = await invoke([
      'backup',
      'restore',
      join(workspace, 'socialprune.sqlite'),
      '--workspace',
      workspace,
    ]);
    expect(dbInput.code).toBe(1);
    expect(dbInput.result).toMatchObject({ error: { code: 'BACKUP_INVALID' } });
    expect(await readFile(join(workspace, 'socialprune.sqlite'))).toEqual(
      before,
    );
    // Adapter receipt survives core's foreign-error flattening.
    const write = Reflect.get(SQLiteStore.prototype, 'write');
    const { CliError } = await import('../cli/errors.ts');
    Reflect.set(SQLiteStore.prototype, 'write', () =>
      Promise.reject(new CliError('STORAGE_FULL')),
    );
    try {
      const full = await invoke([
        'backup',
        'restore',
        backup,
        '--workspace',
        workspace,
      ]);
      expect(full.code).toBe(1);
      expect(full.result).toMatchObject({ error: { code: 'STORAGE_FULL' } });
      expect(await readFile(join(workspace, 'socialprune.sqlite'))).toEqual(
        before,
      );
      expect(await readdir(workspace)).toEqual(['socialprune.sqlite']);
    } finally {
      Reflect.set(SQLiteStore.prototype, 'write', write);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

test('clicklist CSV/JSON uses flag, workspace then system zone, without changing settings or writing decisions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-c2-zone-'));
  const workspace = join(directory, 'workspace');
  const backup = join(directory, 'browser.json');
  const out = join(directory, 'clicklist.json');
  try {
    await browserBackup(backup);
    expect(
      (await invoke(['backup', 'restore', backup, '--workspace', workspace]))
        .code,
    ).toBe(0);
    const before = await load(workspace);
    const flag = await invoke([
      'export',
      'clicklist',
      '--workspace',
      workspace,
      '--account',
      'x:generated',
      '--format',
      'json',
      '--time-zone',
      'America/Los_Angeles',
      '--out',
      out,
    ]);
    expect(flag.code).toBe(0);
    expect(flag.result).toMatchObject({
      data: {
        count: 1,
        timeZone: 'America/Los_Angeles',
        timeZoneSource: 'flag',
      },
    });
    expect(JSON.parse(await readFile(out, 'utf8'))).toMatchObject({
      timeZone: 'America/Los_Angeles',
      entries: [
        {
          itemId: 'x:101',
          day: '2026-10-06',
          via: 'web-review',
          action: 'delete',
        },
      ],
    });
    const setting = await invoke([
      'export',
      'clicklist',
      '--workspace',
      workspace,
      '--account',
      'x:generated',
      '--format',
      'csv',
      '--out',
      out,
    ]);
    expect(setting.code).toBe(0);
    expect(setting.result).toMatchObject({
      data: {
        timeZone: 'Europe/Berlin',
        timeZoneSource: 'workspace',
        count: 1,
      },
    });
    const csv = await readFile(out, 'utf8');
    expect(csv).toContain(
      '2026-10-07,Europe/Berlin,workspace,delete,https://x.com/i/web/status/101',
    );
    expect(csv).not.toContain('x:102');
    expect(await load(workspace)).toEqual(before);
    const database = await SQLiteStore.open(
      join(workspace, 'socialprune.sqlite'),
    );
    try {
      await database.write(async (tx) => {
        const meta = await tx.meta.get();
        await tx.meta.set({
          ...meta,
          settings: { ...meta.settings, timeZone: null },
        });
      });
    } finally {
      await database.close();
    }
    const system = await invoke([
      'export',
      'clicklist',
      '--workspace',
      workspace,
      '--account',
      'x:generated',
      '--format',
      'json',
      '--out',
      out,
    ]);
    expect(system.result).toMatchObject({
      data: {
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timeZoneSource: 'system',
      },
    });
    expect(flag.capture.stdout.join('')).not.toContain(before.items[0]!.text);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('incomplete output does not publish or change lastBackupAt and invalid destinations refuse workspace files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-c2-sink-'));
  const output = join(directory, 'output.json');
  try {
    await writeFile(output, 'ORIGINAL_SYNTHETIC_BYTES');
    const signal = new AbortController().signal;
    const chunks = {
      async *[Symbol.asyncIterator]() {
        await Promise.resolve();
        yield new Uint8Array([1]);
        throw new Error('Synthetic sink failure.');
      },
    };
    await expect(writeChunks(output, chunks, signal)).rejects.toMatchObject({
      code: 'IO_ERROR',
    });
    expect(await readFile(output, 'utf8')).toBe('ORIGINAL_SYNTHETIC_BYTES');
    expect(await readdir(directory)).toEqual(['output.json']);
    const workspace = join(directory, 'workspace');
    await mkdir(workspace);
    const database = await SQLiteStore.open(
      join(workspace, 'socialprune.sqlite'),
      { initial: browserWorkspace() },
    );
    await database.close();
    const failed = await invoke([
      'backup',
      'export',
      '--workspace',
      workspace,
      '--out',
      join(directory, 'missing', 'output.json'),
    ]);
    expect(failed.code).toBe(1);
    expect((await load(workspace)).lastBackupAt).toBeNull();
    expect(
      (
        await invoke([
          'backup',
          'export',
          '--workspace',
          workspace,
          '--out',
          join(workspace, 'socialprune.sqlite'),
        ])
      ).code,
    ).toBe(1);
    const aborted = new AbortController();
    const capture = capturedContext(
      createNodeContext({ write() {} }, { write() {} }).services,
    );
    const node = createNodeContext(
      capture.context.io.stdout,
      capture.context.io.stderr,
      aborted.signal,
    );
    // Abort after core starts producing the backup, before publication or complete().
    const snapshot = Reflect.get(SQLiteStore.prototype, 'snapshot');
    Reflect.set(
      SQLiteStore.prototype,
      'snapshot',
      async function (this: SQLiteStore) {
        const pinned: Awaited<ReturnType<SQLiteStore['snapshot']>> =
          await Reflect.apply(snapshot, this, []);
        let reads = 0;
        return {
          ...pinned,
          store: {
            ...pinned.store,
            read: async function <T>(
              operation: (
                tx: import('@socialprune/core/workspace/store').ReadTransaction,
              ) => Promise<T>,
            ): Promise<T> {
              const value = await pinned.store.read(operation);
              if (++reads === 3) aborted.abort();
              return value;
            },
          },
        };
      },
    );
    try {
      expect(
        await executeCli(
          [
            'backup',
            'export',
            '--workspace',
            workspace,
            '--out',
            output,
            '--json',
          ],
          node,
        ),
      ).toBe(1);
      expect(await readFile(output, 'utf8')).toBe('ORIGINAL_SYNTHETIC_BYTES');
      expect((await load(workspace)).lastBackupAt).toBeNull();
    } finally {
      Reflect.set(SQLiteStore.prototype, 'snapshot', snapshot);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

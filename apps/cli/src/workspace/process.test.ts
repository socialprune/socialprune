import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import {
  createWorkspace,
  readWorkspace,
} from '@socialprune/core/workspace/store';
import { LabelService } from '@socialprune/core/workspace/labels';
import { generateLarge } from '../../../../tools/fixture-gen/src/x/index.ts';
import { executeCli } from '../cli/adapter.ts';
import { createNodeContext } from '../cli/node-context.ts';
import { capturedContext } from '../cli/test/context.ts';
import { SQLiteStore } from './sqlite-store.ts';
import { requireWorkspaceNode } from './node-version.ts';
import { browserWorkspace } from './test/inputs.ts';
import { createBackup } from '@socialprune/core/workspace/backup';
import {
  createMemoryStore,
  MemoryStoreBacking,
} from '@socialprune/core/workspace/memory-store';

const childEntry = fileURLToPath(new URL('./test/child.ts', import.meta.url));
function child(args: string[]) {
  const process = fork(childEntry, args, {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    execArgv: [],
  });
  let stderr = '';
  process.stderr!.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const exited = once(process, 'exit');
  return { process, exited, stderr: () => stderr };
}
async function stop(process: ChildProcess) {
  if (process.exitCode !== null || process.signalCode !== null) return;
  const exited = once(process, 'exit');
  process.kill();
  await exited;
}

test('two processes use rollback journal: writer times out at 5s then succeeds after release', async () => {
  requireWorkspaceNode(process.versions.node);
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-c2-busy-'));
  const file = join(directory, 'socialprune.sqlite');
  const store = await SQLiteStore.open(file, { initial: createWorkspace() });
  await store.close();
  const holder = child(['hold', file]);
  let contender: ReturnType<typeof child> | undefined;
  try {
    expect((await once(holder.process, 'message'))[0]).toEqual({
      type: 'holding',
    });
    const started = performance.now();
    contender = child(['write', file]);
    expect(
      (await once(contender.process, 'message'))[0],
      contender.stderr(),
    ).toEqual({ type: 'error', code: 'WORKSPACE_BUSY' });
    expect((await contender.exited)[0]).toBe(1);
    expect(performance.now() - started).toBeGreaterThanOrEqual(4900);
    holder.process.send('release');
    expect((await holder.exited)[0]).toBe(0);
    contender = child(['write', file]);
    expect(
      (await once(contender.process, 'message'))[0],
      contender.stderr(),
    ).toEqual({ type: 'committed' });
    expect((await contender.exited)[0]).toBe(0);
    const reopened = await SQLiteStore.open(file);
    try {
      expect((await reopened.read((tx) => tx.runtime.get())).revision).toBe(1);
    } finally {
      await reopened.close();
    }
  } finally {
    await stop(holder.process);
    if (contender) await stop(contender.process);
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

test('restore held Windows file becomes WORKSPACE_BUSY, preserves active bytes and later succeeds', async () => {
  requireWorkspaceNode(process.versions.node);
  const directory = await mkdtemp(
    join(tmpdir(), 'socialprune-c2-restore-busy-'),
  );
  const file = join(directory, 'socialprune.sqlite');
  const backup = join(directory, 'backup.json');
  const store = await SQLiteStore.open(file, { initial: browserWorkspace() });
  await store.close();
  const memory = createMemoryStore(new MemoryStoreBacking(browserWorkspace()));
  const session = createBackup(memory);
  const chunks: Uint8Array[] = [];
  for await (const chunk of session.chunks) chunks.push(chunk);
  await writeFile(backup, Buffer.concat(chunks));
  await memory.close();
  const holder = child([
    process.platform === 'win32' ? 'hold-read' : 'hold',
    file,
  ]);
  try {
    const ready = await once(holder.process, 'message');
    expect(ready[0]).toEqual({
      type: process.platform === 'win32' ? 'reading' : 'holding',
    });
    const before = await readFile(file);
    const capture = capturedContext(
      createNodeContext({ write() {} }, { write() {} }).services,
    );
    const context = createNodeContext(
      capture.context.io.stdout,
      capture.context.io.stderr,
    );
    expect(
      await executeCli(
        ['backup', 'restore', backup, '--workspace', directory, '--json'],
        context,
      ),
    ).toBe(1);
    expect(JSON.parse(capture.stdout.join(''))).toMatchObject({
      error: { code: 'WORKSPACE_BUSY', retryable: true },
    });
    expect(await readFile(file)).toEqual(before);
    expect((await readdir(directory)).sort()).toEqual([
      'backup.json',
      'socialprune.sqlite',
    ]);
    holder.process.send('release');
    expect((await holder.exited)[0]).toBe(0);
    capture.stdout.length = 0;
    expect(
      await executeCli(
        ['backup', 'restore', backup, '--workspace', directory, '--json'],
        context,
      ),
    ).toBe(0);
    const result = JSON.parse(capture.stdout.join('')) as {
      data: { previousFile: string };
    };
    expect(result.data.previousFile).toContain('.previous.sqlite');
  } finally {
    await stop(holder.process);
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);

test('killed real import leaves hidden incomplete items; rerun completes the same import', async () => {
  requireWorkspaceNode(process.versions.node);
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-c2-kill-'));
  const archive = join(directory, 'generated.zip');
  const workspace = join(directory, 'workspace');
  let importer: ReturnType<typeof child> | undefined;
  try {
    await generateLarge({ count: 2100, seed: 17, out: archive });
    // The production import creates the folder, while the child is a test-only observer.
    const preview = capturedContext(
      createNodeContext({ write() {} }, { write() {} }).services,
    );
    const context = createNodeContext(
      preview.context.io.stdout,
      preview.context.io.stderr,
    );
    expect(
      await executeCli(
        ['import', archive, '--workspace', workspace, '--dry-run', '--json'],
        context,
      ),
    ).toBe(0);
    const { mkdir } = await import('node:fs/promises');
    await mkdir(workspace);
    importer = child([
      'import-kill',
      join(workspace, 'socialprune.sqlite'),
      archive,
    ]);
    expect(
      (await once(importer.process, 'message'))[0],
      importer.stderr(),
    ).toEqual({ type: 'batch-committed', items: 1000 });
    await stop(importer.process);
    const interrupted = await SQLiteStore.open(
      join(workspace, 'socialprune.sqlite'),
    );
    let importId: string;
    try {
      const data = await interrupted.read(readWorkspace);
      expect(data.items).toHaveLength(1000);
      expect(data.imports).toHaveLength(1);
      expect(data.imports[0]!.status).toBe('incomplete');
      importId = data.imports[0]!.id;
      const hidden = await new LabelService(interrupted).summary();
      expect(hidden.accounts).toEqual([]);
      expect(hidden.decisions.undecided).toBe(0);
    } finally {
      await interrupted.close();
    }
    expect(
      await executeCli(
        ['import', archive, '--workspace', workspace, '--json'],
        context,
      ),
    ).toBe(0);
    const completed = await SQLiteStore.open(
      join(workspace, 'socialprune.sqlite'),
    );
    try {
      const data = await completed.read(readWorkspace);
      expect(data.items).toHaveLength(2100);
      expect(data.imports).toHaveLength(1);
      expect(data.imports[0]).toMatchObject({
        id: importId,
        status: 'complete',
        itemCount: 2100,
      });
      expect(
        (await new LabelService(completed).summary()).decisions.undecided,
      ).toBe(2100);
    } finally {
      await completed.close();
    }
  } finally {
    if (importer) await stop(importer.process);
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);

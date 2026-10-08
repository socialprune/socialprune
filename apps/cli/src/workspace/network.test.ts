import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { createBackup } from '@socialprune/core/workspace/backup';
import {
  createMemoryStore,
  MemoryStoreBacking,
} from '@socialprune/core/workspace/memory-store';
import { executeCli } from '../cli/adapter.ts';
import { createNodeContext } from '../cli/node-context.ts';
import { capturedContext } from '../cli/test/context.ts';
import { networkRecorder } from '../cli/test/network-recorder.ts';
import { browserWorkspace } from './test/inputs.ts';

const archive = fileURLToPath(
  new URL(
    '../../../../fixtures/synthetic/x/current-minimal/archive/',
    import.meta.url,
  ),
);
test('every new command success/dry-run/help/error is observed with zero outbound or opener calls', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-c2-network-'));
  const workspace = join(directory, 'workspace');
  const second = join(directory, 'second');
  const file = join(directory, 'browser.json');
  const out = join(directory, 'out.json');
  const recorder = networkRecorder();
  try {
    const store = createMemoryStore(new MemoryStoreBacking(browserWorkspace()));
    const backup = createBackup(store);
    const chunks: Uint8Array[] = [];
    for await (const chunk of backup.chunks) chunks.push(chunk);
    await writeFile(file, Buffer.concat(chunks));
    await backup.complete();
    await store.close();
    const cases: [string[], number][] = [
      [['backup', 'restore', file, '--workspace', workspace], 0],
      [['summary', '--workspace', workspace], 0],
      [
        [
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
        ],
        0,
      ],
      [
        [
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
          '--dry-run',
        ],
        0,
      ],
      [['backup', 'export', '--workspace', workspace, '--out', out], 0],
      [
        [
          'backup',
          'export',
          '--workspace',
          workspace,
          '--out',
          out,
          '--dry-run',
        ],
        0,
      ],
      [['backup', 'restore', file, '--workspace', second, '--dry-run'], 0],
      [['import', archive, '--workspace', workspace], 0],
      [['import', archive, '--workspace', workspace, '--dry-run'], 0],
    ];
    for (const route of [
      ['import'],
      ['summary'],
      ['backup', 'export'],
      ['backup', 'restore'],
      ['export', 'clicklist'],
    ]) {
      cases.push([[...route, '--help'], 0], [[...route, '--bad'], 2]);
    }
    for (const [args, expected] of cases) {
      for (const json of [false, true]) {
        const capture = capturedContext(
          createNodeContext({ write() {} }, { write() {} }).services,
        );
        const context = createNodeContext(
          capture.context.io.stdout,
          capture.context.io.stderr,
        );
        const result = await executeCli(
          [...args, ...(json ? ['--json'] : [])],
          { ...context, openBrowser: capture.context.openBrowser },
        );
        expect(result, args.join(' ')).toBe(expected);
        expect(recorder.calls, args.join(' ')).toEqual([]);
        expect(capture.opened).toEqual([]);
      }
    }
  } finally {
    recorder.restore();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);

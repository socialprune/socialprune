import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { directory, dist } from './paths.ts';

const require = createRequire(import.meta.url);
await mkdir(join(dist, 'red-controls'), { recursive: true });
for (const control of [
  {
    name: 'sender-zod',
    entry: join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs'),
    args: [
      'run',
      '--config',
      'test/red/router.vitest.config.ts',
      '--maxWorkers=2',
    ],
    evidence: ['10 failed', 'instead of rejecting'],
  },
  {
    name: 'sqlite-error',
    entry: join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs'),
    args: [
      'run',
      '--config',
      'test/red/workspace.vitest.config.ts',
      '--maxWorkers=2',
    ],
    evidence: ['1 failed', 'foundationSummary', 'WORKSPACE_OPEN_FAILED'],
  },
  {
    name: 'renderer-fuses',
    entry: require.resolve('@playwright/test/cli'),
    args: [
      'test',
      '--config',
      'playwright.red.config.ts',
      '--grep',
      'RED planted',
      '--workers=1',
    ],
    evidence: [
      '6 failed',
      "process: 'object'",
      'CSP_VIOLATION',
      'connect-src',
      'script-src-elem',
      'FUSE_MISMATCH_0',
      'APP_LISTENER',
      'BROWSER_PROCESS_REMAINS',
    ],
  },
]) {
  const child = spawn(process.execPath, [control.entry, ...control.args], {
    cwd: directory,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  child.stdout.on('data', (data: Buffer) => {
    output += data.toString();
  });
  child.stderr.on('data', (data: Buffer) => {
    output += data.toString();
  });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  await writeFile(join(dist, 'red-controls', `${control.name}.txt`), output);
  assert.equal(exitCode, 1, `${control.name}: expected assertion failure`);
  for (const evidence of control.evidence)
    assert.ok(
      output.includes(evidence),
      `${control.name}: missing ${evidence}`,
    );
  console.log(
    JSON.stringify({
      control: control.name,
      expectedExit: 1,
      exitCode,
      assertionsObserved: control.evidence,
    }),
  );
}

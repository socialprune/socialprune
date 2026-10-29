import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { helperCacheDirectory } from '../packaging/helper-cache.ts';
import { directory } from '../packaging/paths.ts';

// Hosted-only acceptance runner. Fake compiler tests never write real receipts.
async function snapshot() {
  const entries: Record<string, string> = {};
  let names: string[] = [];
  try {
    names = await readdir(helperCacheDirectory);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw error;
  }
  for (const key of names.filter((name) => /^[a-f0-9]{64}$/.test(name))) {
    const bytes = await readFile(join(helperCacheDirectory, key, 'helper.exe'));
    const digest = createHash('sha256').update(bytes).digest('hex');
    assert.equal(
      await readFile(join(helperCacheDirectory, key, 'sha256'), 'utf8'),
      digest,
    );
    entries[key] = digest;
  }
  let receipts: string[] = [];
  try {
    receipts = await readdir(join(helperCacheDirectory, 'receipts'));
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw error;
  }
  return { entries, receipts };
}

const proof = join(directory, 'dist', 'helper-cache-proof');
await mkdir(proof, { recursive: true });
const before = await snapshot();
const runs: unknown[] = [];
for (const run of [1, 2]) {
  const initial = await snapshot();
  const child = spawn(
    process.execPath,
    [
      join(directory, '../../node_modules/vitest/vitest.mjs'),
      'run',
      '--project',
      'desktop',
      '--maxWorkers=2',
      '--testTimeout=30000',
    ],
    {
      cwd: join(directory, '../..'),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );
  let log = '';
  child.stdout.on('data', (bytes: Buffer) => {
    process.stdout.write(bytes);
    log += bytes.toString();
  });
  child.stderr.on('data', (bytes: Buffer) => {
    process.stderr.write(bytes);
    log += bytes.toString();
  });
  const exit = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  await writeFile(join(proof, `run-${run}.log`), log);
  const after = await snapshot();
  const misses = after.receipts.filter(
    (name) => !initial.receipts.includes(name),
  );
  const receipt = {
    run,
    exit,
    compiles: misses.length,
    entries: after.entries,
    missReceipts: misses,
  };
  runs.push(receipt);
  await writeFile(
    join(proof, 'runs.json'),
    JSON.stringify({ version: 1, before, runs }, null, 2),
  );
  console.log('HELPER_CACHE_RUN_RECEIPT', JSON.stringify(receipt));
  assert.equal(exit, 0, `unit run ${run}`);
  if (run === 1)
    assert.ok(misses.length > 0, 'cold run must compile real helpers');
  if (run === 2) {
    assert.equal(misses.length, 0, 'second unit run must compile zero helpers');
    assert.deepEqual(
      after.entries,
      initial.entries,
      'identical executable hashes retained',
    );
  }
}

/** Opt-in Node-only cache measurement, not a suite or a budget assertion.
 * pnpm exec node --expose-gc e2e/feed-heap.measurement.ts <input.json> <out.json>
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setImmediate } from 'node:timers/promises';
import {
  createMemoryStore,
  MemoryStoreBacking,
} from '@socialprune/core/workspace/memory-store';
import { QueryEngine } from '@socialprune/core/workspace/query';
import { SettingsService } from '@socialprune/core/workspace/settings';
import type { WorkspaceV2 } from '@socialprune/core';
import { scaleWorkspace, SCALE_ACCOUNT } from './scale-data.ts';
import { scaleStop } from './scale-host.ts';
import { measurementIdentity } from '../tooling/measurement-identity.ts';

const [input, output] = process.argv.slice(2);
if (!input || !output || typeof globalThis.gc !== 'function')
  throw new Error('Explicit input, output and --expose-gc are required.');
scaleStop();
async function setup() {
  let text: string;
  try {
    text = await readFile(input!, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    text = (await scaleWorkspace(100_000)).text;
    await writeFile(input!, text, { flag: 'wx' });
  }
  const workspace = JSON.parse(text) as WorkspaceV2;
  const store = createMemoryStore(new MemoryStoreBacking(workspace));
  return {
    query: new QueryEngine(store),
    settings: new SettingsService(store),
    criteria: structuredClone(workspace.settings.criteria!),
    inputSha256: createHash('sha256').update(text).digest('hex'),
    inputBytes: Buffer.byteLength(text),
    entries: workspace.items.length,
    close: () => store.close(),
  };
}
async function retained() {
  // Let completed async callback frames release their local workspace/arrays.
  await setImmediate();
  globalThis.gc!();
  await setImmediate();
  globalThis.gc!();
  return process.memoryUsage();
}
const run = await setup();
const sourceHash = await measurementIdentity();
const head = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: new URL('../../../', import.meta.url),
  encoding: 'utf8',
}).trim();
const before = await retained();
let begin = performance.now();
const first = await run.query.planCounts(SCALE_ACCOUNT);
const firstMs = performance.now() - begin;
if (first.tabs.all !== 100_000 || first.tabs.suggested !== 6_000)
  throw new Error('Generated count mismatch.');
const afterFirst = await retained();
await run.settings.setCriteria({ ...run.criteria, level: 0 });
begin = performance.now();
await run.query.planCounts(SCALE_ACCOUNT);
const levelMs = performance.now() - begin;
const afterLevel = await retained();
const cold: number[] = [];
for (let index = 0; index < 20; index++) {
  scaleStop();
  await run.settings.setCriteria({ ...run.criteria, level: index % 2 ? 0 : 2 });
  const start = performance.now();
  const counts = await run.query.planCounts(SCALE_ACCOUNT);
  cold.push(performance.now() - start);
  if (counts.tabs.all !== 100_000 || counts.tabs.suggested !== 6_000)
    throw new Error('Changed configuration mismatch.');
}
const afterTwenty = await retained();
const sorted = [...cold].sort((a, b) => a - b);
const report = {
  format: 'socialprune-feed-node-heap-v1',
  head,
  sourceHash,
  node: process.version,
  platform: process.platform,
  measuredAt: new Date().toISOString(),
  inputSha256: run.inputSha256,
  inputBytes: run.inputBytes,
  entries: run.entries,
  method:
    'Core in-memory store; two explicit GC calls after released async frames; heapUsed with external/arrayBuffers separately recorded',
  boundary:
    'Increment over an already retained in-memory workspace, not total browser heap or isolated FeedQuery object size',
  before,
  afterFirst,
  afterLevel,
  afterTwenty,
  firstIncrement: afterFirst.heapUsed - before.heapUsed,
  firstBytesPerEntry: (afterFirst.heapUsed - before.heapUsed) / run.entries,
  levelIncrement: afterLevel.heapUsed - before.heapUsed,
  levelBytesPerEntry: (afterLevel.heapUsed - before.heapUsed) / run.entries,
  firstMs,
  levelMs,
  cold: { samples: cold, p95: sorted[18], max: sorted.at(-1) },
};
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log('NODE_HEAP_RESULT', JSON.stringify(report));
await run.close();

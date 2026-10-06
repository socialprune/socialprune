import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// Inspect only the exact aggregate report supplied by the caller and its own
// measurement directory. No real export path or browser profile is discovered.
const path = process.argv[2];
if (!path) throw new Error('Pass an S1 aggregate results.json path.');
const result = JSON.parse(await readFile(path, 'utf8')) as {
  sourceIdentity: string;
  sourceUnchanged: boolean;
  failure: string | null;
  rows: {
    name: string;
    wallMs: number;
    abortMs: number | null;
    items: number;
    peakPrivateBytes: number;
    peakWorkingBytes: number;
    baseline: { privateBytes: number; workingBytes: number };
    after: { privateBytes: number; workingBytes: number };
    mediaReadBytes: number;
    profile: { path: string; bytesAfterClose: number };
  }[];
  comparison: { wallMs: number; peakRss: number; maxRssBytes: number };
};
if (!result.sourceUnchanged || result.failure || result.rows.length !== 5)
  throw new Error('This is not a complete source-bound S1 report.');
if (result.rows.map(({ name }) => name).join(',') !== 'M1-1,M1-2,M1-3,M2,M3')
  throw new Error('The required S1 rows are absent or duplicated.');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const hash = createHash('sha256');
async function hashSource(path: string): Promise<void> {
  for (const entry of (await readdir(path, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) await hashSource(join(path, entry.name));
    else if (!entry.name.endsWith('.test.ts') && entry.name !== 'testing.ts') {
      hash.update(join(path, entry.name).slice(root.length));
      hash.update(await readFile(join(path, entry.name)));
    }
  }
}
for (const source of [
  'apps/web/src',
  'packages/core/src',
  'packages/adapter-x/src',
  'packages/adapter-instagram/src',
  'tools/fixture-gen/src/x',
])
  await hashSource(join(root, source));
for (const source of [
  'pnpm-lock.yaml',
  'apps/web/index.html',
  'apps/web/vite.config.ts',
  'tools/fixture-gen/src/shared/zip.ts',
  'apps/web/scripts/measure-g1.ts',
  'apps/web/scripts/memory-sampler.ps1',
  'apps/web/scripts/node-comparison.ts',
])
  hash.update(await readFile(join(root, source)));
const currentIdentity = hash.digest('hex');
if (currentIdentity !== result.sourceIdentity)
  throw new Error(
    'The current executable source differs from the measured source.',
  );
console.log(
  JSON.stringify({
    sourceIdentity: currentIdentity,
    currentSourceMatches: true,
  }),
);
const mib = (bytes: number) => +(bytes / 1024 ** 2).toFixed(2);
for (const row of result.rows) {
  if (row.mediaReadBytes !== 0) throw new Error('Media payload overlap.');
  if (!row.profile.path.startsWith(tmpdir()))
    throw new Error('Unexpected profile path.');
  if (await stat(row.profile.path).catch(() => null))
    throw new Error('The disposable profile remains.');
  console.log(
    JSON.stringify({
      name: row.name,
      seconds: +(row.wallMs / 1000).toFixed(4),
      abortMs: row.abortMs,
      items: row.items,
      baselinePrivateMiB: mib(row.baseline.privateBytes),
      baselineWorkingMiB: mib(row.baseline.workingBytes),
      peakPrivateMiB: mib(row.peakPrivateBytes),
      peakWorkingMiB: mib(row.peakWorkingBytes),
      privateIncreaseMiB: mib(row.peakPrivateBytes - row.baseline.privateBytes),
      workingIncreaseMiB: mib(row.peakWorkingBytes - row.baseline.workingBytes),
      afterPrivateMiB: mib(row.after.privateBytes),
      afterWorkingMiB: mib(row.after.workingBytes),
      profileExists: false,
    }),
  );
}
console.log(
  JSON.stringify({
    name: 'M4',
    seconds: +(result.comparison.wallMs / 1000).toFixed(4),
    peakRssMiB: mib(result.comparison.peakRss),
    maxRssMiB: mib(result.comparison.maxRssBytes),
  }),
);
const web = fileURLToPath(new URL('../', import.meta.url));
console.log(
  JSON.stringify({
    ignoredWebBuildBytes: await size(join(web, 'dist')),
    ignoredWebTestResultsBytes: await size(join(web, 'test-results')),
  }),
);

async function size(path: string): Promise<number> {
  const info = await stat(path).catch(() => null);
  if (!info) return 0;
  if (info.isFile()) return info.size;
  let bytes = 0;
  for (const child of await readdir(path, { withFileTypes: true }))
    if (!child.isSymbolicLink()) bytes += await size(join(path, child.name));
  return bytes;
}
const s1 = join(
  homedir(),
  'AppData',
  'Local',
  'Temp',
  'kilo',
  'phase1-foundation',
  's1',
);
for (const directory of await readdir(s1, { withFileTypes: true })) {
  if (!directory.isDirectory() || directory.isSymbolicLink())
    throw new Error('Unexpected S1 residue.');
  const files = await readdir(join(s1, directory.name));
  if (files.some((file) => file.endsWith('.zip')))
    throw new Error('A generated archive remains.');
  console.log(
    JSON.stringify({
      trial: directory.name,
      bytes: await size(join(s1, directory.name)),
      files,
    }),
  );
}
console.log(
  JSON.stringify({
    sharedPlaywrightCacheBytes: await size(
      join(homedir(), 'AppData', 'Local', 'ms-playwright'),
    ),
  }),
);

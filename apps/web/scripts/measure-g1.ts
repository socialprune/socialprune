import { spawn, execFile } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  stat,
  readdir,
  writeFile,
  rm,
  readFile,
  open,
} from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import {
  hostname,
  platform,
  release,
  cpus,
  totalmem,
  homedir,
  tmpdir,
} from 'node:os';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import type { Browser, BrowserContext } from '@playwright/test';
import { writeZipFile } from '@socialprune/fixture-gen';
import type { ZipFileEntry } from '@socialprune/fixture-gen';
import { largeEntries } from '../../../tools/fixture-gen/src/x/index.ts';

const web = fileURLToPath(new URL('../', import.meta.url));
const root = fileURLToPath(new URL('../../../', import.meta.url));
const tempRoot =
  platform() === 'win32'
    ? join(
        homedir(),
        'AppData',
        'Local',
        'Temp',
        'kilo',
        'phase1-foundation',
        's1',
      )
    : join(tmpdir(), 'kilo', 'phase1-foundation', 's1');
const origin = 'http://127.0.0.1:4175';
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
const execute = promisify(execFile);

async function bytes(path: string): Promise<number> {
  const info = await stat(path).catch(() => null);
  if (!info) return 0;
  if (info.isFile()) return info.size;
  let total = 0;
  for (const child of await readdir(path, { withFileTypes: true })) {
    if (!child.isSymbolicLink()) total += await bytes(join(path, child.name));
  }
  return total;
}

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) =>
    child.once('exit', () => resolve()),
  );
  child.kill();
  await exited;
}

async function command(args: string[], cwd = web): Promise<void> {
  const child = spawn(process.execPath, args, { cwd, stdio: 'inherit' });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (code !== 0) throw new Error(`Command failed with exit ${code}.`);
}

function padding(size: number, seed: number): ReadableStream<Uint8Array> {
  let remaining = size;
  let state = seed >>> 0 || 1;
  return new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (!remaining) {
          controller.close();
          return;
        }
        const chunk = new Uint8Array(Math.min(1024 * 1024, remaining));
        const words = new DataView(chunk.buffer);
        for (let offset = 0; offset < chunk.byteLength; offset += 4) {
          state ^= state << 13;
          state ^= state >>> 17;
          state ^= state << 5;
          words.setUint32(offset, state >>> 0, true);
        }
        remaining -= chunk.byteLength;
        controller.enqueue(chunk);
      },
    },
    { highWaterMark: 1 },
  );
}

async function* zip64Entries(): AsyncGenerator<ZipFileEntry> {
  // Five 896MiB entries total 4.375GiB. A per-entry STORE setting is checked
  // below from the actual ZIP headers, not inferred from incompressibility.
  // Put JSON last: zip.js probes the last 65557 bytes for the ZIP footer, so
  // media-last layouts otherwise have a small, unavoidable tail read.
  for (let index = 0; index < 5; index++) {
    const entry: ZipFileEntry & { level: number } = {
      path: `data/tweets_media/invented-padding-${index}.bin`,
      content: padding(896 * 1024 * 1024, index + 1),
      level: 0,
    };
    yield entry;
  }
  yield* largeEntries({ count: 100_000, seed: 1 });
}

async function verifyZip64(path: string) {
  const file = await open(path, 'r');
  try {
    const size = (await file.stat()).size;
    const tail = Buffer.alloc(512);
    await file.read(tail, 0, tail.length, size - tail.length);
    const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (eocd < 20 || tail.readUInt32LE(eocd - 20) !== 0x07064b50)
      throw new Error('Expected the real ZIP64 end-of-directory locator.');
    const zip64 = Buffer.alloc(56);
    await file.read(
      zip64,
      0,
      zip64.length,
      Number(tail.readBigUInt64LE(eocd - 12)),
    );
    if (zip64.readUInt32LE(0) !== 0x06064b50)
      throw new Error('Missing ZIP64 directory record.');
    const directorySize = Number(zip64.readBigUInt64LE(40));
    const directoryOffset = Number(zip64.readBigUInt64LE(48));
    if (directorySize > 1024 * 1024 || directoryOffset <= 4 * 1024 ** 3)
      throw new Error('Unexpected ZIP64 central directory.');
    const central = Buffer.alloc(directorySize);
    await file.read(central, 0, central.length, directoryOffset);
    const entries = [];
    for (let offset = 0; offset < central.length;) {
      if (central.readUInt32LE(offset) !== 0x02014b50)
        throw new Error('Invalid ZIP directory entry.');
      const nameBytes = central.readUInt16LE(offset + 28);
      const extraBytes = central.readUInt16LE(offset + 30);
      const commentBytes = central.readUInt16LE(offset + 32);
      const name = central.toString(
        'utf8',
        offset + 46,
        offset + 46 + nameBytes,
      );
      if (name.includes('invented-padding-')) {
        const method = central.readUInt16LE(offset + 10);
        let compressed = central.readUInt32LE(offset + 20);
        let uncompressed = central.readUInt32LE(offset + 24);
        let localOffset = central.readUInt32LE(offset + 42);
        const end = offset + 46 + nameBytes + extraBytes;
        for (let extra = offset + 46 + nameBytes; extra < end;) {
          const tag = central.readUInt16LE(extra);
          const length = central.readUInt16LE(extra + 2);
          if (tag === 1) {
            let value = extra + 4;
            if (uncompressed === 0xffffffff) {
              uncompressed = Number(central.readBigUInt64LE(value));
              value += 8;
            }
            if (compressed === 0xffffffff) {
              compressed = Number(central.readBigUInt64LE(value));
              value += 8;
            }
            if (localOffset === 0xffffffff)
              localOffset = Number(central.readBigUInt64LE(value));
          }
          extra += length + 4;
        }
        if (
          method !== 0 ||
          compressed !== uncompressed ||
          uncompressed !== 896 * 1024 * 1024
        )
          throw new Error(
            'Padding was not stored without compression; the shared writer must forward entry.level.',
          );
        const local = Buffer.alloc(30);
        await file.read(local, 0, local.length, localOffset);
        if (local.readUInt32LE(0) !== 0x04034b50)
          throw new Error('Invalid local ZIP header.');
        const payloadStart =
          localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
        entries.push({
          name,
          method,
          compressed,
          uncompressed,
          payloadStart,
          payloadEnd: payloadStart + compressed,
        });
      }
      offset += 46 + nameBytes + extraBytes + commentBytes;
    }
    if (entries.length !== 5)
      throw new Error('Expected five stored padding entries.');
    return { size, directoryOffset, directorySize, entries };
  } finally {
    await file.close();
  }
}

interface Sample {
  at: number;
  workingBytes: number;
  privateBytes: number;
  processes: number[];
}
interface ProcessInfo {
  id: number;
  type: string;
}
interface Row {
  name: string;
  status: string | undefined;
  items: number;
  batches: number;
  wallMs: number | null;
  abortMs: number | null;
  peakWorkingBytes: number;
  peakPrivateBytes: number;
  baseline: Sample;
  after: Sample;
  sampleCount: number;
  meanIntervalMs: number;
  maxIntervalMs: number;
  browserVersion: string;
  processes: ProcessInfo[];
  processesAfter: ProcessInfo[];
  profile: { path: string; bytesBeforeClose: number; bytesAfterClose: number };
  memorySamples: Sample[];
  archiveReadBytes: number;
  archiveReadCount: number;
  mediaReadBytes: number;
  archiveReads: { start: number; end: number }[];
}

async function measure(
  name: string,
  archive: string,
  abort: boolean,
  expectedCount = 100_000,
  media: { payloadStart: number; payloadEnd: number }[] = [],
): Promise<Row> {
  if (platform() !== 'win32')
    throw new Error(
      'This OS memory probe requires Windows; adapt the sampler before claiming memory results.',
    );
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let sampler: ChildProcess | undefined;
  const samplerState: { failure: Error | null } = { failure: null };
  const samples: Sample[] = [];
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--enable-automation'],
    });
    const processSession = await browser.newBrowserCDPSession();
    const commandLine = await processSession.send(
      'Browser.getBrowserCommandLine',
    );
    const profilePath = commandLine.arguments
      .find((argument) => argument.startsWith('--user-data-dir='))
      ?.slice('--user-data-dir='.length);
    if (!profilePath || !profilePath.startsWith(tmpdir()))
      throw new Error('The disposable browser profile was not identified.');
    context = await browser.newContext();
    const page = await context.newPage();
    const external: string[] = [];
    const failures: string[] = [];
    const errors: string[] = [];
    context.on('request', (request) => {
      if (new URL(request.url()).origin !== origin)
        external.push(request.url());
    });
    context.on('requestfailed', (request) => failures.push(request.url()));
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      Reflect.set(globalThis, '__policy', []);
      document.addEventListener('securitypolicyviolation', (event) => {
        (Reflect.get(globalThis, '__policy') as string[]).push(
          event.effectiveDirective,
        );
      });
    });
    await page.goto(origin);
    await page.waitForFunction(
      () => window.socialprune?.getImportSnapshot().phase === 'idle',
    );
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLButtonElement>('button')?.disabled === true,
    );
    const workerDeadline = Date.now() + 5000;
    while (!page.workers().length && Date.now() < workerDeadline)
      await delay(20);
    if (page.workers().length !== 1)
      throw new Error('Expected the real import worker.');
    await page.workers()[0]!.evaluate(() => {
      const reads: { start: number; end: number }[] = [];
      Reflect.set(globalThis, '__archiveReads', reads);
      const slice = Object.getOwnPropertyDescriptor(Blob.prototype, 'slice')
        ?.value as Blob['slice'];
      Blob.prototype.slice = function (
        this: Blob,
        start = 0,
        end = this.size,
        contentType?: string,
      ) {
        const normalize = (value: number) =>
          Math.min(
            this.size,
            value < 0 ? Math.max(this.size + value, 0) : value,
          );
        reads.push({ start: normalize(start), end: normalize(end) });
        return slice.call(this, start, end, contentType);
      };
    });
    const processes = (
      (await processSession.send('SystemInfo.getProcessInfo')) as {
        processInfo: ProcessInfo[];
      }
    ).processInfo;
    sampler = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-File',
        join(web, 'scripts', 'memory-sampler.ps1'),
        '-ProcessIds',
        processes.map(({ id }) => id).join(','),
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    sampler.on('error', (error) => {
      samplerState.failure = error;
    });
    let buffered = '';
    let samplerErrors = '';
    sampler.stderr?.on('data', (chunk: Buffer) => {
      samplerErrors += chunk.toString();
    });
    sampler.stdout?.on('data', (chunk: Buffer) => {
      buffered += chunk.toString();
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? '';
      for (const line of lines)
        if (line.trim()) samples.push(JSON.parse(line) as Sample);
    });
    const sampleDeadline = Date.now() + 10_000;
    while (samples.length < 3 && Date.now() < sampleDeadline) await delay(100);
    const baseline = samples.at(-1);
    if (!baseline || samplerState.failure)
      throw new Error(
        `Memory sampler failed: ${samplerState.failure?.message ?? samplerErrors}`,
      );
    await page.getByLabel('Export ZIP files').setInputFiles(archive);
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    if (abort) {
      await page.waitForFunction(
        () => window.socialprune.getImportSnapshot().receivedItems >= 50_000,
        undefined,
        { timeout: 180_000 },
      );
      await page.getByRole('button', { name: 'Abort', exact: true }).click();
    }
    await page.waitForFunction(
      (phase) => window.socialprune.getImportSnapshot().phase === phase,
      abort ? 'aborted' : 'complete',
      { timeout: 240_000 },
    );
    const result = await page.evaluate(() => {
      const {
        phase,
        receivedItems,
        batches,
        durationMs,
        abortLatencyMs,
        summary,
        items,
        policyViolations,
      } = window.socialprune.getImportSnapshot();
      return {
        phase,
        receivedItems,
        batches,
        durationMs,
        abortLatencyMs,
        summary,
        storedItems: items.length,
        policyViolations,
      };
    });
    if (
      !abort &&
      (result.receivedItems !== expectedCount ||
        result.storedItems !== expectedCount ||
        result.summary?.status !== 'ok')
    )
      throw new Error(
        `The real import did not return ${expectedCount} items: ${JSON.stringify(result)}`,
      );
    if (
      abort &&
      (result.storedItems !== 0 ||
        !result.abortLatencyMs ||
        result.receivedItems >= 100_000)
    )
      throw new Error('Abort did not discard a partial import.');
    await delay(abort ? 5000 : 500);
    const after = samples.at(-1);
    if (!after) throw new Error('No post-import memory sample.');
    const processesAfter = (
      (await processSession.send('SystemInfo.getProcessInfo')) as {
        processInfo: ProcessInfo[];
      }
    ).processInfo;
    if (
      processesAfter.some(
        ({ id }) => !processes.some((before) => before.id === id),
      )
    )
      throw new Error('A new Chromium process escaped memory sampling.');
    if (
      external.length ||
      failures.length ||
      errors.length ||
      result.policyViolations.length ||
      (
        await page.evaluate(
          () => Reflect.get(globalThis, '__policy') as string[],
        )
      ).length
    )
      throw new Error(
        `Browser audit failed: ${JSON.stringify({ external, failures, errors })}`,
      );
    const measured = samples.filter(({ at }) => at >= baseline.at);
    const archiveReads = await page.workers()[0]!.evaluate(
      () =>
        Reflect.get(globalThis, '__archiveReads') as {
          start: number;
          end: number;
        }[],
    );
    const mediaReadBytes = archiveReads.reduce(
      (total, read) =>
        total +
        media.reduce(
          (sum, entry) =>
            sum +
            Math.max(
              0,
              Math.min(read.end, entry.payloadEnd) -
                Math.max(read.start, entry.payloadStart),
            ),
          0,
        ),
      0,
    );
    if (!archiveReads.length || !archiveReads.some(({ end }) => end > 0))
      throw new Error('The ZIP byte-read audit did not observe actual reads.');
    const intervals = samples
      .slice(1)
      .map((sample, index) => sample.at - samples[index]!.at);
    const row: Row = {
      name,
      status: abort ? 'aborted' : result.summary?.status,
      items: result.receivedItems,
      batches: result.batches,
      wallMs: result.durationMs,
      abortMs: result.abortLatencyMs,
      peakWorkingBytes: Math.max(
        ...measured.map(({ workingBytes }) => workingBytes),
      ),
      peakPrivateBytes: Math.max(
        ...measured.map(({ privateBytes }) => privateBytes),
      ),
      baseline,
      after,
      sampleCount: measured.length,
      meanIntervalMs:
        intervals.reduce((sum, value) => sum + value, 0) / intervals.length,
      maxIntervalMs: Math.max(...intervals),
      browserVersion: browser.version(),
      processes,
      processesAfter,
      profile: {
        path: profilePath,
        bytesBeforeClose: await bytes(profilePath),
        bytesAfterClose: -1,
      },
      memorySamples: measured,
      archiveReadBytes: archiveReads.reduce(
        (sum, { start, end }) => sum + end - start,
        0,
      ),
      archiveReadCount: archiveReads.length,
      mediaReadBytes,
      archiveReads,
    };
    await stop(sampler);
    await context.close();
    await browser.close();
    row.profile.bytesAfterClose = await bytes(profilePath);
    console.log(
      JSON.stringify({ ...row, memorySamples: row.memorySamples.length }),
    );
    return row;
  } finally {
    if (sampler) await stop(sampler);
    await context?.close();
    await browser?.close();
  }
}

async function nodeComparison(archive: string) {
  const result = await execute(
    process.execPath,
    [join(web, 'scripts', 'node-comparison.ts'), archive],
    { timeout: 240_000 },
  );
  return JSON.parse(result.stdout) as {
    name: string;
    status: string;
    items: number;
    wallMs: number;
    peakRss: number;
    baselineRss: number;
    maxRssBytes: number;
    samples: number;
  };
}

async function sourceIdentity() {
  const hash = createHash('sha256');
  async function walk(path: string) {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(join(path, entry.name));
      else if (
        !entry.name.endsWith('.test.ts') &&
        entry.name !== 'testing.ts'
      ) {
        hash.update(join(path, entry.name).slice(root.length));
        hash.update(await readFile(join(path, entry.name)));
      }
    }
  }
  for (const path of [
    'apps/web/src',
    'packages/core/src',
    'packages/adapter-x/src',
    'packages/adapter-instagram/src',
    'tools/fixture-gen/src/x',
  ])
    await walk(join(root, path));
  for (const path of [
    'pnpm-lock.yaml',
    'apps/web/index.html',
    'apps/web/vite.config.ts',
    'tools/fixture-gen/src/shared/zip.ts',
    'apps/web/scripts/measure-g1.ts',
    'apps/web/scripts/memory-sampler.ps1',
    'apps/web/scripts/node-comparison.ts',
  ])
    hash.update(await readFile(join(root, path)));
  return hash.digest('hex');
}

async function main() {
  const { values } = parseArgs({
    options: {
      'without-node': { type: 'boolean' },
      'only-m1': { type: 'boolean' },
      'probe-memory': { type: 'boolean' },
      'only-zip64': { type: 'boolean' },
    },
  });
  await mkdir(tempRoot, { recursive: true });
  const directory = await mkdtemp(join(tempRoot, 'trial-'));
  const sharedCache = join(homedir(), 'AppData', 'Local', 'ms-playwright');
  const cacheBefore = await bytes(sharedCache);
  const beforeIdentity = await sourceIdentity();
  const probe = values['probe-memory'] ?? false;
  const small = join(directory, 'x-100k.zip');
  const huge = join(directory, 'x-zip64-media.zip');
  console.log(
    JSON.stringify({
      machineChanges: ['web dist', 'disposable Playwright profiles', directory],
      sharedCacheBeforeBytes: cacheBefore,
    }),
  );
  let preview: ChildProcess | undefined;
  let zip64GenerationMs = 0;
  let zip64Headers: Awaited<ReturnType<typeof verifyZip64>> | undefined;
  const rows: Row[] = [];
  let comparison: Awaited<ReturnType<typeof nodeComparison>> | undefined;
  let smallBytes = 0;
  let hugeBytes = 0;
  let failure: unknown;
  try {
    await command(
      [
        join(root, 'tools', 'fixture-gen', 'src', 'cli.ts'),
        'large',
        '--platform',
        'x',
        '--count',
        probe ? '1000' : '100000',
        '--seed',
        '1',
        '--out',
        small,
      ],
      root,
    );
    const generationStart = performance.now();
    if (!values['only-m1'] && !probe) {
      await writeZipFile(huge, zip64Entries(), { zip64: true });
      if ((await stat(huge)).size <= 4 * 1024 ** 3)
        throw new Error('The ZIP64 archive is not larger than 4GiB.');
      // Read ZIP64 and STORE header facts without reading the media bodies.
      zip64Headers = await verifyZip64(huge);
    }
    zip64GenerationMs = performance.now() - generationStart;
    await command([
      join(web, 'node_modules', 'vite', 'bin', 'vite.js'),
      'build',
    ]);
    preview = spawn(
      process.execPath,
      [
        join(web, 'node_modules', 'vite', 'bin', 'vite.js'),
        'preview',
        '--host',
        '127.0.0.1',
        '--port',
        '4175',
        '--strictPort',
      ],
      { cwd: web, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const previewState: { failure: Error | null } = { failure: null };
    let previewOutput = '';
    preview.once('error', (error) => {
      previewState.failure = error;
    });
    preview.stdout?.on('data', (chunk: Buffer) => {
      previewOutput += chunk.toString();
    });
    preview.stderr?.on('data', (chunk: Buffer) => {
      previewOutput += chunk.toString();
    });
    const readyDeadline = Date.now() + 30_000;
    let ready = false;
    while (!ready && Date.now() < readyDeadline) {
      ready = await fetch(origin)
        .then((response) => response.ok)
        .catch(() => false);
      if (!ready) await delay(100);
    }
    if (
      !ready ||
      previewState.failure ||
      preview.exitCode !== null ||
      preview.signalCode !== null
    )
      throw new Error(
        `Measurement preview did not start: ${previewState.failure?.message ?? previewOutput}`,
      );
    if (probe) rows.push(await measure('memory-probe', small, false, 1000));
    else {
      if (!values['only-zip64']) {
        for (let run = 1; run <= 3; run++)
          rows.push(await measure(`M1-${run}`, small, false));
      }
      if (!values['only-m1'])
        rows.push(
          await measure('M2', huge, false, 100_000, zip64Headers?.entries),
        );
      rows.push(await measure('M3', small, true));
      if (!values['without-node']) comparison = await nodeComparison(small);
      if (rows.some(({ mediaReadBytes }) => mediaReadBytes > 0))
        throw new Error(
          'The import requested bytes overlapping media payloads; inspect the recorded ranges.',
        );
    }
  } catch (error) {
    failure = error;
  } finally {
    if (preview) await stop(preview);
    smallBytes = await bytes(small);
    hugeBytes = await bytes(huge);
    // These are exclusively this run's generated archives, not source exports.
    await rm(small, { force: true });
    await rm(huge, { force: true });
  }
  const afterIdentity = await sourceIdentity();
  const result = {
    observedAt: new Date().toISOString(),
    sourceIdentity: afterIdentity,
    sourceUnchanged: beforeIdentity === afterIdentity,
    failure:
      failure instanceof Error
        ? failure.message
        : failure
          ? 'Measurement failed.'
          : null,
    machine: {
      hostname: hostname(),
      os: `${platform()} ${release()}`,
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      ramBytes: totalmem(),
      node: process.version,
    },
    rows,
    comparison,
    archives: { smallBytes, hugeBytes, zip64GenerationMs, zip64Headers },
    memoryMethod:
      'Sum of OS WorkingSet64 and PrivateMemorySize64 of all CDP SystemInfo.getProcessInfo IDs, including browser, renderer(s)/worker, GPU and utility. Requested100ms; actual intervals recorded. Fresh disposable browser per row; no forced GC; after-abort readback after5s.',
    machineReadback: {
      sharedCacheBeforeBytes: cacheBefore,
      sharedCacheAfterBytes: await bytes(sharedCache),
      generatedArchiveBytesRemoved: smallBytes + hugeBytes,
      remainingTrialBytesBeforeReport: await bytes(directory),
      remainingArchives: await readdir(directory),
      previewStopped:
        !preview || preview.exitCode !== null || preview.signalCode !== null,
    },
  };
  const report = join(directory, 'results.json');
  await writeFile(report, JSON.stringify(result, null, 2) + '\n', {
    flag: 'wx',
  });
  console.log(
    JSON.stringify({
      report,
      result: {
        ...result,
        rows: rows.map((row) => ({
          ...row,
          memorySamples: row.memorySamples.length,
        })),
      },
    }),
  );
  if (failure)
    throw failure instanceof Error ? failure : new Error('Measurement failed.');
  if (!result.sourceUnchanged && !probe)
    throw new Error(
      'Source changed during S1. Rerun the invalidated measurements.',
    );
}

await main();

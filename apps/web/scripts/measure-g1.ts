import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { cpus, homedir, platform, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { parseArgs, stripVTControlCharacters } from 'node:util';
import {
  assertZip64,
  generate,
  generateZip64,
  headers,
} from './measure-archive.ts';
import { measure, origin } from './measure-browser.ts';
import {
  bytes,
  command,
  cpuLoad,
  delay,
  execute,
  fileIdentity,
  freeSpace,
  root,
  sourceIdentity,
  stop,
  web,
} from './measure-system.ts';

const tempRoot = join(homedir(), 'AppData/Local/Temp/kilo/i1m');
const outerTimeoutMs = 30 * 60_000;
const minimumFreeBytes = 7 * 1024 ** 3;
type Row = Awaited<ReturnType<typeof measure>>;

function table(rows: Row[]) {
  console.error(
    '\nRow       Stored   Receipt ms   Abort ms   Peak private MiB   End private MiB   Peak working MiB   Mean/max sample ms',
  );
  for (const row of rows)
    console.error(
      [
        row.name.padEnd(9),
        String(row.storedItems).padStart(6),
        row.wallMs.toFixed(1).padStart(12),
        (row.abortMs?.toFixed(1) ?? '-').padStart(10),
        (row.memory.peakPrivateBytes / 1024 ** 2).toFixed(2).padStart(18),
        (row.memory.end.privateBytes / 1024 ** 2).toFixed(2).padStart(17),
        (row.memory.peakWorkingBytes / 1024 ** 2).toFixed(2).padStart(18),
        `${row.memory.meanIntervalMs.toFixed(1)}/${row.memory.maxIntervalMs}`.padStart(
          20,
        ),
      ].join(' '),
    );
}

async function startPreview(signal: AbortSignal) {
  // Port ownership is established by this child's readiness output, not by
  // seeing a foreign server answer a fetch on the same port.
  const child = spawn(
    process.execPath,
    [
      join(web, 'node_modules/vite/bin/vite.js'),
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      '4175',
      '--strictPort',
    ],
    { cwd: web, stdio: ['ignore', 'pipe', 'pipe'], signal },
  );
  let output = '';
  let failure: Error | null = null;
  child.on('error', (error) => {
    failure = error;
  });
  child.stdout?.on('data', (chunk: Buffer) => {
    output += stripVTControlCharacters(chunk.toString());
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    output += stripVTControlCharacters(chunk.toString());
  });
  try {
    const deadline = Date.now() + 30_000;
    while (
      !output.includes(origin) &&
      child.exitCode === null &&
      !failure &&
      Date.now() < deadline
    ) {
      signal.throwIfAborted();
      await delay(100);
    }
    if (!output.includes(origin) || child.exitCode !== null || failure)
      throw new Error(`Owned preview did not start: ${output}`);
    const response = await fetch(`${origin}/socialprune/`, { signal });
    if (!response.ok) throw new Error('Built application did not answer.');
    return child;
  } catch (error) {
    await stop(child);
    throw error;
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      'probe-memory': { type: 'boolean' },
      'only-m1': { type: 'boolean' },
      'only-zip64': { type: 'boolean' },
      // Kept as a compatibility argument. Node RSS is not part of the current
      // browser/IndexedDB measurement and is never substituted for its memory.
      'without-node': { type: 'boolean' },
    },
  });
  if (platform() !== 'win32')
    throw new Error(
      'measure:g1 requires Windows. Linux memory is not measured.',
    );
  if (values['only-m1'] && values['only-zip64'])
    throw new Error('Choose at most one partial measurement.');
  await mkdir(tempRoot, { recursive: true });
  const initialFree = await freeSpace(tempRoot);
  if (!values['probe-memory'] && initialFree.freeBytes < minimumFreeBytes)
    throw new Error(
      `Insufficient temporary disk space: ${initialFree.freeBytes} bytes; ${minimumFreeBytes} required.`,
    );
  const directory = await mkdtemp(join(tempRoot, 'trial-'));
  const archives = join(directory, 'generated');
  await mkdir(archives);
  const report = join(directory, 'results.json');
  const small = join(archives, 'generated-x.zip');
  const huge = join(archives, 'generated-x-zip64.zip');
  const sharedCache = join(homedir(), 'AppData/Local/ms-playwright');
  const controller = new AbortController();
  const deadline = setTimeout(
    () => controller.abort(new Error('Measurement outer timeout exceeded.')),
    outerTimeoutMs,
  );
  const cancel = () => controller.abort(new Error('Measurement interrupted.'));
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  const rows: Row[] = [];
  let preview: ChildProcess | undefined;
  let failure: string | null = null;
  let removedArchiveBytes = 0;
  let cacheBefore = 0;
  let cacheAfter = 0;
  let sourceBefore: Awaited<ReturnType<typeof sourceIdentity>> | null = null;
  let sourceAfter: Awaited<ReturnType<typeof sourceIdentity>> | null = null;
  let sourcePreBuild: Awaited<ReturnType<typeof sourceIdentity>> | null = null;
  let generated: Awaited<ReturnType<typeof generate>> | null = null;
  let ordinaryHeaders: Awaited<ReturnType<typeof headers>> | null = null;
  let zip64Headers: Awaited<ReturnType<typeof headers>> | null = null;
  let zip64GenerationMs: number | null = null;
  let loadAtStart: Awaited<ReturnType<typeof cpuLoad>> | null = null;
  let freeAfter = initialFree;
  const startedAt = new Date().toISOString();
  try {
    console.error(
      `Windows measurement; generated archives and disposable profiles only. Report ${report}. Outer timeout ${outerTimeoutMs}ms.`,
    );
    console.error(`Free temp space before: ${initialFree.freeBytes} bytes.`);
    loadAtStart = await cpuLoad(controller.signal);
    cacheBefore = await bytes(sharedCache);
    sourcePreBuild = await sourceIdentity(false);
    await command(
      [join(web, 'node_modules/vite/bin/vite.js'), 'build'],
      controller.signal,
    );
    const postBuild = await sourceIdentity(false);
    if (postBuild.sha256 !== sourcePreBuild.sha256) {
      if (!values['probe-memory'])
        throw new Error('Source changed while building.');
      failure = 'Foundation probe only: source changed while building.';
    }
    sourceBefore = await sourceIdentity(true);
    generated = await generate(
      small,
      values['probe-memory'] ? 2000 : 100_000,
      controller.signal,
    );
    ordinaryHeaders = await headers(small);
    if (!values['only-m1'] && !values['probe-memory']) {
      const start = performance.now();
      await generateZip64(huge, generated, controller.signal);
      zip64Headers = await headers(huge);
      assertZip64(ordinaryHeaders, zip64Headers);
      zip64GenerationMs = performance.now() - start;
    }
    preview = await startPreview(controller.signal);
    if (values['probe-memory']) {
      rows.push(
        await measure('probe', small, generated, false, [], controller.signal),
      );
      rows.push(
        await measure(
          'probe-abort',
          small,
          generated,
          true,
          [],
          controller.signal,
        ),
      );
    } else {
      if (!values['only-zip64'])
        for (let run = 1; run <= 3; run++)
          rows.push(
            await measure(
              `M1-${run}`,
              small,
              generated,
              false,
              [],
              controller.signal,
            ),
          );
      if (zip64Headers)
        rows.push(
          await measure(
            'M2',
            huge,
            generated,
            false,
            assertZip64(ordinaryHeaders, zip64Headers),
            controller.signal,
          ),
        );
      rows.push(
        await measure('M3', small, generated, true, [], controller.signal),
      );
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : 'Measurement failed.';
  } finally {
    clearTimeout(deadline);
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
    try {
      if (preview) await stop(preview);
    } catch (error) {
      failure ??=
        error instanceof Error ? error.message : 'Preview cleanup failed.';
    }
    removedArchiveBytes = await bytes(archives);
    // This unique directory contains only this invocation's generated inputs.
    // Its removal never targets a real export or another lane's scratch.
    await rm(archives, { force: true, recursive: true });
    freeAfter = await freeSpace(tempRoot);
    cacheAfter = await bytes(sharedCache);
    sourceAfter = await sourceIdentity(true);
    if (!sourceBefore || sourceBefore.sha256 !== sourceAfter.sha256)
      failure ??=
        'Executable source or served build changed during measurements.';
    if (cacheBefore !== cacheAfter)
      failure ??= 'Shared Playwright cache changed during measurements.';
  }
  const head = (
    await execute('git', ['--no-pager', 'rev-parse', 'HEAD'], { cwd: root })
  ).stdout.trim();
  const changedPaths = [
    'apps/web/scripts/measure-g1.ts',
    'apps/web/scripts/measure-system.ts',
    'apps/web/scripts/measure-archive.ts',
    'apps/web/scripts/measure-browser.ts',
  ];
  const changedFiles = await Promise.all(changedPaths.map(fileIdentity));
  await writeFile(
    join(tempRoot, 'hashes.txt'),
    changedFiles.map(({ path, sha256 }) => `${sha256}  ${path}`).join('\n') +
      '\n',
  );
  const full =
    !values['probe-memory'] && !values['only-m1'] && !values['only-zip64'];
  const result = {
    startedAt,
    observedAt: new Date().toISOString(),
    report,
    mode: full
      ? 'full'
      : values['probe-memory']
        ? 'foundation-probe'
        : 'partial',
    failure,
    head,
    platform: 'Windows only',
    machine: {
      os: `${platform()} ${release()}`,
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      ramBytes: totalmem(),
      node: process.version,
      chromium: rows[0]?.browserVersion ?? null,
    },
    cpuLoadAtStart: loadAtStart,
    source: {
      before: sourceBefore,
      after: sourceAfter,
      unchanged: sourceBefore?.sha256 === sourceAfter?.sha256,
      preBuild: sourcePreBuild,
      method:
        'SHA256 of sorted JSON [{path,bytes,sha256}], UTF-8, slash-normalized relative paths; .test.ts/.test.tsx and testing.ts excluded. Includes served dist.',
    },
    input: {
      generatorManifest: generated,
      ordinaryHeaders,
      zip64Headers,
      zip64GenerationMs,
      sameDataProof:
        'Generated data central-directory names, uncompressed lengths and CRC32 match M1; all M2 data offsets exceed 4GiB and use ZIP64 extra fields.',
    },
    rows,
    memoryMethod:
      'Sum of Windows WorkingSet64 and PrivateMemorySize64 over all CDP SystemInfo.getProcessInfo IDs. Same stdout-only 100ms-requested OS sampler as S1; stable inventory and PID coverage asserted. Peak/end include file selection, import and 500ms settling (5s after abort). M3 includes a small count-only store check at acknowledgement; large completion count/query readbacks follow sampling. No forced GC/working-set trim. Shared resident pages may be counted more than once.',
    timingMethod:
      'Page capture-phase file-input change timestamp to raw import-worker terminal message, monotonic performance.now. Includes selection-to-click gap, item transactions, archive close and terminal projection/purge settlement. Client start-to-receipt and abort latency also reported separately.',
    abortContract:
      'Fresh empty workspace: after abort acknowledgement, imports/items/state/event/submission/assessment/command tables remain empty, meta/runtime remain, protocol summary and projection report zero. Production discards incomplete owners before acknowledging.',
    disk: { minimumFreeBytes, before: initialFree, after: freeAfter },
    cleanup: {
      generatedArchiveBytesRemoved: removedArchiveBytes,
      generatedDirectoryRemoved: (await bytes(archives)) === 0,
      previewStopped:
        !preview || preview.exitCode !== null || preview.signalCode !== null,
      remainingTrialFiles: await readdir(directory),
      sharedCacheBeforeBytes: cacheBefore,
      sharedCacheAfterBytes: cacheAfter,
    },
    changedFiles,
    compatibility: {
      withoutNodeArgument: values['without-node'] ?? false,
      nodeImporterMeasured: false,
      reason:
        'This port measures the current browser store-of-record path only. The old separate Node importer neither exercises IndexedDB nor the current page/worker receipt path.',
    },
    limits: [
      'Windows desktop, generated X data, headless Chromium only; no Linux, phones, real exports or other engines.',
      'Not comparable to S1 latency or page-held-array memory: this path writes IndexedDB and builds a worker projection.',
      'Two full invocations show observed spread, not a latency distribution or regression attribution.',
      'Sampling can miss peaks shorter than recorded gaps. OS tasks/caches and foreign applications are not isolated.',
      'Zero padding overlap applies to this padding-before-data ZIP layout, not every export layout.',
      'M3 covers a halfway import into an empty workspace, not preservation of an existing workspace or every cancellation boundary.',
    ],
  };
  await writeFile(report, JSON.stringify(result, null, 2) + '\n', {
    flag: 'wx',
  });
  table(rows);
  console.error(
    `Free temp space after: ${freeAfter.freeBytes} bytes. Report ${report}.`,
  );
  console.log(JSON.stringify(result));
  if (failure) process.exitCode = 1;
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Measurement failed.');
  process.exitCode = 1;
});

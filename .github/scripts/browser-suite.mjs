import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Console } from 'node:console';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { runProcess } from './suite-process.mjs';

const console = new Console(process.stdout, process.stderr);
export const suites = Object.freeze({
  delete: { script: 'test:delete', minutes: 25, runner: 'vitest' },
  engine: { script: 'test:engine', minutes: 10, runner: 'vitest' },
  // Local full-run budget remains unchanged. Hosted context uses case shards.
  context: { script: 'test:context', minutes: 70, runner: 'vitest' },
  fill: { script: 'test:fill', minutes: 25, runner: 'playwright' },
  // Generated matrix measured 142 s on Windows, 2026-10-25. Allow 3x
  // (426 s), rounded to 8 min; workflow adds 2 min termination/upload margin.
  'delete-instagram': {
    script: 'test:delete:instagram',
    minutes: 8,
    runner: 'vitest',
  },
});
// 2026-11-05 JUnit from 42013005163 / 41918124592: dominant file
// 3330 / 4030 s, other file 53 / 60 s. Four SHA-256 case partitions project
// to at most 941 / 1124 s. A 1800 s bound leaves >= 676 s measured margin.
// Two and three partitions project to 2121 and 1422 s respectively.
export const contextShards = Object.freeze({ count: 4, minutes: 30 });
export const caseKey = (file, name) => JSON.stringify([file, name]);
export function contextPartition(file, name) {
  // This existing two-case lifecycle probe shares cleanupLease and verifies the
  // preceding case's onTestFinished effect. Keep both in source order together;
  // all other cases are independent. Do not edit the browser test to shard it.
  const group =
    name ===
    'C8 cleanup 2 verifies the preceding test released its browser and fixed fake port'
      ? 'C8 cleanup 1 registers cleanup even when the test never enters a finally'
      : name;
  return (
    (createHash('sha256')
      .update(caseKey(file, group))
      .digest()
      .readUInt32BE(0) %
      contextShards.count) +
    1
  );
}
export function contextCases(inventory) {
  assert(
    Array.isArray(inventory) && inventory.length > 0,
    'CONTEXT_INVENTORY_EMPTY',
  );
  const cases = inventory.map(({ file, name }) => {
    assert(
      typeof file === 'string' && typeof name === 'string' && name.length > 0,
      'CONTEXT_INVENTORY_INVALID',
    );
    const normalized = file.replaceAll('\\', '/');
    const offset = normalized.lastIndexOf('apps/cli/e2e/');
    assert(offset >= 0, 'CONTEXT_INVENTORY_PATH');
    const relative = normalized.slice(offset);
    assert(
      [
        'apps/cli/e2e/context-instagram.test.ts',
        'apps/cli/e2e/list-freshness.test.ts',
      ].includes(relative),
      'CONTEXT_INVENTORY_PATH',
    );
    return { file: relative, name };
  });
  assert.equal(
    new Set(cases.map((c) => caseKey(c.file, c.name))).size,
    cases.length,
    'CONTEXT_CASE_DUPLICATE',
  );
  // Name matching is global across both files. Refuse ambiguity rather than
  // silently select the same-named case in two different shards.
  assert.equal(
    new Set(cases.map((c) => c.name)).size,
    cases.length,
    'CONTEXT_NAME_DUPLICATE',
  );
  return cases.sort((a, b) =>
    caseKey(a.file, a.name).localeCompare(caseKey(b.file, b.name), 'en'),
  );
}
export function contextPattern(cases, shard) {
  assert(
    Number.isInteger(shard) && shard >= 1 && shard <= contextShards.count,
    'CONTEXT_SHARD_INVALID',
  );
  const selected = cases.filter(
    (c) => contextPartition(c.file, c.name) === shard,
  );
  assert(selected.length > 0, 'CONTEXT_SHARD_EMPTY');
  return (
    '^(?:' +
    selected
      .map((c) => c.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|') +
    ')$'
  );
}
const xmlDecode = (text) =>
  text
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) =>
      String.fromCodePoint(n[0] === 'x' ? parseInt(n.slice(1), 16) : Number(n)),
    )
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
export function junitCases(xml) {
  assert(
    /<testsuites?\b/.test(xml) && /<\/testsuites?>\s*$/.test(xml.trim()),
    'CONTEXT_JUNIT_INVALID',
  );
  const rows = [
    ...xml.matchAll(/<testcase\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/testcase>)/g),
  ].map((match) => {
    const attributes = Object.fromEntries(
      [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [
        a[1],
        xmlDecode(a[2]),
      ]),
    );
    assert(
      attributes.classname && attributes.name,
      'CONTEXT_JUNIT_CASE_INVALID',
    );
    return {
      file: attributes.classname.replaceAll('\\', '/'),
      name: attributes.name,
      skipped: /<skipped\b/.test(match[2] ?? ''),
      failed: /<(?:failure|error)\b/.test(match[2] ?? ''),
    };
  });
  assert(rows.length > 0, 'CONTEXT_JUNIT_EMPTY');
  return rows;
}
export async function aggregateContext(input, expectedSource) {
  const receipts = [];
  let inventory;
  const executed = [];
  const artifacts = await readdir(input);
  for (let shard = 1; shard <= contextShards.count; shard++) {
    const attempts = new Map();
    for (const artifact of artifacts) {
      const match = artifact.match(
        new RegExp(`^browser-suite-context-${shard}-(\\d+)$`),
      );
      if (!match) continue;
      const attempt = Number(match[1]);
      assert(
        Number.isSafeInteger(attempt) && attempt > 0,
        'CONTEXT_ATTEMPT_INVALID',
      );
      assert(!attempts.has(attempt), 'CONTEXT_SHARD_MISSING_OR_DUPLICATE');
      attempts.set(attempt, artifact);
    }
    assert(attempts.size > 0, 'CONTEXT_SHARD_MISSING_OR_DUPLICATE');
    // Failed-job reruns retain earlier artifacts and rerun only failed shards.
    // Select each shard's latest attempt, never the latest successful attempt.
    const attempt = Math.max(...attempts.keys());
    const artifact = attempts.get(attempt);
    const folder = join(input, artifact);
    const summary = JSON.parse(
      await readFile(join(folder, 'summary.json'), 'utf8'),
    );
    assert.equal(summary.suite, 'context');
    assert.equal(summary.shard, shard);
    assert.equal(summary.shards, contextShards.count);
    assert.equal(summary.source, expectedSource, 'CONTEXT_SOURCE_MISMATCH');
    assert.equal(summary.state, 'passed', 'CONTEXT_SHARD_FAILED');
    assert.equal(summary.exitCode, 0);
    assert.equal(summary.worktreeDirty, false, 'CONTEXT_DIRTY_SOURCE');
    const cases = contextCases(
      JSON.parse(await readFile(join(folder, 'inventory.json'), 'utf8')),
    );
    if (inventory)
      assert.deepEqual(cases, inventory, 'CONTEXT_INVENTORY_MISMATCH');
    else inventory = cases;
    const rows = junitCases(await readFile(join(folder, 'junit.xml'), 'utf8'));
    const selected = cases
      .filter((c) => contextPartition(c.file, c.name) === shard)
      .map((c) => caseKey(c.file, c.name))
      .sort();
    const actual = rows.filter((c) => !c.skipped);
    assert(
      actual.every((c) => !c.failed),
      'CONTEXT_CASE_FAILED',
    );
    assert.deepEqual(
      actual.map((c) => caseKey(c.file, c.name)).sort(),
      selected,
      'CONTEXT_SHARD_COVERAGE',
    );
    assert(
      (await stat(join(folder, 'suite.log'))).size > 0,
      'CONTEXT_LOG_EMPTY',
    );
    executed.push(...actual.map((c) => caseKey(c.file, c.name)));
    receipts.push({
      shard,
      attempt,
      artifact,
      cases: actual.length,
      durationSeconds: summary.durationSeconds,
      timeoutSeconds: summary.timeoutSeconds,
    });
  }
  assert.deepEqual(
    executed.sort(),
    inventory.map((c) => caseKey(c.file, c.name)).sort(),
    'CONTEXT_TOTAL_COVERAGE',
  );
  return {
    suite: 'context',
    source: expectedSource,
    state: 'passed',
    shards: receipts,
    cases: executed.length,
  };
}
export function selection(value = 'all') {
  if (value === 'all') return Object.keys(suites);
  const names = value.split(',').map((name) => name.trim());
  assert(
    names.length > 0 && names.every((name) => Object.hasOwn(suites, name)),
    'Choose all or a comma-separated subset of delete,engine,context,fill,delete-instagram.',
  );
  assert.equal(new Set(names).size, names.length, 'Duplicate suite.');
  return Object.keys(suites).filter((name) => names.includes(name));
}
export function suiteArguments(name, report, pattern) {
  assert(Object.hasOwn(suites, name), 'Unknown suite.');
  const suite = suites[name];
  assert(suite, 'Unknown suite.');
  return [
    '--filter',
    'socialprune',
    suite.script,
    ...(pattern ? [`--testNamePattern=${pattern}`] : []),
    ...(suite.runner === 'vitest'
      ? [
          '--maxWorkers=1',
          '--reporter=default',
          `--reporter=${join(root, '.github/scripts/suite-progress.mjs')}`,
          '--reporter=junit',
          `--outputFile=${report}`,
        ]
      : [
          '--workers=1',
          '--reporter=list,junit',
          `--output=${dirname(report)}/playwright`,
        ]),
  ];
}
export function contextLaunch(args) {
  const require = createRequire(import.meta.url);
  // pnpm package scripts pass through a Windows command wrapper (8 KiB limit).
  // Invoke the identical Vitest entry/config with Node argv, without a shell.
  return {
    executable: process.execPath,
    args: [
      join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs'),
      'run',
      '--config',
      'apps/cli/e2e/context.vitest.config.ts',
      ...args.slice(3),
    ],
  };
}
export async function resolvePnpm(
  environment = process.env,
  platform = process.platform,
) {
  const variable = (name) =>
    Object.entries(environment).find(
      ([key]) => key.toUpperCase() === name,
    )?.[1];
  const home = variable('PNPM_HOME');
  const directories = [
    ...(variable('PATH') ?? '').split(platform === 'win32' ? ';' : ':'),
    ...(home ? [join(home, 'bin'), home] : []),
  ].filter(Boolean);
  const isFile = async (path) => {
    try {
      return (await stat(path)).isFile();
    } catch {
      return false;
    }
  };
  for (const directory of new Set(directories)) {
    const folder = resolve(directory.replace(/^"|"$/g, ''));
    if (platform !== 'win32') {
      const executable = join(folder, 'pnpm');
      if (await isFile(executable)) return { executable, args: [] };
      continue;
    }
    // action-setup exposes its self-updated executable beside a cmd shim.
    const executable = join(folder, 'pnpm.exe');
    if (await isFile(executable)) return { executable, args: [] };
    const shim = join(folder, 'pnpm.cmd');
    if (!(await isFile(shim))) continue;
    // npm's global and .bin shims name their JS entry relative to the shim.
    // Read that target instead of running cmd or guessing a global store path.
    const target = (await readFile(shim, 'utf8')).match(
      /"%(?:dp0%|~dp0)[\\/]([^"\r\n]*pnpm\.(?:cjs|mjs|js))"/i,
    )?.[1];
    const script = target && resolve(folder, target.replaceAll('\\', '/'));
    if (script && (await isFile(script)))
      return { executable: process.execPath, args: [script] };
    throw Object.assign(new Error('PNPM_SHIM_TARGET_MISSING'), {
      code: 'PNPM_SHIM_TARGET_MISSING',
    });
  }
  throw Object.assign(new Error('PNPM_NOT_FOUND'), { code: 'PNPM_NOT_FOUND' });
}
export async function suiteEnvironment(environment = process.env) {
  const temporary =
    environment.RUNNER_TEMP ?? environment.TEMP ?? environment.TMP;
  if (!temporary) return { ...environment };
  const canonical = await realpath(temporary);
  return { ...environment, TEMP: canonical, TMP: canonical };
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export async function runSuite(
  name,
  output = 'apps/cli/test-results/browser-suites',
  launchEnvironment = process.env,
  shard,
) {
  assert(Object.hasOwn(suites, name), 'Unknown suite.');
  const suite = suites[name];
  assert(suite, 'Unknown suite.');
  assert(
    shard === undefined || name === 'context',
    'Only context supports case shards.',
  );
  if (shard !== undefined)
    assert(
      Number.isInteger(shard) && shard >= 1 && shard <= contextShards.count,
      'CONTEXT_SHARD_INVALID',
    );
  const directory = resolve(
    root,
    output,
    shard === undefined ? name : `${name}-${shard}`,
  );
  await mkdir(directory, { recursive: true });
  const report = join(directory, 'junit.xml');
  await rm(report, { force: true });
  const networkFailure = join(directory, 'network-failures.log');
  await rm(networkFailure, { force: true });
  let args = suiteArguments(name, report);
  // Suite names and scripts are closed above; no shell text comes from dispatch.
  // These are the same package scripts used in a terminal, with reporters added.
  const command = ['pnpm', ...args];
  const started = Date.now();
  const source = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  const summary = {
    suite: name,
    source,
    worktreeDirty:
      execFileSync('git', ['status', '--porcelain'], {
        cwd: root,
        encoding: 'utf8',
      }).trim().length > 0,
    command,
    startedAt: new Date(started).toISOString(),
    timeoutSeconds:
      (shard === undefined ? suite.minutes : contextShards.minutes) * 60,
    ...(shard === undefined ? {} : { shard, shards: contextShards.count }),
    state: 'running',
    exitCode: null,
  };
  const summaryPath = join(directory, 'summary.json');
  await writeFile(summaryPath, JSON.stringify(summary, null, 2));
  const log = createWriteStream(join(directory, 'suite.log'));
  let launchError;
  let timedOut = false;
  let code = null;
  let launch;
  let termination = null;
  let environment;
  try {
    environment = {
      ...(await suiteEnvironment(launchEnvironment)),
      PLAYWRIGHT_JUNIT_OUTPUT_FILE: report,
      SP_SUITE_NETWORK_FAILURE: networkFailure,
      NODE_OPTIONS: `${launchEnvironment.NODE_OPTIONS ?? ''} --require=${JSON.stringify(join(root, '.github/scripts/loopback-only.cjs'))}`,
    };
    launch = await resolvePnpm(launchEnvironment);
    // A broken shim/entry is a launch failure, not a test failure. This also
    // records Node's MODULE_NOT_FOUND output before a suite can be started.
    await promisify(execFile)(
      launch.executable,
      [...launch.args, '--version'],
      {
        cwd: root,
        env: environment,
        windowsHide: true,
        timeout: 30_000,
      },
    );
    if (shard !== undefined) {
      // Collection imports declarations only; it never executes test callbacks.
      // Do not use Vitest's --shard: it shards files, leaving the 4k-second file whole.
      log.write('CONTEXT_INVENTORY_START\n');
      const inventory = join(directory, 'inventory.json');
      await rm(inventory, { force: true });
      await promisify(execFile)(
        launch.executable,
        [
          ...launch.args,
          '--filter',
          'socialprune',
          'exec',
          'vitest',
          'list',
          '--config',
          'e2e/context.vitest.config.ts',
          '--no-staticParse',
          '--maxWorkers=1',
          `--json=${inventory}`,
        ],
        {
          cwd: root,
          env: environment,
          windowsHide: true,
          timeout: 120_000,
          maxBuffer: 4 * 1024 * 1024,
        },
      );
      const cases = contextCases(JSON.parse(await readFile(inventory, 'utf8')));
      log.write(`CONTEXT_INVENTORY_CASES ${cases.length}\n`);
      args = suiteArguments(name, report, contextPattern(cases, shard));
      summary.command = ['pnpm', ...args];
      await writeFile(summaryPath, JSON.stringify(summary, null, 2));
    }
  } catch (error) {
    launchError =
      typeof error.code === 'string' ? error.code : 'PNPM_STARTUP_FAILED';
    log.write(`${launchError}\n${error.stderr ?? error.message}\n`);
  }
  if (!launchError) {
    const executionCommand =
      shard === undefined
        ? { executable: launch.executable, args: [...launch.args, ...args] }
        : contextLaunch(args);
    const execution = await runProcess(
      executionCommand.executable,
      executionCommand.args,
      {
        cwd: root,
        env: environment,
        timeoutMs: Math.max(
          1,
          summary.timeoutSeconds * 1000 - (Date.now() - started),
        ),
        onOutput(bytes, stream) {
          log.write(bytes);
          (stream === 'stdout' ? process.stdout : process.stderr).write(bytes);
        },
      },
    );
    code = execution.exitCode;
    timedOut = execution.timedOut;
    launchError = execution.launchError;
    termination = execution.termination;
  }
  await new Promise((done) => log.end(done));
  let reportPresent = false;
  try {
    reportPresent = /<testsuites?\b/.test(await readFile(report, 'utf8'));
  } catch {
    /* Retain the missing-report failure below. */
  }
  let networkFailures = 0;
  try {
    networkFailures = (await readFile(networkFailure, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean).length;
  } catch {
    /* No blocked Node connection was attempted. */
  }
  const result = {
    ...summary,
    endedAt: new Date().toISOString(),
    durationSeconds: (Date.now() - started) / 1000,
    state: timedOut
      ? 'timed-out'
      : launchError
        ? 'launch-failed'
        : networkFailures > 0
          ? 'non-loopback-attempt'
          : code !== 0
            ? 'failed'
            : reportPresent
              ? 'passed'
              : 'report-missing',
    exitCode: code,
    launchError: launchError ?? null,
    termination,
    resolvedCommand: launch
      ? shard === undefined
        ? [launch.executable, ...launch.args, ...args]
        : [contextLaunch(args).executable, ...contextLaunch(args).args]
      : null,
    reportPresent,
    networkFailures,
  };
  await writeFile(summaryPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  return result.state === 'passed' ? 0 : 1;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  if (process.argv[2] === 'select') {
    const selected = selection(process.argv[3] ?? 'all');
    console.log(
      Object.keys(suites)
        .map((name) => `${name}=${selected.includes(name)}`)
        .concat(`other=${selected.some((name) => name !== 'context')}`)
        .join('\n'),
    );
  } else {
    if (process.argv[2] === 'aggregate-context') {
      try {
        const result = await aggregateContext(
          process.argv[3],
          execFileSync('git', ['rev-parse', 'HEAD'], {
            cwd: root,
            encoding: 'utf8',
          }).trim(),
        );
        console.log(JSON.stringify(result));
        if (process.argv[4])
          await writeFile(process.argv[4], JSON.stringify(result, null, 2));
        if (process.env.GITHUB_STEP_SUMMARY)
          await writeFile(
            process.env.GITHUB_STEP_SUMMARY,
            `Context: ${result.cases} cases across ${result.shards.length} shards, passed.\n`,
          );
      } catch (error) {
        console.error(error);
        process.exitCode = 1;
      }
    } else {
      assert.equal(
        process.argv[2],
        'run',
        'Use select <all|names> or run <suite> [output-root].',
      );
      process.exitCode = await runSuite(
        process.argv[3],
        process.argv[4],
        process.env,
        process.argv[5] === undefined ? undefined : Number(process.argv[5]),
      );
    }
  }
}

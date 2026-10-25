import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import {
  mkdir,
  readFile,
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
import { runProcess } from './suite-process.mjs';

const console = new Console(process.stdout, process.stderr);
export const suites = Object.freeze({
  delete: { script: 'test:delete', minutes: 25, runner: 'vitest' },
  engine: { script: 'test:engine', minutes: 10, runner: 'vitest' },
  context: { script: 'test:context', minutes: 40, runner: 'vitest' },
  fill: { script: 'test:fill', minutes: 25, runner: 'playwright' },
});
export function selection(value = 'all') {
  if (value === 'all') return Object.keys(suites);
  const names = value.split(',').map((name) => name.trim());
  assert(
    names.length > 0 && names.every((name) => Object.hasOwn(suites, name)),
    'Choose all or a comma-separated subset of delete,engine,context,fill.',
  );
  assert.equal(new Set(names).size, names.length, 'Duplicate suite.');
  return Object.keys(suites).filter((name) => names.includes(name));
}
export function suiteArguments(name, report) {
  assert(Object.hasOwn(suites, name), 'Unknown suite.');
  const suite = suites[name];
  assert(suite, 'Unknown suite.');
  return [
    '--filter',
    'socialprune',
    suite.script,
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
) {
  assert(Object.hasOwn(suites, name), 'Unknown suite.');
  const suite = suites[name];
  assert(suite, 'Unknown suite.');
  const directory = resolve(root, output, name);
  await mkdir(directory, { recursive: true });
  const report = join(directory, 'junit.xml');
  await rm(report, { force: true });
  const networkFailure = join(directory, 'network-failures.log');
  await rm(networkFailure, { force: true });
  const args = suiteArguments(name, report);
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
    timeoutSeconds: suite.minutes * 60,
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
  } catch (error) {
    launchError =
      typeof error.code === 'string' ? error.code : 'PNPM_STARTUP_FAILED';
    log.write(`${launchError}\n${error.stderr ?? error.message}\n`);
  }
  if (!launchError) {
    const execution = await runProcess(
      launch.executable,
      [...launch.args, ...args],
      {
        cwd: root,
        env: environment,
        timeoutMs: Math.max(1, suite.minutes * 60_000 - (Date.now() - started)),
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
      ? [launch.executable, ...launch.args, ...args]
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
        .join('\n'),
    );
  } else {
    assert.equal(
      process.argv[2],
      'run',
      'Use select <all|names> or run <suite> [output-root].',
    );
    process.exitCode = await runSuite(process.argv[3], process.argv[4]);
  }
}

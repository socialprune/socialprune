import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout, clearTimeout } from 'node:timers';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Console } from 'node:console';

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
export function invocation(command, platform = process.platform) {
  if (platform !== 'win32')
    return { executable: command[0], args: command.slice(1), options: {} };
  const quoted = command
    .map((part) => `"${part.replaceAll('"', '')}"`)
    .join(' ');
  return {
    executable: process.env.ComSpec ?? 'cmd.exe',
    args: ['/d', '/s', '/c', `"${quoted}"`],
    options: { windowsVerbatimArguments: true },
  };
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export async function runSuite(
  name,
  output = 'apps/cli/test-results/browser-suites',
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
  const environment = {
    ...process.env,
    PLAYWRIGHT_JUNIT_OUTPUT_FILE: report,
    SP_SUITE_NETWORK_FAILURE: networkFailure,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require=${JSON.stringify(join(root, '.github/scripts/loopback-only.cjs'))}`,
  };
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
  const launch = invocation(command);
  const child = spawn(launch.executable, launch.args, {
    ...launch.options,
    cwd: root,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: environment,
  });
  for (const [stream, destination] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr],
  ])
    stream.on('data', (bytes) => {
      log.write(bytes);
      destination.write(bytes);
    });
  let timedOut = false;
  let termination = Promise.resolve();
  const timeout = setTimeout(() => {
    timedOut = true;
    // Terminate only the exact process tree this invocation started.
    if (process.platform === 'win32')
      termination = new Promise((done) => {
        const killer = spawn(
          'taskkill.exe',
          ['/PID', String(child.pid), '/T', '/F'],
          {
            stdio: 'ignore',
            windowsHide: true,
          },
        );
        killer.once('error', done);
        killer.once('close', done);
      });
    else child.kill('SIGTERM');
  }, suite.minutes * 60_000);
  let launchError;
  const code = await new Promise((done) => {
    child.once('error', (error) => {
      launchError = error.code ?? 'SPAWN_FAILED';
      done(null);
    });
    child.once('close', done);
  });
  clearTimeout(timeout);
  await termination;
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

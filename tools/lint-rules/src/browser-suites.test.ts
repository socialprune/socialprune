import {
  readFile,
  mkdtemp,
  writeFile,
  mkdir,
  rm,
  copyFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, delimiter } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');
const entry = resolve(root, '.github/scripts/browser-suite.mjs');
interface Runner {
  suites: Record<string, { script: string; minutes: number; runner: string }>;
  selection(value?: string): string[];
  suiteArguments(name: string, report: string): string[];
  runSuite(
    name: string,
    output?: string,
    environment?: NodeJS.ProcessEnv,
  ): Promise<number>;
  resolvePnpm(
    environment?: NodeJS.ProcessEnv,
    platform?: string,
  ): Promise<{ executable: string; args: string[] }>;
  suiteEnvironment(environment: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv>;
  contextShards: { count: number; minutes: number };
  contextLaunch(args: string[]): { executable: string; args: string[] };
  contextPartition(file: string, name: string): number;
  contextPattern(
    cases: { file: string; name: string }[],
    shard: number,
  ): string;
  aggregateContext(
    input: string,
    source: string,
  ): Promise<{
    cases: number;
    state: string;
    shards: {
      shard: number;
      attempt: number;
      artifact: string;
      cases: number;
    }[];
  }>;
}
const runner = (await import(entry)) as Runner;

test('Instagram deletion is serial, independently uploaded and bounded from its measured 142-second matrix', async () => {
  expect(runner.suites['delete-instagram']).toEqual({
    script: 'test:delete:instagram',
    minutes: 8,
    runner: 'vitest',
  });
  expect(runner.selection('delete-instagram,delete')).toEqual([
    'delete',
    'delete-instagram',
  ]);
  expect(
    runner.suiteArguments('delete-instagram', 'generated.xml').slice(0, 3),
  ).toEqual(['--filter', 'socialprune', 'test:delete:instagram']);
  const workflow = await readFile(
    resolve(root, '.github/workflows/browser-suites.yml'),
    'utf8',
  );
  expect(workflow).toContain('timeout-minutes: 180');
  expect(workflow).toContain(
    "steps.selected.outputs['delete-instagram'] == 'true'",
  );
  expect(workflow).toMatch(
    /name: Instagram deletion suite[\s\S]*?timeout-minutes: 10\s+run: node \.github\/scripts\/browser-suite\.mjs run delete-instagram/,
  );
  expect(workflow).toContain(
    'browser-suite-delete-instagram-${{ github.run_attempt }}',
  );
  expect(workflow).toContain(
    'path: apps/cli/test-results/browser-suites/delete-instagram/',
  );
  expect(
    workflow.indexOf(
      'run: node .github/scripts/browser-suite.mjs run delete-instagram',
    ),
  ).toBeGreaterThan(
    workflow.indexOf('run: node .github/scripts/browser-suite.mjs run fill'),
  );
  expect(
    workflow.slice(
      workflow.indexOf('  suites:'),
      workflow.indexOf('  context:'),
    ),
  ).not.toMatch(/^\s*matrix:/m);
});

// The context suite runs the reading pass and the list-freshness pages; with
// both files it took 57.8 minutes of its 70-minute budget in run 40301770727.
test('the context suite keeps its measured outer budget without changing test or hook deadlines', async () => {
  expect(runner.suites.context!.minutes).toBe(70);
  expect(runner.suites.delete!.minutes).toBe(25);
  expect(runner.suites.engine!.minutes).toBe(10);
  expect(runner.suites.fill!.minutes).toBe(25);
  const config = await readFile(
    resolve(root, 'apps/cli/e2e/context.vitest.config.ts'),
    'utf8',
  );
  expect(config).toMatch(
    /include: \[\s*'apps\/cli\/e2e\/context-instagram\.test\.ts',\s*'apps\/cli\/e2e\/list-freshness\.test\.ts',\s*\]/,
  );
  expect(config).toContain('testTimeout: 60000');
  expect(config).toContain('hookTimeout: 30000');
  const workflow = await readFile(
    resolve(root, '.github/workflows/browser-suites.yml'),
    'utf8',
  );
  expect(workflow).toMatch(
    /name: Instagram context case shard[\s\S]*?timeout-minutes: 32/,
  );
  expect(workflow).toContain('timeout-minutes: 180');
  expect(workflow).toContain(
    'browser-suite-context-${{ matrix.shard }}-${{ github.run_attempt }}',
  );
  expect(workflow).toContain(
    'path: apps/cli/test-results/browser-suites/context-${{ matrix.shard }}/',
  );
  expect(workflow).not.toContain('--shard');
});

test('engine 429 fixture closes its listener before assertions even when no context was launched', async () => {
  const source = await readFile(
    resolve(root, 'apps/cli/e2e/engine-run-controls.test.ts'),
    'utf8',
  );
  const block = source.slice(
    source.indexOf("test('fill HTTP 429"),
    source.indexOf("test('engine fill watches"),
  );
  const cleanup = block.slice(
    block.indexOf('} finally {', block.indexOf("detail: 'http-429'")),
  );
  expect(cleanup.indexOf('server.closeAllConnections()')).toBeGreaterThan(-1);
  expect(cleanup.indexOf('server.close(() => resolve())')).toBeLessThan(
    cleanup.indexOf('expect(context?.pages())'),
  );
  expect(cleanup.indexOf('await rm(root')).toBeLessThan(
    cleanup.indexOf('expect(context?.pages())'),
  );
  expect(cleanup).toMatch(/finally\s*\{\s*server\.closeAllConnections/);
});

test('suite temp paths are canonical before any generated profile or child process is created', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sp-suite-temp-'));
  try {
    const environment = await runner.suiteEnvironment({
      TEMP: directory + '/.',
      TMP: directory + '/.',
      GENERATED_UNCHANGED: 'yes',
    });
    const { realpath } = await import('node:fs/promises');
    expect(environment.TEMP).toBe(await realpath(directory));
    expect(environment.TMP).toBe(await realpath(directory));
    expect(environment.GENERATED_UNCHANGED).toBe('yes');
    expect(runner.suiteArguments('delete', 'generated.xml')).toContain(
      '--reporter=' + resolve(root, '.github/scripts/suite-progress.mjs'),
    );
    const workflow = await readFile(
      resolve(root, '.github/workflows/browser-suites.yml'),
      'utf8',
    );
    expect(workflow).toContain('"TEMP=$env:RUNNER_TEMP" >> $env:GITHUB_ENV');
    expect(workflow).toContain('"TMP=$env:RUNNER_TEMP" >> $env:GITHUB_ENV');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('progress reporter emits a test start before the test has a result', async () => {
  const launch = await runner.resolvePnpm();
  const report = resolve(root, '.github/scripts/suite-progress.mjs');
  const result = await promisify(execFile)(
    launch.executable,
    [
      ...launch.args,
      'exec',
      'vitest',
      'run',
      '--project',
      'lint-rules',
      '--maxWorkers=1',
      'tools/lint-rules/src/browser-suites.test.ts',
      '-t',
      'dispatch selection',
      `--reporter=${report}`,
    ],
    { cwd: root },
  );
  const start = result.stdout.indexOf('SUITE_TEST_START dispatch selection');
  const end = result.stdout.indexOf('SUITE_TEST_END dispatch selection');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
});

test('timeout kills only its generated process tree and releases its listening port before returning', async () => {
  const { runProcess } = (await import(
    resolve(root, '.github/scripts/suite-process.mjs')
  )) as {
    runProcess(
      this: void,
      executable: string,
      args: string[],
      options: {
        timeoutMs: number;
        onOutput(bytes: Buffer, stream: string): void;
      },
    ): Promise<{
      timedOut: boolean;
      termination: { exitCode: number | null } | null;
    }>;
  };
  const directory = await mkdtemp(resolve(tmpdir(), 'sp-suite-timeout-'));
  let output = '';
  try {
    const child = resolve(directory, 'listener.cjs');
    const parent = resolve(directory, 'parent.cjs');
    await writeFile(
      child,
      'const net=require("node:net");const s=net.createServer();s.listen(0,"127.0.0.1",()=>console.log("PORT="+s.address().port));',
    );
    await writeFile(
      parent,
      'require("node:child_process").spawn(process.execPath,[process.argv[2]],{stdio:["ignore","inherit","inherit"]});setInterval(()=>{},1000);',
    );
    const result = await runProcess(process.execPath, [parent, child], {
      timeoutMs: 1500,
      onOutput: (bytes) => {
        output += bytes.toString();
      },
    });
    expect(result.timedOut).toBe(true);
    expect(result.termination).toMatchObject({ exitCode: 0 });
    const port = Number(output.match(/PORT=(\d+)/)?.[1]);
    expect(port).toBeGreaterThan(0);
    const { createServer } = await import('node:net');
    const server = createServer();
    await new Promise<void>((done, fail) => {
      server.once('error', fail);
      server.listen(port, '127.0.0.1', done);
    });
    await new Promise<void>((done) => server.close(() => done()));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('pnpm resolution follows generated action-setup and npm-global layouts without a shell or inferred global path', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sp-pnpm-layout-'));
  const home = resolve(directory, 'action home');
  const bin = resolve(home, 'bin');
  const local = resolve(directory, 'npm global');
  const script = resolve(local, 'node_modules/pnpm/bin/pnpm.cjs');
  try {
    await mkdir(bin, { recursive: true });
    await mkdir(resolve(local, 'node_modules/pnpm/bin'), { recursive: true });
    await writeFile(
      resolve(bin, 'pnpm.cmd'),
      '@node "../../global/v11/missing/node_modules/pnpm/bin/pnpm.cjs" %*\r\n',
    );
    await copyFile(process.execPath, resolve(bin, 'pnpm.exe'));
    await writeFile(
      resolve(local, 'pnpm.cmd'),
      '@"node" "%dp0%\\node_modules\\pnpm\\bin\\pnpm.cjs" %*\r\n',
    );
    await writeFile(
      script,
      'console.log(JSON.stringify(process.argv.slice(2)));',
    );
    const args = ['--filter', 'socialprune', 'test:engine', 'space & literal'];
    const execute = promisify(execFile);
    for (const environment of [
      { PNPM_HOME: home, PATH: bin },
      { PNPM_HOME: home, PATH: '' },
      { Path: local },
    ]) {
      const launch = await runner.resolvePnpm(environment, 'win32');
      if (environment.Path) {
        expect(launch).toEqual({
          executable: process.execPath,
          args: [script],
        });
        const result = await execute(launch.executable, [
          ...launch.args,
          ...args,
        ]);
        expect(JSON.parse(result.stdout)).toEqual(args);
      } else {
        expect(launch).toEqual({
          executable: resolve(bin, 'pnpm.exe'),
          args: [],
        });
        if (process.platform === 'win32') {
          const result = await execute(launch.executable, ['--version']);
          expect(result.stdout.trim()).toBe(process.version);
        }
      }
    }
    await expect(
      readFile(resolve(directory, 'global/v11')),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  } finally {
    // Windows can retain the just-exited executable's image lock briefly.
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('missing pnpm is a retained launchError rather than a suite exit failure', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sp-pnpm-missing-'));
  try {
    expect(
      await runner.runSuite('engine', directory, {
        PNPM_HOME: directory,
        PATH: directory,
      }),
    ).toBe(1);
    const result = JSON.parse(
      await readFile(resolve(directory, 'engine/summary.json'), 'utf8'),
    ) as unknown;
    expect(result).toMatchObject({
      state: 'launch-failed',
      exitCode: null,
      launchError: 'PNPM_NOT_FOUND',
      reportPresent: false,
    });
    expect(
      await readFile(resolve(directory, 'engine/suite.log'), 'utf8'),
    ).toContain('PNPM_NOT_FOUND');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('an unavailable temp root retains a launch-failed summary and causal log', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sp-suite-temp-missing-'));
  try {
    expect(
      await runner.runSuite('engine', directory, {
        TEMP: resolve(directory, 'absent'),
      }),
    ).toBe(1);
    expect(
      JSON.parse(
        await readFile(resolve(directory, 'engine/summary.json'), 'utf8'),
      ),
    ).toMatchObject({
      state: 'launch-failed',
      launchError: 'ENOENT',
      exitCode: null,
    });
    expect(
      await readFile(resolve(directory, 'engine/suite.log'), 'utf8'),
    ).toContain('ENOENT');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a cmd shim with a missing target is reported instead of falling through to another installation', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sp-pnpm-shim-'));
  try {
    await writeFile(
      resolve(directory, 'pnpm.cmd'),
      '@"node" "%~dp0\\missing\\pnpm.cjs" %*\r\n',
    );
    await expect(
      runner.resolvePnpm({ PNPM_HOME: directory, PATH: directory }, 'win32'),
    ).rejects.toMatchObject({ code: 'PNPM_SHIM_TARGET_MISSING' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('pnpm startup failure retains its causal log and launchError before a suite starts', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sp-pnpm-broken-'));
  try {
    const script = resolve(directory, 'pnpm.cjs');
    if (process.platform === 'win32') {
      await writeFile(
        resolve(directory, 'pnpm.cmd'),
        '@"node" "%~dp0\\pnpm.cjs" %*\r\n',
      );
      await writeFile(script, 'require("./generated-missing-entry.cjs");');
    } else {
      await writeFile(resolve(directory, 'pnpm'), 'not executable');
    }
    expect(
      await runner.runSuite('engine', directory, {
        PNPM_HOME: directory,
        PATH: directory,
      }),
    ).toBe(1);
    const result = JSON.parse(
      await readFile(resolve(directory, 'engine/summary.json'), 'utf8'),
    ) as unknown;
    expect(result).toMatchObject({
      state: 'launch-failed',
      exitCode: null,
      launchError:
        process.platform === 'win32' ? 'PNPM_STARTUP_FAILED' : 'EACCES',
      reportPresent: false,
    });
    expect(
      await readFile(resolve(directory, 'engine/suite.log'), 'utf8'),
    ).toContain(process.platform === 'win32' ? 'MODULE_NOT_FOUND' : 'EACCES');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('dispatch selection is closed, deduplicated and canonical before shell use', () => {
  expect(runner.selection()).toEqual([
    'delete',
    'engine',
    'context',
    'fill',
    'delete-instagram',
  ]);
  expect(runner.selection('fill, engine')).toEqual(['engine', 'fill']);
  for (const value of [
    '',
    'engine,engine',
    'all,engine',
    'unknown',
    'engine;exit 0',
  ])
    expect(() => runner.selection(value)).toThrow();
  expect(() => runner.suiteArguments('unknown', 'generated.xml')).toThrow();
  expect(() => runner.suiteArguments('constructor', 'generated.xml')).toThrow();
});

test('the workflow runner calls the real local package scripts, changing only workers and reports', async () => {
  const metadata = JSON.parse(
    await readFile(resolve(root, 'apps/cli/package.json'), 'utf8'),
  ) as {
    scripts: Record<string, string>;
  };
  const expected = {
    delete: ['test:delete', 'e2e/delete.vitest.config.ts'],
    engine: ['test:engine', 'e2e/engine-controls.vitest.config.ts'],
    context: ['test:context', 'e2e/context.vitest.config.ts'],
    fill: ['test:fill', 'e2e/fill.playwright.config.ts'],
    'delete-instagram': [
      'test:delete:instagram',
      'e2e/delete-instagram.vitest.config.ts',
    ],
  };
  for (const [name, [script, config]] of Object.entries(expected)) {
    const args = runner.suiteArguments(name, 'generated.xml');
    expect(args.slice(0, 3)).toEqual(['--filter', 'socialprune', script]);
    expect(metadata.scripts[script!]).toContain(config);
    expect(args.join(' ')).not.toMatch(
      /--config|--testNamePattern|--grep|--retry|--passWithNoTests/,
    );
    expect(args).toContain(name === 'fill' ? '--workers=1' : '--maxWorkers=1');
    expect(runner.suites[name]!.minutes).toBeGreaterThan(0);
  }
});

test('the standalone workflow keeps other suites serial and case-shards context with a required aggregate', async () => {
  const workflow = await readFile(
    resolve(root, '.github/workflows/browser-suites.yml'),
    'utf8',
  );
  expect(workflow).toContain("branches: ['suites/**']");
  expect(workflow).toContain('workflow_dispatch:');
  expect(workflow).toContain('runs-on: windows-latest');
  expect(workflow).toContain('group: browser-suites-${{ github.ref }}');
  expect(workflow).toContain('contents: read');
  expect(workflow).not.toMatch(
    /\bsecrets\b|pull_request_target|\bdeploy\b|continue-on-error/m,
  );
  for (const name of ['delete', 'engine', 'fill', 'delete-instagram']) {
    expect(workflow).toContain(
      `run: node .github/scripts/browser-suite.mjs run ${name}`,
    );
    expect(workflow).toContain(
      name === 'delete-instagram'
        ? `always() && steps.selected.outputs['delete-instagram'] == 'true'`
        : `always() && steps.selected.outputs.${name} == 'true'`,
    );
    expect(workflow).toContain(
      `path: apps/cli/test-results/browser-suites/${name}/`,
    );
  }
  expect(
    workflow.match(/run: node .github\/scripts\/browser-suite.mjs run /g),
  ).toHaveLength(5);
  // Five suite/aggregate jobs plus the opt-in isolated foreground probe.
  expect(workflow.match(/timeout-minutes: (?:27|12|32|10)\n/g)).toHaveLength(6);
  expect(workflow).toContain('placement-only:');
  expect(workflow).toContain('if: inputs.placement-only == true');
  expect(workflow).toContain(
    'Measure foreground and placement before full-suite admission',
  );
  expect(workflow).toContain('shard: [1, 2, 3, 4]');
  expect(workflow).toContain('needs: [select, context]');
  expect(workflow).toContain(
    'node .github/scripts/browser-suite.mjs aggregate-context context-artifacts',
  );
  expect(workflow).toContain('test "$SHARDS_RESULT" = success');
  const pins = [...workflow.matchAll(/uses: ([^\s]+)@([^\s]+)/g)];
  expect(pins.length).toBeGreaterThan(5);
  for (const [, , pin] of pins) expect(pin).toMatch(/^[a-f0-9]{40}$/);
});

test('context aggregate fails first for planted empty JUnit and a missing shard, then proves every case once', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sp-context-aggregate-'));
  const cases = Array.from({ length: 40 }, (_, n) => ({
    file: 'apps/cli/e2e/context-instagram.test.ts',
    name: `generated [${n}] (case)? & value`,
  }));
  const encode = (s: string) =>
    s.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
  const xml = (rows: typeof cases) =>
    '<testsuites><testsuite>' +
    rows
      .map(
        (c) =>
          `<testcase classname="${encode(c.file)}" name="${encode(c.name)}"></testcase>`,
      )
      .join('') +
    '</testsuite></testsuites>';
  try {
    const reports: string[] = [];
    for (let shard = 1; shard <= runner.contextShards.count; shard++) {
      const folder = resolve(directory, `browser-suite-context-${shard}-1`);
      await mkdir(folder);
      const selected = cases.filter(
        (c) => runner.contextPartition(c.file, c.name) === shard,
      );
      const pattern = new RegExp(runner.contextPattern(cases, shard));
      expect(cases.filter((c) => pattern.test(c.name))).toEqual(selected);
      reports.push(xml(selected));
      await writeFile(resolve(folder, 'inventory.json'), JSON.stringify(cases));
      await writeFile(
        resolve(folder, 'summary.json'),
        JSON.stringify({
          suite: 'context',
          shard,
          shards: 4,
          source: 'generated-source',
          state: 'passed',
          exitCode: 0,
          worktreeDirty: false,
          durationSeconds: 10,
          timeoutSeconds: 1800,
        }),
      );
      await writeFile(resolve(folder, 'suite.log'), 'generated suite output');
      await writeFile(
        resolve(folder, 'junit.xml'),
        shard === 1
          ? '<testsuites><testsuite></testsuite></testsuites>'
          : reports[shard - 1]!,
      );
    }
    await expect(
      runner.aggregateContext(directory, 'generated-source'),
    ).rejects.toThrow('CONTEXT_JUNIT_EMPTY');
    await writeFile(
      resolve(directory, 'browser-suite-context-1-1/junit.xml'),
      reports[0]!,
    );
    await rm(resolve(directory, 'browser-suite-context-4-1'), {
      recursive: true,
    });
    await expect(
      runner.aggregateContext(directory, 'generated-source'),
    ).rejects.toThrow('CONTEXT_SHARD_MISSING_OR_DUPLICATE');
    const folder = resolve(directory, 'browser-suite-context-4-1');
    await mkdir(folder);
    await writeFile(resolve(folder, 'inventory.json'), JSON.stringify(cases));
    const summary = {
      suite: 'context',
      shard: 4,
      shards: 4,
      source: 'generated-source',
      state: 'passed',
      exitCode: 0,
      worktreeDirty: false,
      durationSeconds: 10,
      timeoutSeconds: 1800,
    };
    await writeFile(resolve(folder, 'summary.json'), JSON.stringify(summary));
    await writeFile(resolve(folder, 'suite.log'), 'generated output');
    await writeFile(resolve(folder, 'junit.xml'), reports[3]!);
    await expect(
      runner.aggregateContext(directory, 'generated-source'),
    ).resolves.toMatchObject({ cases: 40, state: 'passed' });
    await writeFile(
      resolve(folder, 'summary.json'),
      JSON.stringify({ ...summary, state: 'timed-out' }),
    );
    await expect(
      runner.aggregateContext(directory, 'generated-source'),
    ).rejects.toThrow('CONTEXT_SHARD_FAILED');
    await writeFile(resolve(folder, 'summary.json'), JSON.stringify(summary));
    await rm(resolve(folder, 'junit.xml'));
    await expect(
      runner.aggregateContext(directory, 'generated-source'),
    ).rejects.toThrow();
    await writeFile(resolve(folder, 'junit.xml'), xml(cases));
    await expect(
      runner.aggregateContext(directory, 'generated-source'),
    ).rejects.toThrow('CONTEXT_SHARD_COVERAGE');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

const rerunInventory = Array.from({ length: 40 }, (_, n) => ({
  file: 'apps/cli/e2e/context-instagram.test.ts',
  name: `generated rerun case ${n}`,
}));
async function contextAttempt(
  directory: string,
  shard: number,
  attempt: number | string,
  state = 'passed',
) {
  const folder = resolve(
    directory,
    `browser-suite-context-${shard}-${attempt}`,
  );
  await mkdir(folder);
  await writeFile(
    resolve(folder, 'summary.json'),
    JSON.stringify({
      suite: 'context',
      shard,
      shards: 4,
      source: 'generated-source',
      state,
      exitCode: state === 'passed' ? 0 : 1,
      worktreeDirty: false,
      durationSeconds: 10,
      timeoutSeconds: 1800,
    }),
  );
  await writeFile(
    resolve(folder, 'inventory.json'),
    JSON.stringify(rerunInventory),
  );
  await writeFile(resolve(folder, 'suite.log'), 'generated rerun output');
  await writeFile(
    resolve(folder, 'junit.xml'),
    '<testsuites><testsuite>' +
      rerunInventory
        .filter((c) => runner.contextPartition(c.file, c.name) === shard)
        .map((c) => `<testcase classname="${c.file}" name="${c.name}"/>`)
        .join('') +
      '</testsuite></testsuites>',
  );
  return folder;
}

test('context rerun selects the latest attempt per shard, ignoring an earlier failure and counting every case once', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'sp-context-rerun-'));
  try {
    for (let shard = 1; shard <= 4; shard++)
      await contextAttempt(
        directory,
        shard,
        1,
        shard === 1 ? 'failed' : 'passed',
      );
    await contextAttempt(directory, 1, 2);
    const result = await runner.aggregateContext(directory, 'generated-source');
    expect(result).toMatchObject({ cases: 40, state: 'passed' });
    expect(
      result.shards.map(({ shard, attempt, artifact }) => ({
        shard,
        attempt,
        artifact,
      })),
    ).toEqual([
      { shard: 1, attempt: 2, artifact: 'browser-suite-context-1-2' },
      { shard: 2, attempt: 1, artifact: 'browser-suite-context-2-1' },
      { shard: 3, attempt: 1, artifact: 'browser-suite-context-3-1' },
      { shard: 4, attempt: 1, artifact: 'browser-suite-context-4-1' },
    ]);
    expect(result.shards.reduce((sum, shard) => sum + shard.cases, 0)).toBe(40);
    await contextAttempt(directory, 1, 10);
    expect(
      (await runner.aggregateContext(directory, 'generated-source')).shards[0],
    ).toMatchObject({
      attempt: 10,
      artifact: 'browser-suite-context-1-10',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test.each(['failed', 'timed-out'])(
  'context rerun rejects a %s latest attempt instead of falling back to green',
  async (state) => {
    const directory = await mkdtemp(resolve(tmpdir(), 'sp-context-rerun-red-'));
    try {
      for (let shard = 1; shard <= 4; shard++)
        await contextAttempt(directory, shard, 1);
      await contextAttempt(directory, 1, 2, state);
      await expect(
        runner.aggregateContext(directory, 'generated-source'),
      ).rejects.toThrow('CONTEXT_SHARD_FAILED');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test('context rerun rejects duplicate shard-attempt identities even when superseded', async () => {
  const directory = await mkdtemp(
    resolve(tmpdir(), 'sp-context-rerun-duplicate-'),
  );
  try {
    for (let shard = 1; shard <= 4; shard++)
      await contextAttempt(directory, shard, 1);
    // Different directory spellings carry the same numeric shard/attempt pair.
    await contextAttempt(directory, 1, '01');
    await contextAttempt(directory, 1, 2);
    await expect(
      runner.aggregateContext(directory, 'generated-source'),
    ).rejects.toThrow('CONTEXT_SHARD_MISSING_OR_DUPLICATE');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('context rerun still rejects a missing shard among mixed attempts', async () => {
  const directory = await mkdtemp(
    resolve(tmpdir(), 'sp-context-rerun-missing-'),
  );
  try {
    for (let shard = 1; shard <= 3; shard++)
      await contextAttempt(directory, shard, 1);
    await contextAttempt(directory, 1, 2);
    await expect(
      runner.aggregateContext(directory, 'generated-source'),
    ).rejects.toThrow('CONTEXT_SHARD_MISSING_OR_DUPLICATE');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('context rerun checks the selected latest JUnit and never reuses an older complete report', async () => {
  const directory = await mkdtemp(
    resolve(tmpdir(), 'sp-context-rerun-report-'),
  );
  try {
    for (let shard = 1; shard <= 4; shard++)
      await contextAttempt(directory, shard, 1);
    const folder = await contextAttempt(directory, 1, 2);
    const report = resolve(folder, 'junit.xml');
    const complete = await readFile(report, 'utf8');
    await writeFile(report, '<testsuites><testsuite></testsuite></testsuites>');
    await expect(
      runner.aggregateContext(directory, 'generated-source'),
    ).rejects.toThrow('CONTEXT_JUNIT_EMPTY');
    await rm(report);
    await expect(
      runner.aggregateContext(directory, 'generated-source'),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    const caseTag = complete.match(/<testcase\b[^>]*\/>/)![0];
    for (const altered of [
      complete.replace(caseTag, ''),
      complete.replace(caseTag, caseTag + caseTag),
    ]) {
      await writeFile(report, altered);
      await expect(
        runner.aggregateContext(directory, 'generated-source'),
      ).rejects.toThrow('CONTEXT_SHARD_COVERAGE');
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('large case shard patterns go directly to the real Vitest Node entry instead of a Windows script wrapper', () => {
  const pattern = '^(?:' + 'generated long test name|'.repeat(600) + 'last)$';
  const launch = runner.contextLaunch([
    '--filter',
    'socialprune',
    'test:context',
    `--testNamePattern=${pattern}`,
    '--maxWorkers=1',
  ]);
  expect(launch.executable).toBe(process.execPath);
  expect(launch.args[0]).toMatch(/vitest[\\/]vitest\.mjs$/);
  expect(launch.args.slice(1, 4)).toEqual([
    'run',
    '--config',
    'apps/cli/e2e/context.vitest.config.ts',
  ]);
  expect(launch.args).toContain(`--testNamePattern=${pattern}`);
});

test('the existing two-case cleanup lifecycle proof stays on the same runner', () => {
  const file = 'apps/cli/e2e/context-instagram.test.ts';
  expect(
    runner.contextPartition(
      file,
      'C8 cleanup 2 verifies the preceding test released its browser and fixed fake port',
    ),
  ).toBe(
    runner.contextPartition(
      file,
      'C8 cleanup 1 registers cleanup even when the test never enters a finally',
    ),
  );
});

test('test-only preload refuses Node TCP before dialing and configures a closed browser proxy', async () => {
  const preload = resolve(root, '.github/scripts/loopback-only.cjs');
  const execute = promisify(execFile);
  for (const code of [
    "require('node:net').connect({host:'198.51.100.7',port:80})",
    "require('node:net').connect(80,'198.51.100.7')",
    "require('node:net').Socket.prototype.connect.call(new (require('node:net').Socket)(),[{host:'198.51.100.7',port:80},()=>{}])",
  ]) {
    const result = await execute(
      process.execPath,
      ['--require', preload, '-e', code],
      {
        cwd: root,
      },
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(result).toMatchObject({ code: 1 });
    expect((result as { stderr: string }).stderr).toContain(
      'BROWSER_SUITE_NON_LOOPBACK_TCP',
    );
  }
  const source = await readFile(preload, 'utf8');
  expect(source).toContain("server: 'http://127.0.0.1:9'");
  expect(source).toContain("bypass: 'localhost,127.0.0.1,[::1]'");
});

test('pnpm resolution uses the current terminal installation and never enables a shell', async () => {
  const launch = await runner.resolvePnpm();
  const result = await promisify(execFile)(launch.executable, [
    ...launch.args,
    '--version',
  ]);
  expect(result.stdout.trim()).toBe('10.33.0');
  const source = await readFile(entry, 'utf8');
  expect(source).not.toMatch(/shell\s*:|cmd\.exe|windowsVerbatimArguments/);
});

test.skipIf(process.platform !== 'win32')(
  'failed suite retains its summary and full log and cannot reuse a stale JUnit success',
  async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'sp-suite-runner-'));
    const output = resolve(directory, 'reports');
    const folder = resolve(output, 'engine');
    try {
      await mkdir(folder, { recursive: true });
      await writeFile(
        resolve(folder, 'junit.xml'),
        '<testsuites tests="10" failures="0"/>',
      );
      // PATH selects a test-only command double, never a runtime activation flag.
      await writeFile(
        resolve(directory, 'pnpm.cmd'),
        '@"node" "%dp0%\\pnpm.cjs" %*\r\n',
      );
      await writeFile(
        resolve(directory, 'pnpm.cjs'),
        'if(process.argv[2]==="--version") console.log("10.33.0"); else { console.log("Generated suite failure"); process.exitCode=7; }',
      );
      expect(
        await runner.runSuite('engine', output, {
          ...process.env,
          PATH: directory + delimiter + process.env.PATH,
        }),
      ).toBe(1);
      const result = JSON.parse(
        await readFile(resolve(folder, 'summary.json'), 'utf8'),
      ) as unknown;
      expect(result).toMatchObject({
        state: 'failed',
        exitCode: 7,
        launchError: null,
        reportPresent: false,
      });
      expect(await readFile(resolve(folder, 'suite.log'), 'utf8')).toContain(
        'Generated suite failure',
      );
      await expect(
        readFile(resolve(folder, 'junit.xml')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

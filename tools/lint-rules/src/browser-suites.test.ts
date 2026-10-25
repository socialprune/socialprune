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
}
const runner = (await import(entry)) as Runner;

test('single-file context receives its measured outer budget without changing test or hook deadlines', async () => {
  expect(runner.suites.context!.minutes).toBe(70);
  expect(runner.suites.delete!.minutes).toBe(25);
  expect(runner.suites.engine!.minutes).toBe(10);
  expect(runner.suites.fill!.minutes).toBe(25);
  const config = await readFile(
    resolve(root, 'apps/cli/e2e/context.vitest.config.ts'),
    'utf8',
  );
  expect(config).toContain(
    "include: ['apps/cli/e2e/context-instagram.test.ts']",
  );
  expect(config).toContain('testTimeout: 60000');
  expect(config).toContain('hookTimeout: 30000');
  const workflow = await readFile(
    resolve(root, '.github/workflows/browser-suites.yml'),
    'utf8',
  );
  expect(workflow).toMatch(
    /name: Instagram context suite[\s\S]*?timeout-minutes: 72\s+run: node \.github\/scripts\/browser-suite\.mjs run context/,
  );
  expect(workflow).toContain('timeout-minutes: 170');
  expect(workflow).toContain('browser-suite-context-${{ github.run_attempt }}');
  expect(workflow).toContain(
    'path: apps/cli/test-results/browser-suites/context/',
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
    await rm(directory, { recursive: true, force: true });
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
  expect(runner.selection()).toEqual(['delete', 'engine', 'context', 'fill']);
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

test('the standalone workflow keeps all four suites serial, bounded and independently uploaded', async () => {
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
    /^\s*matrix:|\bsecrets\b|pull_request_target|\bdeploy\b|continue-on-error/m,
  );
  for (const name of ['delete', 'engine', 'context', 'fill']) {
    expect(workflow).toContain(
      `run: node .github/scripts/browser-suite.mjs run ${name}`,
    );
    expect(workflow).toContain(
      `always() && steps.selected.outputs.${name} == 'true'`,
    );
    expect(workflow).toContain(
      `path: apps/cli/test-results/browser-suites/${name}/`,
    );
  }
  expect(
    workflow.match(/run: node .github\/scripts\/browser-suite.mjs run /g),
  ).toHaveLength(4);
  expect(workflow.match(/timeout-minutes: (?:27|12|72)\n/g)).toHaveLength(4);
  const pins = [...workflow.matchAll(/uses: ([^\s]+)@([^\s]+)/g)];
  expect(pins.length).toBeGreaterThan(5);
  for (const [, , pin] of pins) expect(pin).toMatch(/^[a-f0-9]{40}$/);
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

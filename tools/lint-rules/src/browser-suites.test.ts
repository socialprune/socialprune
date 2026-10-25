import { readFile, mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, delimiter } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test, vi } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');
const entry = resolve(root, '.github/scripts/browser-suite.mjs');
interface Runner {
  suites: Record<string, { script: string; minutes: number; runner: string }>;
  selection(value?: string): string[];
  suiteArguments(name: string, report: string): string[];
  runSuite(name: string, output?: string): Promise<number>;
  invocation(
    command: string[],
    platform?: string,
  ): {
    executable: string;
    args: string[];
    options: { windowsVerbatimArguments?: boolean };
  };
}
const runner = (await import(entry)) as Runner;

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
  expect(workflow.match(/timeout-minutes: (?:27|12|42)\n/g)).toHaveLength(4);
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

test('the workflow invocation preserves Windows arguments rather than escaping quotes into the command name', async () => {
  const command = [process.execPath, '--version'];
  const launch = runner.invocation(command);
  const execute = promisify(execFile);
  const result = await execute(launch.executable, launch.args, {
    ...launch.options,
    cwd: root,
  });
  expect(result.stdout.trim()).toBe(process.version);
  expect(
    runner.invocation(
      ['pnpm', '--filter', 'socialprune', 'test:engine'],
      'linux',
    ),
  ).toEqual({
    executable: 'pnpm',
    args: ['--filter', 'socialprune', 'test:engine'],
    options: {},
  });
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
        '@echo Generated suite failure\r\n@exit /b 7\r\n',
      );
      vi.stubEnv('PATH', directory + delimiter + process.env.PATH);
      expect(await runner.runSuite('engine', output)).toBe(1);
      const result = JSON.parse(
        await readFile(resolve(folder, 'summary.json'), 'utf8'),
      ) as unknown;
      expect(result).toMatchObject({
        state: 'failed',
        exitCode: 7,
        reportPresent: false,
      });
      expect(await readFile(resolve(folder, 'suite.log'), 'utf8')).toContain(
        'Generated suite failure',
      );
      await expect(
        readFile(resolve(folder, 'junit.xml')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

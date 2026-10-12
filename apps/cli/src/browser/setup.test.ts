import type { ChildProcess } from 'node:child_process';
import * as childProcess from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  unlink,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import * as readline from 'node:readline';
import { afterEach, expect, test, vi } from 'vitest';
import * as profileModule from './profile.ts';
import { executeCli } from '../cli/adapter.ts';
import { createNodeContext } from '../cli/node-context.ts';
import { productionDriver } from './x/driver.ts';
import { runFill } from './x/fill/run.ts';
import { SQLiteStore } from '../workspace/sqlite-store.ts';
import { fixtureWorkspace, FIXTURE } from '../../e2e/fake-x/fixture.ts';
import { planFill } from './x/fill/plan.ts';
import { ordinarySetup } from './setup.ts';
import * as setupModule from './setup.ts';

const driver = vi.hoisted(() => ({
  launch: vi.fn((_profile: string, _options: unknown) => {
    throw new Error('GENERATED_DRIVER_ATTACHED');
  }),
}));
vi.mock('playwright-core', () => ({
  chromium: { launchPersistentContext: driver.launch },
}));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof childProcess>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});
vi.mock('node:readline', async (importOriginal) => {
  const actual = await importOriginal<typeof readline>();
  return { ...actual, createInterface: vi.fn(actual.createInterface) };
});
afterEach(() => {
  vi.restoreAllMocks();
  driver.launch.mockClear();
});

const stub = `import {writeFile,unlink} from 'node:fs/promises';
import {join} from 'node:path';
const args=process.argv.slice(2),profile=args.find(arg=>arg.startsWith('--user-data-dir='))?.slice(16);
if(!profile)throw new Error('Missing fixture profile');
await writeFile(join(profile,'SingletonLock'),'Generated held lock',{flag:'wx'});
process.send({type:'ready',args});
const hold=setInterval(()=>{},1000);
process.on('message',async message=>{
 if(message==='release'){await unlink(join(profile,'SingletonLock'));process.send({type:'released'});}
 if(message==='exit'){process.send({type:'exiting'});clearInterval(hold);process.exit(0);}
});`;

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-setup-stub-'));
  const profile = join(directory, 'dedicated profile');
  const script = join(directory, 'generated-browser.mjs');
  await writeFile(script, stub);
  const stdout: string[] = [],
    stderr: string[] = [],
    input = new PassThrough();
  const context = {
    ...createNodeContext(
      { write: (text) => stdout.push(text) },
      { write: (text) => stderr.push(text) },
    ),
    stdoutIsTerminal: true,
  };
  let child: ChildProcess | undefined;
  const messages: { type: string; args?: string[] }[] = [];
  const installed = vi
    .spyOn(profileModule, 'installedBrowser')
    .mockResolvedValue(process.execPath);
  const realSpawn = (
    await vi.importActual<typeof childProcess>('node:child_process')
  ).spawn;
  const spawn = vi
    .spyOn(childProcess, 'spawn')
    .mockImplementation(
      (
        command: string,
        args: readonly string[],
        options: childProcess.SpawnOptions,
      ) => {
        child = realSpawn(command, [script, ...args], {
          ...options,
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        });
        child.on('message', (value) =>
          messages.push(value as { type: string; args?: string[] }),
        );
        return child;
      },
    );
  const actualReadline = (
    await vi.importActual<typeof readline>('node:readline')
  ).createInterface;
  const active = new Set<AbortController>();
  const actualSetup = (await vi.importActual<typeof setupModule>('./setup.ts'))
    .ordinarySetup;
  vi.spyOn(setupModule, 'ordinarySetup').mockImplementation((options, wait) =>
    actualSetup(options, wait ?? { pollMs: 10, releaseTimeoutMs: 1500 }),
  );
  vi.spyOn(readline, 'createInterface').mockImplementation(
    (options: readline.ReadLineOptions) =>
      actualReadline({ ...options, input }),
  );
  const run = (terminal = true) => {
    const controller = new AbortController();
    active.add(controller);
    const running = executeCli(
      [
        'browser',
        'setup',
        '--platform',
        'x',
        '--profile',
        profile,
        '--browser',
        'edge',
      ],
      { ...context, stdoutIsTerminal: terminal, signal: controller.signal },
    );
    void running.finally(() => active.delete(controller));
    return running;
  };
  const send = (message: string) =>
    new Promise<void>((resolve, reject) => {
      if (!child) throw new Error('Stub not spawned');
      child.send(message, (error) => (error ? reject(error) : resolve()));
    });
  return {
    directory,
    profile,
    stdout,
    stderr,
    input,
    messages,
    installed,
    spawn,
    run,
    send,
    get child() {
      return child;
    },
    async ready() {
      await expect
        .poll(() => messages.find((value) => value.type === 'ready'), {
          timeout: 3000,
        })
        .toBeDefined();
    },
    async close() {
      for (const controller of active) controller.abort();
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill();
        await new Promise<void>((resolve) =>
          child!.once('close', () => resolve()),
        );
      }
      input.end();
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
      });
    },
  };
}

test('setup directly spawns exact ordinary-browser argv and returns only after child exit and profile lock release', async () => {
  const f = await fixture();
  let running: Promise<number> | undefined;
  try {
    running = f.run();
    await f.ready();
    expect(f.messages[0]?.args).toEqual([
      `--user-data-dir=${f.profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-mode',
      'https://x.com/i/flow/login',
    ]);
    expect(f.spawn).toHaveBeenCalledOnce();
    expect(driver.launch).not.toHaveBeenCalled();
    let finished = false;
    void running.then(() => {
      finished = true;
    });
    await f.send('exit');
    await expect.poll(() => f.child?.exitCode).toBe(0);
    expect(finished).toBe(false);
    await unlink(join(f.profile, 'SingletonLock'));
    expect(await running, f.stderr.join('')).toBe(0);
    expect(f.stderr.join('')).toContain(
      'ordinary browser window with no program attached',
    );
    expect(f.stderr.join('')).toContain(
      'normal browser profile is not touched',
    );
  } finally {
    await f.close();
    await running;
  }
});

test('setup reuses its marked profile and never reports completion after early Enter while the window lock remains held', async () => {
  const f = await fixture();
  let running: Promise<number> | undefined;
  try {
    await profileModule.createProfile(f.profile);
    const marker = await readFile(
      join(f.profile, profileModule.PROFILE_MARKER),
      'utf8',
    );
    running = f.run();
    await f.ready();
    f.input.write('\n');
    await expect.poll(() => f.stderr.join('')).toContain('still in use');
    let done = false;
    void running.then(() => {
      done = true;
    });
    expect(done).toBe(false);
    await f.send('release');
    await f.send('exit');
    expect(await running).toBe(0);
    expect(
      await readFile(join(f.profile, profileModule.PROFILE_MARKER), 'utf8'),
    ).toBe(marker);
  } finally {
    await f.close();
    await running;
  }
});

test('setup refuses non-terminal calls and foreign nonempty folders before starting a browser', async () => {
  const f = await fixture();
  try {
    const pipe = f.run(false);
    await expect
      .poll(() => f.spawn.mock.calls.length + f.stdout.length)
      .toBeGreaterThan(0);
    expect(f.spawn).not.toHaveBeenCalled();
    expect(await pipe).toBe(2);
    expect(f.stdout.join('')).toContain('NOT_INTERACTIVE');
    expect(f.spawn).not.toHaveBeenCalled();
    await mkdir(f.profile);
    await writeFile(
      join(f.profile, 'foreign.txt'),
      'Generated ordinary profile',
    );
    f.stdout.length = 0;
    const foreign = f.run();
    await expect
      .poll(() => f.spawn.mock.calls.length + f.stdout.length)
      .toBeGreaterThan(0);
    expect(f.spawn).not.toHaveBeenCalled();
    expect(await foreign).toBe(2);
    expect(f.stdout.join('')).toContain('PROFILE_INVALID');
    expect(f.spawn).not.toHaveBeenCalled();
    expect(driver.launch).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});

test('Enter ends only the owned lingering child after its observed profile lock is released', async () => {
  const f = await fixture();
  let running: Promise<number> | undefined;
  try {
    running = f.run();
    await f.ready();
    const kill = vi.spyOn(f.child!, 'kill');
    f.input.write('\n');
    await expect.poll(() => f.stderr.join('')).toContain('still in use');
    expect(kill).not.toHaveBeenCalled();
    await f.send('release');
    await expect
      .poll(() => f.messages.some((message) => message.type === 'released'))
      .toBe(true);
    expect(f.child!.exitCode).toBeNull();
    f.input.write('\n');
    await expect.poll(() => kill.mock.calls.length, { timeout: 5000 }).toBe(1);
    expect(await running, f.stderr.join('')).toBe(0);
    expect(kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
    expect(f.child!.exitCode !== null || f.child!.signalCode !== null).toBe(
      true,
    );
  } finally {
    await f.close();
    await running;
  }
});

test('an exited browser with a remaining lock fails within the bounded wait without deleting the lock', async () => {
  const f = await fixture();
  let running: Promise<void> | undefined;
  try {
    await profileModule.createProfile(f.profile);
    running = ordinarySetup(
      {
        profile: f.profile,
        executablePath: process.execPath,
        signal: new AbortController().signal,
        notice: (text) => f.stderr.push(text),
      },
      { pollMs: 10, releaseTimeoutMs: 100 },
    );
    const result = running.then(
      () => null,
      (error) => error as unknown,
    );
    await f.ready();
    const kill = vi.spyOn(f.child!, 'kill');
    await f.send('exit');
    expect(await result).toMatchObject({ code: 'PROFILE_INVALID' });
    expect(await readFile(join(f.profile, 'SingletonLock'), 'utf8')).toBe(
      'Generated held lock',
    );
    expect(kill).not.toHaveBeenCalled();
    expect(driver.launch).not.toHaveBeenCalled();
  } finally {
    await f.close();
    await running?.catch(() => undefined);
  }
});

test('an already-held profile is rejected before spawning and cancellation never kills its browser', async () => {
  const f = await fixture();
  let running: Promise<void> | undefined;
  try {
    await profileModule.createProfile(f.profile);
    await writeFile(
      join(f.profile, 'SingletonLock'),
      'Generated foreign owner',
    );
    await expect(
      ordinarySetup({
        profile: f.profile,
        executablePath: process.execPath,
        signal: new AbortController().signal,
        notice: () => {},
      }),
    ).rejects.toMatchObject({ code: 'PROFILE_INVALID' });
    expect(f.spawn).not.toHaveBeenCalled();
    await unlink(join(f.profile, 'SingletonLock'));
    const controller = new AbortController();
    running = ordinarySetup(
      {
        profile: f.profile,
        executablePath: process.execPath,
        signal: controller.signal,
        notice: (text) => f.stderr.push(text),
      },
      { pollMs: 10, releaseTimeoutMs: 100 },
    );
    const result = running.then(
      () => null,
      (error) => error as unknown,
    );
    await f.ready();
    const kill = vi.spyOn(f.child!, 'kill');
    controller.abort();
    expect(await result).toMatchObject({ code: 'CANCELLED' });
    expect(kill).not.toHaveBeenCalled();
    expect(f.child!.exitCode).toBeNull();
  } finally {
    await f.close();
    await running?.catch(() => undefined);
  }
});

test('released Windows lockfile residue is probed without truncation and POSIX singleton links are not followed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-lock-decoy-'));
  try {
    const path = join(directory, 'lockfile');
    await writeFile(path, 'Generated lock residue');
    expect(await profileModule.profileInUse(directory)).toBe(false);
    expect(await readFile(path, 'utf8')).toBe('Generated lock residue');
    await writeFile(
      join(directory, 'SingletonLock'),
      'Generated held singleton',
    );
    expect(await profileModule.profileInUse(directory)).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('delete and verify driver keep Chromium sandbox enabled and all automation default arguments', async () => {
  await expect(
    productionDriver({
      profile: 'generated-profile',
      executablePath: 'generated-browser',
      confirmationOrigin: 'http://127.0.0.1',
      record: () => Promise.resolve(),
    }),
  ).rejects.toThrow('GENERATED_DRIVER_ATTACHED');
  const options = driver.launch.mock.calls[0]?.[1] as {
    chromiumSandbox: boolean;
    ignoreDefaultArgs?: string[];
    args?: string[];
  };
  expect(options.chromiumSandbox).toBe(true);
  expect(options.ignoreDefaultArgs).toEqual([
    '--disable-extensions',
    '--disable-infobars',
  ]);
  expect(options.args).toEqual(['--enable-automation']);
  expect(options.ignoreDefaultArgs).not.toContain('--enable-automation');
  expect(options.ignoreDefaultArgs).not.toContain('--remote-debugging-pipe');
});

test('fill driver keeps Chromium sandbox enabled and all automation default arguments', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-fill-launch-')),
    profile = join(directory, 'profile');
  await profileModule.createProfile(profile);
  const store = await SQLiteStore.open(join(directory, 'socialprune.sqlite'), {
    initial: fixtureWorkspace(['1001']),
  });
  try {
    const plan = await planFill(store, FIXTURE.account.key);
    await expect(
      runFill({
        store,
        plan,
        profile,
        executablePath: 'generated-browser',
        workspace: directory,
        list: 'generated-list',
        signal: new AbortController().signal,
        limit: 1,
        maxVideoBytes: 1024 ** 3,
        maxRunBytes: 20 * 1024 ** 3,
        include: new Set(),
        now: () => new Date(FIXTURE.now),
        notice: () => {},
      }),
    ).rejects.toThrow();
    const options = driver.launch.mock.calls[0]?.[1] as {
      chromiumSandbox: boolean;
      ignoreDefaultArgs?: string[];
      args?: string[];
    };
    expect(options.chromiumSandbox).toBe(true);
    expect(options.ignoreDefaultArgs).toEqual([
      '--disable-extensions',
      '--disable-infobars',
    ]);
    expect(options.args).toEqual(['--enable-automation']);
    expect(options.ignoreDefaultArgs).not.toContain('--enable-automation');
    expect(options.ignoreDefaultArgs).not.toContain('--remote-debugging-pipe');
  } finally {
    await store.close();
    await rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
});

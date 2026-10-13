import type { ChildProcess } from 'node:child_process';
import * as childProcess from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
  unlink,
} from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
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
import { runWithDependencies } from './runner.ts';
import { planDeletion } from './plan.ts';
import type { BrowserDriver } from './x/driver.ts';

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
// Capture functions before installing any spy. importActual returns the same
// module namespace, whose export may already be a spy in a later fixture.
const actualSetup = setupModule.ordinarySetup;
const realSpawn = (
  await vi.importActual<typeof childProcess>('node:child_process')
).spawn;
const actualReadline = (await vi.importActual<typeof readline>('node:readline'))
  .createInterface;
const cleanups = new Set<() => Promise<void>>();
async function cleanupOwnedFixtures() {
  const results = await Promise.allSettled(
    [...cleanups].map((close) => close()),
  );
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason as unknown] : [],
  );
  if (failures.length)
    throw new AggregateError(
      failures,
      'Generated setup fixture cleanup failed',
    );
}
afterEach(async () => {
  try {
    // Vitest can time out the body without waiting for its finally. Join every
    // fixture here before replacing module hooks or admitting the next test.
    await cleanupOwnedFixtures();
  } finally {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  }
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

async function fixture(source = stub) {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-setup-stub-'));
  const profile = join(directory, 'dedicated profile');
  const script = join(directory, 'generated-browser.mjs');
  await writeFile(script, source);
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
  const children = new Map<ChildProcess, Promise<void>>();
  const events = new EventEmitter();
  const messages: { type: string; args?: string[] }[] = [];
  const installed = vi
    .spyOn(profileModule, 'installedBrowser')
    .mockResolvedValue(process.execPath);
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
        const launched = child;
        children.set(
          launched,
          new Promise((resolve) => launched.once('close', () => resolve())),
        );
        launched.on('message', (value) => {
          const message = value as { type: string; args?: string[] };
          messages.push(message);
          events.emit(message.type);
        });
        return child;
      },
    );
  const active = new Set<AbortController>();
  const activeRuns = new Set<Promise<number>>();
  const activeSetups = new Set<Promise<void>>();
  vi.spyOn(setupModule, 'ordinarySetup').mockImplementation((options, wait) => {
    const controller = new AbortController();
    active.add(controller);
    const running = actualSetup(
      {
        ...options,
        signal: AbortSignal.any([controller.signal, options.signal]),
      },
      wait ?? {
        pollMs: 10,
        releaseTimeoutMs: 5000,
        appearanceTimeoutMs: 60000,
      },
    );
    activeSetups.add(running);
    const settled = () => {
      active.delete(controller);
      activeSetups.delete(running);
    };
    void running.then(settled, settled);
    return running;
  });
  vi.spyOn(readline, 'createInterface').mockImplementation(
    (options: readline.ReadLineOptions) =>
      actualReadline({ ...options, input }),
  );
  const run = (terminal = true) => {
    if (closing) throw new Error('Generated setup fixture already closed');
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
    activeRuns.add(running);
    const settled = () => {
      active.delete(controller);
      activeRuns.delete(running);
    };
    void running.then(settled, settled);
    return running;
  };
  const send = (message: string) =>
    new Promise<void>((resolve, reject) => {
      if (!child) throw new Error('Stub not spawned');
      child.send(message, (error) => (error ? reject(error) : resolve()));
    });
  const released = async () => {
    await send('release');
    if (!messages.some((message) => message.type === 'released'))
      await new Promise<void>((resolve) => events.once('released', resolve));
  };
  const exit = async () => {
    await send('exit');
    await children.get(child!);
    expect(child!.exitCode).toBe(0);
  };
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= (async () => {
      try {
        for (const controller of active) controller.abort();
        input.end();
        await Promise.allSettled([...activeRuns, ...activeSetups]);
        for (const [owned, ended] of children) {
          if (owned.exitCode === null && owned.signalCode === null)
            owned.kill();
          await ended;
        }
        await stopGeneratedGrandchild(profile);
      } finally {
        await rm(directory, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 100,
        });
        cleanups.delete(close);
      }
    })();
    return closing;
  };
  cleanups.add(close);
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
    released,
    exit,
    get child() {
      return child;
    },
    async ready() {
      await expect
        .poll(() => messages.find((value) => value.type === 'ready'), {
          timeout: 10000,
        })
        .toBeDefined();
      await expect
        .poll(() => stderr.join(''), { timeout: 10000 })
        .toContain('profile is active');
    },
    close,
  };
}

test('overlapping fixtures retain a real setup function rather than recursively capturing the installed spy', async () => {
  const first = await fixture();
  const next = await fixture('process.exit(0);');
  try {
    await profileModule.createProfile(next.profile);
    const running = ordinarySetup(
      {
        profile: next.profile,
        executablePath: process.execPath,
        signal: new AbortController().signal,
        notice: (text) => next.stderr.push(text),
      },
      { pollMs: 1, releaseTimeoutMs: 10, appearanceTimeoutMs: 10 },
    );
    await expect(running).rejects.toMatchObject({ code: 'PROFILE_INVALID' });
    expect(next.spawn).toHaveBeenCalledOnce();
  } finally {
    await next.close();
    await first.close();
  }
});

// Cleanup must join a real running child before the next test installs its hooks.
test('fixture cleanup joins a pending setup before clearing hooks for the next test', async () => {
  const f = await fixture();
  const pending = f.run();
  await f.ready();
  // Emulate the afterEach boundary while the body still has pending work.
  await cleanupOwnedFixtures();
  expect(await pending).toBe(1);
  expect(f.stdout.join('')).toContain('CANCELLED');
  expect(cleanups.size).toBe(0);
  for (const child of [f.child].filter((value) => value !== undefined))
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
  vi.restoreAllMocks();
  vi.clearAllMocks();
  const next = await fixture();
  try {
    expect(await next.run(false)).toBe(2);
    expect(next.spawn).not.toHaveBeenCalled();
    expect(() => f.run()).toThrow('already closed');
  } finally {
    await next.close();
  }
}, 30000);

// Native child startup and lock/exit IPC are the behavior under test, not a
// five-second wall-clock promise. Other files keep Vitest's default limits.
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
    await expect.poll(() => f.child?.exitCode, { timeout: 10000 }).toBe(0);
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
}, 30000);

// Real process startup plus held-lock/release acknowledgements need their own bound.
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
    await f.released();
    await f.exit();
    expect(await running).toBe(0);
    expect(
      await readFile(join(f.profile, profileModule.PROFILE_MARKER), 'utf8'),
    ).toBe(marker);
  } finally {
    await f.close();
    await running;
  }
}, 30000);

test('setup refuses non-terminal calls and foreign nonempty folders before starting a browser', async () => {
  const f = await fixture();
  try {
    expect(await f.run(false)).toBe(2);
    expect(f.stdout.join('')).toContain('NOT_INTERACTIVE');
    expect(f.spawn).not.toHaveBeenCalled();
    await mkdir(f.profile);
    await writeFile(
      join(f.profile, 'foreign.txt'),
      'Generated ordinary profile',
    );
    f.stdout.length = 0;
    expect(await f.run()).toBe(2);
    expect(f.stdout.join('')).toContain('PROFILE_INVALID');
    expect(f.spawn).not.toHaveBeenCalled();
    expect(driver.launch).not.toHaveBeenCalled();
  } finally {
    await f.close();
  }
});

// Exercises a real lingering child, lock release and signal-driven exit.
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
}, 30000);

// A native child must start, then exit while its real lock file remains held.
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
    f.input.write('\n');
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
}, 30000);

// Cancellation is checked after the native stub has acquired its lock.
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
}, 30000);

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

const grandchildStub = `import {writeFile,unlink} from 'node:fs/promises';import {join} from 'node:path';
const [profile]=process.argv.slice(2);await new Promise(resolve=>setTimeout(resolve,400));await writeFile(join(profile,'SingletonLock'),'Generated grandchild lock',{flag:'wx'});await writeFile(join(profile,'grandchild-ready.json'),JSON.stringify({pid:process.pid}));
const hold=setInterval(()=>{},20);process.on('message',async message=>{if(message==='finish'){await unlink(join(profile,'SingletonLock'));clearInterval(hold);process.exit(0);}});
const watch=setInterval(async()=>{try{await import('node:fs/promises').then(value=>value.stat(join(profile,'finish-grandchild')));await unlink(join(profile,'SingletonLock')).catch(()=>undefined);clearInterval(hold);clearInterval(watch);process.exit(0);}catch{}},20);`;
const handoffStub = `import {spawn} from 'node:child_process';import {join} from 'node:path';import {writeFile} from 'node:fs/promises';
const profile=process.argv.slice(2).find(arg=>arg.startsWith('--user-data-dir='))?.slice(16);const child=spawn(process.execPath,[join(profile,'..','grandchild.mjs'),profile],{stdio:'ignore',detached:true});child.unref();await writeFile(join(profile,'handoff-pid.json'),JSON.stringify({pid:child.pid}));process.exit(0);`;
async function stopGeneratedGrandchild(profile: string) {
  await writeFile(
    join(profile, 'finish-grandchild'),
    'Generated window close',
  ).catch(() => undefined);
  try {
    const value = JSON.parse(
      await readFile(join(profile, 'handoff-pid.json'), 'utf8'),
    ) as { pid: number };
    await expect
      .poll(
        () => {
          try {
            process.kill(value.pid, 0);
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 10000 },
      )
      .toBe(false);
  } catch (error) {
    if (!(
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ))
      throw error;
  }
}

// This test intentionally crosses two native process startups and a delayed lock.
test('fast-exiting browser stub hands off to a lock-holding grandchild and setup never completes before that observed lock releases', async () => {
  const f = await fixture(handoffStub);
  let running: Promise<number> | undefined;
  try {
    await writeFile(join(f.directory, 'grandchild.mjs'), grandchildStub);
    let done = false;
    running = f.run();
    void running.then(() => {
      done = true;
    });
    await expect.poll(() => f.child?.exitCode, { timeout: 10000 }).toBe(0);
    expect(done).toBe(false);
    const options = f.spawn.mock.calls[0]?.[2] as childProcess.SpawnOptions;
    expect(options.detached).toBe(process.platform === 'win32');
    await expect
      .poll(async () => profileModule.profileInUse(f.profile), {
        timeout: 10000,
      })
      .toBe(true);
    await expect
      .poll(() => f.stderr.join(''), { timeout: 10000 })
      .toContain('profile is active');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(done).toBe(false);
    expect(f.stderr.join('')).toContain(
      'Waiting for the dedicated browser profile',
    );
    await writeFile(
      join(f.profile, 'finish-grandchild'),
      'Generated close confirmation',
    );
    expect(await running, f.stderr.join('')).toBe(0);
    expect(await profileModule.profileInUse(f.profile)).toBe(false);
  } finally {
    await f.close();
    await running;
  }
}, 30000);

// The two-second native startup delay is the regression input, so allow IPC and teardown too.
test('setup waits through a two-second child startup before the first profile lock appears', async () => {
  const delayed = stub.replace(
    "await writeFile(join(profile,'SingletonLock')",
    "await new Promise(resolve=>setTimeout(resolve,2000));await writeFile(join(profile,'SingletonLock')",
  );
  const f = await fixture(delayed);
  let running: Promise<number> | undefined;
  try {
    let done = false;
    running = f.run();
    void running.then(() => {
      done = true;
    });
    await expect
      .poll(() => f.child?.pid, { timeout: 10000 })
      .toBeTypeOf('number');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(done).toBe(false);
    await f.ready();
    expect(done).toBe(false);
    await f.released();
    await f.exit();
    expect(await running, f.stderr.join('')).toBe(0);
  } finally {
    await f.close();
    await running;
  }
}, 30000);

test('an exited launcher without any observed lock fails at the first-lock deadline, never reports a completed window', async () => {
  const f = await fixture('process.exit(0);');
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
      {
        pollMs: 10,
        releaseTimeoutMs: 100,
        appearanceTimeoutMs: 100,
      },
    );
    const result = running.then(
      () => null,
      (error) => error as unknown,
    );
    expect(await result).toMatchObject({ code: 'PROFILE_INVALID' });
    expect(f.stderr.join('')).toContain('never became active');
  } finally {
    await f.close();
    await running?.catch(() => undefined);
  }
});

// Waits for a real launcher to exit before sending the person's Enter confirmation.
test('the explicit Enter confirmation can finish a fast launcher after window closure even if a short-lived lock was never sampled', async () => {
  const f = await fixture('process.exit(0);');
  let running: Promise<number> | undefined;
  try {
    let done = false;
    running = f.run();
    void running.then(() => {
      done = true;
    });
    await expect.poll(() => f.child?.exitCode, { timeout: 10000 }).toBe(0);
    expect(done).toBe(false);
    f.input.write('\n');
    expect(await running, f.stderr.join('')).toBe(0);
  } finally {
    await f.close();
    await running;
  }
}, 30000);

test('profile snapshot records only sorted extension ID directory names, not manifest paths or contents', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-extension-set-'));
  try {
    for (const id of ['b'.repeat(32), 'a'.repeat(32)]) {
      await mkdir(join(directory, 'Default', 'Extensions', id, '1.0'), {
        recursive: true,
      });
      await writeFile(
        join(directory, 'Default', 'Extensions', id, '1.0', 'manifest.json'),
        'Generated forbidden manifest contents',
      );
    }
    const snapshot = await profileModule.profileSnapshot(directory);
    expect(Reflect.get(snapshot, 'extensionIds')).toEqual([
      'a'.repeat(32),
      'b'.repeat(32),
    ]);
    expect(
      [...snapshot.files.keys()].some((path) => path.includes('/Extensions/')),
    ).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('extension-set equality rejects a replacement ID even at the same count and never reads the extension tree', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'socialprune-extension-change-'),
  );
  try {
    const first = join(directory, 'Default', 'Extensions', 'a'.repeat(32));
    await mkdir(first, { recursive: true });
    const before = await profileModule.profileSnapshot(directory);
    await rm(first, { recursive: true });
    await mkdir(join(directory, 'Default', 'Extensions', 'b'.repeat(32)), {
      recursive: true,
    });
    const after = await profileModule.profileSnapshot(directory);
    expect(before.extensions).toBe(after.extensions);
    expect(profileModule.extensionsChanged(before, after)).toBe(true);
    expect(
      profileModule.extensionsChanged(before, {
        ...before,
        extensionIds: [...before.extensionIds],
      }),
    ).toBe(false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

// Real parent/child lifetime on Windows is the point; the default five seconds
// cannot bound two startups, heartbeat observation, exit and process teardown.
test('a detached generated window survives the actual setup CLI process ending on Windows', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-setup-job-')),
    profile = join(directory, 'profile');
  await profileModule.createProfile(profile);
  const browser = join(directory, 'window.mjs'),
    cli = join(directory, 'cli.mjs');
  await writeFile(
    browser,
    `import {writeFile,stat,unlink} from 'node:fs/promises';import {join} from 'node:path';const profile=process.argv.slice(2).find(value=>value.startsWith('--user-data-dir='))?.slice(16);await writeFile(join(profile,'window-pid.json'),JSON.stringify({pid:process.pid}));await writeFile(join(profile,'SingletonLock'),'Generated window owns lock');let count=0;for(;;){await writeFile(join(profile,'heartbeat-'+(++count)), '', {flag:'wx'});try{await stat(join(profile,'close-window'));await unlink(join(profile,'SingletonLock'));process.exit(0);}catch{}await new Promise(resolve=>setTimeout(resolve,20));}`,
  );
  await writeFile(
    cli,
    `import cp from 'node:child_process';import {syncBuiltinESMExports}from'node:module';import {readdir,writeFile}from'node:fs/promises';import {join}from'node:path';const real=cp.spawn;cp.spawn=(command,args,options)=>{const child=real(command,[${JSON.stringify(browser)},...args],options);void writeFile(join(profile,'spawned-window-pid.json'),JSON.stringify({pid:child.pid}));return child;};syncBuiltinESMExports();const {ordinarySetup}=await import(${JSON.stringify(pathToFileURL(fileURLToPath(new URL('./setup.ts', import.meta.url))).href)});const profile=${JSON.stringify(profile)},controller=new AbortController();const timer=setInterval(async()=>{try{if((await readdir(profile)).some(name=>/^heartbeat-[0-9]+$/.test(name)))controller.abort();}catch{}},20);try{await ordinarySetup({profile,executablePath:process.execPath,signal:controller.signal,notice:()=>{}},{pollMs:10,releaseTimeoutMs:100,appearanceTimeoutMs:60000});}catch(error){if(error.code!=='CANCELLED')throw error;}clearInterval(timer);await writeFile(join(profile,'cli-ended'),'Generated CLI cancellation');process.exit(0);`,
  );
  const parent = realSpawn(process.execPath, [cli], { stdio: 'ignore' });
  const parentClosed = new Promise<void>((resolve) =>
    parent.once('close', () => resolve()),
  );
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= (async () => {
      try {
        await writeFile(join(profile, 'close-window'), 'Generated teardown');
        if (parent.exitCode === null && parent.signalCode === null)
          parent.kill();
        await parentClosed;
        const record = await readFile(
          join(profile, 'window-pid.json'),
          'utf8',
        ).catch(() =>
          readFile(join(profile, 'spawned-window-pid.json'), 'utf8').catch(
            () => null,
          ),
        );
        if (record) {
          const pid = (JSON.parse(record) as { pid: number }).pid;
          await expect
            .poll(
              () => {
                try {
                  process.kill(pid, 0);
                  return true;
                } catch {
                  return false;
                }
              },
              { timeout: 10000 },
            )
            .toBe(false);
        }
      } finally {
        await rm(directory, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 100,
        });
        cleanups.delete(close);
      }
    })();
    return closing;
  };
  cleanups.add(close);
  try {
    await parentClosed;
    expect(parent.exitCode).toBe(0);
    expect(await readFile(join(profile, 'cli-ended'), 'utf8')).toBe(
      'Generated CLI cancellation',
    );
    // Append-only empty files are an observable heartbeat without partial JSON
    // reads or Windows replacement conflicts with a reader's file handle.
    const heartbeats = async () =>
      (await readdir(profile)).filter((name) => /^heartbeat-[0-9]+$/.test(name))
        .length;
    const prior = await heartbeats();
    expect(prior).toBeGreaterThan(0);
    await expect.poll(heartbeats, { timeout: 10000 }).toBeGreaterThan(prior);
    expect(await profileModule.profileInUse(profile)).toBe(true);
    await writeFile(join(profile, 'close-window'), 'Generated window close');
    await expect
      .poll(() => profileModule.profileInUse(profile), { timeout: 10000 })
      .toBe(false);
  } finally {
    await close();
  }
}, 30000);

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
  expect(options.ignoreDefaultArgs).toEqual(['--disable-infobars']);
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
    expect(options.ignoreDefaultArgs).toEqual(['--disable-infobars']);
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

test('a preinstalled generated extension set reaches the disabled-extension driver and is persisted in its CLI profile report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-preinstalled-')),
    profile = join(directory, 'profile'),
    id = 'a'.repeat(32),
    notices: string[] = [];
  await profileModule.createProfile(profile);
  await mkdir(join(profile, 'Default', 'Extensions', id, '1.0'), {
    recursive: true,
  });
  await writeFile(
    join(profile, 'Default', 'Extensions', id, '1.0', 'manifest.json'),
    'Generated forbidden manifest contents',
  );
  const store = await SQLiteStore.open(join(directory, 'socialprune.sqlite'), {
    initial: fixtureWorkspace(['1005']),
  });
  const plan = await planDeletion(store, FIXTURE.account.key);
  let called = false;
  try {
    const result = await runWithDependencies(
      {
        store,
        plan,
        profile,
        executablePath: 'generated-not-used',
        verify: false,
        list: 'generated-list',
        lang: 'en',
        signal: new AbortController().signal,
        now: () => new Date(FIXTURE.now),
        notice: (text) => notices.push(text),
      },
      {
        pace: { intervalMs: 1, batchSize: 1, pauseMs: 1, perDay: 1 },
        confirmationPort: 0,
        sleep: () => Promise.resolve(),
        driver: async () => {
          await Promise.resolve();
          called = true;
          const driver: BrowserDriver = {
            async showConfirmation(url) {
              const target = new URL(url),
                origin = target.origin,
                token = new URLSearchParams(target.hash.slice(1)).get(
                  'bootstrap',
                )!;
              const response = await fetch(origin + '/session', {
                method: 'POST',
                headers: {
                  Origin: origin,
                  'Content-Type': 'application/json',
                  'X-SocialPrune-Bootstrap': token,
                },
                body: '{}',
              });
              const data = (await response.json()) as { csrf: string };
              const answer = await fetch(origin + '/api/action', {
                method: 'POST',
                headers: {
                  Origin: origin,
                  'Content-Type': 'application/json',
                  'X-SocialPrune-CSRF': data.csrf,
                  Cookie: response.headers.get('set-cookie')!.split(';')[0]!,
                },
                body: JSON.stringify({ action: 'start', version: 1 }),
              });
              expect(answer.status).toBe(200);
            },
            account: () => Promise.resolve(FIXTURE.account.handle),
            inspect: () => {
              throw new Error('Unexpected page');
            },
            delete: () => {
              throw new Error('Unexpected deletion');
            },
            flush: () => Promise.resolve(),
            close: () => Promise.resolve(),
          };
          return driver;
        },
      },
    );
    expect(called).toBe(true);
    expect(result).toMatchObject({ completed: 0, endReason: 'done' });
    const report = JSON.parse(
      await readFile(
        join(profile, `socialprune-readback-${result.runId}.json`),
        'utf8',
      ),
    ) as {
      extensionIdsBefore: string[];
      extensionIdsAfter: string[];
      extensionsDisabled: boolean;
    };
    expect(report).toMatchObject({
      extensionIdsBefore: [id],
      extensionIdsAfter: [id],
      extensionsDisabled: true,
    });
    expect(notices.join('')).toContain('Extensions disabled for this run.');
    expect(
      await readFile(
        join(profile, 'Default', 'Extensions', id, '1.0', 'manifest.json'),
        'utf8',
      ),
    ).toBe('Generated forbidden manifest contents');
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

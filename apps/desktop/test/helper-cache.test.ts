import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  mkdtemp,
  readFile,
  readdir,
  writeFile,
  rm,
  mkdir,
  open,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import { expect, test, vi } from 'vitest';
import { cachedHelper } from '../packaging/helper-cache.ts';
import { cleanStaleHelperScratch } from '../packaging/helper-scratch.ts';
import { WINDOWS_QUERY_TIMEOUT_MS } from '../packaging/windows-powershell.ts';

const faults = vi.hoisted(() => ({
  open: undefined as undefined | ((path: unknown, flags: unknown) => void),
  mkdir: undefined as undefined | (() => void),
}));
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return {
    ...actual,
    mkdir: (...args: Parameters<typeof actual.mkdir>) => {
      faults.mkdir?.();
      return actual.mkdir(...args);
    },
    open: (...args: Parameters<typeof actual.open>) => {
      faults.open?.(args[0], args[1]);
      return actual.open(...args);
    },
  };
});

test.each(['EPERM', 'EACCES', 'EBUSY'])(
  'transient %s on the lock waits then acquires without stealing it',
  async (code) => {
    const root = await mkdtemp(join(tmpdir(), 'sp-cache-unit-'));
    let attempts = 0;
    let calls = 0;
    const times: number[] = [];
    faults.open = (path, flags) => {
      if (String(path).endsWith('.lock') && flags === 'wx') {
        times.push(Date.now());
        if (++attempts <= 3)
          throw Object.assign(new Error('injected lock sharing'), { code });
      }
    };
    try {
      const result = await cachedHelper('sharing', {
        cacheDirectory: root,
        compiler: async (_source, output) => {
          calls++;
          await writeFile(output, 'MZgenerated');
        },
      });
      expect(attempts).toBe(4);
      expect(times.at(-1)! - times[0]!).toBeGreaterThanOrEqual(60);
      expect(calls).toBe(1);
      expect(await readFile(result, 'utf8')).toBe('MZgenerated');
      expect(
        (await readdir(root)).filter((name) => name.endsWith('.lock')),
      ).toEqual([]);
    } finally {
      faults.open = undefined;
      await rm(root, { recursive: true, force: true });
    }
  },
);

test.each(['EPERM', 'EBUSY', 'EEXIST'])(
  'persistent %s on the lock reaches the existing deadline without deleting another owner',
  async (code) => {
    const root = await mkdtemp(join(tmpdir(), 'sp-cache-unit-'));
    let attempts = 0;
    let lock: string | undefined;
    let compiled = false;
    const now = vi
      .spyOn(Date, 'now')
      .mockImplementation(() =>
        attempts < 2 ? 0 : WINDOWS_QUERY_TIMEOUT_MS * 2,
      );
    faults.open = (path, flags) => {
      if (String(path).endsWith('.lock') && flags === 'wx') {
        lock = String(path);
        attempts++;
        throw Object.assign(new Error('injected lock sharing'), { code });
      }
    };
    try {
      const result = cachedHelper('persistent', {
        cacheDirectory: root,
        compiler: () => {
          compiled = true;
          return Promise.resolve();
        },
      });
      await expect(result).rejects.toThrow(/^HELPER_CACHE_LOCK_TIMEOUT$/);
      expect(attempts).toBe(2);
      expect(compiled).toBe(false);
      // Injection owns no filesystem lock. A separate real owner stays intact.
      faults.open = undefined;
      const owner = await open(lock!, 'wx');
      try {
        await owner.writeFile('another-owner');
        attempts = 0;
        faults.open = (path) => {
          if (String(path) === lock) {
            attempts++;
            throw Object.assign(new Error('sharing'), { code });
          }
        };
        await expect(
          cachedHelper('persistent', { cacheDirectory: root }),
        ).rejects.toThrow(/^HELPER_CACHE_LOCK_TIMEOUT$/);
        expect(await readFile(lock!, 'utf8')).toBe('another-owner');
      } finally {
        await owner.close();
      }
    } finally {
      faults.open = undefined;
      now.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test.each(['probe', 'mkdir'])(
  'an unwritable cache root at %s fails immediately with a closed error before lock acquisition',
  async (stage) => {
    const root = await mkdtemp(join(tmpdir(), 'sp-cache-unit-'));
    let opened = 0;
    let denied = 0;
    let compiled = false;
    const deny = () => {
      denied++;
      throw Object.assign(new Error('private permission detail'), {
        code: 'EACCES',
      });
    };
    if (stage === 'mkdir') faults.mkdir = deny;
    faults.open = () => {
      opened++;
      deny();
    };
    try {
      await expect(
        cachedHelper('denied', {
          cacheDirectory: root,
          compiler: () => {
            compiled = true;
            return Promise.resolve();
          },
        }),
      ).rejects.toThrow(/^HELPER_CACHE_ROOT_NOT_WRITABLE$/);
      expect(opened).toBe(stage === 'probe' ? 1 : 0);
      expect(denied).toBe(1);
      expect(compiled).toBe(false);
      expect(await readdir(root)).toEqual([]);
    } finally {
      faults.open = undefined;
      faults.mkdir = undefined;
      await rm(root, { recursive: true, force: true });
    }
  },
);

test('miss publishes once; hit retains the identical file; source and compiler options have distinct keys', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-cache-unit-'));
  let calls = 0;
  const compiler = async (source: string, output: string) => {
    calls++;
    await writeFile(output, 'MZ' + source);
  };
  try {
    const config = { cacheDirectory: root, compiler };
    const first = await cachedHelper('source-one', config);
    expect(calls).toBe(1);
    expect(await cachedHelper('source-one', config)).toBe(first);
    expect(calls).toBe(1);
    expect(await readFile(first, 'utf8')).toBe('MZsource-one');
    expect(await cachedHelper('source-two', config)).not.toBe(first);
    expect(
      await cachedHelper('source-one', {
        ...config,
        compilerOptions: ['changed'],
      }),
    ).not.toBe(first);
    expect(calls).toBe(3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('corrupt or missing digest and a modified executable recompile instead of executing unchecked bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-cache-unit-'));
  let calls = 0;
  const compiler = async (_source: string, output: string) => {
    calls++;
    await writeFile(output, 'MZgenerated');
  };
  try {
    const config = { cacheDirectory: root, compiler };
    const first = await cachedHelper('source', config);
    const digest = join(first, '..', 'sha256');
    await writeFile(digest, 'corrupt');
    await cachedHelper('source', config);
    expect(calls).toBe(2);
    await rm(digest);
    await cachedHelper('source', config);
    expect(calls).toBe(3);
    await writeFile(first, 'MZtampered');
    await cachedHelper('source', config);
    expect(calls).toBe(4);
    expect(await readFile(first, 'utf8')).toBe('MZgenerated');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('concurrent first uses wait for one atomic publication and failed compiles leave no published executable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-cache-unit-'));
  let calls = 0;
  const compiler = async (_source: string, output: string) => {
    calls++;
    await wait(50);
    await writeFile(output, 'MZgenerated');
  };
  try {
    const outputs = await Promise.all(
      Array.from({ length: 8 }, () =>
        cachedHelper('source', { cacheDirectory: root, compiler }),
      ),
    );
    expect(new Set(outputs).size).toBe(1);
    expect(calls).toBe(1);
    await expect(
      cachedHelper('broken', {
        cacheDirectory: root,
        compiler: () => Promise.reject(new Error('fake failure')),
      }),
    ).rejects.toThrow('fake failure');
    expect(
      (await readdir(root)).filter((name) => name.endsWith('.lock')),
    ).toEqual([]);
    expect(
      (await readdir(root)).filter((name) => /^[a-f0-9]{64}$/.test(name)),
    ).toHaveLength(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('separate Node processes compile a cold key exactly once using the injected fake compiler', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-cache-unit-'));
  try {
    const entry = join(root, 'child.mjs');
    await writeFile(
      entry,
      `import {cachedHelper} from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, '../packaging/helper-cache.ts')).href)};
import {appendFile,writeFile} from 'node:fs/promises';
await cachedHelper('shared-source',{cacheDirectory:${JSON.stringify(join(root, 'cache'))},compiler:async(s,p)=>{await appendFile(${JSON.stringify(join(root, 'calls'))},'compile\\n');await new Promise(r=>setTimeout(r,100));await writeFile(p,'MZfake');}});`,
    );
    const children = [0, 1].map(() =>
      spawn(process.execPath, [entry], { stdio: 'pipe', windowsHide: true }),
    );
    const results = await Promise.all(
      children.map(async (child) => {
        let errors = '';
        child.stdout.resume();
        child.stderr.on('data', (bytes: Buffer) => {
          errors += bytes.toString();
        });
        const [code] = (await once(child, 'close')) as [number | null];
        expect(errors).not.toContain('Error');
        expect(code).toBe(0);
      }),
    );
    expect(results).toHaveLength(2);
    expect(await readFile(join(root, 'calls'), 'utf8')).toBe('compile\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('next start removes only older dead owned scratch and keeps cache, active, new and foreign folders', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-cache-unit-'));
  try {
    const marker = 'socialprune-helper-run-';
    for (const [name, pid, started, kind] of [
      [marker + 'old', 2147483647, 1, marker],
      [marker + 'active', process.pid, 1, marker],
      [marker + 'new', 2147483647, 100, marker],
      [marker + 'foreign', 2147483647, 1, 'other'],
      ['socialprune-test-helpers', 2147483647, 1, marker],
    ] as const) {
      await mkdir(join(root, name));
      await writeFile(
        join(root, name, 'owner.json'),
        JSON.stringify({ kind, pid, started }),
      );
    }
    cleanStaleHelperScratch(root, 50);
    expect((await readdir(root)).sort()).toEqual(
      [
        marker + 'active',
        marker + 'foreign',
        marker + 'new',
        'socialprune-test-helpers',
      ].sort(),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('normal process exit removes its scratch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sp-cache-unit-'));
  try {
    const entry = join(root, 'exit.mjs');
    await writeFile(
      entry,
      `import {createHelperScratch} from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, '../packaging/helper-scratch.ts')).href)};console.log(await createHelperScratch('exit-test'));`,
    );
    const child = spawn(process.execPath, [entry], {
      stdio: 'pipe',
      windowsHide: true,
    });
    let text = '';
    child.stdout.on('data', (bytes: Buffer) => {
      text += bytes.toString();
    });
    child.stderr.resume();
    expect((await once(child, 'close'))[0]).toBe(0);
    await expect(
      readFile(join(text.trim(), 'owner.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import {
  mkdtemp,
  readFile,
  readdir,
  writeFile,
  rm,
  mkdir,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import { expect, test } from 'vitest';
import { cachedHelper } from '../packaging/helper-cache.ts';
import { cleanStaleHelperScratch } from '../packaging/helper-scratch.ts';

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

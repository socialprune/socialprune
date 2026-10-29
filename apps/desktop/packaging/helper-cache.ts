import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import {
  runPowerShell,
  WINDOWS_QUERY_TIMEOUT_MS,
} from './windows-powershell.ts';
import { createHelperScratch, prepareHelperScratch } from './helper-scratch.ts';

const hash = (bytes: string | Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
const options = [
  'WindowsPowerShell-5.1',
  'Add-Type',
  'ConsoleApplication',
  'default-references',
] as const;
export const helperCacheDirectory = join(tmpdir(), 'socialprune-test-helpers');

export interface HelperCompiler {
  (source: string, output: string): Promise<void>;
}

async function compile(source: string, output: string) {
  const input = output + '.cs';
  await writeFile(input, source);
  const quote = (value: string) => value.replaceAll("'", "''");
  await runPowerShell(
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Add-Type -Path '${quote(input)}' -OutputAssembly '${quote(output)}' -OutputType ConsoleApplication`,
    ],
    {
      timeout: WINDOWS_QUERY_TIMEOUT_MS,
      windowsHide: true,
      queryClass: 'test-helper-compile',
    },
  );
}

// Harness-only. Neither this module nor its mutable cache enters an app bundle.
export async function cachedHelper(
  source: string,
  configuration: {
    compiler?: HelperCompiler;
    cacheDirectory?: string;
    compilerOptions?: readonly string[];
  } = {},
): Promise<string> {
  prepareHelperScratch();
  const root = configuration.cacheDirectory ?? helperCacheDirectory;
  const key = hash(
    JSON.stringify([source, configuration.compilerOptions ?? options]),
  );
  await mkdir(root, { recursive: true });
  if ((await lstat(root)).isSymbolicLink())
    throw new Error('HELPER_CACHE_LINK');
  const target = join(root, key);
  const output = join(target, 'helper.exe');
  async function valid() {
    try {
      for (const file of [target, output, join(target, 'sha256')])
        if ((await lstat(file)).isSymbolicLink()) return false;
      const digest = await readFile(join(target, 'sha256'), 'utf8');
      const bytes = await readFile(output);
      return (
        /^[a-f0-9]{64}$/.test(digest) &&
        bytes.subarray(0, 2).toString() === 'MZ' &&
        hash(bytes) === digest
      );
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return false;
      throw error;
    }
  }
  // Exclusive ownership serializes misses across workers/processes. Never
  // steal a lock on an elapsed-time or PID guess: that could race a new owner.
  // An interrupted compile fails closed until its lock is inspected/removed.
  const lock = join(root, key + '.lock');
  const deadline = Date.now() + WINDOWS_QUERY_TIMEOUT_MS * 2;
  let handle: Awaited<ReturnType<typeof open>>;
  for (;;) {
    try {
      handle = await open(lock, 'wx');
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, token: randomUUID() }),
      );
      break;
    } catch (error) {
      if (!(
        error instanceof Error &&
        'code' in error &&
        error.code === 'EEXIST'
      ))
        throw error;
      if (Date.now() >= deadline) throw new Error('HELPER_CACHE_LOCK_TIMEOUT');
      await wait(25);
    }
  }
  let scratch: string | undefined;
  try {
    if (await valid()) return output;
    scratch = createHelperScratch('compile');
    const staging = join(scratch, 'entry');
    await mkdir(staging);
    const temporary = join(staging, 'helper.exe');
    await (configuration.compiler ?? compile)(source, temporary);
    const bytes = await readFile(temporary);
    if (bytes.subarray(0, 2).toString() !== 'MZ')
      throw new Error('HELPER_BUILD_INVALID');
    await writeFile(join(staging, 'sha256'), hash(bytes));
    // Keep the exact compiled file. Recompiling identical C# is not binary
    // reproducible with the Framework compiler and would trigger another hash.
    await rm(target, { recursive: true, force: true });
    await rm(join(staging, 'helper.exe.cs'), { force: true });
    await rename(staging, target);
    if (!(await valid())) throw new Error('HELPER_CACHE_PUBLISH_INVALID');
    if (!configuration.compiler) {
      const receipt = {
        version: 1,
        key,
        executableSha256: hash(bytes),
        pid: process.pid,
      };
      const receipts = join(root, 'receipts');
      await mkdir(receipts, { recursive: true });
      await writeFile(
        join(receipts, randomUUID() + '.json'),
        JSON.stringify(receipt),
      );
      process.stdout.write(
        'HELPER_CACHE_MISS ' + JSON.stringify(receipt) + '\n',
      );
    }
    return output;
  } finally {
    if (scratch) await rm(scratch, { recursive: true, force: true });
    await handle.close();
    await rm(lock, { force: true });
  }
}

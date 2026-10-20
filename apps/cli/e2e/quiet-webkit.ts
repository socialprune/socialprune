import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';

/** Native window isolation for tests, never a production browser launcher. */
export async function quietWebKit(endpoint?: string) {
  // eslint-disable-next-line no-restricted-properties -- Test-runner pause boundary.
  const stopFile = process.env['SP_TEST_STOP_FILE'];
  const checkStop = () => {
    if (stopFile && existsSync(stopFile)) throw new Error('Test run paused');
  };
  checkStop();
  const directory = await mkdtemp(join(tmpdir(), 'sp-test-desktop-'));
  if (endpoint) {
    const url = new URL(endpoint);
    await writeFile(
      join(directory, 'options.json'),
      JSON.stringify({ port: Number(url.port), wsPath: url.pathname.slice(1) }),
    );
  }
  checkStop();
  const child = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      fileURLToPath(new URL('./quiet-desktop.ps1', import.meta.url)),
      '-Node',
      process.execPath,
      '-Entry',
      fileURLToPath(new URL('./quiet-webkit-entry.ts', import.meta.url)),
      '-Directory',
      directory,
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let output = '',
    ended = false;
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => {
      ended = true;
      resolve(code);
    });
  });
  child.stdout.on('data', (part: Buffer) => {
    output += part.toString();
  });
  child.stderr.on('data', (part: Buffer) => {
    output += part.toString();
  });
  const wait = async (ready: () => boolean, timeout: number) => {
    const deadline = performance.now() + timeout;
    while (!ready()) {
      if (performance.now() >= deadline)
        throw new Error(`Quiet WebKit lifecycle timed out: ${output}`);
      await setTimeout(50);
    }
  };
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      await writeFile(join(directory, 'stop'), '');
      await wait(() => ended, 15000);
      if ((await closed) !== 0)
        throw new Error(`Quiet WebKit failed: ${output}`);
      await rm(directory, { recursive: true, force: true });
    })());
  try {
    await wait(() => existsSync(join(directory, 'ready.json')) || ended, 30000);
    if (ended) throw new Error(`Quiet WebKit failed: ${output}`);
    const ready = JSON.parse(
      await readFile(join(directory, 'ready.json'), 'utf8'),
    ) as { endpoint: string };
    if (endpoint && ready.endpoint !== endpoint)
      throw new Error('Quiet WebKit endpoint did not match the probe config');
    return { endpoint: ready.endpoint, close };
  } catch (error) {
    await close();
    throw error;
  }
}

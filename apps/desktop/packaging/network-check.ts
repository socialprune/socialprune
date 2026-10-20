import { spawnPowerShell } from './windows-powershell.ts';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { z } from 'zod';
import { directory } from './paths.ts';
import { pathExists } from './file-presence.ts';
import {
  WATCH_READY_TIMEOUT_MS,
  POWERSHELL_READY_TIMEOUT_MS,
} from './query-poll.ts';

const NetworkSchema = z.strictObject({
  ticks: z.number().int().nonnegative(),
  observed: z.array(z.string()),
  violations: z.array(z.string()),
});
export type NetworkObservation = z.infer<typeof NetworkSchema>;
export function assertNoOwnedNetwork(observation: NetworkObservation): void {
  NetworkSchema.parse(observation);
  if (!observation.ticks) throw new Error('NETWORK_OBSERVATION_MISSING');
  if (observation.violations.length)
    throw new Error(`OWNED_NETWORK:${observation.violations.join(',')}`);
}

export async function watchNetwork(
  install: string,
  output: string,
  roots = [process.pid],
) {
  if (roots.some((pid) => !Number.isSafeInteger(pid) || pid < 1))
    throw new Error('NETWORK_ROOT_PID_INVALID');
  for (const suffix of ['', '.ready', '.stop'])
    await rm(output + suffix, { force: true });
  const child = spawnPowerShell(
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      join(directory, 'packaging/network-watch.ps1'),
      '-InstallRoot',
      install,
      '-Output',
      output,
      '-RootIds',
      roots.join(','),
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  let errors = '';
  child.stdout.resume();
  child.stderr.on('data', (bytes: Buffer) => {
    errors += bytes.toString();
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  try {
    // Native table watch: use 3x runner predecessor max + 50 ms interval.
    const deadline = Date.now() + POWERSHELL_READY_TIMEOUT_MS;
    while (Date.now() < deadline && child.exitCode === null) {
      if (await pathExists(output + '.ready')) break;
      await wait(50);
    }
    if (!(await pathExists(output + '.ready')))
      throw new Error(`NETWORK_WATCH_NOT_READY:${errors}`);
  } catch (error) {
    child.kill();
    await exited;
    throw error;
  }
  let stopped = false;
  return {
    async stop(): Promise<NetworkObservation> {
      if (stopped)
        return NetworkSchema.parse(JSON.parse(await readFile(output, 'utf8')));
      stopped = true;
      await writeFile(output + '.stop', 'stop');
      const code = await Promise.race([
        exited,
        wait(WATCH_READY_TIMEOUT_MS, undefined, { ref: false }).then(
          () => 'timeout',
        ),
      ]);
      if (code !== 0) {
        if (code === 'timeout') {
          child.kill();
          await exited;
        }
        throw new Error(`NETWORK_WATCH_FAILED:${code}:${errors}`);
      }
      return NetworkSchema.parse(JSON.parse(await readFile(output, 'utf8')));
    },
  };
}

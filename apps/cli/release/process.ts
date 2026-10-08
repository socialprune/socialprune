import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../../', import.meta.url));
export const packageDirectory = resolve(root, 'apps/cli/dist/package');

/** Resolve npm from this Node distribution, never from a registry or a config. */
export function shippedNpm(): string {
  const directory = dirname(process.execPath);
  const paths = [
    resolve(directory, 'node_modules/npm/bin/npm-cli.js'),
    resolve(directory, '../lib/node_modules/npm/bin/npm-cli.js'),
  ];
  const path = paths.find((value) => existsSync(value));
  if (!path)
    throw new Error('The running Node distribution has no bundled npm.');
  return path;
}

export function command(
  executable: string,
  args: string[],
  cwd: string,
  expected = 0,
): string {
  const result = spawnSync(executable, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    timeout: 120_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== expected)
    throw new Error(
      `Command failed (${result.status ?? result.error?.name}): ${args[0]}\n${result.stderr.toString()}`,
    );
  return result.stdout.toString('utf8');
}

export function npm(args: string[], cwd: string): string {
  // Missing, uniquely named config paths prevent npm from reading user/global
  // credential files. These commands never access a registry write endpoint.
  const prefix = resolve(tmpdir(), `socialprune-no-config-${process.pid}`);
  return command(
    process.execPath,
    [
      shippedNpm(),
      `--userconfig=${prefix}-user`,
      `--globalconfig=${prefix}-global`,
      ...args,
    ],
    cwd,
  );
}

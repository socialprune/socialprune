import { spawnSync } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { checkLicenses, parseExceptions, parseInventory } from './index.ts';

export function readInventory(cwd: string): unknown {
  const pnpm = process.env.npm_execpath;
  const viaNode = pnpm && /pnpm\.(?:c?js|mjs)$/.test(pnpm);
  const result = spawnSync(
    viaNode ? process.execPath : 'pnpm',
    [...(viaNode ? [pnpm] : []), 'licenses', 'list', '--json'],
    {
      cwd,
      shell: !viaNode && process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 32 * 1024 * 1024,
      timeout: 60_000,
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0) {
    throw new Error('pnpm license inventory failed.');
  }
  return JSON.parse(result.stdout.toString('utf8')) as unknown;
}

export async function runLicenses(cwd = process.cwd()): Promise<0 | 1 | 2> {
  try {
    const root = await realpath(cwd);
    const exceptions = parseExceptions(
      JSON.parse(
        await readFile(
          resolve(root, 'tools/licenses-check/exceptions.json'),
          'utf8',
        ),
      ) as unknown,
    );
    for (const exception of exceptions) {
      const path = resolve(root, exception.adr);
      const resolved = await realpath(path);
      const segment = relative(root, resolved);
      if (
        isAbsolute(segment) ||
        segment.split(/[\\/]/).includes('..') ||
        resolved !== path
      ) {
        throw new Error('Exception ADR must resolve inside the repository.');
      }
      await readFile(resolved, 'utf8');
    }
    const report = checkLicenses(
      parseInventory(readInventory(root)),
      exceptions,
    );
    for (const entry of report.failures) {
      console.error(
        `${entry.name}@${entry.version}: ${entry.license ?? '<missing>'}`,
      );
    }
    console.log(JSON.stringify(report, null, 2));
    return report.failures.length === 0 ? 0 : 1;
  } catch {
    console.error('License check: invalid inventory, exception file or ADR.');
    return 2;
  }
}

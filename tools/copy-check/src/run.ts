import { spawnSync } from 'node:child_process';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { copyKind, inspectCopy } from './index.ts';

function git(args: string[], cwd: string): string {
  const result = spawnSync('git', ['--no-pager', ...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
    timeout: 15_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error('Could not inventory copy paths.');
  }
  return result.stdout.toString('utf8');
}

export async function runCopy(cwd = process.cwd()): Promise<0 | 1 | 2> {
  try {
    const root = git(['rev-parse', '--show-toplevel'], cwd).trim();
    const paths = [
      ...new Set(
        git(
          ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
          root,
        )
          .split('\0')
          .filter((path) => path && copyKind(path) !== null),
      ),
    ].sort();
    let checked = 0;
    let violations = 0;
    for (const path of paths) {
      const disk = resolve(root, path);
      let stat;
      try {
        stat = await lstat(disk);
      } catch (error) {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          continue;
        }
        throw error;
      }
      const target = await realpath(disk);
      const segment = relative(root, target);
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        target !== disk ||
        isAbsolute(segment) ||
        segment.split(/[\\/]/).includes('..')
      ) {
        throw new Error('Copy paths must be regular repository files.');
      }
      checked++;
      const findings = inspectCopy(path, await readFile(disk, 'utf8'));
      violations += findings.length;
      for (const finding of findings) {
        console.error(
          `${finding.path}:${finding.line}:${finding.column}: ${finding.rule} ${JSON.stringify(finding.text)}`,
        );
      }
    }
    console.log(`Copy check: ${checked} files, ${violations} findings.`);
    return violations === 0 ? 0 : 1;
  } catch {
    console.error('Copy check: could not inventory or parse scoped copy.');
    return 2;
  }
}

import { spawnSync } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { inspectFile } from './index.ts';
import type { Violation } from './index.ts';

const usage = 'Usage: data-guard (--staged | --all | <file>...)';
const emptyBytes = new Uint8Array();

function git(args: string[], cwd: string): Buffer {
  const result = spawnSync('git', ['--no-pager', ...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error('Git could not read the repository index.');
  }
  return result.stdout;
}

function parseOptions(args: readonly string[]): {
  mode: 'staged' | 'all' | 'files' | 'help';
  files: string[];
} {
  if (args.length === 1 && args[0] === '--help') {
    return { mode: 'help', files: [] };
  }
  if (args.length === 1 && (args[0] === '--staged' || args[0] === '--all')) {
    return { mode: args[0] === '--staged' ? 'staged' : 'all', files: [] };
  }
  const files = args[0] === '--' ? args.slice(1) : args.slice();
  if (
    files.length === 0 ||
    files.some((path) => path.length === 0) ||
    (args[0] !== '--' && files.some((path) => path.startsWith('-')))
  ) {
    throw new Error(usage);
  }
  return { mode: 'files', files };
}

export async function runGuard(
  args: readonly string[],
  cwd = process.cwd(),
): Promise<0 | 1 | 2> {
  let options: ReturnType<typeof parseOptions>;
  try {
    options = parseOptions(args);
  } catch {
    console.error(usage);
    return 2;
  }
  if (options.mode === 'help') {
    console.log(usage);
    return 0;
  }

  try {
    const root = git(['rev-parse', '--show-toplevel'], cwd)
      .toString('utf8')
      .trim();
    const files =
      options.mode === 'files'
        ? options.files
        : git(
            options.mode === 'staged'
              ? ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']
              : ['ls-files', '-z'],
            root,
          )
            .toString('utf8')
            .split('\0')
            .filter(Boolean);
    const violations: Violation[] = [];

    for (const path of files) {
      let gitPath = path;
      let diskPath: string | undefined;
      if (options.mode === 'files') {
        if (path.replaceAll('\\', '/').split('/').includes('..')) {
          violations.push({ path, reason: 'parent path segment' });
          continue;
        }
        diskPath = resolve(cwd, path);
        gitPath = relative(root, diskPath).replaceAll('\\', '/');
        if (isAbsolute(gitPath) || gitPath.split('/').includes('..')) {
          throw new Error(
            'Explicit file paths must stay inside the repository.',
          );
        }
      }

      const pathViolations = inspectFile(gitPath, emptyBytes);
      if (pathViolations.length > 0) {
        violations.push(...pathViolations);
        continue;
      }
      if (gitPath.startsWith('fixtures/synthetic/')) continue;

      let content: Uint8Array;
      if (diskPath) {
        const resolved = await realpath(diskPath);
        const resolvedRelative = relative(root, resolved).replaceAll('\\', '/');
        if (
          isAbsolute(resolvedRelative) ||
          resolvedRelative.split('/').includes('..') ||
          resolved !== diskPath
        ) {
          throw new Error(
            'Explicit file paths must not follow symbolic links.',
          );
        }
        content = await readFile(diskPath);
      } else {
        content = git(['show', `:${gitPath}`], root);
      }
      violations.push(...inspectFile(gitPath, content));
    }

    for (const violation of violations) {
      console.error(`${JSON.stringify(violation.path)}: ${violation.reason}`);
    }
    if (violations.length > 0) {
      console.error(`Data guard: ${violations.length} violation(s).`);
      return 1;
    }
    console.log(`Data guard: ${files.length} file(s) checked, no violations.`);
    return 0;
  } catch {
    console.error(
      'Data guard: could not read the requested files or Git index.',
    );
    return 2;
  }
}

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// LL-2026-10-010: vitest runs test files in parallel, so a unit test that
// starts a server on a fixed port collides with another one. Unit tests and
// their helpers listen on port 0 and read the assigned port back. Playwright
// and the serial browser suites under e2e/ keep their assigned ports.
const root = resolve(import.meta.dirname, '../../..');
const fixedListen = /\.listen\(\s*[1-9][0-9]*/;
const skipped = new Set(['node_modules', 'dist', 'dist-review', 'e2e', '.git']);

async function unitTestFiles(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (skipped.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await unitTestFiles(path)));
    else if (
      /\.tsx?$/.test(entry.name) &&
      (entry.name.includes('.test.') || path.split(sep).includes('test'))
    )
      found.push(path);
  }
  return found;
}

describe('unit tests take a free port', () => {
  it('flags a fixed port and accepts port 0', () => {
    // Built from parts so this file's own lines do not match the scan below.
    const call = (argument: string) => `server.${'listen'}(${argument})`;
    expect(fixedListen.test(call("4236, '127.0.0.1', resolve"))).toBe(true);
    expect(fixedListen.test(call(' 8080 '))).toBe(true);
    expect(fixedListen.test(call("0, '127.0.0.1', resolve"))).toBe(false);
    expect(fixedListen.test(call('port, host'))).toBe(false);
  });
  it('finds no unit test or test helper that listens on a fixed port', async () => {
    const files = (
      await Promise.all(
        ['apps', 'packages', 'tools'].map((name) =>
          unitTestFiles(join(root, name)),
        ),
      )
    ).flat();
    expect(files.length).toBeGreaterThan(50);
    const offenders: string[] = [];
    for (const file of files) {
      const lines = (await readFile(file, 'utf8')).split('\n');
      lines.forEach((line, index) => {
        if (fixedListen.test(line))
          offenders.push(`${relative(root, file)}:${index + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

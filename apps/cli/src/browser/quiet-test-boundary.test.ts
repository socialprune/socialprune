import { readdir, readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';

async function productionFiles(directory: URL): Promise<URL[]> {
  const result: URL[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(
      entry.name + (entry.isDirectory() ? '/' : ''),
      directory,
    );
    if (entry.isDirectory()) {
      if (entry.name !== 'test') result.push(...(await productionFiles(path)));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'))
      result.push(path);
  }
  return result;
}
function assertProductionSource(source: string, path: string) {
  expect(source, path).not.toMatch(
    /quiet-desktop|quiet-webkit|quiet-review|context-diagnostics|SP_CONTEXT_DIAGNOSTICS|SP_TEST_STOP_FILE|SP_PROBE_QUIET_ENDPOINT|e2e\//,
  );
  expect(source, path).not.toMatch(/headless\s*:\s*(?:true|process\.)/);
}

test('C13 production sources cannot select test desktop, headless or timing overrides', async () => {
  const sources = await productionFiles(new URL('../', import.meta.url));
  expect(sources.length).toBeGreaterThan(0);
  for (const path of sources) {
    const source = await readFile(path, 'utf8');
    assertProductionSource(source, path.pathname);
  }
  for (const relative of [
    './launch.ts',
    './instagram/driver.ts',
    '../commands/browser.ts',
  ]) {
    const source = await readFile(new URL(relative, import.meta.url), 'utf8');
    expect(source).toMatch(/headless: false/);
    expect(source).not.toMatch(/process\.env/);
  }
});

test.each([
  "import { quietWebKit } from '../../e2e/quiet-webkit.ts';",
  "const diagnostics = process.env['SP_CONTEXT_DIAGNOSTICS'];",
  "const stop = process.env['SP_TEST_STOP_FILE'];",
  "const endpoint = process.env['SP_PROBE_QUIET_ENDPOINT'];",
  'const launch = { headless: true };',
  "const launch = { headless: process.env['GENERATED_OVERRIDE'] };",
])('C13 static boundary rejects planted production source %s', (source) => {
  expect(() =>
    assertProductionSource(source, 'generated-production.ts'),
  ).toThrow();
});

test('C13 the probe build is run-owned and has no workflow-folder output', async () => {
  const source = await readFile(
    new URL('../../../web/playwright.probe.config.ts', import.meta.url),
    'utf8',
  );
  expect(source).toContain("mkdtempSync(join(tmpdir(), 'socialprune-probe-'))");
  expect(source).toContain('rmSync(out, { recursive: true, force: true })');
  expect(source).not.toMatch(/phase2|probe-dist|'w0'/);
});

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { build } from 'vite';

const web = fileURLToPath(new URL('../', import.meta.url));

// W0 invariant 11 was written before the shell: exercise the actual workspace
// Vite override, not a standalone toolchain with Lightning CSS installed.
test('emits a real CSS Module into an external file under the workspace override', async () => {
  const output = await build({
    root: resolve(web, 'test/probes/css-module'),
    configFile: resolve(web, 'vite.config.ts'),
    logLevel: 'silent',
    build: { write: false },
  });
  const bundles = Array.isArray(output) ? output : [output];
  const assets = bundles.flatMap((bundle) =>
    'output' in bundle ? bundle.output : [],
  );
  const css = assets.filter(
    (asset) => asset.type === 'asset' && asset.fileName.endsWith('.css'),
  );
  expect(css).toHaveLength(1);
  const stylesheet = css[0];
  if (!stylesheet || stylesheet.type !== 'asset')
    throw new Error('Missing CSS asset.');
  expect(String(stylesheet.source)).toContain('var(--color-text)');
  expect(String(stylesheet.source)).toMatch(/\.[\w-]*sample[\w-]*/);
  expect(assets.some((asset) => asset.fileName.endsWith('.wasm'))).toBe(false);
  const workspace = await readFile(
    resolve(web, '../../pnpm-workspace.yaml'),
    'utf8',
  );
  expect(workspace).toMatch(/vite>lightningcss:\s*['"]-['"]/);
});

test('component modules keep raw color literals out of their styles', async () => {
  async function scan(folder: string): Promise<void> {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = resolve(folder, entry.name);
      if (entry.isDirectory()) await scan(path);
      else if (entry.name.endsWith('.module.css')) {
        expect(await readFile(path, 'utf8'), path).not.toMatch(
          /#[\da-f]{3,8}\b|\b(?:rgb|hsl)a?\(/i,
        );
      }
    }
  }
  await scan(resolve(web, 'src'));
});

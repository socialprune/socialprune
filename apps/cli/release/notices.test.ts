import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { bundledLicenses, renderNotices } from './notices.ts';
import { root } from './process.ts';

test('notices follow the bundled module inventory, preserve license text and refuse missing texts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'socialprune-notices-'));
  const owner = join(directory, 'node_modules/example');
  const module = join(owner, 'esm/module.js');
  try {
    await mkdir(join(owner, 'esm'), { recursive: true });
    await writeFile(
      join(owner, 'package.json'),
      JSON.stringify({ name: 'example', version: '1.0.0', license: 'MIT' }),
    );
    await writeFile(join(owner, 'esm/package.json'), '{"type":"module"}');
    await expect(bundledLicenses([module], root)).rejects.toThrow(
      'Missing license text',
    );
    const license = 'MIT license text, synthetic copyright holder';
    await writeFile(join(owner, 'LICENSE'), license);
    const packages = await bundledLicenses([module, module], root);
    expect(packages).toHaveLength(1);
    expect(packages[0]!.name).toBe('example');
    expect(renderNotices(packages)).toContain(license);
    await writeFile(
      join(owner, 'package.json'),
      JSON.stringify({ name: 'example', version: '1.0.0', license: 'GPL-3.0' }),
    );
    await expect(bundledLicenses([module], root)).rejects.toThrow(
      'unapproved license',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the exact Stricli 1.3.0 exception carries the reread tagged copyright and license', async () => {
  const entry = import.meta.resolve('@stricli/core');
  const packages = await bundledLicenses([fileURLToPath(entry)], root);
  expect(packages).toHaveLength(1);
  const text = renderNotices(packages);
  expect(text).toContain(
    'https://raw.githubusercontent.com/bloomberg/stricli/v1.3.0/LICENSE',
  );
  expect(text).toContain('Copyright 2024 Bloomberg Finance L.P.');
  expect(text).not.toContain('Copyright [yyyy]');
  expect(text).toContain(
    (await readFile(new URL('../../../LICENSE', import.meta.url), 'utf8'))
      .trim()
      .split('Copyright [yyyy]')[0]!
      .trim(),
  );
});

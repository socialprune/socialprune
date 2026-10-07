import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { variants as instagramVariants } from './instagram/index.ts';
import { checkFixtures, createRandom, writeVariants } from './index.ts';
import type { Variant } from './shared/index.ts';
import { variants as xVariants } from './x/index.ts';

const registry = { x: xVariants, instagram: instagramVariants };

test('registered platforms and every variant satisfy the fixture registry contract', async () => {
  const source = await readFile(new URL('./cli.ts', import.meta.url), 'utf8');
  const registered = /const generators = \{([^}]+)\};/.exec(source);
  expect(registered).not.toBeNull();
  const platforms = registered![1]!
    .split(',')
    .map((name) => name.trim())
    .sort();
  expect(platforms).toEqual(['instagram', 'x']);
  expect(Object.keys(registry).sort()).toEqual(platforms);
  for (const [platform, variants] of Object.entries(registry)) {
    expect(new Set(variants.map(({ id }) => id)).size).toBe(variants.length);
    for (const variant of variants) {
      expect(variant.platform, `${platform}/${variant.id}`).toBe(platform);
      expect(
        variant.archives.length,
        `${platform}/${variant.id}`,
      ).toBeGreaterThan(0);
      expect(variant.description.trim(), `${platform}/${variant.id}`).not.toBe(
        '',
      );
    }
  }
});

test('CLI check without a platform detects drift in both registered platform trees', async () => {
  const root = await mkdtemp(join(tmpdir(), 'socialprune-fixture-cli-check-'));
  const variants = Object.values(registry).flat();
  const cli = new URL('./cli.ts', import.meta.url).href;
  const load = new URL('./load.ts', import.meta.url).href;
  // Redirect only fixture storage in the child test process. The real CLI,
  // registry and check implementation run unchanged; repository fixtures stay
  // read-only and no testing switch enters a production entrypoint.
  const script = [
    "import { registerHooks } from 'node:module';",
    `const root = ${JSON.stringify(root)};`,
    `const loadUrl = ${JSON.stringify(load)};`,
    'registerHooks({ load(url, context, nextLoad) {',
    '  const result = nextLoad(url, context);',
    '  if (url === loadUrl) {',
    '    const source = typeof result.source === "string" ? result.source : new TextDecoder().decode(result.source);',
    '    const pattern = /^export const FIXTURES_ROOT = fileURLToPath\\([\\s\\S]*?\\);/m;',
    '    if (!pattern.test(source)) throw new Error("Fixture root test binding changed.");',
    '    result.source = source.replace(pattern, `export const FIXTURES_ROOT = ${JSON.stringify(root)};`);',
    '  }',
    '  return result;',
    '} });',
  ].join('\n');
  const run = () =>
    spawnSync(
      process.execPath,
      [
        '--import',
        `data:text/javascript,${encodeURIComponent(script)}`,
        fileURLToPath(cli),
        'check',
      ],
      {
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 20_000,
      },
    );
  try {
    await writeVariants(root, variants);
    const clean = run();
    expect(clean.error).toBeUndefined();
    expect(clean.status, clean.stderr).toBe(0);
    expect(clean.stdout).toContain(
      `Fixtures: ${variants.length} variant(s), 0 changed file(s).`,
    );
    for (const platform of Object.keys(registry)) {
      await mkdir(join(root, platform), { recursive: true });
      const marker = join(root, platform, 'cli-check-marker.json');
      await writeFile(marker, '{"text":"Generated CLI drift marker."}\n');
      const drift = run();
      expect(drift.error).toBeUndefined();
      expect(drift.status, drift.stderr).toBe(1);
      expect(drift.stderr).toContain(`${platform}/cli-check-marker.json`);
      expect(drift.stdout).toContain('1 changed file(s).');
      await rm(marker);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

test('seeded random sequences repeat and stay in range', () => {
  const first = createRandom(42);
  const second = createRandom(42);
  const values = Array.from({ length: 50 }, () => first());
  expect(values).toEqual(Array.from({ length: 50 }, () => second()));
  expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
  expect(values).not.toEqual(Array.from({ length: 50 }, createRandom(43)));
});

test('fixture checks compare paths and bytes, including unexpected files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'socialprune-fixture-test-'));
  const variant: Variant = {
    id: 'test-variant',
    platform: 'x',
    description: 'Generated fixture for the tree comparison test.',
    archives: [
      { name: 'archive', files: { 'data/notes.txt': 'generated content\n' } },
    ],
    expected: { count: 1 },
  };
  try {
    expect(await checkFixtures(root, [])).toEqual([]);
    await writeVariants(root, [variant]);
    expect(await checkFixtures(root, [variant])).toEqual([]);
    await writeFile(
      join(root, 'x/test-variant/archive/data/notes.txt'),
      'changed\n',
    );
    await writeFile(join(root, 'x/extra.txt'), 'unexpected\n');
    expect(await checkFixtures(root, [variant])).toEqual([
      'x/extra.txt',
      'x/test-variant/archive/data/notes.txt',
    ]);
    await expect(
      writeVariants(root, [
        {
          ...variant,
          archives: [{ name: 'archive', files: { '../outside.txt': 'no' } }],
        },
      ]),
    ).rejects.toThrow('relative');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

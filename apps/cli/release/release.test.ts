import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { assertFileList } from './inventory.ts';
import { workspaceAliases } from './release.ts';
import { readWorkflow } from './workflow-reader.ts';

test('manifest oracle rejects planted private files, sources, fixtures and tests', () => {
  const expected = ['bin/socialprune.mjs', 'web/assets/index-Ab_cd123.js'];
  const actual = ['bin/socialprune.mjs', 'web/assets/index-Ab_cd123.js'];
  assertFileList(actual, expected);
  expect(() =>
    assertFileList(actual, [
      'bin/socialprune.mjs',
      'web/assets/index-other123.js',
    ]),
  ).toThrow();
  for (const extra of [
    'bin/private.txt',
    'fixtures/export.json',
    'bin/main.ts',
    'bin/main.test.js',
  ])
    expect(() => assertFileList([...actual, extra], expected)).toThrow();
});

test('aliases resolve adapter guide and all core subpaths without prefix capture', async () => {
  const aliases = await workspaceAliases();
  for (const specifier of [
    '@socialprune/core/node',
    '@socialprune/core/workspace/protocol',
    '@socialprune/adapter-x/guide',
    '@socialprune/adapter-instagram/guide',
  ]) {
    expect(aliases[`${specifier}$`]).toBeDefined();
    expect(
      (await readFile(aliases[`${specifier}$`]!, 'utf8')).length,
    ).toBeGreaterThan(0);
  }
  expect(aliases['@socialprune/core/unregistered$']).toBeUndefined();
});

function assertRelease(source: string): void {
  const workflow = readWorkflow(source) as {
    on: Record<string, unknown>;
    permissions: unknown;
    jobs: Record<
      string,
      {
        permissions: unknown;
        environment: string;
        if: string;
        needs: string;
        strategy: { matrix: { os: string[] } };
        steps: { name?: string; run?: string; shell?: string; uses?: string }[];
      }
    >;
  };
  expect(workflow.on).toEqual({ workflow_dispatch: null });
  expect(workflow.permissions).toEqual({ contents: 'read' });
  const publish = workflow.jobs.publish!;
  expect(publish.permissions).toEqual({
    contents: 'read',
    'id-token': 'write',
  });
  expect(publish.environment).toBe('npm-publish');
  expect(publish.if).toBe("vars.NPM_PUBLISH_ENABLED == 'true'");
  expect(publish.needs).toBe('build-and-smoke');
  const setup = publish.steps.findIndex(
    (step) =>
      step.uses ===
      'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
  );
  const preflight = publish.steps.findIndex(
    (step) => step.name === 'Require bundled npm 11.5.1 or newer',
  );
  const install = publish.steps.findIndex(
    (step) => step.run === 'pnpm install --frozen-lockfile',
  );
  const publishCommand = publish.steps.findIndex(
    (step) => step.run === 'npm publish --provenance --access public',
  );
  expect(setup).toBeGreaterThanOrEqual(0);
  expect(preflight).toBe(setup + 1);
  expect(install).toBe(preflight + 1);
  expect(publishCommand).toBeGreaterThan(preflight);
  expect(publish.steps[preflight]).toMatchObject({
    shell: 'bash',
    name: 'Require bundled npm 11.5.1 or newer',
  });
  expect(publish.steps[preflight]!.run).toContain('"--version"');
  expect(publish.steps[preflight]!.run).toContain('minor===5 && patch<1');
  expect(publish.steps[preflight]!.run).toContain('process.exit(1)');
  expect(workflow.jobs['build-and-smoke']!.strategy.matrix.os).toEqual([
    'ubuntu-latest',
    'windows-latest',
    'macos-latest',
  ]);
  for (const job of Object.values(workflow.jobs)) {
    expect(job.steps.map((step) => step.run)).toContain(
      'pnpm guide:check --max-age 120 --release',
    );
    for (const step of job.steps)
      if (step.uses) expect(step.uses).toMatch(/^[\w/-]+@[a-f0-9]{40}$/);
  }
  expect(source).not.toMatch(
    /secrets\.|NODE_AUTH_TOKEN|NPM_TOKEN|npm (?:install|i|add).*npm@|npm (?:login|adduser|token)/,
  );
}

test('release workflow has only manual dispatch, guarded OIDC and bundled-npm preflight', async () => {
  const source = (
    await readFile(
      new URL('../../../.github/workflows/release-cli.yml', import.meta.url),
      'utf8',
    )
  ).replaceAll('\r\n', '\n');
  assertRelease(source);
  for (const mutation of [
    source.replace('  workflow_dispatch:', '  workflow_dispatch:\n  push:'),
    source.replace("    if: vars.NPM_PUBLISH_ENABLED == 'true'\n", ''),
    source.replace('    environment: npm-publish', '    environment: wrong'),
    source.replace('      id-token: write', '      id-token: read'),
    source.replace('minor===5 && patch<1', 'minor===5 && patch<0'),
  ])
    expect(() => assertRelease(mutation)).toThrow();
});

test('rejects a planted npm preflight before setup-node (F38)', async () => {
  const source = (
    await readFile(
      new URL('../../../.github/workflows/release-cli.yml', import.meta.url),
      'utf8',
    )
  ).replaceAll('\r\n', '\n');
  const check = source.match(
    /^      - name: Require bundled npm 11\.5\.1 or newer\n[\s\S]*?(?=^      - )/m,
  )?.[0];
  expect(check).toBeDefined();
  const withoutCheck = source.replace(check!, '');
  const publishSteps =
    withoutCheck.indexOf(
      '    steps:\n',
      withoutCheck.indexOf('\n  publish:\n'),
    ) + '    steps:\n'.length;
  const mutation =
    withoutCheck.slice(0, publishSteps) +
    check! +
    withoutCheck.slice(publishSteps);
  expect(mutation).not.toBe(source);
  const parsed = readWorkflow(mutation) as {
    jobs: { publish: { steps: { name?: string }[] } };
  };
  expect(parsed.jobs.publish.steps[0]!.name).toBe(
    'Require bundled npm 11.5.1 or newer',
  );
  expect(() => assertRelease(mutation)).toThrow();
});

test.each([
  'a: &anchor value',
  'a: *anchor',
  'a: {b: c}',
  'a: [b, c]',
  '---\na: value',
  'a: !!str value',
  'a: >\n  folded',
  'a: value # comment',
  'a: value: nested',
  'a: value &anchor',
  'a: value\na: duplicate',
  'a:\n   b: value',
])('restricted workflow reader rejects unsupported YAML: %s', (source) => {
  expect(() => readWorkflow(source)).toThrow();
});

import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');
const eslint = new ESLint({
  cwd: root,
  overrideConfig: [
    tseslint.configs.disableTypeChecked,
    {
      languageOptions: {
        parserOptions: {
          project: false,
          projectService: false,
          ecmaFeatures: { jsx: true },
        },
      },
    },
  ],
});

async function restricted(code: string, path: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, {
    filePath: resolve(root, path),
  });
  if (!result || result.messages.some((message) => message.fatal)) {
    throw new Error(
      `Lint probe did not parse: ${JSON.stringify(result?.messages)}`,
    );
  }
  return result.messages
    .map((message) => message.ruleId)
    .filter(
      (rule): rule is string => rule?.startsWith('no-restricted-') ?? false,
    );
}

async function propertyRestrictions(path: string): Promise<unknown[]> {
  const config: unknown = await eslint.calculateConfigForFile(
    resolve(root, path),
  );
  if (
    typeof config !== 'object' ||
    config === null ||
    !('rules' in config) ||
    typeof config.rules !== 'object' ||
    config.rules === null ||
    !('no-restricted-properties' in config.rules)
  ) {
    throw new Error('Property restriction config is missing.');
  }
  const rule: unknown = config.rules['no-restricted-properties'];
  if (!Array.isArray(rule)) {
    throw new Error('Property restriction options are missing.');
  }
  return rule as unknown[];
}

describe('Node-only Playwright runner environment exception', () => {
  const source = 'export const port = process.env.SP_E2E_PORT;';

  it.each([
    'apps/web/playwright.config.ts',
    'apps/web/playwright.probe.config.ts',
    'apps/web/playwright.update.config.ts',
    'apps/cli/playwright.config.ts',
  ])('allows runner ports only in %s', async (path) => {
    expect(await restricted(source, path)).toEqual([]);
  });

  it.each([
    'apps/web/src/main.tsx',
    'apps/web/e2e/helpers.ts',
    'apps/web/scripts/build-check.ts',
    'apps/web/tooling/manifest.ts',
    'apps/cli/src/main.ts',
    'packages/core/src/index.ts',
    'apps/web/src/playwright.config.ts',
    'apps/web/e2e/playwright.config.ts',
    'packages/core/playwright.config.ts',
  ])('retains the environment ban in %s', async (path) => {
    expect(await restricted(source, path)).toContain(
      'no-restricted-properties',
    );
  });

  it('removes only the environment entry from restricted properties', async () => {
    const ordinaryRules = await propertyRestrictions('apps/web/src/main.tsx');
    const runnerRules = await propertyRestrictions(
      'apps/web/playwright.config.ts',
    );
    expect(runnerRules).toEqual([
      ordinaryRules[0],
      ...ordinaryRules
        .slice(1)
        .filter(
          (entry) =>
            typeof entry !== 'object' ||
            entry === null ||
            !('object' in entry) ||
            !('property' in entry) ||
            entry.object !== 'process' ||
            entry.property !== 'env',
        ),
    ]);
  });
});

describe('ADR-004 archive DOM boundary', () => {
  it.each([
    'export const view = <div dangerouslySetInnerHTML={{__html:"text"}} />;',
    'export const props = {dangerouslySetInnerHTML:{__html:"text"}};',
    'export const props = {"dangerouslySetInnerHTML":{__html:"text"}};',
    'export const value = document["dangerouslySetInnerHTML"];',
  ])('rejects planted raw HTML through the actual config', async (code) => {
    expect(await restricted(code, 'apps/web/src/proof.tsx')).toContain(
      'no-restricted-syntax',
    );
  });

  it('allows escaped React text through the actual config', async () => {
    expect(
      await restricted(
        'export const view = <div>{"invented text"}</div>;',
        'apps/web/src/proof.tsx',
      ),
    ).toEqual([]);
  });
});

describe('ADR-017 capability imports', () => {
  it.each([
    '@socialprune/core/workspace/review',
    '@socialprune/core/workspace/review.ts',
    '@socialprune/core/src/workspace/review.ts',
    '../../../../packages/core/src/workspace/review.ts',
    '../../../../../packages/core/src/workspace/review.js',
  ])('rejects %s from a CLI command', async (specifier) => {
    expect(
      await restricted(
        `export { ReviewService } from ${JSON.stringify(specifier)};`,
        'apps/cli/src/commands/proof.ts',
      ),
    ).toContain('no-restricted-imports');
  });

  it('rejects a direct imported review capability, not only a re-export', async () => {
    expect(
      await restricted(
        'import {ReviewService} from "@socialprune/core/workspace/review"; export {ReviewService};',
        'apps/cli/src/commands/proof.ts',
      ),
    ).toContain('no-restricted-imports');
  });

  it('allows label and protocol services in commands, and review on review side', async () => {
    for (const specifier of [
      '@socialprune/core/workspace/labels',
      '@socialprune/core/workspace/protocol',
      '../../../../packages/core/src/workspace/review-history.ts',
    ]) {
      expect(
        await restricted(
          `export { service } from ${JSON.stringify(specifier)};`,
          'apps/cli/src/commands/proof.ts',
        ),
      ).toEqual([]);
    }
    expect(
      await restricted(
        'export { ReviewService } from "@socialprune/core/workspace/review";',
        'apps/cli/src/review/proof.ts',
      ),
    ).toEqual([]);
  });
});

describe('ADR-004 test-probe isolation', () => {
  it.each([
    '../../test/probes/violation-worker.ts',
    '../../../test/probes/violation-worker.ts',
    'apps/web/test/probes/violation-worker.ts',
    '/apps/web/test/probes/violation-worker.ts',
  ])('rejects %s from production web source', async (specifier) => {
    expect(
      await restricted(
        `import ${JSON.stringify(specifier)};`,
        'apps/web/src/app/proof.ts',
      ),
    ).toContain('no-restricted-imports');
  });

  it('allows production modules and test-side probe wiring', async () => {
    expect(
      await restricted(
        'import "./contest/controller.ts";',
        'apps/web/src/app/proof.ts',
      ),
    ).toEqual([]);
    expect(
      await restricted(
        'import "./probes/violation-worker.ts";',
        'apps/web/test/proof.ts',
      ),
    ).toEqual([]);
  });
});

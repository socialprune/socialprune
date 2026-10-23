import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { expect, test } from 'vitest';

const root = resolve(import.meta.dirname, '../../..');
const eslint = new ESLint({
  cwd: root,
  overrideConfig: [
    tseslint.configs.disableTypeChecked,
    {
      languageOptions: {
        parserOptions: { project: false, projectService: false },
      },
    },
  ],
});
async function rules(
  source: string,
  file = 'packages/classify/src/generated-proof.ts',
) {
  const [result] = await eslint.lintText(source, {
    filePath: resolve(root, file),
  });
  if (!result || result.messages.some((message) => message.fatal))
    throw new Error('Generated lint probe did not parse.');
  return result.messages
    .map((message) => message.ruleId)
    .filter((rule) => rule?.startsWith('no-restricted-'));
}
test.each([
  [
    'export const key = process.env.OPENAI_API_KEY;',
    'no-restricted-properties',
  ],
  ['import {env} from "node:process"; export {env};', 'no-restricted-imports'],
  [
    'import {homedir} from "node:os"; export {homedir};',
    'no-restricted-imports',
  ],
  [
    'export {ReviewService} from "@socialprune/core/workspace/review";',
    'no-restricted-imports',
  ],
  [
    'export {ReviewService} from "../../core/src/workspace/review.ts";',
    'no-restricted-imports',
  ],
  ['import "../test/fake-endpoint.ts";', 'no-restricted-imports'],
  [
    'export const request = fetch("http://127.0.0.1");',
    'no-restricted-globals',
  ],
])('actual root lint config rejects %s', async (source, rule) => {
  expect(await rules(source)).toContain(rule);
  expect(await rules('export const local = "generated";')).toEqual([]);
});
test('production restrictions do not prohibit injected transport or test probes', async () => {
  expect(
    await rules(
      'export function check(transport: () => void) { transport(); }',
    ),
  ).toEqual([]);
  expect(
    await rules(
      'export const value = process.env.GENERATED;',
      'packages/classify/test/proof.ts',
    ),
  ).toEqual(['no-restricted-properties']);
});

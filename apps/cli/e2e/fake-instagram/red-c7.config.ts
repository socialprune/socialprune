import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Explicit test config only; no normal CLI entry reads this selector.
// eslint-disable-next-line no-restricted-properties -- Node-only red-control selection.
const mode = process.env.SP_CONTEXT_RED_MODE;
const cases: Record<string, { before: string; after: string; tests: string }> =
  {
    collaboration: {
      before: '    post.ownerCount !== 1 ||\n',
      after: '',
      tests: 'C7 collaboration rejects',
    },
    profile: {
      before: '    !post.ownerMatchesProfile ||\n',
      after: '',
      tests: 'C7 owner-first-profile rejects',
    },
    text: {
      before:
        "  const text = textRow.locator(':scope > span[dir=\"auto\"]');\n  if (\n    (await textRow.locator(':scope > *').count()) !== 1 ||\n    (await text.count()) !== 1 ||",
      after:
        '  const text = textRow.locator(\':scope > span[dir="auto"]\').first();\n  if (\n    (await text.count()) !== 1 ||',
      tests: 'C7 block-two-texts skips',
    },
    content: {
      before: '.locator(\'time,button,img,[role="button"],a[href*="/c/"]\')',
      after: '.locator(\'a[href="/generated-never/"]\')',
      tests: 'C7r block-text-(time|image|button|permalink) is skipped',
    },
    caption: {
      before: '  return normalize(await text.innerText());',
      after: '  return normalize(await block.innerText());',
      tests: 'C7r measured comment rows',
    },
    incomplete: {
      before: '      : !captionBlockSeen,',
      after: '      : true,',
      tests: 'C7r caption-.* leaves the present',
    },
    image: {
      before:
        "      (await image.locator('xpath=ancestor::a').count()) === 0 &&",
      after:
        "      index === 0 || (await image.locator('xpath=ancestor::a').count()) === 0 &&",
      tests: 'C7 media image ignores',
    },
    privacy: {
      before: '    caption: caption?.text.slice(0, 10000) ?? null,',
      after: '    caption: comments[0]?.text ?? null,',
      tests: 'C7 main media',
    },
    screenshot: {
      before: '    element,\n  };',
      after: "    element: element.locator('img').first(),\n  };",
      tests: 'C7 main media',
    },
    readiness: {
      before: '  if (!address || (await element.count()) !== 1) return null;',
      after: '  if (!address) return null;',
      tests: 'C7 post-two-main cannot',
    },
  };
const mutation = mode ? cases[mode] : undefined;
if (!mutation) throw new Error('Choose an explicit C7 red control.');
export default defineConfig({
  root: fileURLToPath(new URL('../../../../', import.meta.url)),
  plugins: [
    {
      name: 'instagram-c7-red-only',
      enforce: 'pre',
      transform(source, id) {
        if (!id.replaceAll('\\', '/').endsWith('/instagram/selectors.ts'))
          return null;
        if (source.split(mutation.before).length !== 2)
          throw new Error('Stale C7 red control: ' + mode);
        return {
          code: source.replace(mutation.before, mutation.after),
          map: null,
        };
      },
    },
  ],
  test: {
    environment: 'node',
    include: ['apps/cli/e2e/context-instagram.test.ts'],
    testNamePattern: mutation.tests,
    fileParallelism: false,
    maxWorkers: 1,
    retry: 0,
    testTimeout: 60000,
    hookTimeout: 30000,
  },
});

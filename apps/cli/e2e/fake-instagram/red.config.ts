import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Test-only mutation entry. Neither production nor the normal runner imports it.
// Mutants exist only in Vite's in-memory transform, never in checked-out source.
export const mutations: Record<string, [string, string][]> = {
  '/browser/instagram/order.ts': [
    ['if (canary && !parsed.data.acceptCanary)', 'if (false)'],
  ],
  '/browser/instagram/canary.ts': [
    ['if (!check.confirmed)', 'if (false)'],
    [
      'if (\n    !check.ownerShown ||\n    !check.timeShown ||\n    !check.imageStored ||\n    !check.screenshotStored\n  )',
      'if (false)',
    ],
    [
      'if (Object.values(check.fields).some((field) => !field.found))',
      'if (false)',
    ],
    [
      'if (Object.values(check.fields).some((field) => !field.agrees))',
      'if (false)',
    ],
    [
      'if (\n    !before ||\n    before.toLowerCase() !== after?.toLowerCase() ||\n    added ||\n    removed ||\n    unexpected\n  )',
      'if (false)',
    ],
  ],
  '/browser/instagram/network.ts': [
    ['if (mutation(request.method(), url.href, name))', 'if (false)'],
  ],
  '/browser/instagram/selectors.ts': [
    [
      "if (ownerName(post.owner) !== ownerName(item.reference.ownerHandle ?? ''))",
      'if (false)',
    ],
    ['ownerName(comment.username) === ownerName(handle)', 'true'],
    ['comment.text === normalize(item.text)', 'true'],
    [
      'Math.abs(Date.parse(comment.createdAt) - Date.parse(item.createdAt)) <=\n      60000',
      'true',
    ],
    ['if (passed.length === 1)', 'if (passed.length > 0)'],
    ["if (!lang?.toLowerCase().startsWith('en'))", 'if (false)'],
  ],
  '/browser/instagram/run.ts': [
    ['if (!(await Promise.race([start, cancelled])))', 'if (false)'],
    [
      'if (options.order && options.plan.canary) automaticCanaryCheck(check);',
      '',
    ],
  ],
  '/browser/instagram/pace.ts': [
    ["run.platform === 'instagram' &&", 'true &&'],
  ],
  '/browser/instagram/capture.ts': [
    ['if (bytes.length > INSTAGRAM_SCREENSHOT_MAX_BYTES)', 'if (false)'],
  ],
  '/browser/profile.ts': [
    [
      '!stat?.isDirectory() ||\n    stat.isSymbolicLink() ||\n    resolve(directory) !== (await realpath(directory)) ||',
      'false ||',
    ],
    ['inDefaultProfile(directory, defaultRoots)', 'false'],
    [
      'if (await lstat(join(directory, PROFILE_MARKER)).catch(() => null))',
      'if (false)',
    ],
    [
      "JSON.stringify({ platform: 'instagram', adoptedAt: at, version: '0.0.0' }),\n    { flag: 'wx' }",
      "JSON.stringify({ platform: 'instagram', adoptedAt: at, version: '0.0.0' }),\n    { flag: 'w' }",
    ],
    ['(await profileInUse(directory))', 'false'],
    ['!state?.isFile() ||', 'false ||'],
  ],
  '/browser/instagram/plan.ts': [
    ['if (!normalize(item.text))', 'if (false)'],
    ["if (!ownerName(item.reference.ownerHandle ?? ''))", 'if (false)'],
    ['if (twins.has(item.id))', 'if (false)'],
  ],
  '/browser/instagram/report.ts': [
    ["(KEYS.has(key) ? key.replace(/\\d/g, '') : '*')", 'key'],
  ],
};
export function redTransform(source: string, id: string) {
  const path = id.replaceAll('\\', '/');
  for (const [file, edits] of Object.entries(mutations))
    if (path.endsWith(file)) {
      for (const [before, after] of edits) {
        if (!source.includes(before))
          throw new Error(`Stale test mutant: ${file}`);
        source = source.replace(before, after);
      }
      return { code: source, map: null };
    }
  return null;
}
export default defineConfig({
  root: fileURLToPath(new URL('../../../../', import.meta.url)),
  plugins: [
    {
      name: 'instagram-red-controls-only',
      enforce: 'pre',
      transform: redTransform,
    },
  ],
  test: {
    environment: 'node',
    include: [
      'apps/cli/e2e/context-instagram.test.ts',
      'apps/cli/src/browser/instagram/{plan,canary,network,selectors,profile,pace,capture}.test.ts',
    ],
    fileParallelism: false,
    maxWorkers: 1,
    retry: 0,
    testTimeout: 60000,
    hookTimeout: 30000,
  },
});

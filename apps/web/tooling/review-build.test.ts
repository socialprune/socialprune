import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, expect, test } from 'vitest';
import { build } from 'vite';
import { LOCAL_REVIEW_POLICY } from '../src/local-review/policy.ts';
import { DESKTOP_POLICY } from '../src/desktop/policy.ts';
import { assertDesktopOutput } from './desktop-build-output.ts';
import { REVIEW_ROUTES, parseReviewRoute } from '../src/app/router.ts';
import {
  assertPagesIsolation,
  assertReviewOutput,
  outputFiles,
} from './review-output.ts';

// Unit gates run before build in CI. Exercise the real reserved-target config
// here as well, so neither a previous dist nor an unbuilt checkout is an oracle.
beforeAll(async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const configFile = fileURLToPath(
    new URL('../vite.config.ts', import.meta.url),
  );
  await build({ root, configFile, mode: 'review', logLevel: 'silent' });
  await build({ root, configFile, mode: 'production', logLevel: 'silent' });
  // The two builds took 17,224 ms while the full unit suite ran on 2026-10-08
  // (4,032 ms alone); the project rule is at least six times the measurement.
}, 120_000);

test('review policy equals the exact ADR-016 document and built meta text', async () => {
  const adr = await readFile(
    new URL(
      '../../../docs/architecture/adrs/ADR-016-local-review-server.md',
      import.meta.url,
    ),
    'utf8',
  );
  const declared = /- Header and meta policy: `([^`]+)`/.exec(adr)?.[1];
  expect(declared).toBeDefined();
  const amended = declared!.replace(
    "img-src 'self';",
    "img-src 'self'; media-src 'self';",
  );
  expect(LOCAL_REVIEW_POLICY).toBe(amended);
  const html = await readFile(
    new URL('../dist-review/index.html', import.meta.url),
    'utf8',
  );
  expect(
    /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1],
  ).toBe(amended);
});

test('review routes match the fixed local list including CLI pointers, never Pages-only guide subroutes', () => {
  expect(REVIEW_ROUTES).toEqual([
    '/',
    '/review',
    '/review/list',
    '/archive',
    '/clicklist/x',
    '/clicklist/x/go',
    '/clicklist/instagram',
    '/clicklist/instagram/go',
    '/settings',
    '/privacy',
    '/guide',
    '/demo',
    '/import',
    '/backup',
  ]);
  for (const route of REVIEW_ROUTES)
    expect(parseReviewRoute(`#${route}`)).toBe(route);
  expect(parseReviewRoute('')).toBe('/');
  for (const hash of [
    '#/guide/x',
    '#/guide/instagram',
    '#bootstrap=secret',
    '#/review?item=input',
    '#/review/input',
  ])
    expect(parseReviewRoute(hash)).toBe('not-found');
});

test('actual review output excludes every worker/storage path, and Pages output excludes the review entry', async () => {
  assertReviewOutput(
    await outputFiles(
      fileURLToPath(new URL('../dist-review/', import.meta.url)),
    ),
  );
  assertPagesIsolation(
    await outputFiles(fileURLToPath(new URL('../dist/', import.meta.url))),
  );
});

test('the real Pages service worker planted at the review build root is rejected', async () => {
  const files = await outputFiles(
    fileURLToPath(new URL('../dist-review/', import.meta.url)),
  );
  files.set(
    'sw.js',
    await readFile(new URL('../dist/sw.js', import.meta.url), 'utf8'),
  );
  expect(() => assertReviewOutput(files)).toThrow(
    'Worker, manifest or test file in local-review build.',
  );
});

// LL-2026-10-002: defects are independently planted, not inferred from the
// output scanner. Every forbidden branch must make the assertion fail.
test.each([
  'sw.js',
  'assets/sw.js',
  'manifest.json',
  'assets/manifest.json',
  'manifest.webmanifest',
  'assets/workspace-worker-input.js',
  'test/entry.js',
])('review output assertion catches planted forbidden file %s', (path) => {
  const files = new Map([
    [
      'index.html',
      `<meta http-equiv="Content-Security-Policy" content="${LOCAL_REVIEW_POLICY}" />`,
    ],
    [path, 'input'],
  ]);
  expect(() => assertReviewOutput(files)).toThrow();
});
test.each([
  'assets/X-abcdsw.js',
  'assets/DeleteMode-kRsF95sw.js',
  'assets/X-abcdmanifest.json',
])(
  'review accepts ordinary hashed asset %s, not a fixed shell filename',
  (path) => {
    expect(() =>
      assertReviewOutput(
        new Map([
          [
            'index.html',
            `<meta http-equiv="Content-Security-Policy" content="${LOCAL_REVIEW_POLICY}" />`,
          ],
          [path, 'input'],
        ]),
      ),
    ).not.toThrow();
  },
);
test.each(['assets/X-abcdsw.js', 'assets/DeleteMode-kRsF95sw.js'])(
  'desktop accepts ordinary hashed asset %s, not a service worker filename',
  (path) => {
    expect(() =>
      assertDesktopOutput(
        new Map([
          [
            'desktop.html',
            `<meta http-equiv="Content-Security-Policy" content="${DESKTOP_POLICY}" />`,
          ],
          [path, 'input'],
        ]),
      ),
    ).not.toThrow();
  },
);
test.each([
  'sw.js',
  'assets/sw.js',
  'manifest.webmanifest',
  'assets/workspace-worker-input.js',
])('desktop output still rejects planted shell or worker file %s', (path) => {
  expect(() =>
    assertDesktopOutput(
      new Map([
        [
          'desktop.html',
          `<meta http-equiv="Content-Security-Policy" content="${DESKTOP_POLICY}" />`,
        ],
        [path, 'input'],
      ]),
    ),
  ).toThrow();
});
test.each([
  'new Worker("/input.js")',
  'navigator.serviceWorker.register("/sw.js")',
  'indexedDB.open("input")',
  'always-denied-review-fixture',
])('review assertion catches planted runtime path %s', (body) => {
  const files = new Map([
    [
      'index.html',
      `<meta http-equiv="Content-Security-Policy" content="${LOCAL_REVIEW_POLICY}" />`,
    ],
    ['assets/input.js', body],
  ]);
  expect(() => assertReviewOutput(files)).toThrow();
});
test.each(['dist-review/index.html', 'assets/review-main.js'])(
  'Pages assertion catches planted review file %s',
  (path) => {
    expect(() => assertPagesIsolation(new Map([[path, 'input']]))).toThrow();
  },
);
test('Pages assertion catches a planted review bootstrap even in an ordinary chunk name', () => {
  expect(() =>
    assertPagesIsolation(
      new Map([['assets/input.js', 'X-SocialPrune-Bootstrap']]),
    ),
  ).toThrow();
});

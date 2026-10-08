import { createHash, webcrypto } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { expect, test } from 'vitest';
import { readWorkflow } from '../../cli/release/workflow-reader.ts';
import { PAGE_POLICY } from '../src/sw/policies.ts';
import { assertPagesIsolation } from './review-output.ts';

const deployCondition =
  "inputs.publish && github.ref == 'refs/heads/main' && vars.PAGES_ENABLED == 'true'";
const sha = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const encoder = new TextEncoder();
const pins = {
  checkout: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
  pnpm: 'pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413',
  node: 'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
  upload:
    'actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9',
  deploy: 'actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346',
};
interface Step {
  uses?: string;
  run?: string;
  with?: Record<string, string | boolean>;
  env?: Record<string, string>;
}
function assertWorkflow(source: string) {
  const workflow = readWorkflow(source) as unknown as {
    on: { workflow_dispatch: { inputs: { publish: unknown } } };
    permissions: unknown;
    jobs: Record<
      string,
      {
        if: string;
        permissions: unknown;
        needs?: string;
        environment?: string;
        concurrency?: unknown;
        steps: Step[];
      }
    >;
  };
  expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
  expect(workflow.on.workflow_dispatch.inputs.publish).toEqual({
    description: 'Publish the release artifact to Pages',
    type: 'boolean',
    required: true,
    default: false,
  });
  expect(Object.keys(workflow.on.workflow_dispatch.inputs)).toEqual([
    'publish',
  ]);
  expect(workflow.permissions).toEqual({ contents: 'read' });
  expect(Object.keys(workflow.jobs)).toEqual(['build', 'deploy']);
  const build = workflow.jobs.build!,
    deploy = workflow.jobs.deploy!;
  expect(build.if).toBe("github.event_name == 'workflow_dispatch'");
  expect(build.permissions).toEqual({ contents: 'read' });
  expect(deploy.if).toBe(deployCondition + '\n');
  expect(deploy.needs).toBe('build');
  expect(deploy.permissions).toEqual({ pages: 'write', 'id-token': 'write' });
  expect(deploy.environment).toBe('github-pages');
  expect(deploy.concurrency).toEqual({
    group: 'pages',
    'cancel-in-progress': false,
  });
  expect(build.steps).toEqual([
    { uses: pins.checkout, with: { 'persist-credentials': false } },
    { uses: pins.pnpm },
    { uses: pins.node, with: { 'node-version': '24', cache: 'pnpm' } },
    { run: 'pnpm install --frozen-lockfile' },
    { run: 'pnpm guard' },
    { run: 'pnpm --filter @socialprune/web build:release' },
    { run: 'node apps/web/scripts/build-check.ts' },
    {
      run: 'pnpm exec vitest run --project web apps/web/tooling/pages-workflow.test.ts',
      env: { SP_PAGES_OUTPUT_CHECK: '1' },
    },
    { run: 'pnpm guide:check --max-age 120 --release' },
    { uses: pins.upload, with: { path: 'apps/web/dist' } },
  ]);
  expect(deploy.steps).toEqual([{ uses: pins.deploy }]);
  for (const job of Object.values(workflow.jobs))
    for (const step of job.steps)
      if (step.uses) expect(step.uses).toMatch(/^[\w/-]+@[a-f0-9]{40}$/);
  expect(source).not.toMatch(
    /secrets\b|configure-pages|enablement|NODE_AUTH_TOKEN/,
  );
}
const source = (
  await readFile(
    new URL('../../../.github/workflows/pages.yml', import.meta.url),
    'utf8',
  )
).replaceAll('\r\n', '\n');
test('I1 Pages is manual, default-off, least-permission, SHA-pinned and release-checked before upload', () =>
  assertWorkflow(source));
test.each([
  [
    'added push',
    source.replace('  workflow_dispatch:', '  push:\n  workflow_dispatch:'),
  ],
  [
    'publish default true',
    source.replace('        default: false', '        default: true'),
  ],
  [
    'removed enablement clause',
    source.replace(" && vars.PAGES_ENABLED == 'true'", ''),
  ],
])('I1 Pages workflow oracle rejects planted %s', (_name, mutation) => {
  expect(mutation).not.toBe(source);
  expect(() => assertWorkflow(mutation)).toThrow();
});

// Run the app-owned worker in an isolated test realm. Its real install handler
// validates the manifest hashes against artifact bytes, with no network access.
async function assertBuiltPages(files: ReadonlyMap<string, Uint8Array>) {
  const decoded = new Map(
    [...files].map(([path, bytes]) => [path, new TextDecoder().decode(bytes)]),
  );
  const html = decoded.get('index.html') ?? '';
  expect(
    /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1],
  ).toBe(PAGE_POLICY);
  assertPagesIsolation(decoded);
  expect(
    [...files.values()].reduce((total, bytes) => total + bytes.byteLength, 0),
  ).toBeLessThanOrEqual(50 * 1024 * 1024);
  const listeners = new Map<
    string,
    (event: { waitUntil(promise: Promise<void>): void }) => void
  >();
  const origin = 'https://socialprune.github.io';
  const cached: string[] = [];
  runInNewContext(
    decoded.get('sw.js') ?? '',
    {
      self: {
        location: { origin },
        addEventListener: (
          type: string,
          callback: (event: {
            waitUntil(promise: Promise<void>): void;
          }) => void,
        ) => listeners.set(type, callback),
      },
      URL,
      Response,
      Headers,
      Uint8Array,
      Set,
      Map,
      TextEncoder,
      crypto: webcrypto,
      caches: {
        open: () =>
          Promise.resolve({
            put: (url: URL) => {
              cached.push(url.pathname);
              return Promise.resolve();
            },
          }),
        delete: () => Promise.resolve(true),
      },
      fetch: (url: URL) => {
        expect(url.origin).toBe(origin);
        expect(url.pathname.startsWith('/socialprune/')).toBe(true);
        const bytes = files.get(url.pathname.slice('/socialprune/'.length));
        if (!bytes)
          throw new Error('Manifest file absent from Pages artifact.');
        return Promise.resolve(new Response(bytes.slice()));
      },
    },
    { timeout: 5000 },
  );
  expect(listeners.has('install')).toBe(true);
  let installed: Promise<void> | undefined;
  listeners.get('install')!({
    waitUntil: (promise) => {
      installed = promise;
    },
  });
  expect(installed).toBeDefined();
  await installed;
  expect(cached.sort()).toEqual(
    [...files.keys()]
      .filter((path) => path !== 'sw.js')
      .map((path) => '/socialprune/' + path)
      .sort(),
  );
}
function generatedOutput() {
  const files = new Map([
    [
      'index.html',
      encoder.encode(
        `<meta http-equiv="Content-Security-Policy" content="${PAGE_POLICY}">`,
      ),
    ],
    ['assets/invented.js', encoder.encode('export const generated = true;')],
  ]);
  const manifest = [...files].map(([path, bytes]) => ({
    url: '/socialprune/' + path,
    sha256: sha(bytes),
  }));
  files.set(
    'sw.js',
    encoder.encode(`self.addEventListener('install', event => event.waitUntil((async () => {
    const cache = await caches.open('generated');
    for (const file of ${JSON.stringify(manifest)}) {
      const url = new URL(file.url, self.location.origin);
      const response = await fetch(url);
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer())), value => value.toString(16).padStart(2, '0')).join('');
      if (digest !== file.sha256) throw new Error('Precache digest differs.');
      await cache.put(url, response);
    }
  })()));`),
  );
  return files;
}
test('I1 built-output oracle checks exact CSP, review isolation, complete manifest and actual file hashes', async () => {
  const valid = generatedOutput();
  await assertBuiltPages(valid);
  for (const defect of [
    'CSP',
    'review file',
    'digest',
    'missing manifest entry',
  ]) {
    const files = new Map(valid);
    if (defect === 'CSP')
      files.set(
        'index.html',
        encoder.encode(
          '<meta http-equiv="Content-Security-Policy" content="wrong">',
        ),
      );
    if (defect === 'review file')
      files.set('dist-review/entry.js', encoder.encode('generated'));
    if (defect === 'digest')
      files.set('assets/invented.js', encoder.encode('changed'));
    if (defect === 'missing manifest entry')
      files.set('assets/extra.js', encoder.encode('generated'));
    await expect(assertBuiltPages(files)).rejects.toThrow();
  }
});
// Test-only build-check selector, not a credential or a production setting.
// eslint-disable-next-line no-restricted-properties
if (process.env.SP_PAGES_OUTPUT_CHECK === '1') {
  test('I1 release artifact has exact CSP, no local-review, at most 50 MiB and a complete matching precache', async () => {
    const files = new Map<string, Uint8Array>();
    const directory = new URL('../dist/', import.meta.url);
    async function walk(folder: URL, prefix = '') {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const path = prefix + entry.name;
        if (entry.isDirectory())
          await walk(new URL(entry.name + '/', folder), path + '/');
        else
          files.set(
            path,
            await readFile(fileURLToPath(new URL(entry.name, folder))),
          );
      }
    }
    await walk(directory);
    await assertBuiltPages(files);
  });
}

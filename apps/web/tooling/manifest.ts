import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { build as bundle } from 'esbuild';
import { build as buildWorker } from 'vite';
import type { Plugin, ResolvedConfig } from 'vite';
import { DATA_WORKER_POLICY } from '../src/sw/policies.ts';
import type { BuildManifest } from '../src/sw/policies.ts';
import { guides } from '../src/app/guide.ts';
import { checkGuides } from '@socialprune/core/guide/check';

const sha256 = (bytes: string | Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
export function shellManifest(mode: string): Plugin {
  let config: ResolvedConfig;
  const probe = mode === 'e2e-probe';
  return {
    name: 'socialprune-shell-manifest',
    apply: 'build',
    configResolved(value) {
      config = value;
    },
    buildStart() {
      if (mode === 'release') {
        const findings = checkGuides(guides, {
          today: new Date().toISOString().slice(0, 10),
          maxAgeDays: 120,
          release: true,
        });
        if (findings.length)
          throw new Error(
            `Guide release check failed: ${JSON.stringify(findings)}`,
          );
      }
    },
    transformIndexHtml(html) {
      return probe
        ? html.replace(
            'trusted-types socialprune"',
            'trusted-types socialprune socialprune-test"',
          )
        : html;
    },
    resolveId(id) {
      if (id === 'virtual:sp-build-info')
        return { id: `${config.base}build-info.js`, external: true };
    },
    async closeBundle() {
      const directory = resolve(config.root, config.build.outDir);
      if (!config.build.write || config.root.endsWith('css-module')) return;
      if (probe) {
        await writeFile(
          resolve(directory, 'live-probe'),
          'invented test response',
        );
        await bundle({
          entryPoints: [
            resolve(config.root, 'test/probes/violation-worker.ts'),
          ],
          outfile: resolve(directory, 'probe-worker.js'),
          bundle: true,
          format: 'esm',
          platform: 'browser',
          minify: true,
        });
        await bundle({
          entryPoints: [resolve(config.root, 'test/probes/store-contract.ts')],
          outfile: resolve(directory, 'store-contract.js'),
          bundle: true,
          format: 'esm',
          platform: 'browser',
          minify: true,
        });
        await bundle({
          entryPoints: [resolve(config.root, 'test/probes/storage-measure.ts')],
          outfile: resolve(directory, 'storage-measure.js'),
          bundle: true,
          format: 'esm',
          platform: 'browser',
          minify: true,
        });
      }
      const output: string[] = [];
      async function walk(path: string) {
        for (const entry of (await readdir(path, { withFileTypes: true })).sort(
          (a, b) => a.name.localeCompare(b.name),
        )) {
          if (entry.isDirectory()) await walk(resolve(path, entry.name));
          else if (
            !['sw.js', 'build-info.js'].includes(entry.name) &&
            !(probe && entry.name === 'live-probe')
          )
            output.push(resolve(path, entry.name));
        }
      }
      await walk(directory);
      const files = await Promise.all(
        output.map(async (path) => ({
          url: `${config.base}${relative(directory, path).replaceAll('\\', '/')}`,
          sha256: sha256(await readFile(path)),
        })),
      );
      const buildId = sha256(JSON.stringify(files)).slice(0, 24);
      const workers = files.filter(
        ({ url }) =>
          /\/(?:worker|gate-worker|demo-worker|demo-import-worker|workspace-worker)-[\w-]+\.js$/.test(
            url,
          ) ||
          (probe && url.endsWith('/probe-worker.js')),
      );
      const workerPolicies = Object.fromEntries(
        workers.map(({ url }) => [url, DATA_WORKER_POLICY]),
      );
      const info = `export const buildId=${JSON.stringify(buildId)};export const base=${JSON.stringify(config.base)};export const workerURLs=${JSON.stringify(workers.map(({ url }) => url))};`;
      await writeFile(resolve(directory, 'build-info.js'), info);
      files.push({ url: `${config.base}build-info.js`, sha256: sha256(info) });
      const manifest: BuildManifest = {
        buildId,
        base: config.base,
        files,
        workerPolicies,
      };
      // Use the same property-tree-shaking path as the real page/workers.
      // esbuild retained zod's full namespace for its z.config side effect.
      const result = await buildWorker({
        root: config.root,
        configFile: false,
        logLevel: 'silent',
        define: { __SP_MANIFEST__: JSON.stringify(manifest) },
        build: {
          write: false,
          minify: 'esbuild',
          lib: {
            entry: resolve(config.root, 'src/sw/service-worker.ts'),
            name: 'SocialPruneSW',
            formats: ['iife'],
          },
        },
      });
      const outputs = Array.isArray(result) ? result : [result];
      const script = outputs
        .flatMap((output) => ('output' in output ? output.output : []))
        .find((output) => output.type === 'chunk');
      if (!script || script.type !== 'chunk')
        throw new Error('Service worker bundle missing.');
      await writeFile(resolve(directory, 'sw.js'), script.code);
    },
  };
}

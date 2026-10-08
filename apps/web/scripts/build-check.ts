import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { assertPagesIsolation, outputFiles } from '../tooling/review-output.ts';

const directory = fileURLToPath(new URL('../dist/', import.meta.url));
const demo = JSON.parse(
  await readFile(
    new URL('../../../fixtures/synthetic/demo/manifest.json', import.meta.url),
    'utf8',
  ),
) as { exports: { archive: string }[] };
const rows: { name: string; bytes: number; gzipBytes: number }[] = [];
async function walk(folder: string) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = resolve(folder, entry.name);
    if (entry.isDirectory()) await walk(path);
    else {
      if (entry.name.endsWith('.wasm'))
        throw new Error('WASM asset in production build.');
      const bytes = await readFile(path);
      if (/\.js$/.test(entry.name)) {
        const text = bytes.toString('utf8');
        if (
          /AGFzbQ|data:application\/wasm|wasmBinary|WebAssembly\.(?:instantiate|compile)/.test(
            text,
          )
        )
          throw new Error('Inline or executable WASM in production build.');
        if (
          /Test-only blocked registration|probe-result|__archiveReads|__abortTrigger|__wasmCalls|socialprune-test|__rejectNextDecision|__recordWorkspacePost|__captureReviewRequest|__releaseHeldDecision|__pickerFiles|__persistCalls|__tabPosts|__platformOpens|__demoLifecycleTrace/.test(
            text,
          )
        )
          throw new Error('Test mutation reached production output.');
        if (
          /accessibility-checker-engine|IBM_Accessibility|getGuidelineIds|checkDemo|WCAG22|a11yRulesets/.test(
            text,
          )
        )
          throw new Error(
            'Test-only accessibility engine reached production output.',
          );
      }
      if (
        [
          'probe-worker.js',
          'live-probe',
          'store-contract.js',
          'storage-measure.js',
        ].includes(entry.name)
      )
        throw new Error('Test worker reached production output.');
      rows.push({
        name: path.slice(directory.length),
        bytes: bytes.length,
        gzipBytes: gzipSync(bytes, { level: 9 }).length,
      });
    }
  }
}
await walk(directory);
assertPagesIsolation(await outputFiles(directory));
const serviceWorker = await readFile(resolve(directory, 'sw.js'), 'utf8');
for (const { archive } of demo.exports) {
  const asset = rows.find(({ name }) =>
    name.replaceAll('\\', '/').endsWith(`/${archive}`),
  );
  if (!asset || !serviceWorker.includes(asset.name.replaceAll('\\', '/')))
    throw new Error('Demo archive missing from production precache.');
}
console.log(
  JSON.stringify({
    bundleRows: rows,
    noWasm: true,
    testEntrypointsAbsent: true,
    demoArchivesPrecached: true,
    reviewBuildAbsent: true,
  }),
);

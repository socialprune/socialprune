import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const directory = fileURLToPath(new URL('../dist/', import.meta.url));
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
          /Test-only blocked registration|probe-result|__archiveReads|__abortTrigger|__wasmCalls|socialprune-test/.test(
            text,
          )
        )
          throw new Error('Test mutation reached production output.');
      }
      if (entry.name === 'probe-worker.js' || entry.name === 'live-probe')
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
console.log(
  JSON.stringify({
    bundleRows: rows,
    noWasm: true,
    testEntrypointsAbsent: true,
  }),
);

import { createServer } from 'node:http';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Test-only entrypoint: bundles the real store probe but cannot enter a shipped build.
const output = await build({
  entryPoints: [
    fileURLToPath(new URL('../test/probes/store-contract.ts', import.meta.url)),
  ],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  write: false,
});
const bytes = output.outputFiles[0]!.contents;
const server = createServer((request, response) => {
  const script = request.url === '/socialprune/store-contract.js';
  response.writeHead(200, {
    'Content-Type': script ? 'text/javascript' : 'image/svg+xml',
    'Cache-Control': 'no-store',
  });
  response.end(script ? bytes : '<svg xmlns="http://www.w3.org/2000/svg"/>');
});
server.listen(4608, '127.0.0.1', () =>
  console.log('Generated store contract server ready'),
);
const close = () => server.close(() => process.exit(0));
process.once('SIGINT', close);
process.once('SIGTERM', close);

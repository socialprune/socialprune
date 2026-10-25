import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DESKTOP_POLICY } from '../../src/desktop/policy.ts';

const port = Number(process.argv[2]);
const root =
  process.argv[3] ??
  fileURLToPath(new URL('../../dist-desktop/', import.meta.url));
const files = new Map<string, { bytes: Buffer; type: string }>();
async function walk(folder: string, prefix = '') {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    if (entry.isDirectory())
      await walk(resolve(folder, entry.name), `${prefix}${entry.name}/`);
    else
      files.set(`/${prefix}${entry.name}`, {
        bytes: await readFile(resolve(folder, entry.name)),
        type: entry.name.endsWith('.html')
          ? 'text/html'
          : entry.name.endsWith('.css')
            ? 'text/css'
            : 'text/javascript',
      });
  }
}
await walk(root);
const server = createServer((request, response) => {
  const file = files.get(
    request.url === '/' ? '/desktop.html' : (request.url ?? ''),
  );
  response.setHeader('Content-Security-Policy', DESKTOP_POLICY);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('Cache-Control', 'no-store');
  response.writeHead(file ? 200 : 404, {
    'Content-Type': `${file?.type ?? 'text/plain'}; charset=utf-8`,
  });
  response.end(file?.bytes);
});
server.listen(port, '127.0.0.1', () =>
  console.log(`Desktop fixture ready ${port}`),
);
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.on(signal, () => {
    server.close();
    server.closeAllConnections();
  });

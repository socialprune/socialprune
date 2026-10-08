import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCAL_REVIEW_POLICY } from '../src/local-review/policy.ts';

// Test-only denial fixture. No server module is imported by a production
// entrypoint, and no successful exchange or workspace API is implemented here.
export async function deniedReviewServer() {
  const directory = fileURLToPath(new URL('../dist-review/', import.meta.url));
  const files = new Map<string, { bytes: Buffer; type: string }>();
  async function walk(folder: string, prefix = '') {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = resolve(folder, entry.name);
      if (entry.isDirectory()) await walk(path, `${prefix}${entry.name}/`);
      else
        files.set(`/${prefix}${entry.name}`, {
          bytes: await readFile(path),
          type: entry.name.endsWith('.html')
            ? 'text/html'
            : entry.name.endsWith('.js')
              ? 'text/javascript'
              : entry.name.endsWith('.css')
                ? 'text/css'
                : 'application/octet-stream',
        });
    }
  }
  await walk(directory);
  const exchanges: {
    token: string | undefined;
    origin: string | undefined;
    method: string | undefined;
    body: string;
  }[] = [];
  const server = createServer((request, response) => {
    response.setHeader('Content-Security-Policy', LOCAL_REVIEW_POLICY);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    if (request.url === '/session') {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        body += chunk;
      });
      request.on('end', () => {
        exchanges.push({
          token: request.headers['x-socialprune-bootstrap'] as
            string | undefined,
          origin: request.headers.origin,
          method: request.method,
          body,
        });
        response.writeHead(401);
        response.end();
      });
      return;
    }
    const file = files.get(
      request.url === '/' ? '/index.html' : (request.url ?? ''),
    );
    if (!file || !['GET', 'HEAD'].includes(request.method ?? '')) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.setHeader('Content-Type', `${file.type}; charset=utf-8`);
    response.writeHead(200);
    response.end(request.method === 'HEAD' ? undefined : file.bytes);
  });
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Test server address missing.');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    exchanges,
    async close() {
      await new Promise<void>((done, reject) => {
        server.close((error) => (error ? reject(error) : done()));
        server.closeAllConnections();
      });
    },
    marker: 'always-denied-review-fixture',
  };
}

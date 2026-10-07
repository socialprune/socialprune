import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultOutput = fileURLToPath(new URL('../dist/', import.meta.url));
export async function startStaticServer(port: number, output = defaultOutput) {
  let root = output;
  const failures = new Set<string>();
  const hits: string[] = [];
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
      .pathname;
    hits.push(path);
    if (!path.startsWith('/socialprune/') || path.includes('..')) {
      response.writeHead(404).end();
      return;
    }
    if (failures.has(path)) {
      response.writeHead(503).end();
      return;
    }
    if (path === '/socialprune/test-parent') {
      response.setHeader('Content-Type', 'text/html');
      response
        .writeHead(200)
        .end(
          '<!doctype html><html lang="en"><head><title>Test parent</title></head><body></body></html>',
        );
      return;
    }
    if (path.endsWith('/live-probe')) {
      response.writeHead(200).end('owned test probe');
      return;
    }
    const relative =
      path === '/socialprune/'
        ? 'index.html'
        : path.slice('/socialprune/'.length);
    void readFile(resolve(root, relative))
      .then((bytes) => {
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader(
          'Content-Type',
          (
            {
              '.html': 'text/html; charset=utf-8',
              '.js': 'text/javascript; charset=utf-8',
              '.css': 'text/css',
              '.svg': 'image/svg+xml',
              '.webmanifest': 'application/manifest+json',
            } as Record<string, string>
          )[extname(relative)] ?? 'application/octet-stream',
        );
        response.writeHead(200).end(bytes);
      })
      .catch(() => response.writeHead(404).end());
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    origin: `http://127.0.0.1:${port}`,
    hits,
    failures,
    switchOutput: (path: string) => {
      root = path;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}

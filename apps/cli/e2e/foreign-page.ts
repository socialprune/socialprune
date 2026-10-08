import { createServer } from 'node:http';
import type { BrowserContext } from '@playwright/test';

/** Browser-only hostile fixture. Nothing in the production graph imports e2e. */
export async function foreignPage() {
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(
      '<!doctype html><title>Generated foreign-origin fixture</title>',
    );
  });
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  );
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Foreign fixture did not bind.');
  return {
    origin: `http://127.0.0.1:${address.port}`,
    stop: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

export function browserSocketAudit(context: BrowserContext, origins: string[]) {
  const requests: string[] = [];
  context.on('request', (request) => requests.push(request.url()));
  return { requests, origins };
}

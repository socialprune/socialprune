import { createServer } from 'node:http';
import type { Item } from '@socialprune/core';
import { IG_FIXTURE } from './fixture.ts';
import type { Variant } from './fixture.ts';
import { listPage, postPage, postAnswer } from './pages.ts';

export async function fakeInstagram(port: number, items: readonly Item[]) {
  let variant: Variant = 'success',
    zone = 0;
  const requests: { method: string; path: string }[] = [],
    events: { inputs: string[]; clicks: string[]; added: string[] }[] = [];
  let beforeNavigation: (() => Promise<void>) | undefined;
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url!, `http://127.0.0.1:${port}`),
        path = url.pathname;
      requests.push({ method: request.method!, path });
      response.setHeader('Cache-Control', 'no-store');
      if (path === '/events') {
        let text = '';
        for await (const part of request) text += String(part);
        events.push(JSON.parse(text) as (typeof events)[number]);
        response.end('{}');
        return;
      }
      if (path === '/your_activity/interactions/comments') {
        await beforeNavigation?.();
        response.writeHead(variant === '429' ? 429 : 200, {
          'Content-Type': 'text/html',
        });
        response.end(listPage(items, variant, zone));
        return;
      }
      if (path.startsWith('/accounts/')) {
        response.end('<html lang="en"><h1>Login</h1></html>');
        return;
      }
      const post = /^\/(?:p|reel)\/([A-Za-z0-9_-]+)\/$/.exec(path);
      if (post) {
        if (post[1]!.startsWith('Generated_wrong_candidate')) {
          response.writeHead(200, { 'Content-Type': 'text/html' });
          response.end(
            postPage(items[items.length > 1 ? 1 : 0]!, 0, 'time').replaceAll(
              IG_FIXTURE.code,
              post[1]!,
            ),
          );
          return;
        }
        const index = items.findIndex(
          (_, index) => `${IG_FIXTURE.code}${index || ''}` === post[1],
        );
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end(
          postPage(items[Math.max(0, index)]!, Math.max(0, index), variant),
        );
        return;
      }
      if (path.startsWith('/data/')) {
        const index = items.findIndex(
          (_, index) => path === `/data/${IG_FIXTURE.code}${index || ''}.json`,
        );
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify(
            postAnswer(
              items[Math.max(0, index)]!,
              Math.max(0, index),
              variant,
              `http://127.0.0.1:${port}`,
              url.searchParams.has('different'),
            ),
          ),
        );
        return;
      }
      if (path.startsWith('/media/') || path === '/thumb.png') {
        const image = Buffer.from(IG_FIXTURE.png, 'base64');
        response.writeHead(200, {
          'Content-Type': variant === 'image-type' ? 'text/plain' : 'image/png',
        });
        response.end(
          variant === 'image-large' && path !== '/thumb.png'
            ? Buffer.concat([image, Buffer.alloc(5 * 1024 ** 2)])
            : image,
        );
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end('{}');
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    events,
    setVariant(value: Variant) {
      variant = value;
    },
    setZone(value: number) {
      zone = value;
    },
    beforeList(value: () => Promise<void>) {
      beforeNavigation = value;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

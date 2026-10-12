import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

export interface Fixture {
  tokenPair: { id: string; token: string };
  fetched: {
    id_str: string;
    text: string;
    user: { name: string; screen_name: string };
    photos: { url: string }[];
    quoted_tweet: { id_str: string };
    parent: { id_str: string };
    truncated: boolean;
    video: unknown;
  };
  plain: {
    id_str: string;
    text: string;
    user: { name: string; screen_name: string };
  };
  empty: Record<string, never>;
  tombstone: { __typename: string; tombstone: { text: string } };
  pngBase64: string;
  references: string[];
  expectedStatuses: string[];
  expectedRequests: string[];
  expectedExpandedCount: number;
}
export const fixture = JSON.parse(
  await readFile(new URL('./syndication.json', import.meta.url), 'utf8'),
) as Fixture;
export async function fakeSyndication(
  mode:
    | 'normal'
    | 'fail'
    | 'reset'
    | 'redirect'
    | 'foreign-photo'
    | 'bad-photo' = 'normal',
) {
  const requests: { url: URL; at: number }[] = [];
  let origin = '';
  const server = createServer((request, response) => {
    const url = new URL(request.url!, origin);
    requests.push({ url, at: performance.now() });
    if (url.pathname.startsWith('/photo/')) {
      if (mode === 'bad-photo') {
        response.writeHead(200, { 'Content-Type': 'image/png' });
        response.end('<svg onload="generated()"/>');
        return;
      }
      response.writeHead(200, { 'Content-Type': 'image/png' });
      response.end(Buffer.from(fixture.pngBase64, 'base64'));
      return;
    }
    if (mode === 'redirect') {
      response.writeHead(302, {
        Location: 'https://cdn.syndication.twimg.com/tweet-result?id=900001',
      });
      response.end();
      return;
    }
    const id = url.searchParams.get('id');
    if (
      mode === 'fail' ||
      (mode === 'reset' && !['900003', '900009'].includes(id!))
    ) {
      response.writeHead(500);
      response.end();
      return;
    }
    if (mode === 'reset') {
      response.writeHead(404);
      response.end();
      return;
    }
    if (id === '900003') {
      response.writeHead(404);
      response.end();
      return;
    }
    let data: unknown =
      id === '900001'
        ? {
            ...fixture.fetched,
            photos: fixture.fetched.photos.map((photo) => ({
              url:
                mode === 'foreign-photo'
                  ? 'https://pbs.twimg.com/generated.png'
                  : new URL(photo.url, origin).href,
            })),
          }
        : id === '900004'
          ? fixture.empty
          : id === '900005'
            ? fixture.tombstone
            : fixture.plain;
    if (id === '900006') data = { bad: 'Generated invalid response.' };
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(data));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    // Port 0: vitest runs test files in parallel, and a fixed port collides.
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Fake server did not listen.');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    requests,
    async stop() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

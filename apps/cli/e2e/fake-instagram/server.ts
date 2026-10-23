import { createServer } from 'node:http';
import type { Item } from '@socialprune/core';
import { IG_FIXTURE, POST_NOTICE_FIXTURE } from './fixture.ts';
import type { Variant } from './fixture.ts';
import { listPage, postPage, postAnswer, answerResponse } from './pages.ts';
import { setTimeout as delay } from 'node:timers/promises';

export async function fakeInstagram(port: number, items: readonly Item[]) {
  let variant: Variant = 'success',
    zone = 0,
    today = IG_FIXTURE.now.slice(0, 10),
    firstYear = 1919;
  const requests: { method: string; path: string }[] = [],
    events: {
      inputs: string[];
      choices: { type: string; side: string; unit: string; label: string }[];
      clicks: string[];
      added: string[];
      wheels: { area: string; x: number; y: number }[];
    }[] = [];
  let beforeNavigation: (() => Promise<void>) | undefined;
  const postVariants = new Map<number, Variant>();
  const hiddenPosts = new Set<number>();
  const slowPosts = new Map<number, number>();
  let emptyFilteredLists = 0;
  let clientSidePosts = false;
  let filteredPlaceholders: { count: number; status: boolean } | undefined;
  const candidates = new Map<
    number,
    readonly { code: string; variant: Variant }[]
  >();
  const candidatePost = (code: string) => {
    for (const [index, posts] of candidates) {
      const post = posts.find((post) => post.code === code);
      if (post) return { index, ...post };
    }
    return undefined;
  };
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
      if (path === '/restored') {
        const operation =
          url.searchParams.get('mutation') === '1'
            ? 'RestoredMutation'
            : 'RestoredCommentsQuery';
        response.setHeader('Content-Type', 'text/html');
        const signal = url.searchParams.get('limit');
        response.end(
          `<!doctype html><html lang="en"><body>Generated restored tab<script>fetch('/startup-read${signal === '429' || signal === 'signal' ? '?limit=' + signal : ''}',{method:'POST',headers:{'x-fb-friendly-name':'${operation}'}}).then(r=>r.json()).then(()=>document.body.dataset.ready='yes',()=>document.body.dataset.ready='blocked');</script></body></html>`,
        );
        return;
      }
      if (path === '/startup-read') {
        response.setHeader('Content-Type', 'application/json');
        if (url.searchParams.get('limit') === '429') response.statusCode = 429;
        response.end(
          url.searchParams.get('limit') === 'signal'
            ? '{"status":"feedback_required"}'
            : '{}',
        );
        return;
      }
      const notice = POST_NOTICE_FIXTURE.cases.find(
        (entry) =>
          entry.variant === url.searchParams.get('generated_case') &&
          entry.path === path,
      );
      if (notice) {
        const body =
          'padding' in notice
            ? Buffer.alloc(notice.padding, 32)
            : Buffer.from(notice.body);
        response.writeHead(404, {
          'Content-Type': notice.type,
          'Content-Length': String(body.length),
          ...('encoding' in notice
            ? { 'Content-Encoding': notice.encoding }
            : {}),
        });
        response.end(body);
        return;
      }
      if (path.startsWith('/api/v1/generated/post-notice/')) {
        const status = Number(path.split('/').at(-2));
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ status: 'generated-read-error' }));
        return;
      }
      if (path === '/api/v1/generated/read/') {
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Retry-After', IG_FIXTURE.other.code);
        response.setHeader('X-RateLimit-Remaining', IG_FIXTURE.other.username);
        if (variant === 'side-429') response.writeHead(429);
        const signal =
          variant === 'feedback-required'
            ? 'feedback_required'
            : variant === 'please-wait'
              ? 'please_wait'
              : variant === 'checkpoint-required'
                ? 'checkpoint_required'
                : variant === 'spam'
                  ? 'spam'
                  : null;
        response.end(
          JSON.stringify(
            signal
              ? { data: { message: signal }, unrelated: IG_FIXTURE.other.text }
              : { status: 'ok' },
          ),
        );
        return;
      }
      if (variant === 'signal-metrics' && path === '/graphql/query') {
        response.writeHead(403, { 'Content-Type': 'application/json' });
        response.end('{}');
        return;
      }
      if (variant === 'signal-metrics' && path === '/api/v1/generated/error/') {
        response.writeHead(503, { 'Content-Type': 'application/json' });
        response.end('{}');
        return;
      }
      if (path === '/your_activity/interactions/comments') {
        await beforeNavigation?.();
        response.writeHead(variant === '429' ? 429 : 200, {
          'Content-Type': 'text/html',
        });
        let html = listPage(
          items,
          variant,
          zone,
          { today, firstYear },
          candidates,
          postVariants,
          clientSidePosts,
        );
        if (emptyFilteredLists > 0) {
          emptyFilteredLists--;
          const anchor = 'for(const [index,row]of chosen.entries())';
          if (!html.includes(anchor))
            throw new Error('Generated filtered-list anchor missing');
          html = html.replace(anchor, 'if(start&&end)chosen=[];' + anchor);
        }
        if (filteredPlaceholders) {
          const anchor = 'for(const [index,row]of chosen.entries())';
          if (!html.includes(anchor))
            throw new Error('Generated placeholder anchor missing');
          html = html.replace(
            anchor,
            `if(start&&end){chosen=[];for(let i=0;i<${filteredPlaceholders.count};i++)emptyImageButton();${filteredPlaceholders.status ? "const status=document.createElement('div');status.setAttribute('role','status');status.textContent='No generated comments in this window';list.append(status);" : "list.setAttribute('aria-busy','true');"}}` +
              anchor,
          );
        }
        response.end(html);
        return;
      }
      if (path.startsWith('/accounts/')) {
        response.end('<html lang="en"><h1>Login</h1></html>');
        return;
      }
      const post = /^\/(?:p|reel)\/([A-Za-z0-9_-]+)\/?$/.exec(path);
      if (post) {
        const candidate = candidatePost(post[1]!);
        if (candidate) {
          response.writeHead(200, { 'Content-Type': 'text/html' });
          response.end(
            postPage(
              items[candidate.index]!,
              candidate.index,
              candidate.variant,
              candidate.code,
              hiddenPosts.has(candidate.index),
            ),
          );
          return;
        }
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
        const slow = slowPosts.get(index) ?? 0;
        if (slow > 0) {
          slowPosts.set(index, slow - 1);
          await delay(6500);
        }
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end(
          postPage(
            items[Math.max(0, index)]!,
            Math.max(0, index),
            postVariants.get(index) ?? variant,
            undefined,
            hiddenPosts.has(index),
          ),
        );
        return;
      }
      if (path.startsWith('/ajax/')) {
        const index = items.findIndex(
          (_, index) => path === `/ajax/${IG_FIXTURE.code}${index || ''}.json`,
        );
        const selected = postVariants.get(index) ?? variant;
        const answer = answerResponse(
          postAnswer(
            items[Math.max(0, index)]!,
            Math.max(0, index),
            selected,
            `http://127.0.0.1:${port}`,
            false,
          ),
          selected,
        );
        response.writeHead(200, { 'Content-Type': answer.type });
        response.end(answer.body);
        return;
      }
      if (path.startsWith('/data/')) {
        const candidate = candidatePost(
          path.slice('/data/'.length, -'.json'.length),
        );
        if (candidate) {
          response.writeHead(200, { 'Content-Type': 'application/json' });
          response.end(
            JSON.stringify(
              postAnswer(
                items[candidate.index]!,
                candidate.index,
                candidate.variant,
                `http://127.0.0.1:${port}`,
                url.searchParams.has('different'),
                candidate.code,
              ),
            ),
          );
          return;
        }
        const index = items.findIndex(
          (_, index) => path === `/data/${IG_FIXTURE.code}${index || ''}.json`,
        );
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(
          JSON.stringify(
            postAnswer(
              items[Math.max(0, index)]!,
              Math.max(0, index),
              postVariants.get(index) ?? variant,
              `http://127.0.0.1:${port}`,
              url.searchParams.has('different'),
            ),
          ),
        );
        return;
      }
      if (
        path.startsWith('/media/') ||
        path.startsWith('/profiles/') ||
        path === '/thumb.png'
      ) {
        const image = Buffer.from(IG_FIXTURE.png, 'base64');
        response.writeHead(200, {
          'Content-Type': variant === 'image-type' ? 'text/plain' : 'image/png',
        });
        response.end(
          variant === 'image-large' && path.startsWith('/media/')
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
  let closing: Promise<void> | undefined;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    events,
    get listening() {
      return server.listening;
    },
    setVariant(value: Variant) {
      variant = value;
    },
    setPostVariant(index: number, value: Variant) {
      if (!Number.isInteger(index) || !items[index])
        throw new Error('Invalid generated post index.');
      postVariants.set(index, value);
    },
    slowPostOpens(index: number, count: number) {
      if (!items[index] || !Number.isInteger(count) || count < 0)
        throw new Error('Invalid generated slow opens');
      slowPosts.set(index, count);
    },
    clientSidePostOpens() {
      clientSidePosts = true;
    },
    emptyFilteredLists(count: number) {
      if (!Number.isInteger(count) || count < 0)
        throw new Error('Invalid generated empty-filtered-list count');
      emptyFilteredLists = count;
    },
    filteredListPlaceholders(count: number, status: boolean) {
      if (!Number.isInteger(count) || count < 0 || count > 20)
        throw new Error('Invalid generated placeholder count');
      filteredPlaceholders = { count, status };
    },
    setPostHidden(index: number) {
      if (!items[index])
        throw new Error('Invalid generated hidden post index.');
      hiddenPosts.add(index);
    },
    setCandidates(index: number, variants: readonly Variant[]) {
      if (
        !Number.isInteger(index) ||
        !items[index] ||
        variants.length < 1 ||
        variants.length > IG_FIXTURE.candidateCodes.length
      )
        throw new Error('Invalid generated candidate rows.');
      candidates.set(
        index,
        variants.map((variant, candidate) => ({
          code: `${IG_FIXTURE.candidateCodes[candidate]}${index || ''}`,
          variant,
        })),
      );
    },
    setZone(value: number) {
      zone = value;
    },
    setToday(value: string) {
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value))
      )
        throw new Error('Invalid generated current day.');
      today = value;
    },
    setFirstYear(value: number) {
      if (!Number.isInteger(value) || value < 1000 || value > 9999)
        throw new Error('Invalid generated first year.');
      firstYear = value;
    },
    beforeList(value: () => Promise<void>) {
      beforeNavigation = value;
    },
    close() {
      return (closing ??= (async () => {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      })());
    },
  };
}

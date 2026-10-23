import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { FIXTURE } from './fixture.ts';
import { TEST_PORTS, TEST_ORIGINS } from '../../playwright.ports.config.ts';

export type Variant =
  | 'success'
  | 'not-found'
  | 'login'
  | 'challenge'
  | 'lock'
  | 'limit'
  | 'unknown'
  | 'errors'
  | '500'
  | '429'
  | 'side-429'
  | 'unconfirmed'
  | 'ambiguous'
  | 'shape'
  | 'wrong-id'
  | 'external'
  | 'mutation';
export async function fakeX(port = TEST_PORTS.x) {
  const variants = new Map<string, Variant>();
  const scripts = new Map<string, string>();
  const rateHeaders = new Map<string, Record<string, string>>();
  const gone = new Set<string>();
  const requests: {
    method: string;
    path: string;
    id: string | null;
    at: number;
  }[] = [];
  const sockets = new Set<Socket>();
  let german = false;
  let accessibleOnly = false;
  let handle: string = FIXTURE.account.handle;
  let navDelay = 0,
    articleCount = 1,
    navMissing = false;
  const names = () =>
    german
      ? {
          more: 'Mehr',
          delete: 'Löschen',
          repost: 'Repostet',
          undo: 'Repost rückgängig machen',
          deleted: 'Dein Post wurde gelöscht',
          undone: 'Dein Repost wurde rückgängig gemacht',
        }
      : {
          more: 'More',
          delete: 'Delete',
          repost: 'Reposted',
          undo: 'Undo repost',
          deleted: 'Your post was deleted',
          undone: 'Your repost was undone',
        };
  const attr = (value: string) =>
    accessibleOnly ? '' : `data-testid="${value}"`;
  const server = createServer((request, response) => {
    const path = request.url ?? '';
    const id = /\/status\/(\d+)$/.exec(path)?.[1] ?? null;
    requests.push({ method: request.method ?? '', path, id, at: Date.now() });
    if (path === '/i/api/generated-limit') {
      response.writeHead(429);
      response.end();
      return;
    }
    if (scripts.has(path)) {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(scripts.get(path));
      return;
    }
    if (
      request.method === 'POST' &&
      (path.startsWith('/graphql/') || path.startsWith('/i/api/graphql/'))
    ) {
      let bytes = '';
      request.on('data', (part: Buffer) => {
        bytes += part.toString();
      });
      request.on('end', () => {
        const value = JSON.parse(bytes) as { id: string };
        requests[requests.length - 1]!.id = value.id;
        const variant = variants.get(value.id) ?? 'success';
        for (const [name, header] of Object.entries(
          rateHeaders.get(value.id) ?? {},
        ))
          response.setHeader(name, header);
        if (variant === 'ambiguous') return;
        response.setHeader('Content-Type', 'application/json');
        if (variant === '500' || variant === '429') {
          response.writeHead(variant === '429' ? 429 : 500);
          response.end(JSON.stringify({ error: 'generated failure' }));
          return;
        }
        if (variant === 'errors') {
          response.end(
            JSON.stringify({
              data: null,
              errors: [{ message: 'generated failure' }],
            }),
          );
          return;
        }
        if (variant !== 'unconfirmed') gone.add(value.id);
        response.end(
          JSON.stringify(
            variant === 'shape'
              ? { data: { unexpected: { id: value.id } } }
              : { data: { delete_result: { id: value.id } } },
          ),
        );
      });
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    const nav = `<button data-testid="SideNav_AccountSwitcher_Button">Generated account @${handle}</button>`;
    const account = navMissing
      ? ''
      : navDelay
        ? `<div id="nav"></div><script>setTimeout(()=>document.getElementById('nav').innerHTML=${JSON.stringify(nav)},${navDelay})</script>`
        : nav;
    const variant = id ? (variants.get(id) ?? 'success') : 'success';
    const pageId = variant === 'wrong-id' ? '9999' : id;
    if (['login', 'challenge', 'lock', 'limit', 'unknown'].includes(variant)) {
      const decoys = {
        login: '<button data-testid="loginButton">Log in to X</button>',
        challenge: '<p data-testid="challenge">Confirm you are human</p>',
        lock: '<p data-testid="lockedAccount">Your account is locked</p>',
        limit: '<p data-testid="rateLimit">Rate limit exceeded</p>',
        unknown: '<p>Generated unrelated page</p>',
      };
      response.end(
        `<!doctype html>${account}${decoys[variant as keyof typeof decoys]}`,
      );
      return;
    }
    if (id && (variant === 'not-found' || gone.has(id))) {
      response.end(
        `<!doctype html>${account}<p data-testid="error-detail">${german ? 'Dieser Post existiert nicht.' : "This Post doesn't exist."}</p>`,
      );
      return;
    }
    if (!id) {
      response.end(`<!doctype html>${account}<main>Generated home</main>`);
      return;
    }
    const name = names();
    const repost = FIXTURE.rows.find((row) => row.id === id)?.kind === 'repost';
    const buttons = repost
      ? `<button ${attr('unretweet')} id="repost">${name.repost}</button>`
      : `<button ${attr('caret')} id="more">${name.more}</button>`;
    const other = Array.from(
      { length: articleCount - 1 },
      (_, index) =>
        `<article data-testid="tweet"><a href="/other/status/${2000 + index}"><time>2020</time></a><p data-testid="tweetText">Generated other post</p><button data-testid="caret" onclick="window.decoyClicked=true">${name.more}</button><button data-testid="unretweet" onclick="window.decoyClicked=true">${name.repost}</button></article>`,
    ).join('');
    response.end(`<!doctype html><html><body>${account}${other}<article data-testid="tweet"><a href="/fixture/status/${pageId}"><time>2020-01-01</time></a><p data-testid="tweetText">Generated post ${id}</p>${buttons}</article><div id="menu" hidden><button role="menuitem" ${attr(repost ? 'unretweetConfirm' : 'delete')} id="delete">${repost ? name.undo : name.delete}</button></div><div role="dialog" id="dialog" hidden><button ${attr('confirmationSheetConfirm')} id="confirm">${name.delete}</button></div><div data-testid="toast" hidden id="toast"></div><script>
    const menu=document.getElementById('menu'), dialog=document.getElementById('dialog'), toast=document.getElementById('toast');
    async function send(){ const r=await fetch('/i/api/graphql/generated/${repost ? 'DeleteRetweet' : 'DeleteTweet'}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'${id}'})}); const b=await r.json(); if(r.status===200&&b.data&&!b.errors){menu.hidden=true;dialog.hidden=true;toast.textContent='${variant === 'unconfirmed' ? 'Generated result not confirmed' : repost ? name.undone : name.deleted}';toast.hidden=false;} }
    document.getElementById('${repost ? 'repost' : 'more'}').onclick=()=>menu.hidden=false;
    document.getElementById('delete').onclick=${repost ? 'send' : '()=>{menu.hidden=true;dialog.hidden=false;}'};
    document.getElementById('confirm').onclick=send;
    ${variant === 'external' ? `const decoy=document.createElement('img');decoy.src='${TEST_ORIGINS.foreign}/decoy';document.body.appendChild(decoy);fetch('${TEST_ORIGINS.foreign}/generated/CreateCheckoutSession',{method:'POST',mode:'no-cors'}).catch(()=>{});` : ''}
    ${variant === 'mutation' ? "fetch('/i/api/graphql/generated/FavoriteTweet',{method:'POST'}).catch(()=>{});" : ''}
    ${variant === 'side-429' ? "fetch('/i/api/generated-limit').catch(()=>{});" : ''}
    </script></body></html>`);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    origin: `http://127.0.0.1:${port}`,
    variants,
    scripts,
    rateHeaders,
    gone,
    requests,
    setLanguage(de: boolean) {
      german = de;
    },
    setAccessibleOnly(value: boolean) {
      accessibleOnly = value;
    },
    setHandle(value: string) {
      handle = value;
    },
    renderOptions(options: {
      navDelay?: number;
      articleCount?: number;
      navMissing?: boolean;
    }) {
      navDelay = options.navDelay ?? 0;
      articleCount = options.articleCount ?? 1;
      navMissing = options.navMissing ?? false;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

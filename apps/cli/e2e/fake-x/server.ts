import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { FIXTURE } from './fixture.ts';

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
  | 'ambiguous'
  | 'shape'
  | 'wrong-id'
  | 'external';
export async function fakeX(port = 4231) {
  const variants = new Map<string, Variant>();
  const scripts = new Map<string, string>();
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
    if (scripts.has(path)) {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(scripts.get(path));
      return;
    }
    if (request.method === 'POST' && path.startsWith('/graphql/')) {
      let bytes = '';
      request.on('data', (part: Buffer) => {
        bytes += part.toString();
      });
      request.on('end', () => {
        const value = JSON.parse(bytes) as { id: string };
        requests[requests.length - 1]!.id = value.id;
        const variant = variants.get(value.id) ?? 'success';
        if (variant === 'ambiguous') return;
        response.setHeader('Content-Type', 'application/json');
        if (variant === '500') {
          response.writeHead(500);
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
        gone.add(value.id);
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
    const account = `<button data-testid="SideNav_AccountSwitcher_Button">Generated account @${handle}</button>`;
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
    response.end(`<!doctype html><html><body>${account}<article data-testid="tweet"><a href="/fixture/status/${pageId}"><time>2020-01-01</time></a><p>Generated post ${id}</p>${buttons}</article><div id="menu" hidden><button role="menuitem" ${attr(repost ? 'unretweetConfirm' : 'delete')} id="delete">${repost ? name.undo : name.delete}</button></div><div role="dialog" id="dialog" hidden><button ${attr('confirmationSheetConfirm')} id="confirm">${name.delete}</button></div><div data-testid="toast" hidden id="toast"></div><script>
    const menu=document.getElementById('menu'), dialog=document.getElementById('dialog'), toast=document.getElementById('toast');
    async function send(){ const r=await fetch('/graphql/generated/${repost ? 'DeleteRetweet' : 'DeleteTweet'}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:'${id}'})}); const b=await r.json(); if(r.status===200&&b.data&&!b.errors){menu.hidden=true;dialog.hidden=true;toast.textContent='${repost ? name.undone : name.deleted}';toast.hidden=false;} }
    document.getElementById('${repost ? 'repost' : 'more'}').onclick=()=>menu.hidden=false;
    document.getElementById('delete').onclick=${repost ? 'send' : '()=>{menu.hidden=true;dialog.hidden=false;}'};
    document.getElementById('confirm').onclick=send;
    ${variant === 'external' ? "const decoy=document.createElement('img');decoy.src='http://127.0.0.1:4239/decoy';document.body.appendChild(decoy);" : ''}
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
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

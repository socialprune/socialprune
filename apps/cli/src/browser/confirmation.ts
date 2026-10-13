import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ReviewSession } from '../review/session.ts';
import { REVIEW_HEADERS, REVIEW_POLICY } from '../review/static.ts';

export interface ConfirmationView {
  phase: 'start' | 'running' | 'canary' | 'match' | 'ended';
  version: number;
  warning: string;
  profileWarning: string;
  expectedHandle?: string;
  planned: number;
  bulk: number;
  estimateMs: number;
  list: string;
  rows: unknown[];
  completed: number;
  result: string;
}
const document = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${REVIEW_POLICY}"><title>SocialPrune browser run</title><script src="/confirmation.js" defer></script></head><body><main><h1>SocialPrune browser run</h1><p id="account"></p><p id="warning"></p><p id="profile"></p><p id="counts"></p><p id="list"></p><pre id="rows"></pre><p id="result" role="status"></p><button id="start" hidden>Start</button><button id="continue" hidden>Continue</button><button id="matches" hidden>Matches</button><button id="does-not-match" hidden>Does not match</button><button id="stop" hidden>Stop</button></main></body></html>`;
// No template, HTML injection or export text inside JavaScript. The page only
// renders JSON as text nodes, under the local review's actual response policy.
const script = `(() => {
const bootstrap = new URLSearchParams(location.hash.slice(1)).get('bootstrap');
history.replaceState(null, '', '/');
let csrf, view;
async function post(path, body, token) {
 const response = await fetch(path, {method:'POST',headers:{'Content-Type':'application/json', ...(token ? {'X-SocialPrune-Bootstrap':token} : {'X-SocialPrune-CSRF':csrf})}, body:JSON.stringify(body)});
 if(!response.ok) throw new Error('Session ended'); return response.json();
}
function render(v) {
  view = v;
  document.getElementById('account').textContent=v.expectedHandle ? 'Expected X account: @'+v.expectedHandle : '';
 document.getElementById('warning').textContent=v.warning;
 document.getElementById('profile').textContent=v.profileWarning;
 document.getElementById('counts').textContent=v.planned+' planned; '+v.bulk+' from bulk actions; '+v.completed+' completed. Estimated active time '+Math.ceil(v.estimateMs/60000)+' minutes.';
 document.getElementById('list').textContent='Full list: '+v.list;
 document.getElementById('rows').textContent=JSON.stringify(v.rows,null,2);
 document.getElementById('result').textContent=v.result;
 document.getElementById('start').hidden=v.phase!=='start';
 document.getElementById('continue').hidden=v.phase!=='canary';
 document.getElementById('matches').hidden=v.phase!=='match';
 document.getElementById('does-not-match').hidden=v.phase!=='match';
 document.getElementById('stop').hidden=v.phase==='ended';
}
for(const action of ['start','continue','matches','does-not-match','stop']) document.getElementById(action).addEventListener('click', async event => {
 if(!event.isTrusted || !view) return;
 try { render(await post('/api/action',{action,version:view.version})); } catch { document.getElementById('result').textContent='Session ended. Nothing further will run.'; }
});
(async () => {try {const session=await post('/session',{},bootstrap); csrf=session.csrf; render(await post('/api/view',{})); const poll=async()=>{try {render(await post('/api/view',{})); if(view.phase!=='ended') setTimeout(poll,200);} catch {document.getElementById('result').textContent='Session ended';}}; setTimeout(poll,200);} catch {document.getElementById('result').textContent='Session ended';}})();
})();`;

function header(request: IncomingMessage, name: string): string | undefined {
  const values: string[] = [];
  for (let i = 0; i < request.rawHeaders.length; i += 2)
    if (request.rawHeaders[i]!.toLowerCase() === name)
      values.push(request.rawHeaders[i + 1]!);
  return values.length === 1 ? values[0] : undefined;
}
export async function startConfirmation(
  initial: Omit<ConfirmationView, 'version'>,
  port = 0,
) {
  let view: ConfirmationView = { ...initial, version: 1 };
  let authority = '';
  let pending:
    | {
        action: 'start' | 'continue' | 'matches';
        resolve(value: boolean): void;
      }
    | undefined;
  let stopped = false;
  const session = new ReviewSession();
  const stopListeners = new Set<() => void>();
  const reply = (response: ServerResponse, status: number, data?: unknown) => {
    response.writeHead(status, {
      ...REVIEW_HEADERS,
      'Content-Type': 'application/json',
    });
    response.end(data === undefined ? '' : JSON.stringify(data));
  };
  const server = createServer(
    { headersTimeout: 10_000, requestTimeout: 30_000, keepAliveTimeout: 5_000 },
    (request, response) => {
      void route(request, response).catch(() => {
        if (!response.headersSent) reply(response, 400);
        else response.end();
      });
    },
  );
  async function route(request: IncomingMessage, response: ServerResponse) {
    const origin = header(request, 'origin');
    const site = header(request, 'sec-fetch-site');
    if (
      header(request, 'host') !== authority ||
      request.method === 'OPTIONS' ||
      (origin !== undefined && origin !== `http://${authority}`) ||
      (site !== undefined && !['same-origin', 'none'].includes(site))
    ) {
      reply(response, 403);
      request.resume();
      return;
    }
    if (
      request.method === 'GET' &&
      ['/', '/confirmation.js'].includes(request.url ?? '')
    ) {
      response.writeHead(200, {
        ...REVIEW_HEADERS,
        'Content-Type':
          request.url === '/'
            ? 'text/html; charset=utf-8'
            : 'text/javascript; charset=utf-8',
      });
      response.end(request.url === '/' ? document : script);
      return;
    }
    if (request.method !== 'POST') {
      reply(response, 405);
      request.resume();
      return;
    }
    if (
      origin !== `http://${authority}` ||
      (site !== undefined && site !== 'same-origin')
    ) {
      reply(response, 403);
      request.resume();
      return;
    }
    if (header(request, 'content-type') !== 'application/json') {
      reply(response, 415);
      request.resume();
      return;
    }
    const parts: Buffer[] = [];
    let size = 0;
    for await (const part of request as AsyncIterable<Buffer>) {
      size += part.length;
      if (size <= 1024 * 1024) parts.push(part);
    }
    if (size > 1024 * 1024) {
      reply(response, 413);
      return;
    }
    const body: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)),
    );
    if (request.url === '/session') {
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).length
      ) {
        reply(response, 400);
        return;
      }
      const exchanged = session.exchange(
        header(request, 'x-socialprune-bootstrap'),
      );
      if (!exchanged) {
        reply(response, 401);
        return;
      }
      response.setHeader('Set-Cookie', exchanged.cookie);
      reply(response, 200, { csrf: exchanged.csrf });
      return;
    }
    if (!session.authenticated(header(request, 'cookie'))) {
      reply(response, 401);
      return;
    }
    if (!session.authorized(header(request, 'x-socialprune-csrf'))) {
      reply(response, 403);
      return;
    }
    if (
      request.url === '/api/view' &&
      body &&
      typeof body === 'object' &&
      Object.keys(body).length === 0
    ) {
      reply(response, 200, view);
      return;
    }
    if (request.url !== '/api/action') {
      reply(response, 404);
      return;
    }
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).sort().join(',') !== 'action,version' ||
      !('action' in body) ||
      !('version' in body) ||
      body.version !== view.version
    ) {
      reply(response, 409);
      return;
    }
    if (
      (body.action === 'stop' ||
        (body.action === 'does-not-match' && view.phase === 'match')) &&
      view.phase !== 'ended'
    ) {
      stopped = true;
      pending?.resolve(false);
      pending = undefined;
      for (const listener of stopListeners) listener();
      view = {
        ...view,
        phase: 'ended',
        version: view.version + 1,
        result: 'Stopped by you.',
      };
    } else if (
      pending &&
      pending.action === body.action &&
      ((body.action === 'start' && view.phase === 'start') ||
        (body.action === 'continue' && view.phase === 'canary') ||
        (body.action === 'matches' && view.phase === 'match'))
    ) {
      pending.resolve(true);
      pending = undefined;
      view = { ...view, phase: 'running', version: view.version + 1 };
    } else {
      reply(response, 409);
      return;
    }
    reply(response, 200, view);
  }
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Listener failed');
  authority = `127.0.0.1:${address.port}`;
  return {
    url: `http://${authority}/`,
    launchUrl: `http://${authority}/#bootstrap=${session.bootstrap}`,
    get stopped() {
      return stopped;
    },
    update(update: Partial<Omit<ConfirmationView, 'version'>>) {
      view = { ...view, ...update, version: view.version + 1 };
    },
    wait(action: 'start' | 'continue' | 'matches'): Promise<boolean> {
      if (stopped) return Promise.resolve(false);
      if (pending) throw new Error('Already waiting');
      return new Promise((resolve) => {
        pending = { action, resolve };
      });
    },
    onStop(listener: () => void) {
      stopListeners.add(listener);
    },
    async close() {
      pending?.resolve(false);
      pending = undefined;
      session.invalidate();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
export type Confirmation = Awaited<ReturnType<typeof startConfirmation>>;

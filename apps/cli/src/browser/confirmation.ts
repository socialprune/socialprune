import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ReviewSession } from '../review/session.ts';
import { REVIEW_HEADERS, REVIEW_POLICY } from '../review/static.ts';
import { endText } from './copy.ts';
import type { BrowserLanguage } from './copy.ts';

export interface ConfirmationView {
  lang?: BrowserLanguage;
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
const LABELS = {
  en: {
    title: 'SocialPrune browser run',
    continue: 'Continue',
    matches: 'Matches',
    mismatch: 'Does not match',
    stop: 'Stop',
    rows: 'Planned entries',
    status: 'Run status',
  },
  de: {
    title: 'SocialPrune im Browser',
    continue: 'Weiter',
    matches: 'Passt',
    mismatch: 'Passt nicht',
    stop: 'Stopp',
    rows: 'Geplante Einträge',
    status: 'Laufstatus',
  },
};
function document(lang: BrowserLanguage): string {
  const labels = LABELS[lang];
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${REVIEW_POLICY}"><title>${labels.title}</title><link rel="stylesheet" href="/confirmation.css"><script src="/confirmation.js" defer></script></head><body><main><header><p class="brand">SocialPrune</p><h1>${labels.title}</h1></header><section class="plan"><p id="account"></p><p id="counts"></p><p id="list"></p><details><summary>${labels.rows}</summary><pre id="rows"></pre></details></section><section class="warning"><p id="warning"></p><p id="profile"></p></section><section class="state" aria-label="${labels.status}"><p id="result" role="status" aria-live="polite"></p></section><nav class="actions"><button id="start" class="primary" hidden>Start</button><button id="continue" class="primary" hidden>${labels.continue}</button><button id="matches" class="primary" hidden>${labels.matches}</button><button id="does-not-match" hidden>${labels.mismatch}</button><button id="stop" hidden>${labels.stop}</button></nav></main></body></html>`;
}
const stylesheet = `:root{color-scheme:light;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17243d;background:#f5f7fb;line-height:1.55}*{box-sizing:border-box}body{margin:0;padding:1.5rem}main{max-width:58rem;margin:0 auto}header{padding:.5rem 0 1rem}.brand{color:#3159c9;font-weight:700;margin:0}h1{font-size:clamp(1.5rem,4vw,2rem);line-height:1.2;margin:.35rem 0 1rem}section{background:#fff;border:1px solid #d5dceb;border-radius:.65rem;padding:1.1rem 1.3rem;margin-bottom:1rem}p{margin:.2rem 0 .8rem}p:last-child{margin-bottom:0}.warning{border-left:4px solid #a36b11;background:#fffaf0}.plan #account{font-weight:650}.plan #list{overflow-wrap:anywhere}details{margin-top:.8rem}summary{cursor:pointer;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:.9rem;line-height:1.5}.state{border-left:4px solid #3159c9}#result{font-weight:600}.actions{display:flex;gap:.75rem;flex-wrap:wrap;padding-bottom:1.5rem}button{font:inherit;min-height:2.9rem;padding:.65rem 1.4rem;border:1px solid #6a7895;border-radius:.45rem;color:inherit;background:#fff;cursor:pointer}.primary{background:#254dbe;color:#fff;border-color:#254dbe;font-weight:650}button:hover{filter:brightness(.94)}button:focus-visible,summary:focus-visible{outline:3px solid #d68808;outline-offset:3px}[hidden]{display:none!important}@media(max-width:32rem){body{padding:1rem}section{padding:1rem}.actions button{flex:1}}`;
// No template, HTML injection or export text inside JavaScript. The page only
// renders JSON as text nodes, under the local review's actual response policy.
const script = `(() => {
const bootstrap = new URLSearchParams(location.hash.slice(1)).get('bootstrap');
history.replaceState(null, '', '/');
let csrf, view;
const de = document.documentElement.lang==='de';
const sessionEnded = de ? 'Sitzung beendet. Es laufen keine weiteren Schritte.' : 'Session ended. Nothing further will run.';
const rowLabels = de ? {id:'Beitrag',itemId:'Eintrag',eventId:'Entscheidung',date:'Datum',kind:'Art',action:'Aktion',firstLine:'Erste Zeile',decisionTime:'Entschieden am',via:'Quelle',origin:'Ursprung',reasons:'Gründe',reference:'Bezug'} : {};
const values = de ? {'post':'Beitrag','reply':'Antwort','quote':'Zitat','repost':'Repost','delete-post':'Beitrag löschen','undo-repost':'Repost rückgängig machen','bulk':'Sammelaktion','single':'Einzelentscheidung','unseen':'Bisher nicht sichtbar','long-text':'Langer Text','media':'Medien'} : {};
async function post(path, body, token) {
 const response = await fetch(path, {method:'POST',headers:{'Content-Type':'application/json', ...(token ? {'X-SocialPrune-Bootstrap':token} : {'X-SocialPrune-CSRF':csrf})}, body:JSON.stringify(body)});
 if(!response.ok) throw new Error(sessionEnded); return response.json();
}
function render(v) {
  view = v;
  document.getElementById('account').textContent=v.expectedHandle ? (de?'Erwartetes X-Konto: @':'Expected X account: @')+v.expectedHandle : '';
 document.getElementById('warning').textContent=v.warning;
 document.getElementById('profile').textContent=v.profileWarning;
 document.getElementById('counts').textContent=de ? v.planned+' geplant; '+v.bulk+' aus Sammelaktionen; '+v.completed+' abgeschlossen. Geschätzte aktive Dauer: '+Math.ceil(v.estimateMs/60000)+' Minuten.' : v.planned+' planned; '+v.bulk+' from bulk actions; '+v.completed+' completed. Estimated active time '+Math.ceil(v.estimateMs/60000)+' minutes.';
 document.getElementById('list').textContent=(de?'Vollständige Liste: ':'Full list: ')+v.list;
 const show = value => Array.isArray(value) ? value.map(show).join(', ') : typeof value==='string' ? values[value] || value : String(value);
 document.getElementById('rows').textContent=v.rows.map(row=>Object.entries(row).map(([key,value])=>(rowLabels[key] || key)+': '+show(value)).join('\\n')).join('\\n\\n');
 document.getElementById('result').textContent=v.result;
 document.getElementById('start').hidden=v.phase!=='start';
 document.getElementById('continue').hidden=v.phase!=='canary';
 document.getElementById('matches').hidden=v.phase!=='match';
 document.getElementById('does-not-match').hidden=v.phase!=='match';
 document.getElementById('stop').hidden=v.phase==='ended';
}
for(const action of ['start','continue','matches','does-not-match','stop']) document.getElementById(action).addEventListener('click', async event => {
 if(!event.isTrusted || !view) return;
  try { render(await post('/api/action',{action,version:view.version})); } catch { if(view?.phase!=='ended') document.getElementById('result').textContent=sessionEnded; }
});
(async () => {try {const session=await post('/session',{},bootstrap); csrf=session.csrf; render(await post('/api/view',{})); const poll=async()=>{try {render(await post('/api/view',{})); setTimeout(poll,200);} catch {if(view?.phase!=='ended')document.getElementById('result').textContent=sessionEnded;}}; setTimeout(poll,200);} catch {document.getElementById('result').textContent=sessionEnded;}})();
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
  const lang = initial.lang ?? 'en';
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
      ['/', '/confirmation.js', '/confirmation.css'].includes(request.url ?? '')
    ) {
      response.writeHead(200, {
        ...REVIEW_HEADERS,
        'Content-Type':
          request.url === '/'
            ? 'text/html; charset=utf-8'
            : request.url === '/confirmation.css'
              ? 'text/css; charset=utf-8'
              : 'text/javascript; charset=utf-8',
      });
      response.end(
        request.url === '/'
          ? document(lang)
          : request.url === '/confirmation.css'
            ? stylesheet
            : script,
      );
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
        result: endText('stopped-by-person', lang),
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

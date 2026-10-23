import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openLabelStore } from './label-store.mjs';
import { loadDataset } from './dataset.mjs';
import { DEFAULT_CATEGORIES, categoryNames, descriptions, readRubric } from './contract.mjs';

const assets = { '/': ['label.html', 'text/html'], '/app.mjs': ['label-page.mjs', 'text/javascript'], '/style.css': ['label.css', 'text/css'] };
export async function createLabelServer({ port = 4761, dataset, rubric, directory } = {}) {
  if (!Number.isInteger(port) || port < 4761 || port > 4765) throw new Error('Use a port from 4761 to 4765');
  dataset ??= await loadDataset();
  rubric ??= (await readRubric()).text;
  directory ??= fileURLToPath(new URL('local/', import.meta.url));
  const store = await openLabelStore({ ...dataset, rubric, directory });
  const origin = `http://127.0.0.1:${port}`, token = randomBytes(32).toString('hex');
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; font-src 'none'; worker-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const json = (code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      if (req.headers.host !== `127.0.0.1:${port}` || (req.headers.origin && req.headers.origin !== origin) ||
        (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) return json(403, { error: 'ORIGIN_REFUSED' });
      if (req.method === 'GET' && assets[req.url]) {
        const [file, type] = assets[req.url];
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); res.end(await readFile(new URL(file, import.meta.url))); return;
      }
      if (req.method === 'GET' && req.url === '/api/state') return json(200, { ...store.view(), token, rubric,
        categories: DEFAULT_CATEGORIES.map((id, i) => ({ id, de: categoryNames[i], definition: descriptions[id] })) });
      if (req.method === 'POST' && req.url === '/api/action') {
        if (req.headers.origin !== origin || req.headers['x-s2-token'] !== token || req.headers['content-type'] !== 'application/json') return json(403, { error: 'ACTION_REFUSED' });
        let body = '';
        for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 16000) return json(413, { error: 'BODY_TOO_LARGE' }); }
        return json(200, await store.action(JSON.parse(body)));
      }
      json(404, { error: 'NOT_FOUND' });
    } catch (error) { json(409, { error: String(error.message).slice(0, 300) }); }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); }
  catch (error) { await store.close(); throw error; }
  return { origin, store, async close() {
    await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    await store.close();
  } };
}
export async function startLabelPage() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--port' || !/^476[1-5]$/.test(args[1]))) throw new Error('Usage: node label-server.mjs [--port 4761..4765]');
  const app = await createLabelServer({ port: args.length ? Number(args[1]) : 4761 });
  console.log(`S2 label page: ${app.origin}\nLocal labels: spikes/s2-classify/local/labels.history.jsonl\nNo model is involved. Press Ctrl+C to stop.`);
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { if (closing) return; closing = true; await app.close(); });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) startLabelPage().catch(error => { console.error(error.message); process.exitCode = 1; });

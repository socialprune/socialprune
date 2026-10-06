import workerURL from './worker.js?worker&url';

const variant = location.pathname.match(/(V[1-5])\.html/)?.[1] || 'V3';
const status = document.querySelector('#status');
const events = [];
let activeWorker;

function report(event) {
  events.push(event);
  globalThis.s3report?.(event);
}

document.addEventListener('securitypolicyviolation', event => report({
  kind: 'csp', source: 'document', blockedURI: event.blockedURI,
  effectiveDirective: event.effectiveDirective, originalPolicy: event.originalPolicy,
}));

async function ready() {
  await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
  }
  status.textContent = `Ready, ${variant}, service worker controlled`;
}

async function run(runtime, mode = 'stock', sentences = [
  'The little robot made a wonderful cup of tea.',
  'This imaginary concert was terrible and disappointing.',
  'The invented blue bicycle is parked beside a tree.',
]) {
  activeWorker?.terminate();
  const url = new URL(workerURL, location.origin);
  url.searchParams.set('variant', variant);
  activeWorker = new Worker(url, { type: 'module' });
  const worker = activeWorker;
  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      worker.terminate();
      resolve({ ok: false, error: 'Trial timeout after 240000 ms' });
    }, 240000);
    worker.onmessage = event => {
      report(event.data);
      if (event.data.kind === 'result') {
        clearTimeout(timeout);
        status.textContent = JSON.stringify(event.data, null, 2);
        resolve(event.data);
      }
    };
    worker.onerror = event => {
      clearTimeout(timeout);
      resolve({ ok: false, error: event.message });
    };
    worker.postMessage({ runtime, mode, sentences });
  });
}

async function inventory() {
  const rows = [];
  for (const name of await caches.keys()) {
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      const response = await cache.match(request);
      rows.push({ cache: name, url: request.url, bytes: (await response.arrayBuffer()).byteLength });
    }
  }
  return rows;
}

async function probe() {
  const url = '/ort/ort-wasm-simd-threaded.asyncify.wasm';
  async function fetchCount() {
    const channel = new MessageChannel();
    const result = new Promise(resolve => { channel.port1.onmessage = event => resolve(event.data); });
    navigator.serviceWorker.controller.postMessage('fetch-count', [channel.port2]);
    return result;
  }
  const before = await fetchCount();
  let fetched;
  try { fetched = { ok: (await fetch(url)).ok }; }
  catch (error) { fetched = { ok: false, error: String(error) }; }
  const cached = await caches.match(url);
  const after = await fetchCount();
  return { fetched, cacheBytes: (await cached.arrayBuffer()).byteLength,
    serviceWorkerFetchesBefore: before[url] || 0, serviceWorkerFetchesAfter: after[url] || 0 };
}

globalThis.s3 = { ready: ready(), run, inventory, events, variant, probe };

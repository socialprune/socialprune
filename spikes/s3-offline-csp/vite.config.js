import { defineConfig } from 'vite';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { connections, policy } from './policies.js';

const require = createRequire(import.meta.url);
const variants = Object.keys(connections);
const ortDirectory = path.dirname(require.resolve('onnxruntime-web'));

export default defineConfig({
  worker: { format: 'es' },
  build: { target: 'esnext', chunkSizeWarningLimit: 10000 },
  plugins: [{
    name: 's3-self-host-and-precache',
    enforce: 'post',
    async generateBundle(_, bundle) {
      for (const name of ['ort-wasm-simd-threaded.asyncify.wasm', 'ort-wasm-simd-threaded.asyncify.mjs']) {
        this.emitFile({ type: 'asset', fileName: `ort/${name}`, source: await readFile(path.join(ortDirectory, name)) });
      }
      const modelLibURL = 'https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/025bcaf3780fa8254f5e5efd3bfea0a5397248f4/web-llm-models/v0_2_84/base/Qwen3-0.6B-q4f16_1_cs1k-webgpu.wasm';
      const modelLib = await fetch(modelLibURL);
      if (!modelLib.ok) throw new Error(`Model library download failed: ${modelLib.status}`);
      this.emitFile({ type: 'asset', fileName: 'mlc/qwen3.wasm', source: new Uint8Array(await modelLib.arrayBuffer()) });
      const html = bundle['index.html'].source;
      for (const variant of variants) {
        this.emitFile({ type: 'asset', fileName: `${variant}.html`, source: html });
      }
      const assets = [...new Set([...Object.keys(bundle),
        '/ort/ort-wasm-simd-threaded.asyncify.wasm', '/ort/ort-wasm-simd-threaded.asyncify.mjs',
        '/mlc/qwen3.wasm',
        ...variants.map(v => `/${v}.html`)].map(p => p.startsWith('/') ? p : `/${p}`))];
      const headers = Object.fromEntries(variants.map(v => [v, policy(v)]));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: `
const CACHE = 's3-shell-v1';
const ASSETS = ${JSON.stringify(assets)};
const POLICIES = ${JSON.stringify(headers)};
const FETCHES = {};
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  for (const url of ASSETS) {
    const response = await fetch(url, {cache: 'reload'});
    if (!response.ok) throw new Error('Precache failed: ' + url);
    await cache.put(url, response);
  }
  await self.skipWaiting();
})()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  FETCHES[url.pathname] = (FETCHES[url.pathname] || 0) + 1;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const response = await cache.match(url.pathname === '/' ? '/index.html' : url.pathname);
    if (!response) return fetch(event.request);
    const variant = url.searchParams.get('variant') || url.pathname.slice(1, -5);
    if (!POLICIES[variant]) return response;
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', POLICIES[variant]);
    return new Response(response.body, {status: response.status, headers});
  })());
});
self.addEventListener('message', event => {
  if (event.data === 'inventory') event.ports[0].postMessage(ASSETS);
  if (event.data === 'fetch-count') event.ports[0].postMessage(FETCHES);
});
` });
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url, 'http://127.0.0.1:4173');
        const variant = url.searchParams.get('variant') || url.pathname.match(/\/(V[1-5])\.html$/)?.[1];
        response.setHeader('Content-Security-Policy', policy(variants.includes(variant) ? variant : 'V3'));
        response.setHeader('Cache-Control', 'no-store');
        next();
      });
    },
  }],
});

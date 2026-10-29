import '@socialprune/core/browser-init';
import { DOCUMENT_POLICY } from './policies.ts';
import type { BuildManifest } from './policies.ts';

declare const __SP_MANIFEST__: BuildManifest;
const manifest = __SP_MANIFEST__;
const scope = self as unknown as ServiceWorkerGlobalScope;
const cacheName = `sp-app-${manifest.buildId}`;
const known = new Set(
  manifest.files.map(({ url }) => new URL(url, scope.location.origin).href),
);
const clientsByBuild = new Map<string, string>();
const pendingFlushes = new Map<string, Set<string>>();
const obsoleteAtActivation = new Set<string>();

function harden(url: string, response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'no-referrer');
  const path = new URL(url).pathname;
  const policy =
    manifest.workerPolicies[path] ??
    (path.endsWith('.html') ? DOCUMENT_POLICY : null);
  if (policy) headers.set('Content-Security-Policy', policy);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function cleanup(): Promise<void> {
  const clients = await scope.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });
  // An unannounced client can still be running an old shell. Keep its cache
  // until hello or a page close proves otherwise, never guess from activation.
  const builds = new Set(
    clients.map((client) => clientsByBuild.get(client.id)),
  );
  if (builds.has(undefined)) return;
  for (const name of obsoleteAtActivation) {
    if (!builds.has(name.slice('sp-app-'.length))) {
      await caches.delete(name);
      obsoleteAtActivation.delete(name);
    }
  }
}

scope.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(cacheName);
        for (const file of manifest.files) {
          const url = new URL(file.url, scope.location.origin);
          if (
            url.origin !== scope.location.origin ||
            !url.pathname.startsWith(manifest.base)
          )
            throw new Error('Manifest URL outside app scope.');
          const response = await fetch(url, { cache: 'reload' });
          if (!response.ok) throw new Error('Precache response failed.');
          const bytes = await response.clone().arrayBuffer();
          const digest = Array.from(
            new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
            (value) => value.toString(16).padStart(2, '0'),
          ).join('');
          if (digest !== file.sha256)
            throw new Error('Precache digest differs.');
          await cache.put(url, harden(url.href, response));
        }
      } catch (error) {
        await caches.delete(cacheName);
        throw error;
      }
    })(),
  );
});

scope.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // A still-active old SW must not delete a new worker's waiting cache when
      // another old-shell tab sends hello. Only caches seen at this activation
      // can be obsolete for this worker, never caches installed afterwards.
      for (const name of await caches.keys())
        if (name.startsWith('sp-app-') && name !== cacheName)
          obsoleteAtActivation.add(name);
      await cleanup();
      await scope.clients.claim();
    })(),
  );
});

scope.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  url.hash = '';
  if (
    event.request.method !== 'GET' ||
    url.origin !== scope.location.origin ||
    !url.pathname.startsWith(manifest.base)
  )
    return;
  if (url.pathname === manifest.base) url.pathname += 'index.html';
  if (!known.has(url.href)) return;
  event.respondWith(
    (async () => {
      const cached = await (await caches.open(cacheName)).match(url.href);
      if (!cached) throw new Error('Missing verified precache entry.');
      return cached;
    })(),
  );
});

scope.addEventListener('message', (event) => {
  const data = event.data as { type?: string; buildId?: string; id?: string };
  if (data.type === 'hello') {
    const client = event.source as Client | null;
    if (client && data.buildId) clientsByBuild.set(client.id, data.buildId);
    event.ports[0]?.postMessage({
      type: 'hello',
      buildId: manifest.buildId,
      scope: scope.registration.scope,
    });
    event.waitUntil(cleanup());
  } else if (data.type === 'prepare-update' && data.id) {
    const id = data.id;
    event.waitUntil(
      (async () => {
        const clients = await scope.clients.matchAll({ type: 'window' });
        const pending = new Set(clients.map(({ id }) => id));
        pendingFlushes.set(id, pending);
        for (const client of clients)
          client.postMessage({ type: 'flush-tab', id });
        const deadline = Date.now() + 10_000;
        while (pending.size && Date.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 20));
        pendingFlushes.delete(id);
        event.ports[0]?.postMessage({
          type: pending.size ? 'flush-failed' : 'all-flushed',
        });
      })(),
    );
  } else if (data.type === 'tab-flushed' && data.id) {
    const client = event.source as Client | null;
    if (client) pendingFlushes.get(data.id)?.delete(client.id);
  } else if (data.type === 'SKIP_WAITING') {
    // Only the coordinated, person-confirmed page update path sends this.
    event.waitUntil(scope.skipWaiting());
  }
});

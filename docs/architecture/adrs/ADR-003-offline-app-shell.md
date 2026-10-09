# ADR-003: Offline app shell and update flow

- **Status:** Accepted
- **Date:** 2026-10-06
- **Hard constraints touched:** 1 (no hosting beyond GitHub Pages), 2 (local first)
- **Related:** [ADR-002](ADR-002-dependency-licenses.md), [ADR-004](ADR-004-content-security-policy.md), [ADR-005](ADR-005-browser-storage.md), [ADR-019](ADR-019-pages-deployment.md)

## Context

The web app is a static site on GitHub Pages under `/socialprune/`. People use it with a 100 MB to several GB export, often over more than one sitting, and some will open it without a network connection after the first visit. The app also needs a service worker for a second reason: Pages cannot send response headers, and the service worker is the only place that can attach a Content Security Policy to worker scripts and to later HTML loads ([ADR-004](ADR-004-content-security-policy.md)).

This replaces the earlier default vite-plugin-pwa. The replacement takes effect when the maintainer approves this record.

The update path matters as much as the cache. A person in the middle of a review must not lose decisions because a new build took over, and an update must never delete the workspace database or a downloaded model cache.

## Decision Drivers

- Offline reload of the shell, the guide and the demo after one online visit, in Chromium, Firefox and WebKit.
- A dependency graph that passes [ADR-002](ADR-002-dependency-licenses.md) without local patches.
- The service worker must be able to rewrite responses (add CSP and `nosniff` headers), which a precache-only plugin does not do.
- Updates are announced, never forced during work, and keep every non-app cache and all IndexedDB data.

## Options

### Option 1: vite-plugin-pwa 2.0.0 with `injectManifest`

**Pros:**
- Registry release 2.0.0 (published 2026-10-03) declares Vite 8 in its peer range.
- Mature precache manifest generation and update helpers.

**Cons:**
- It pulls `workbox-build` 7.4.1, whose stock graph contains the BlueOak-1.0.0 glob family and CC-BY-4.0 data in `caniuse-lite`. Removing `caniuse-lite` broke the build, because `workbox-build`'s index eagerly imports its `generateSW` path even for `injectManifest`.
- A pruned trial graph built only after a two-line patch to `workbox-build` and a glob substitution. Carrying that patch defeats the reason to use a plugin.
- The plugin's precache responses did not restrict worker `fetch`; the header work still has to be written by hand.

**Effort:** not measured
**Risk:** High. Fails the license policy without a maintained patch.

### Option 2: App-owned service worker with a build-generated manifest

A small Vite plugin enumerates the real build output after `generateBundle`, hashes each file with SHA-256, derives a build ID and emits a stable `sw.js` with the manifest inlined. The worker precaches, serves in-scope GET requests from the cache, adds headers and handles updates.

**Pros:**
- No new dependency. The trial service worker reloaded root, `#/guide` and `#/demo` offline with status 200 from the service worker in Chromium 153.0.8010.12 and Firefox 155.0, and in WebKit 26.6 with the local server stopped.
- Response rewriting for CSP and `nosniff` lives in the same 100 to 200 lines of code that serves the cache.

**Cons:**
- The project owns precache correctness, cache naming and multi-tab coordination.
- No community recipes for edge cases such as partial install failures; each one needs a test.

**Effort:** not measured
**Risk:** Medium. Lifecycle bugs are easy to write; the trial covered one tab only.

### Option 3: No service worker

**Pros:**
- Nothing to maintain.
- No update state machine.

**Cons:**
- No offline use and no worker CSP on Pages at all, which removes the second layer in [ADR-004](ADR-004-content-security-policy.md).
- No place to add `frame-ancestors` or `nosniff` after the first visit.

**Effort:** not measured
**Risk:** High for the privacy layer.

## Decision

We chose **Option 2: app-owned service worker with a build-generated manifest** because it is the only option that passes the license policy and also gives the header rewriting the CSP design needs.

1. **Build plugin** in `apps/web/tooling/` (development code, not shipped): after the bundle is written, list every output file, compute SHA-256, emit `sw.js` at a stable URL with `{ buildId, files: [{ url, sha256 }] }` inlined. No hand-written list of chunk names.
2. **Install.** Fetch every listed same-origin URL with `cache: 'reload'`, verify status and hash, store hardened copies (see [ADR-004](ADR-004-content-security-policy.md)) in `sp-app-<buildId>`. Any failure aborts the install and deletes only the incomplete new cache.
3. **Fetch.** Serve only in-scope GET requests. `/socialprune/` maps to `index.html`. Unknown same-origin URLs go to the network uncached. A missing `.js` path never receives HTML. Cross-origin requests are not intercepted.
4. **Registration and first activation.** Register with `updateViaCache: 'none'` and a Trusted Types script URL ([ADR-004](ADR-004-content-security-policy.md)). Check `registration.waiting` on start as well as `updatefound`. The `activate` handler calls `self.clients.claim()` after its cache cleanup, so a first visit becomes controlled without a reload and the worker gate in [ADR-004](ADR-004-content-security-policy.md) can pass in the same page load. The trial service worker did the same. Claiming only affects pages that have no controller yet; an update still waits for **Reload now** (rule 5).
5. **Update flow.** A new build waits. The page shows "A new version is ready" with **Reload now** and **Later**. Reload now first asks the workspace worker to flush pending commands and to finish or cancel a running import; then it sends `SKIP_WAITING` to the waiting worker; on `controllerchange` every open tab reloads. A `BroadcastChannel('sp-app')` message tells other tabs to flush first. No `skipWaiting()` runs unconditionally.
6. **Cache names.** `sp-app-<buildId>` for the shell. Model and runtime caches (Phase 2a) use `sp-model-<runtime>-<digest>`. Activation deletes only `sp-app-*` caches other than the current one, and only after no client still runs the old build. IndexedDB is never touched by the service worker.
7. **Installability.** `manifest.webmanifest` with `id`, `scope` and `start_url` under `/socialprune/`, and app-owned PNG icons. This needs `manifest-src 'self'` and `img-src 'self'` in the page policy ([ADR-004](ADR-004-content-security-policy.md)).

8. **Browser tests.** In Chromium, Firefox and WebKit: a first visit in a fresh profile passes the worker gate without a reload (control arrives through `clients.claim()`); offline reload of `#/`, `#/guide` and `#/demo`; update held until **Reload now**; two tabs flushed before an update; a failed install keeps the active build.

Decided by the maintainer on 2026-10-08: SocialPrune uses its own service worker instead of vite-plugin-pwa.

### Changes before acceptance

- The proposal put the build plugin in `apps/web/build/`. It lives in `apps/web/tooling/`, because the root `.gitignore` ignores every `build/` folder and a plugin there would never be committed.

**Decision made by:** maintainer
**Approved on:** 2026-10-09

## Consequences

### Positive
- No PWA dependency in the graph. The precache list always matches the real build because it is generated from it.
- The same worker carries the CSP layer, so offline support and the privacy layer cannot drift apart.

### Negative
- The update flow is ours to test: one-tab update, multi-tab update, failed install and offline start each need a browser test.
- WebKit's Playwright `setOffline(true)` failed with internal navigation errors on Windows; offline tests on WebKit have to stop the local server instead.

### Risks
- **An update strands an old tab that lazy-loads a deleted chunk.** Mitigation: rule 6 keeps the previous app cache until no client runs the old build; the update test opens two tabs.
- **Windows WebKit is not Safari.** Mitigation: before a release that claims Safari support, rerun the offline and update tests on Safari on macOS and iOS.

## Evidence

- Plugin and Workbox graph, custom worker results and the one-tab update trial (five assertions passed: waiting, update ready, still v1, v2 after SKIP_WAITING, model cache and an IndexedDB decision kept): [evidence-2026-10.md, sections 2 and 9](../evidence-2026-10.md#2-offline-shell-and-update).
- Vite PWA maintainers, [injectManifest guide](https://vite-pwa-org.netlify.app/guide/inject-manifest) and [prompt-for-update guide](https://vite-pwa-org.netlify.app/guide/prompt-for-update), observed 2026-10-06.
- Google web.dev, Jake Archibald, [The service worker lifecycle](https://web.dev/articles/service-worker-lifecycle), 2016-09-29, observed 2026-10-06.
- MDN, [manifest-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/manifest-src), observed 2026-10-06.

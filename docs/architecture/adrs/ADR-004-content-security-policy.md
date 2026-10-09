# ADR-004: Content Security Policy layers, Trusted Types and the worker gate

- **Status:** Accepted
- **Date:** 2026-10-06
- **Hard constraints touched:** 2 (local first), 5 (no promises in copy)
- **Related:** [ADR-003](ADR-003-offline-app-shell.md), [ADR-007](ADR-007-review-data-worker.md), [ADR-016](ADR-016-local-review-server.md), [ADR-021](ADR-021-archive-media.md)

## Context

Export content must stay on the device. The app parses untrusted archive files in a web worker and will keep review data in a second worker ([ADR-007](ADR-007-review-data-worker.md)). The Phase 1 page carries a strict policy in a `<meta>` element, including `connect-src 'none'`. That policy does not reach the workers: a same-origin worker script takes its policy from its own response headers, and GitHub Pages sends none. Today the Phase 1 import worker runs with no policy at all, as the comment in `apps/web/index.html` notes.

Three engines agreed on this in a headerless trial on 2026-10-06. Before a service worker controlled the page, a module worker's `fetch` to a local probe succeeded under the exact Phase 1 page policy in Chromium 153.0.8010.12, Firefox 155.0 and WebKit 26.6. After control, the service worker returned the same worker file from its cache with an added CSP header, and the same `fetch` failed in all three. Chromium and Firefox reported a `securitypolicyviolation` with `effectiveDirective: 'connect-src'`; WebKit rejected the request without forwarding an event within 50 ms.

The sources disagreed on what to do with that. One research lane recommended that real-data workers wait until the service worker controls the page. The literature review argued against making the service worker a prerequisite. This record decides it.

Three further facts shape the policy. `frame-ancestors` is ignored in a meta policy, so the first visit can be framed; the trial framed the page from a same-origin parent in all three engines before control and was denied after. zod 4.6.5 probes `new Function` on first schema compilation unless `z.config({ jitless: true })` ran first, and a strict policy reports the swallowed probe as a violation (`v4/core/util.js`, lines 219 to 220). Vite's dev server injects `<style>` elements that the strict meta policy blocks, so `vite` dev mode renders unstyled today.

## Decision Drivers

- No archive byte reaches a context whose policy allows network access.
- A first-time visitor can read the guide and try the demo at once.
- Contributors get a working `pnpm dev` without weakening the built policy.
- Copy makes no promises. The UI describes what the app does and what it does not do.

## Options

### Option 1: Gate real-data workers on verified service-worker control

Workers that receive archive bytes or workspace data start only after the page is controlled by the current build's service worker, which serves each worker entry with its own CSP header.

**Pros:**
- Every worker that touches export content runs under `connect-src 'none'`, proven in three engines.
- The gate is one check in one place, so it is testable.

**Cons:**
- The first visit waits for the service worker to install and claim the page before import can start.
- Contexts without service workers (some private windows, some managed browsers) cannot import real data in the web app.

**Effort:** not measured
**Risk:** Medium. Users in those contexts need another path.

### Option 2: Start workers at once, add headers when available

**Pros:**
- Import works on the first visit and everywhere.
- Simpler startup.

**Cons:**
- Workers created before control, and every worker in a context without a service worker, run with no policy. That is the Phase 1 state the comment in `index.html` flags as unfinished.
- Two code paths with different protection, and the UI cannot tell the person which one they got without explaining CSP.

**Effort:** not measured
**Risk:** High for hard constraint 2.

### Option 3: Parse on the main thread when no service worker exists

**Pros:**
- The page's meta policy covers the main thread.
- Works without a service worker.

**Cons:**
- S1 measured about 400 MiB peak with all items on the page, and the main-thread sort of 100,000 rows took 423 to 622 ms in Firefox. A main-thread fallback blocks the UI and raises the memory risk on phones.
- A second import path doubles the privacy and memory proof.

**Effort:** not measured
**Risk:** High for performance and proof cost.

## Decision

We chose **Option 1: gate real-data workers on verified service-worker control** because it is the only option under which every context that touches export content has `connect-src 'none'`, and the people it blocks have a working alternative in the CLI.

### Policy layers

| Layer | Delivered by | Policy |
|---|---|---|
| Page, first visit and fallback | `<meta>` in `index.html` | `default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'none'; style-src 'self'; img-src 'self'; font-src 'none'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; require-trusted-types-for 'script'; trusted-types socialprune` |
| Page, controlled loads | service-worker response header, in addition to the meta | the same policy plus `frame-ancestors 'none'`; also `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` |
| Import and workspace workers | service-worker response header on each exact entry URL | `default-src 'none'; script-src 'self'; connect-src 'none'; worker-src 'none'` |
| Analysis worker (Phase 2a, reserved) | same mechanism | `default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'none'; worker-src 'none'` |
| Local review document | real HTTP headers from `socialprune review` | see [ADR-016](ADR-016-local-review-server.md) |

`img-src 'self'` admits only the app's own icons. Archive media is not displayed ([ADR-021](ADR-021-archive-media.md)), and `blob:` and `data:` stay excluded. The build generates the map from worker entry URL to policy. The service worker never chooses a policy from a query parameter or any other request input.

### The gate

1. Before mounting import, restore or review, the page checks `window.top === window.self`. A framed page shows a neutral explanation and mounts nothing that reads files or storage.
2. The page registers the service worker, waits until `navigator.serviceWorker.controller` is set, then sends a `hello` message and expects the current `buildId` and scope back. `navigator.serviceWorker.ready` alone is not proof of control. On a first visit, control arrives without a reload because the service worker calls `clients.claim()` on activation ([ADR-003](ADR-003-offline-app-shell.md)).
3. Only then does the page construct the import and workspace workers that may receive a person's data. No selected `File` and no personal workspace is passed to any worker before this.
4. **First visit.** Start screen, guide and demo render at once. The import button shows "Getting ready…" until the gate passes. The demo uses generated data only and may start its own import and workspace workers before the gate. Those workers are demo-only: they never receive a person's file or open a personal workspace. When the gate passes, the page terminates every worker it created before control, and only then enables real-data actions. Every worker that handles a person's data is a new instance created after control, so its script response came from the service worker with the header policy.
5. **No service worker.** If registration throws, the API is missing, or control does not arrive within 10 seconds after activation, real-data actions stay disabled. The screen says why in plain words and offers two ways on: open SocialPrune in a normal browser window, or import the export with `npx socialprune import` and review it with `npx socialprune review`, which serves the same app from the person's computer with real response headers ([ADR-016](ADR-016-local-review-server.md)). There is no override button.
6. A gate failure is recorded in a local diagnostics entry with its reason code, never with file names or content.
7. **Gate tests**, in Chromium, Firefox and WebKit against the built app: a first visit passes the gate without a reload; after control, a worker `fetch` to a live local probe fails; the demo started before control, followed by a fixture import after control, uses a new real-data worker instance whose script response satisfies `response.fromServiceWorker()` and carries the worker policy header; every generated fixture imports through the real worker entries under that header policy.
8. **Local-review mode** (`vite build --mode review`, [ADR-016](ADR-016-local-review-server.md)) has no service worker, so this gate does not apply there. A successful `/session` exchange, under the server's real response headers, replaces it, and a failed exchange shows the session-ended page. That mode starts no worker and has no import. The test is `apps/cli/e2e/review-session.spec.ts`.

Decided by the maintainer on 2026-10-08: the service-worker gate is hard. Without a controlling service worker there is no real import in the browser; the CLI is the way on, and there is no override.

### Archive codec in the import worker

zip.js 2.23.0's default entry (`index.js`) re-exports `lib/zip-fs-wasm.js`, whose WASM module initializes lazily when a codec needs its fallback, and compiling it would need `'wasm-unsafe-eval'`. The package's `exports` map, checked on 2026-10-06, also publishes native entries: `./lib/zip-native.js`, `./lib/zip-core-native.js`, `./lib/zip-fs-native.js`, `./lib/zip-fs-core-native.js` and `./index-native.js`. `lib/zip-module-native.js` is not a published subpath; it is reached through `zip-native.js` and `zip-core-native.js`, sets `wasmURI: null` and uses a JavaScript zlib fallback instead of WASM.

- The web build maps the exact specifier `@zip.js/zip.js` to `@zip.js/zip.js/lib/zip-core-native.js` with a Vite alias. That entry holds the reader and the native codec module and configures no inline web worker; `packages/core` already reads with `useWebWorkers: false`. If it lacks an export that `packages/core` uses, the alias points to `./lib/zip-native.js` instead, which uses the same native module. The import worker's policy keeps `script-src 'self'` without `'wasm-unsafe-eval'`. A build test asserts that no `.wasm` file and no inline WASM module reach `apps/web/dist`, and a browser test asserts that `WebAssembly.compile` and `WebAssembly.instantiate` are never called in the import worker.
- The CLI keeps the default entry. Node has no CSP, so the WASM codec can load there, and the release bundle measured in [ADR-018](ADR-018-cli-distribution.md) already used it.
- **Deflate64 (method 9).** The browser import refuses it by policy before reading: the archive reader checks each needed entry's compression method and, for method 9, records the diagnostic category `unsupported-compression` with status `unreadable` and the entry path. The CLI reads method 9 through the WASM codec; if the Node test below shows that it cannot, the CLI reports the same diagnostic and the docs drop the CLI as the way on for deflate64. The JavaScript zlib in the native entry lists a `deflate64-raw` format, but no test has run it, so the browser does not rely on it.
- **Encrypted entries** (ZipCrypto or AES) are refused in both the browser and the CLI with the category `encrypted-entry`, status `unreadable`, because SocialPrune asks for no password and platform exports are not encrypted.
- The import screen names both cases ([design specification](../../design/README.md#import-import)). For deflate64 the ways on are the CLI, or extracting the ZIP with the computer's own tool and opening the folder. For encrypted entries the way on is extracting with the tool that set the password and opening the folder.
- **Test.** A ZIP built inside the test, with no external sample file: its entry data is a raw deflate stream made only of stored blocks (Node `zlib.deflateRawSync(data, { level: 0 })`), and the method field is patched to 9. Stored blocks have the same format in deflate and deflate64, so this is a valid deflate64 entry. The browser test expects `unsupported-compression` and no WebAssembly call; the Node test in `packages/core` expects the item text with a passing CRC check.

### Positive control for the violation observer

A test that sees zero `securitypolicyviolation` events proves nothing unless the same observer is shown to catch a real one.

- A test-only worker entry, `apps/web/test/probes/violation-worker.ts`, calls `fetch` against a live local probe under the import worker policy. It is built only by a separate e2e build (`vite build --mode e2e-probe`), which adds the entry to the service worker's policy map and to the Trusted Types allowlist.
- In Chromium and Firefox, the e2e spec runs this worker with the same observer the other specs use and expects exactly one `connect-src` violation from it. If the observer reports none, the spec fails.
- In WebKit, which emits no worker violation event, the spec instead asserts the policy header on the real worker responses (`response.fromServiceWorker()` and the header value) and that the probe request from the worker is rejected.
- **Unreachable from production.** A test runs after `pnpm build` and asserts that `apps/web/dist` contains no file built from `apps/web/test/`, that the production service worker's policy map and Trusted Types allowlist list no probe URL, and that requesting the probe URL from the production preview returns 404. ESLint forbids imports from `apps/web/test/` in `apps/web/src/`.

### Trusted Types

One policy named `socialprune`. Its `createScriptURL` accepts only the exact URLs of `sw.js` and the built worker entries, taken from the build manifest; anything else throws. It has no `createHTML` and no `createScript`. No default policy is installed. Archive text renders only as React text nodes. ESLint's core `no-restricted-syntax` rule in the root `eslint.config.js` forbids `dangerouslySetInnerHTML` in `apps/web/src`. Browsers without Trusted Types still get the same code paths without `innerHTML` and without `eval`.

### zod

Every browser entry (page, each worker) imports `@socialprune/core/browser-init` as its first import. That module calls `z.config({ jitless: true })` and nothing else. Browser tests assert zero `securitypolicyviolation` events in page and workers during import, review and restore.

### Development mode

A Vite plugin with `apply: 'serve'` rewrites the meta policy in `transformIndexHtml` to a development policy: it adds `'unsafe-inline'` to `style-src`, allows the React refresh preamble in `script-src`, and allows `connect-src` only to the dev server's own origin for hot reload. The banner "Development policy" appears in the page footer in dev mode. The plugin never runs in `vite build`. A unit test reads `apps/web/dist/index.html` after the build and compares the meta `content` attribute byte for byte with the policy in the table above; a second test asserts the plugin's `apply` value is `'serve'`.

### Changes before acceptance

- The proposal selected the local-review and probe builds with a build constant, `SP_MODE=review` and `SP_MODE=e2e-probe`. The build uses Vite's own `--mode review` and `--mode e2e-probe` and reads no environment variable, so the record names those commands.

**Decision made by:** maintainer
**Approved on:** 2026-10-09

## Consequences

### Positive
- Every worker that sees export content runs under `connect-src 'none'`, and the browser tests prove it per engine instead of assuming it.
- Contributors get styled dev pages, and the shipped policy is pinned by a test.

### Negative
- A first visit cannot start an import until the service worker has installed, which includes downloading the precache.
- People whose browser has no service worker cannot import in the web app. They need the CLI route, with the Node version set in [ADR-015](ADR-015-cli-storage-node-baseline.md).
- SocialPrune does not read Deflate64 or encrypted archives in the browser.
- Every new worker entry needs a policy entry and a Trusted Types URL, or it will not start.

### Risks
- **WebKit gives no violation event.** Mitigation: tests prove denial in WebKit by header assertions on the real worker responses and by the rejected request against a live local probe, not by an event.
- **The violation observer misses events.** Mitigation: the positive control above runs in Chromium and Firefox.
- **The service worker itself has no response policy.** Its own script request never passes through its fetch handler. Mitigation: keep it small, free of archive data and without network code beyond precache; review it as part of every change to `apps/web/src/sw/`.
- **The gate times out on slow devices.** Mitigation: the 10-second value is measured in the browser tests on CI and is adjustable; a timeout shows the explanation, never a silent fallback.

## Evidence

- Worker CSP matrix, framing and Trusted Types results per engine: [evidence-2026-10.md, section 3](../evidence-2026-10.md#3-content-security-policy-matrix).
- W3C, [CSP Level 3](https://w3c.github.io/webappsec-csp/), live specification; WHATWG, [HTML workers](https://html.spec.whatwg.org/multipage/workers.html#run-a-worker); MDN, [Using Web Workers, CSP section](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#content_security_policy), modified 2026-08-27; MDN, [frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors), modified 2026-08-27; MDN, [require-trusted-types-for](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/require-trusted-types-for), listing Chrome 83+, Firefox 148+, Safari 26+. All observed 2026-10-06.
- zod 4.6.5 published source, `v4/core/util.js` lines 219 to 220 and `compile.js` at the package root, lines 28 to 29, read 2026-10-06.
- zip.js 2.23.0 published files, read on jsDelivr on 2026-10-06: `package.json` (`exports` map), `index.js`, `lib/zip-native.js`, `lib/zip-core-native.js`, `lib/zip-module-native.js`, `lib/zip-module-wasm-base.js`, and `lib/core/zip-reader.js` lines 1029 to 1033 (method 9 turns off the native decompression stream and uses the fallback codec): [evidence-2026-10.md, section 9](../evidence-2026-10.md#9-dependency-and-license-observations).
- Vite 8.3.3 dev-server style injection observed in this repository on 2026-10-06.

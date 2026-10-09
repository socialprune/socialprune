# Phase 2 architecture evidence, October 2026

This document holds the measurements and sources behind the Phase 2 decision records in [adrs/](adrs/README.md). Three research lanes ran standalone trial projects outside the repository on 2026-10-06, each with its own lockfile and only invented data; a literature review covered the web platform and a second one the CLI and agent interface. The trial projects are not kept, so the tables here are the record. Each section states its method and its limits. Statements marked **Inference** are reasoning from the measurements, not measurements.

No real export, signed-in browser profile, paid API, key or model endpoint was used. Repository `main` was at `7263d7d` and clean before and after every trial.

## 1. Trial environment

| Item | Value |
|---|---|
| Machine | one Windows 11 desktop (build 10.0.26200), Intel Core i9-11900K, 8 cores and 16 logical processors, 68,603,314,176 bytes RAM; not isolated from other work |
| Node | 24.14.1 for most trials; 24.21.0 and 26.10.0 for runtime probes; 24.21.0 for the SQLite concurrency probe |
| Tooling | pnpm 10.33.0, Vite 8.3.3, `@vitejs/plugin-react` 6.1.2, React and React DOM 19.3.0, TypeScript 7.0.2 as `tsc`, Playwright 1.63.0 |
| Browsers | Chromium 153.0.8010.12, Firefox 155.0, WebKit 26.6 (Playwright's Windows build, not Safari on macOS or iOS) |
| Profiles | disposable headless profiles only, closed after each run |
| Servers | own local static servers without CSP headers, serving `/socialprune/`; no request left localhost |

All timings are single-machine observations. Several runs overlapped other installs and builds; where two samples of one measurement differ, both are given.

## 2. Offline shell and update

Method: a production build with an app-owned service worker generated from the real build output, served headerless under `/socialprune/`.

| Check | Chromium | Firefox | WebKit |
|---|---|---|---|
| Registration scope `/socialprune/` | yes | yes | yes |
| Trial service worker calls `clients.claim()` on activation | yes, same file for all engines | | |
| Offline reload of `/`, `#/guide`, `#/demo`, status 200 from the service worker | yes | yes | yes, with the local server stopped; Playwright `setOffline(true)` failed with internal navigation errors |
| Update held in `waiting`, page still on v1, v2 after `SKIP_WAITING` and reload | yes (one tab) | not run | not run |
| After update: old app cache removed, a model cache and an IndexedDB decision kept | yes | not run | not run |

vite-plugin-pwa 2.0.0 (published 2026-10-03, peer range includes Vite 8) pulls `workbox-build` 7.4.1. Its stock graph contained BlueOak-1.0.0 glob packages and CC-BY-4.0 `caniuse-lite`. Removing `caniuse-lite` broke the build because `workbox-build`'s index imports its `generateSW` path eagerly. A pruned graph built only with a two-line patch to `workbox-build`; its precache responses did not restrict worker `fetch`.

Limits: the update trial used one tab. Multi-tab coordination, failed installs and Safari on Apple hardware were not tested.

## 3. Content Security Policy matrix

Method: the exact Phase 1 meta policy, a headerless server, a dedicated module worker that fetches a live local probe. Positive control before the service worker controls the page; the same request after control, when the service worker returns the worker script from its cache with an added CSP header.

| Engine | Worker fetch before control | Worker fetch after control | Violation event | Framing by a same-origin parent before / after control |
|---|---|---|---|---|
| Chromium 153 | allowed | denied | `securitypolicyviolation`, `connect-src` | allowed / denied |
| Firefox 155 | allowed | denied | `securitypolicyviolation`, `connect-src` | allowed / denied |
| WebKit 26.6 | allowed | denied | none within 50 ms | allowed / denied |

Trusted Types with `require-trusted-types-for 'script'; trusted-types socialprune`: the built app rendered in all three engines; `innerHTML` with a string threw; an unlisted same-origin script URL was rejected; plain `navigator.serviceWorker.register(url)` and `new Worker(url)` threw, and wrapping only the exact allowed URLs let both run.

A `blob:` anchor download worked under the exact Phase 1 policy in Chromium and Firefox. Controlled HTML responses carried the added CSP and `nosniff` headers in all three engines.

zod 4.6.5 (`v4/core/util.js` lines 219 to 220, and `compile.js` at the package root, lines 28 to 29; both reread by the architect on 2026-10-06): the `new Function` capability probe runs unless `z.config({ jitless: true })` was called first; a strict CSP reports the swallowed probe as a violation. Vite 8.3.3's dev server injects `<style>` elements that `style-src 'self'` blocks.

Limits: one build per engine; WebKit on Windows only.

## 4. Storage

Method: 100,000 invented records of about 1,135 bytes each, written as 100 transactions of 1,000 puts with primary key `id` and no secondary index. Full read with `getAll`; bounded read in pages of 1,000 with key ranges. 50 decision-event writes timed one after another; idb and raw writes used `durability: 'strict'`, Dexie its default.

| Engine and method | Write 100k | Full read | Bounded read and iterate | Event median / p95 |
|---|---:|---:|---:|---:|
| Chromium idb 8.0.4 | 9,638 ms | 2,491 ms | 1,795 ms | 0.60 / 2.10 ms |
| Chromium raw IndexedDB | 6,462 ms | 2,377 ms | 1,953 ms | 0.50 / 1.40 ms |
| Chromium Dexie 4.4.6 `bulkPut` | 6,632 ms | 2,310 ms | 1,832 ms | 0.50 / 1.20 ms |
| Chromium OPFS sync handle, NDJSON | 3,653 ms | n/a | 1,180 ms | 1.70 / 11.60 ms |
| Firefox idb 8.0.4, final run | 15,154 ms | 2,537 ms | 1,799 ms | 2 / 5 ms |
| Firefox OPFS, final run | 1,554 ms | n/a | 712 ms | 2 / 7 ms |
| WebKit OPFS | failed, `UnknownError` | | | |

An earlier Firefox run measured 30,423 ms for the idb write. A Chromium restart trial in a persistent disposable profile took 21,600 ms for the idb write, then closed the browser, reopened the profile and counted 100,000 items, 50 events and an active service-worker controller.

**Architect spot check.** The idb path in the trial code pushed each `put` promise into an array and awaited them with `tx.done`; it did not await puts one by one. The raw path attached no per-request handler. **Inference:** the write gap comes from idb creating a promise wrapper for each of the 100,000 requests. No run measured idb with unwrapped puts; [ADR-005](adrs/ADR-005-browser-storage.md) sets that measurement as an acceptance condition.

`navigator.storage.persist()` returned `false` in fresh Chromium and WebKit profiles; in headless Firefox the permission prompt stayed pending.

Backup: a schema-valid v1 workspace with 100,000 items, one import and 50 human decisions streamed to OPFS scratch in 1,818.5 ms (Chromium) as 135,427,980 bytes, with no chunk larger than 2,501,748 bytes. The repository's `WorkspaceSchema` accepted the downloaded file. File input and drag and drop read every byte back with matching checksums. `showSaveFilePicker` existed only in Chromium.

Phones: no phone was measured, and no source in the research establishes how much memory a phone browser gives a page before ending it. The web literature review cited WebKit bug 309251 for page termination on iPads; that bug concerns WebAssembly compiler memory in an Asyncify SQLite WASM benchmark, was closed as a duplicate of bug 304810, and was reported fixed in the iOS 26.5 beta, so it is not evidence about pages that hold archive data. It is not used by any decision record.

Limits: one sample per library per engine; no crash or power-loss test; no phone hardware.

## 5. Queries, search and time zones

Main thread, 100,000 rows, filters and searches repeated 11 times, sorts 7 times, no rendering:

| Operation | Chromium median / p95 | Firefox median / p95 |
|---|---:|---:|
| status and two categories filter, 13,334 hits | 1.7 / 7.2 ms | 2 / 3 ms |
| sort by risk, then date | 82.9 / 105.8 ms | 622 / 715 ms (earlier run 423 / 550 ms) |
| lowercase substring per query, 5,883 hits | 94.9 / 311 ms | 92 / 233 ms |
| substring on a pre-lowercased projection | 59.6 / 76.9 ms | 34 / 43 ms |

Worker substring scan in sorted order: Chromium 100.8 / 392.4 ms, Firefox 89 / 109 ms, WebKit 102 / 188 ms (median / p95).

A separate state canary in Node (100,000 small records, one run): filter to 40,000 in 7.08 ms, bulk mark 86.02 ms, undo 29.30 ms, redo 48.61 ms, heap 50,753,800 bytes.

Full-text, Chromium, retained heap measured with forced garbage collection before and after:

| Candidate | Build | Retained added heap | Term query median / p95 |
|---|---:|---:|---:|
| substring, pre-lowercased | 221.7 ms normalize | not measured | 59.6 / 76.9 ms |
| MiniSearch 7.2.0 | 4,044.1 ms | 59,236,544 B | 4.9 / 5.6 ms |
| FlexSearch 0.8.212 | 3,552.2 ms | 24,060,160 B | below 0.1 ms timer resolution |

FlexSearch index build inside a worker: Chromium 3.713 s, Firefox 7.148 s, WebKit 10.077 s (runs in parallel). FlexSearch's last release was 2025-09-06.

Time zones: `Intl.DateTimeFormat` with `formatToParts`, `calendar: 'iso8601'`, `numberingSystem: 'latn'` and an explicit IANA zone matched Temporal for ten instant and zone pairs, including both Berlin daylight-saving changes and Los Angeles previous-day cases, in all three engines. `2026-10-06T23:30Z` grouped to 7 October in Berlin and 6 October in Los Angeles. All three engines reported `typeof Temporal === 'object'`.

Limits: repetitive generated text; desktop only; no keystroke-to-paint measurement.

## 6. UI primitives, grid and accessibility

Built samples under the strict policy in Chromium 153, recording inserted style elements and violations:

| Sample | Raw JS | gzip -9 | CSS / gzip | Inserted styles | Violations |
|---|---:|---:|---:|---:|---:|
| React baseline with tokens and one CSS Module | 219,838 B | 67,819 B | 2,308 / 1,027 B | 0 | 0 |
| Base UI 1.8.0 selected controls, `CSPProvider disableStyleElements` | 426,168 B | 134,107 B | | 0 | 0 |
| React Aria Components 1.21.1 selected controls | 550,038 B | 156,616 B | | 1 | 1 |

React's `style` prop (CSSOM) was allowed under `style-src 'self'`; `setAttribute('style', …)` and an inserted `<style>` element were rejected. Radix Dialog depends on `react-remove-scroll`, which creates style elements. Tailwind CSS 4.3.3 (Vite and PostCSS integrations) requires `lightningcss` 1.32.0 through `@tailwindcss/node`; StyleX 0.19.1's Vite integration requires `lightningcss` ^1.29.1.

Grid trial with TanStack Virtual 3.14.13 and 100,000 rows: 14 rows mounted at the top and 13 near the end, End reached `aria-rowindex` 100000, Space selected exactly that row, an expanded row grew from 97 px to 241 px, Home returned to the top, first layout 65 ms after the data existed, zero inserted styles, violations or external requests.

i18n stacks, each rendering an EN/DE heading, a plural, a select, `1.234,5` and a Berlin date:

| Stack | App JS gzip -9 | Over baseline | Locale-switch requests | Violations |
|---|---:|---:|---:|---:|
| Paraglide JS 2.26.0 | 69,293 B | 1,474 B | 0 | 0 |
| React Intl 12.1.4 | 82,178 B | 14,359 B | 0 | 0 |
| i18next 26.4.2 + react-i18next 17.0.16 + ICU 2.5.0 | 95,268 B | 27,449 B | 0 | 0 |

Unknown message IDs failed `tsc` in all three; a missing plural argument failed only with Paraglide.

Accessibility engine: `accessibility-checker-engine` 4.0.34's `ace.js` injected with `page.evaluate` ran 91 rules for `WCAG_2_2` under the unchanged policy with no external request, and a planted unnamed button failed `input_label_exists`.

Contrast of the design tokens, computed by the architect with the WCAG 2.2 relative-luminance formula: see the table in the [design specification](../design/README.md#color-roles). Every text pair is 4.5:1 or higher and every boundary pair 3:1 or higher.

Limits: no screen-reader run; the grid trial is reachability, not the final review.

## 7. CLI bundles and framework

`node_modules/<pkg>/index.ts` failed with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` under Node 24.14.1, 24.21.0 and 26.10.0.

Release bundle of the real `structure` entry with `packages/core` and both adapters (Node platform, ESM, minified, all dependencies bundled, external source map):

| Bundler | `cli.mjs` | gzip | Without tree shaking | Source map |
|---|---:|---:|---:|---:|
| esbuild 0.28.2 | 639,552 B | 172,816 B | 693,302 B | 2,281,128 B |
| tsdown 0.23.0 on Rolldown 1.2.12 | 238,964 B | 89,458 B | 346,357 B | 1,268,414 B |
| Rolldown 1.2.12 directly (architect spot check) | 238,949 B | 89,455 B | 346,362 B | 1,269,581 B |

Every bundle ran `structure <synthetic zip> --json` with exit 0; the report contained the key path and not the planted leaf text or number. A companion entry importing both adapters returned one item for a compressed X fixture (esbuild 654,609 B, tsdown 254,126 B). With `--enable-source-maps`, a thrown error mapped to `packages/core/src/archive/limits.ts` with both esbuild and tsdown. esbuild's metadata showed zod at 453,252 bytes with tree shaking and 453,281 without; Rolldown kept 19 of 95 zod modules and 42 of 49 zip.js modules.

CLI frameworks, same tiny command, bundled with esbuild 0.28.2:

| Framework | License | Last release | JS / gzip |
|---|---|---|---:|
| `node:util.parseArgs` | Node core | runtime | 566 / 364 B |
| citty 0.2.2 | MIT | 2026-04-01 | 8,371 / 3,474 B |
| cac 7.0.0 | MIT | 2026-02-27 | 10,819 / 4,020 B |
| @stricli/core 1.3.0 | Apache-2.0 | 2026-07-16 | 30,722 / 10,155 B |
| commander 15.0.0 | MIT | 2026-05-29 | 39,529 / 11,386 B |
| clipanion 3.2.1 | MIT | 2023-06-05 | 54,257 / 16,725 B |
| cmd-ts 0.15.0 | MIT | 2026-02-12 | 58,782 / 17,272 B |
| yargs 18.2.0 | MIT | 2026-09-20 | 112,183 / 34,947 B |

citty's tested path accepted an unknown flag. Stricli's default parse error exit was `-4`, reported by Windows as 4,294,967,292; an injected-context adapter mapped it to 2 and produced one JSON error document. With no version checker configured, success, dry run, bad flag and help made zero fetch attempts.

## 8. CLI workspace, SQLite and review server

Storage of 100,000 generated items with one assessment and one human decision each, valid under the current schemas, data flushed:

| Format | Bytes | Write | Read, parse, validate |
|---|---:|---:|---:|
| One JSON document | 94,937,642 | 1,282.76 ms | 5,038.67 + 1,196.97 ms |
| Manifest plus NDJSON | 94,937,891 | 8,260.10 ms | 5,003.35 ms |
| SQLite DELETE journal | 119,377,920 | 3,597.82 ms | 4,136.22 ms |
| SQLite WAL, one connection | 119,377,920 | 6,655.33 ms | 3,668.92 ms |

An earlier, less contended sample: JSON 1,030.66 ms write and 1,188.36 ms read, NDJSON 3,148.66 and 3,669.12 ms, SQLite DELETE 3,669.52 and 3,390.03 ms, WAL 4,623.85 and 3,172.29 ms. SQLite read a 50-item indexed page near the end in 6.94 ms (DELETE) and 5.23 ms (WAL); 100,000 repeated `INSERT OR IGNORE` left the count at 100,000. WAL peaked at 239,779,296 bytes with its journal before checkpoint.

Concurrency probe on Node 24.21.0 (SQLite 3.53.4), database in `journal_mode=WAL` with `synchronous=FULL` and a 5,000 ms busy timeout: two worker threads inside one Node process, each with its own connection, committed 1,000 events each in one `BEGIN IMMEDIATE` transaction at the same time, in 104.93 ms (an earlier sample 226.18 ms); all 2,000 rows were present and an `UPDATE` on the event table was rejected by a trigger. The probe used two threads, not two processes, and did not test the rollback journal that [ADR-015](adrs/ADR-015-cli-storage-node-baseline.md) chooses.

On Windows, renaming over a file another Node process held open failed with `EPERM`, and succeeded after the handle closed.

**Architect spot check of the Node boundary**, from Node's tagged sources and its release index on 2026-10-06:

| Node | Released | `node:sqlite` stability | `emitExperimentalWarning` in `lib/sqlite.js` | Embedded SQLite |
|---|---|---|---|---|
| 24.14.1 | 2026-03-24 | 1.1, Active development | two lines: one import and one call | 3.51.2 |
| 24.15.0 | 2026-04-15 | 1.2, Release candidate | absent | 3.51.3 |
| 24.21.0 | 2026-09-07 | 1.2, Release candidate | not read; no warning at run time | 3.53.4 |
| 26.10.0 | | 2, Stable | no warning at run time | 3.53.4 |

The SQLite WAL documentation (section 11, updated 2026-08-25) lists the WAL-reset race for 3.7.0 through 3.51.2, fixed in 3.51.3. It concerns WAL mode with two or more connections; the rollback journal is not affected.

pnpm and the Node floor, measured during the architecture review on 2026-10-06 in a temporary project with no dependencies: on Node 24.14.1, `pnpm install` with pnpm 10.33.0 and a root `"engines": { "node": ">=24.15.0" }` exited 0 and printed `WARN Unsupported engine`.

Local review server probe: a minimal `node:http` handler on `127.0.0.1` under Node 24.14.1, driven by `node:http` clients, 13 cases:

| Case | Status |
|---|---:|
| forged Host; Host prefix confusion | 403; 403 |
| foreign Origin; `Origin: null`; cross-origin preflight | 403; 403; 403 |
| no authentication | 401 |
| correct bootstrap; replayed bootstrap | 200; 401 |
| authenticated with foreign Origin; missing Origin; missing CSRF header | 403; 403; 403 |
| authenticated form content type | 415 |
| fully authorized JSON mutation | 200 |

A counter read back `1` afterwards, and no response carried a CORS header. No browser, CSP or real database was involved.

## 9. Dependency and license observations

| Package or graph | Observation, 2026-10-06 |
|---|---|
| Repository at `7263d7d` | `pnpm licenses list --json`: 145 package versions, 109 MIT, 20 Apache-2.0, 7 ISC, 6 BSD-2-Clause, 3 BSD-3-Clause (architect run) |
| Vite 8.3.3 | lists `lightningcss` in `dependencies`; with the override `vite>lightningcss: '-'` none is installed and the build passes with PostCSS and esbuild minification |
| vite-plugin-pwa 2.0.0, workbox-build 7.4.1 | BlueOak-1.0.0 glob family, CC-BY-4.0 `caniuse-lite` |
| Paraglide JS 2.26.0 message-format plugin | `@inlang/sdk` 3.1.0, `@lix-js/sdk` 0.19.0, three `@bytecodealliance/jco-*` packages under `Apache-2.0 WITH LLVM-exception` |
| i18next-cli 1.74.8 | BlueOak-1.0.0 packages in its default graph |
| axe-core, @axe-core/playwright 4.13.0 | MPL-2.0 |
| accessibility-checker-engine 4.0.34 | Apache-2.0, no dependencies; the wrapper `accessibility-checker` defaults include telemetry and a rule CDN |
| Tailwind CSS 4.3.3 | requires Lightning CSS 1.32.0 (MPL-2.0) |
| @sqlite.org/sqlite-wasm 3.53.4-build2 | registry Apache-2.0; shipped JS carries MIT, University of Illinois/NCSA and SQLite public-domain notices |
| @stricli/core 1.3.0 | Apache-2.0 at the `v1.3.0` tag; the installed npm package had no LICENSE file |
| Rolldown 1.2.12 | MIT; already in the lockfile through Vite 8.3.3 |
| npm 11.17.0 and 12.2.0 | Artistic-2.0; trusted publishing needs npm 11.5.1 or newer |
| Pages actions | `upload-pages-artifact` 5.0.0 MIT, `deploy-pages` 5.0.1 MIT |
| zip.js 2.23.0 | BSD-3-Clause; default entry `index.js` re-exports `lib/zip-fs-wasm.js`; the `exports` map also publishes `./lib/zip-native.js`, `./lib/zip-core-native.js`, `./lib/zip-fs-native.js`, `./lib/zip-fs-core-native.js` and `./index-native.js`; `lib/zip-module-native.js` sets `wasmURI: null` and a JavaScript zlib fallback; `lib/core/zip-reader.js` lines 1029 to 1033 turn off the native decompression stream for method 9 (architect check on jsDelivr) |

## 10. Sources

All observed 2026-10-06 unless a date is given.

| Publisher | Source |
|---|---|
| W3C | [CSP Level 3](https://w3c.github.io/webappsec-csp/), live; [Indexed Database API](https://w3c.github.io/IndexedDB/), live; [WCAG 2.2](https://www.w3.org/TR/WCAG22/); [ARIA grid pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/) |
| WHATWG | [HTML, workers](https://html.spec.whatwg.org/multipage/workers.html#run-a-worker); [Storage](https://storage.spec.whatwg.org/); [File System](https://fs.spec.whatwg.org/) |
| MDN | [Using Web Workers, CSP](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#content_security_policy), modified 2026-08-27; [frame-ancestors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-ancestors); [require-trusted-types-for](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/require-trusted-types-for); [Storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria); [showSaveFilePicker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker); [Intl.DateTimeFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat); [Cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies), updated 2026-09-17; [browser-compat-data for Temporal](https://raw.githubusercontent.com/mdn/browser-compat-data/main/javascript/builtins/Temporal.json) |
| WebKit | Sihui Liu, [Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/), 2023-08-28; John Wilander, [Full Third-Party Cookie Blocking and More](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/), 2020-03-24; [bug 309251](https://bugs.webkit.org/show_bug.cgi?id=309251), reported 2026-03-05, closed as a duplicate of bug 304810; cited by the literature review and not used by any record (section 4) |
| Google web.dev | Jake Archibald, [The service worker lifecycle](https://web.dev/articles/service-worker-lifecycle), 2016-09-29 |
| GitHub | [Custom workflows with Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages); [Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits); [Custom 404 page](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-custom-404-page-for-your-github-pages-site); [Adding skills for Copilot](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills) |
| Node.js | tagged sources at [v24.14.1](https://github.com/nodejs/node/tree/v24.14.1) and [v24.15.0](https://github.com/nodejs/node/tree/v24.15.0); [release index](https://nodejs.org/dist/index.json); [Modules: TypeScript](https://nodejs.org/api/typescript.html) |
| SQLite | [Write-Ahead Logging](https://www.sqlite.org/wal.html#walreset), updated 2026-08-25; [Transactions](https://www.sqlite.org/lang_transaction.html); [Copyright](https://www.sqlite.org/copyright.html), updated 2026-01-12; [WASM persistence](https://sqlite.org/wasm/doc/trunk/persistence.md) |
| npm | [package.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-json); [Trusted publishing](https://docs.npmjs.com/trusted-publishers/); [Provenance](https://docs.npmjs.com/generating-provenance-statements) |
| Library maintainers | [idb 8.0.4 README](https://cdn.jsdelivr.net/npm/idb@8.0.4/README.md); [Vite PWA guides](https://vite-pwa-org.netlify.app/guide/inject-manifest); [Base UI CSPProvider](https://base-ui.com/react/utils/csp-provider); [TanStack Virtual API](https://tanstack.com/virtual/latest/docs/api/virtualizer); [Stricli](https://bloomberg.github.io/stricli/docs/quick-start); [Rolldown v1.2.12 LICENSE](https://raw.githubusercontent.com/rolldown/rolldown/v1.2.12/LICENSE); [FlexSearch 0.8.212 README](https://cdn.jsdelivr.net/npm/flexsearch@0.8.212/README.md); [MiniSearch 7.2.0 README](https://cdn.jsdelivr.net/npm/minisearch@7.2.0/README.md); IBM, [accessibility-checker-engine 4.0.34](https://cdn.jsdelivr.net/npm/accessibility-checker-engine@4.0.34/README.md) |
| Security advisories | Vite, [GHSA-vg6x-rcgg-rjx6](https://github.com/vitejs/vite/security/advisories/GHSA-vg6x-rcgg-rjx6), 2025-01-20; webpack, [GHSA-9jgg-88mc-972h](https://github.com/webpack/webpack-dev-server/security/advisories/GHSA-9jgg-88mc-972h) and [GHSA-4v9v-hfq4-rm2v](https://github.com/webpack/webpack-dev-server/security/advisories/GHSA-4v9v-hfq4-rm2v), 2025-05-05; Project Jupyter, [Jupyter Server security](https://jupyter-server.readthedocs.io/en/latest/operators/security.html) |
| Agents and MCP | Agent Skills project, [Specification](https://agentskills.io/specification); MCP project, [2026-07-28 changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog.md) and [Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools.md); Anthropic, [prompt-injection mitigations](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/mitigate-jailbreaks); OpenAI, [agent builder guide on prompt injection and tool risks](https://developers.openai.com/api/docs/guides/agent-builder-safety) |
| CLI conventions | clig.dev contributors, [Command Line Interface Guidelines](https://clig.dev/); ndjson-spec maintainers, [NDJSON 1.0.0](https://raw.githubusercontent.com/ndjson/ndjson-spec/master/README.md) |
| SPDX | [License List](https://spdx.org/licenses/) |

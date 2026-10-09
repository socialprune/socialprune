# ADR-016: Local review server and session token handling

- **Status:** Accepted
- **Date:** 2026-10-06
- **Hard constraints touched:** 2 (local first), 3 (only a person decides, in the review UI)
- **Related:** [ADR-004](ADR-004-content-security-policy.md), [ADR-007](ADR-007-review-data-worker.md), [ADR-014](ADR-014-agent-interface.md), [ADR-015](ADR-015-cli-storage-node-baseline.md)

## Context

`socialprune review --workspace <dir>` lets a person review a CLI workspace in the browser. It serves the same React app from the person's computer and writes their decisions into the SQLite workspace. It is also the fallback for browsers without a service worker ([ADR-004](ADR-004-content-security-policy.md)).

Two threats shape it. A hostile web page open in the same browser can send requests to `127.0.0.1` and can use DNS rebinding to make a foreign host name resolve there; development servers have been hit by exactly this (Vite advisory GHSA-vg6x-rcgg-rjx6, 2025-01-20; webpack-dev-server GHSA-9jgg-88mc-972h and GHSA-4v9v-hfq4-rm2v, 2025-05-05). And the agent that started the command must not receive a way to create decisions: whoever holds the session token can mark items, and an agent that reads the token from the command output could then do what the CLI deliberately does not offer. An agent with shell access can still edit the database file directly; this design does not make that easier.

A Node HTTP probe on 2026-10-06 ran 13 cases against a minimal handler: forged Host and Host-prefix confusion returned 403; foreign Origin, `null` Origin and a cross-origin preflight returned 403; missing authentication 401; a correct bootstrap 200 and its replay 401; authenticated requests with a foreign or missing Origin, or without the CSRF header, 403; a form content type 415; one fully authorized JSON mutation 200. A counter read back `1`, so no rejected request changed state, and no response carried a CORS header. The probe used `node:http` clients, not a browser.

Multiple Content Security Policies all apply, and the strictest wins. A response header with `connect-src 'self'` cannot relax the Pages document's meta `connect-src 'none'`, so the local review needs its own document.

## Decision Drivers

- Hostile pages and DNS rebinding get nothing: no data, no state change.
- The session token stays out of every output an agent normally captures: stdout, JSON documents, logs, errors, and stderr when it is a pipe.
- The same app code serves Pages and the local review, with a policy fitted to each.
- The server stops cleanly without losing an acknowledged decision.

## Options

### Option 1: Token in the URL fragment, opened by the CLI, exchanged for an HttpOnly session

**Pros:**
- The fragment never travels in an HTTP request, and the CLI can hand it to the browser without printing it.
- After the exchange, the page holds no long-lived secret in JavaScript; the cookie is HttpOnly.

**Cons:**
- Cookies on `127.0.0.1` are not isolated by port, so a random cookie name per session is needed.
- When the CLI cannot open a browser and no terminal is attached, there is no channel for the token.

**Effort:** not measured
**Risk:** Low.

### Option 2: Token in the query string, printed on stdout

**Pros:**
- Works everywhere, including headless machines.
- The common pattern in local notebook servers.

**Cons:**
- The token appears in the agent's captured output, browser history and request logs; the agent could call the decision API with it.
- Contradicts hard constraint 3 in spirit: the CLI would hand a decision capability to whoever runs it.

**Effort:** not measured
**Risk:** High.

### Option 3: No token, loopback binding only

**Pros:**
- Nothing to transport.
- Simplest code.

**Cons:**
- Any local process and, without exact Host checks, any web page through DNS rebinding could read and write the workspace.
- The advisories above show that "only local" is not a boundary.

**Effort:** not measured
**Risk:** High.

## Decision

We chose **Option 1: a one-use token in the URL fragment, handed to the browser by the CLI and exchanged for an HttpOnly session**, because it is the only option that keeps the decision capability out of the agent's output while blocking hostile pages.

### What the CLI prints and when it opens the browser

| Situation | stdout | stderr | Browser |
|---|---|---|---|
| default, human mode | nothing | "Review is running at http://127.0.0.1:<port>/. Your browser opens it now. Press Ctrl+C to stop." | opened by the CLI with the tokenized URL |
| `--json` | one readiness document: `{ lifecycle: "running", url: "http://127.0.0.1:<port>/", tokenDelivery: "browser", pid }`, no token | the same notice | opened by the CLI with the tokenized URL |
| `--no-open`, stderr is a terminal | nothing (or the readiness document with `tokenDelivery: "terminal"`) | the tokenized URL, once | not opened |
| `--no-open`, stderr is not a terminal | error document `NO_TOKEN_CHANNEL`, exit 2 | short reason | not opened |
| opener fails and stderr is a terminal | as above | the tokenized URL, once | none |
| opener fails and stderr is not a terminal | error document `BROWSER_OPEN_FAILED`, exit 1; the server stops | short reason | none |
| `--dry-run` | what would happen, with counts | nothing | not opened; nothing bound |

**What this does and does not keep from an agent.** The token never appears on stdout, in any JSON document, in a log file, in the workspace, in an error message, or on stderr when stderr is not a terminal. An agent that captures the command's output through pipes, which is how most agent hosts run commands, therefore receives no token. Two paths still expose it, and both are listed under Risks: `--no-open` or a failed opener with a terminal on stderr prints it there, and any agent host that runs commands in a pseudo-terminal sees that output; and launching the browser puts the tokenized URL into the browser's process arguments, which other processes of the same user can read. The skill forbids `--no-open` ([ADR-014](ADR-014-agent-interface.md)).

Opening the browser uses `spawn` with `shell: false`: `open <url>` on macOS, `xdg-open <url>` on Linux, and on Windows a fixed `powershell.exe -NoProfile -NonInteractive -Command "$u = [Console]::In.ReadLine(); Start-Process -FilePath $u"` that reads the URL from its standard input, so the URL is not part of the PowerShell command line. No dependency is added. The URL is built only from the port and the random token, never from input, and the opener refuses any other URL.

The CLI waits at most 10 seconds for the opener. An opener that exits with an error within that time counts as failed, as in the table above. An opener still running after 10 seconds counts as launched, and a failure after that point is not reported.

### Listener and requests

- `server.listen(0, '127.0.0.1')`. The allowed authority is exactly `127.0.0.1:<port>`. `localhost`, `[::1]` and any other Host value get 403 before routing.
- Any `Origin` other than `http://127.0.0.1:<port>` gets 403; `Origin: null` gets 403. Session exchange and every API request require an exact `Origin`. A top-level GET of the document may omit it.
- No `Access-Control-*` headers. Preflights get 403.
- API requests must be `POST` with `Content-Type: application/json`; anything else gets 415. Bodies over 1 MiB get 413. Header timeout 10 s, request timeout 30 s, keep-alive 5 s.
- Static files come from a fixed map of the built asset list. A URL never becomes a file system path.

### Token and session

1. The CLI creates a 256-bit bootstrap token with `crypto.randomBytes(32)`, valid for one exchange within 10 minutes.
2. The page reads it from `location.hash` before the router starts, removes it with `history.replaceState`, and posts it in the `X-SocialPrune-Bootstrap` header to `/session`.
3. The server returns a CSRF token in the JSON body and sets a cookie named `sp_<16 random hex>` with `HttpOnly; SameSite=Strict; Path=/`, no `Domain`, expiring when the server stops. The page keeps the CSRF token in memory and sends it in `X-SocialPrune-CSRF` on every API call.
4. A second exchange with the same bootstrap returns 401. If the tab loses its session, the person runs `review` again.

### API

The page in local-review mode replaces the IndexedDB worker with an HTTP adapter. `POST /api/<type>` carries one request of the worker protocol in [ADR-007](ADR-007-review-data-worker.md), validated by the same schemas from `packages/core/src/workspace/protocol.ts`: `open`, `query`, `window`, `detail`, `decide`, `previewBulk`, `confirmBulk`, `releasePreview`, `undo`, `redo`, `history`, `outcome`, `clickListOpen`, `clickListWindow`, `clickListExport`, `setTimeZone` and `setReviewView`. It answers 200 with a JSON array of the replies the service produced, in order, each passing the protocol's reply schema and naming the request's `requestId`. The last element is the terminal reply; elements before it can only be `progress` or `clickListExportChunk`. There is no import, backup, restore or workspace deletion over HTTP; an authenticated request to `/api/backup`, `/api/restore`, `/api/attachImport` or `/api/deleteWorkspace` gets 404. Import, backup and restore are CLI commands. The server sets `source.via = 'local-review'` itself; the client cannot choose it. `POST /api/revision` returns the current revision; the page polls it every 2 seconds while visible to pick up label submissions from an agent. `POST /api/shutdown` stops the server. A worker thread owns the SQLite connection ([ADR-015](ADR-015-cli-storage-node-baseline.md)) and keeps the projection; the HTTP thread only routes.

- **Scan cancellation.** A `query` request for a `queryId` that already has a running scan, with a higher `generation`, makes the database worker stop the older scan at its next 5,000-row chunk; the older HTTP request returns `200` with `[cancelled { queryId, generation }]`. If the browser aborts a request (the page navigates or calls `AbortController.abort()`), the server sees the closed socket and cancels that scan the same way.
- **Preview expiry.** The expiry rules of [ADR-007](ADR-007-review-data-worker.md) apply: one open preview per page; a session holds at most 4, one per page, and a fifth evicts the oldest. The page creates a random `pageId` on load and sends it with every preview request, so the server can tell pages of one session apart. Each preview lasts at most 10 minutes and is released on `releasePreview`, on a new `previewBulk` from the same page, or when the session ends. An expired preview gives `rejected { code: 'PREVIEW_EXPIRED' }`.
- **Routes in the page.** Local-review mode has the routes listed in [ADR-009](ADR-009-navigation.md): review, both click lists, settings and privacy, with a start view; guide, demo, import and backup point to the matching CLI commands.

### The local-review document

- The web build produces two outputs from one source: `dist/` for Pages and `dist-review/` for the npm package, selected with Vite's mode (`vite build --mode review` for the second). `dist-review/index.html` has a meta policy identical to its header policy. `dist-review/` is never part of the Pages artifact; a test checks the Pages artifact list.
- Header and meta policy: `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; worker-src 'none'; font-src 'none'; manifest-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types socialprune`. Every response also carries `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.
- Local-review mode registers no service worker and never caches `/session` or `/api/*`.
- **Gate in this mode.** The service-worker gate of [ADR-004](ADR-004-content-security-policy.md) does not apply, because no service worker exists. A successful `/session` exchange replaces it: the page mounts review, click lists and settings only after `/session` returned 200, and everything it loaded came with the server's real response headers above. Local-review mode starts no worker (`worker-src 'none'`), so there is no worker script whose policy could be missing. A failed exchange (replayed or expired bootstrap, missing fragment, server stopped) shows the session-ended page and mounts nothing that reads the workspace. The framing check of ADR-004 still runs first.
- **Test.** `apps/cli/e2e/review-session.spec.ts`, a C3 Playwright spec run by `apps/cli/playwright.config.ts` in Chromium, Firefox and WebKit against a real `review` server whose opener is a recorder: it asserts that no service worker is registered, that the document and every script response carry the header policy, that the review mounts only after `/session` returned 200, that a replayed bootstrap and a missing fragment both show the session-ended page with no `/api/*` request, and that the fragment is gone from `location` before the router starts.

### Stopping

Ctrl+C, SIGTERM or `/api/shutdown`: stop accepting connections, let in-flight commands finish for up to 5 seconds, close idle keep-alive sockets, invalidate the session, close the database worker, exit 0. A decision the page saw as saved was committed before its reply.

### Tests for the token boundary

The CLI tests capture both streams of `review` with stdout and stderr as pipes (not terminals) in human mode, in `--json` mode and when the opener is replaced by a recorder that fails, and assert that the token appears in none of them; the recorder confirms the token went only to the opener's argument. A further test with stderr attached to a real pseudo-terminal and `--no-open` asserts the token appears there once and nowhere else; it uses util-linux `script` and runs on Linux only.

Decided by the maintainer on 2026-10-08: the remaining token exposure is accepted. It covers a pseudo-terminal's stderr with `--no-open` or when the opener fails, and the browser's launch arguments. The skill still forbids `--no-open`.

### Changes before acceptance

- The proposal said the probe ran 16 cases. It listed 13, and the evidence table has 13; the review server's tests add a missing, a wrong and an expired bootstrap, each answered with 401.
- The proposal selected the local-review build with a build constant `SP_MODE`. The build uses `vite build --mode review` and reads no environment variable.
- The proposal said `/api/<type>` carries the worker's reply shapes without saying how several replies travel. The server answers with a JSON array of replies ending in the terminal one (decision D46). The API list now also names the click-list messages, `setTimeZone` and `setReviewView`.
- The proposal opened the browser on Windows with `Start-Process -FilePath $args[0]` and the URL as a separate argument. That form never worked: PowerShell appends extra arguments to the `-Command` text, so the URL never reaches `$args[0]`. The opener now reads the URL from standard input (decision D47).
- The proposal did not say how long the CLI waits for the opener. It waits at most 10 seconds; an opener still running then counts as launched, and a later failure is not reported (decision D53).
- The proposal's risks missed two points, now listed: the browser history can hold the `#bootstrap=` URL until `replaceState` runs, and the real pseudo-terminal proof runs on Linux only.

**Decision made by:** maintainer
**Approved on:** 2026-10-09

## Consequences

### Positive
- An agent that runs `review` with its output captured through pipes sees a URL without a token; the decision capability goes to the browser through the OS opener.
- Hostile pages get 403 at the Host or Origin check before any data is read.

### Negative
- On a headless machine without a terminal, `review` cannot deliver a token and refuses to run. The person runs it in their own terminal instead.
- A second build output and a second policy to keep in sync with the Pages build.

### Risks
- **The tokenized URL is visible in the browser's process arguments** to software running as the same user, including an agent that lists processes. Mitigation: the bootstrap is one-use and expires after 10 minutes, so it is worthless once the browser exchanged it; the docs state that the server does not protect against software already running as the person.
- **A pseudo-terminal sees the token.** With `--no-open`, or when the opener fails, and stderr is a terminal, the CLI prints the tokenized URL there once. An agent host that runs commands in a pseudo-terminal receives it. Mitigation: the skill forbids `--no-open`; the docs tell people to run `review` themselves when the browser does not open; the token works once.
- **Another local server on `127.0.0.1` reads the session cookie,** because cookies ignore ports. Mitigation: the random cookie name, the CSRF header requirement and the session ending with the process; documented as a limit.
- **The handler probe did not use a real browser.** Mitigation: Playwright tests in Chromium, Firefox and WebKit cover fragment removal, cookie acceptance on `127.0.0.1`, CSP enforcement, a forged Host and a foreign-origin page posting to the API.
- **The browser history can hold the `#bootstrap=` URL** until the page's `history.replaceState` runs, and a browser may keep that entry. Mitigation: the page removes the fragment before the router starts, and the bootstrap works once and expires after 10 minutes.
- **The real pseudo-terminal proof runs on Linux only.** Windows and macOS terminals are not tested that way. Mitigation: the skill forbids `--no-open`, the docs tell people to run `review` themselves when the browser does not open, and the bootstrap works once.

## Evidence

- HTTP probe cases: [evidence-2026-10.md, section 8](../evidence-2026-10.md#8-cli-workspace-sqlite-and-review-server).
- Vite maintainers, [GHSA-vg6x-rcgg-rjx6](https://github.com/vitejs/vite/security/advisories/GHSA-vg6x-rcgg-rjx6), 2025-01-20; webpack maintainers, [GHSA-9jgg-88mc-972h](https://github.com/webpack/webpack-dev-server/security/advisories/GHSA-9jgg-88mc-972h) and [GHSA-4v9v-hfq4-rm2v](https://github.com/webpack/webpack-dev-server/security/advisories/GHSA-4v9v-hfq4-rm2v), 2025-05-05; Project Jupyter, [Jupyter Server security](https://jupyter-server.readthedocs.io/en/latest/operators/security.html); MDN, [Using HTTP cookies](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies), updated 2026-09-17; W3C, [CSP Level 3, multiple policies](https://w3c.github.io/webappsec-csp/#multiple-policies); Microsoft, [Start-Process](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process?view=powershell-7.5). All observed 2026-10-06.

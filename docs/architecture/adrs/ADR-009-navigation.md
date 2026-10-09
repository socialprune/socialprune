# ADR-009: Navigation with hash routes

- **Status:** Accepted
- **Date:** 2026-10-06
- **Hard constraints touched:** 1 (GitHub Pages only), 2 (no export data in URLs)
- **Related:** [ADR-003](ADR-003-offline-app-shell.md), [ADR-016](ADR-016-local-review-server.md)

## Context

The app has a handful of sections: start, export guide per platform, demo, import, review, click lists, backup and settings. People need to link to the guide and the demo, use Back and Forward, and reload a section offline. GitHub Pages serves static files and cannot rewrite unknown paths to `index.html`; a custom `404.html` is served with status 404 and is an error document, not a rewrite. The usual redirect recipes for single-page apps on Pages rely on inline scripts, which the page policy forbids.

## Decision Drivers

- Deep links to guide and demo work on the first visit and offline.
- No new dependency for a few routes.
- No item text, account handle or file name ever appears in a URL.

## Options

### Option 1: Hash routes with a small app-owned router

**Pros:**
- `/socialprune/#/guide/x` sends only `/socialprune/` to the host, so first visits and offline reloads work; guide and demo hash reloads passed in Chromium, Firefox and WebKit.
- About 50 lines of code, no dependency.

**Cons:**
- Hash URLs look less tidy and are not indexed as separate pages by search engines.
- The app must parse and validate the hash itself.

**Effort:** not measured
**Risk:** Low.

### Option 2: A router library with path routes and a `404.html` fallback

**Pros:**
- Clean paths.
- Familiar API for contributors.

**Cons:**
- Deep paths return status 404 on first visit and need inline-script redirects or a duplicated shell.
- A dependency for six routes.

**Effort:** not measured
**Risk:** Medium.

### Option 3: No URLs, state only

**Pros:**
- Nothing to parse.
- Nothing can leak into a URL.

**Cons:**
- No links to the guide or demo, which the start page and the README need.
- Back and Forward do nothing useful.

**Effort:** not measured
**Risk:** Medium for usability.

## Decision

We chose **Option 1: hash routes with a small app-owned router**, because it is the only option that gives working deep links on Pages, offline and under the page policy, without a dependency.

Routes: `#/` start, `#/guide`, `#/guide/x`, `#/guide/instagram`, `#/demo`, `#/import`, `#/review`, `#/clicklist/x`, `#/clicklist/instagram`, `#/backup`, `#/settings`, `#/privacy`. Anything else shows a "Page not found" view with a link to `#/`.

- The router listens to `hashchange`, matches against this fixed list, and sets the document title and moves focus to the page's `<h1>` on every change.
- The review's account, filter, sort and search are kept in the workspace settings (`settings.review`), in the Pages build and in local-review mode alike. They are written only after a person changes one of them; opening the review reads them and writes nothing.
- Selection and the focused item stay in the page's memory for the session only. A selection restored after a restart could feed a bulk action the person did not prepare, and the protocol cannot report an item's position in a query, so the review reopens at the top of its list ([BL-005](../../BACKLOG.md)).
- The stored view's shape is part of workspace schema version 2, so changing it needs a `schemaVersion` bump. SQLite metadata and backups validate it strictly; only the reads that do not validate, the IndexedDB summary and the UI, fall back to the default view when the stored one does not parse.
- None of this state goes into the hash. The review route never carries an item ID.
- In the Pages build, `#/review` and `#/clicklist/*` render only after the worker gate in [ADR-004](ADR-004-content-security-policy.md) passes and a workspace is open; otherwise they redirect to `#/import`. In local-review mode there is no service worker; there the gate is a successful session exchange ([ADR-016](ADR-016-local-review-server.md)), and a failed exchange shows the session-ended page instead of any route.
- `404.html` is a static page with one link back to `/socialprune/#/`.
- **Local-review mode** ([ADR-016](ADR-016-local-review-server.md)) has a smaller route list, because the workspace is imported, backed up and restored with CLI commands there and its HTTP API offers none of that: `#/` (a start view that shows the workspace summary and the local-review privacy line), `#/review`, `#/clicklist/x`, `#/clicklist/instagram`, `#/settings` and `#/privacy`. `#/guide`, `#/demo`, `#/import` and `#/backup` show a short page naming the CLI command that does the job (`socialprune guide`, `socialprune import`, `socialprune backup export`). Settings hides the storage section and the "Delete this review from this browser" action, which belong to browser storage. The session token travels in the fragment once before the router starts and is removed with `history.replaceState`.

### Changes before acceptance

- The proposal kept filters, sort, selection and the focused item together in memory and in the workspace settings. Only the account, filter, sort and search are stored, and only after a person changes them; selection and the focused item stay in the session, because a restored selection could feed an unprepared bulk action and the protocol cannot locate an item in a query (decision D58, backlog BL-005).
- The proposal said nothing about the stored view's shape. A change to it needs a `schemaVersion` bump, because SQLite metadata and backups reject a view that does not parse, while only unvalidated reads fall back to defaults (decision D58a).

**Decision made by:** maintainer
**Approved on:** 2026-10-09

## Consequences

### Positive
- Links in the README and the start page work for first-time visitors and offline.
- No routing dependency to update.

### Negative
- Search engines see one page. If guide pages ever need indexing, they would become separate static HTML files.
- Contributors cannot add a route without editing the fixed list.

### Risks
- **A future feature puts sensitive state into the hash** because fragments are not sent to the server. Mitigation: the router rejects any hash outside the fixed list, and a unit test enumerates the list.
- **Focus handling on route change regresses.** Mitigation: the keyboard tests in [ADR-008](ADR-008-review-ui-primitives.md) check focus on the `<h1>` after each navigation.

## Evidence

- Hash reload results per engine: [evidence-2026-10.md, section 2](../evidence-2026-10.md#2-offline-shell-and-update).
- GitHub, [Creating a custom 404 page for your GitHub Pages site](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-custom-404-page-for-your-github-pages-site); MDN, [Location: hash](https://developer.mozilla.org/en-US/docs/Web/API/Location/hash). Both observed 2026-10-06.

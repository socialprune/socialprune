# ADR-007: Review data in a workspace worker, its protocol, queries and search

- **Status:** Proposed
- **Date:** 2026-10-06
- **Hard constraints touched:** 2 (local first), 3 (a person decides)
- **Related:** [ADR-004](ADR-004-content-security-policy.md), [ADR-005](ADR-005-browser-storage.md), [ADR-006](ADR-006-workspace-event-log.md), [ADR-008](ADR-008-review-ui-primitives.md)

## Context

The review screen shows one account's items, filtered and sorted, starting at the highest risk. A person moves through tens of thousands of rows by keyboard, changes one item or 4,000 at once, undoes, searches text and watches progress counts.

Two research lanes disagreed on where that data lives. The UI lane measured a main-thread store with `useSyncExternalStore`: filtering 40,000 of 100,000 small records took 7.08 ms, bulk mark 86.02 ms, undo 29.30 ms in a single Node run. The web-platform lane measured richer records closer to real items on the main thread:

| 100,000 rows, main thread | Chromium 153 median / p95 | Firefox 155 median / p95 |
|---|---:|---:|
| status and two categories filter, 13,334 hits | 1.7 / 7.2 ms | 2 / 3 ms |
| sort by risk then date | 82.9 / 105.8 ms | 622 / 715 ms (earlier run 423 / 550 ms) |
| lowercase substring, 5,883 hits | 94.9 / 311 ms | 92 / 233 ms |
| substring on a pre-lowercased projection | 59.6 / 76.9 ms | 34 / 43 ms |

S1 measured about 400 MiB peak with all 100,000 items held on the page during import. The Phase 1 import client still collects every item in a main-thread array. No phone was measured.

For search, one lane tested FlexSearch 0.8.212 and MiniSearch 7.2.0 in Chromium:

| 100,000 rows | Build | Retained added heap | Term query median / p95 |
|---|---:|---:|---:|
| substring, pre-lowercased | 221.7 ms normalize | not GC-measured | 59.6 / 76.9 ms |
| MiniSearch 7.2.0 | 4,044.1 ms | 59,236,544 bytes | 4.9 / 5.6 ms |
| FlexSearch 0.8.212 | 3,552.2 ms | 24,060,160 bytes | below 0.1 ms timer resolution |

In a worker, FlexSearch's index build took 3.713 s in Chromium, 7.148 s in Firefox and 10.077 s in WebKit. A worker substring scan in sorted order measured Chromium median 100.8 / p95 392.4 ms, Firefox 89 / 109 ms and WebKit 102 / 188 ms. FlexSearch's last release was 2025-09-06.

## Decision Drivers

- No interaction blocks the main thread for longer than 50 ms, on any engine, at 100,000 items.
- The page never holds all items, because S1 measured about 400 MiB with all of them on the page and phones were not measured at all.
- Search must match what people type literally, including inside words, URLs and names.
- Every decision command is atomic, acknowledged and undoable after a reload.

## Options

### Option 1: Main-thread store

**Pros:**
- Simplest code; filters under 10 ms in the measured canary.
- No message protocol.

**Cons:**
- Firefox sorts took 423 to 715 ms on the main thread, and substring p95 reached 311 ms in Chromium.
- All items live on the page, which S1 measured at about 400 MiB.

**Effort:** not measured
**Risk:** High in Firefox, and unmeasured on phones.

### Option 2: Workspace worker with a compact projection and bounded windows

A dedicated worker owns the database, keeps a compact columnar projection in memory, answers queries with counts and ID lists, and hands the UI windows of at most 200 rows.

**Pros:**
- Long scans and sorts run off the main thread; the page holds only visible rows.
- One owner for storage, commands and history, which makes atomicity testable.

**Cons:**
- A message protocol to design, version and test.
- Moving work to a worker does not make it faster: substring p95 was 392.4 ms in the Chromium worker probe.

**Effort:** not measured
**Risk:** Medium.

### Option 3: Worker plus a full-text index

Option 2 with FlexSearch for token search.

**Pros:**
- Term queries under 0.1 ms after the build.
- Prefix search.

**Cons:**
- 3.7 to 10.1 s index build per workspace open and 24 MB extra heap; token search does not find text inside words, and its default encoders change matching unless configured.
- A dependency without a release for 13 months at observation time.

**Effort:** not measured
**Risk:** Medium.

## Decision

We chose **Option 2: a workspace worker with a compact projection and bounded windows, with literal substring search only**, because it keeps the page small and responsive on every engine and gives search semantics people can predict. Full-text indexing is not part of Phase 2. We revisit it if the acceptance measurement shows substring p95 above 500 ms on the reference desktop in any engine, or if ranked search becomes a requirement.

### Ownership

- The **import worker** parses archives ([ADR-004](ADR-004-content-security-policy.md)). It sends item batches through a `MessageChannel` port straight to the workspace worker. Item batches no longer pass through the main thread.
- The **workspace worker** owns the IndexedDB connection ([ADR-005](ADR-005-browser-storage.md)), the projection, queries, commands, history, backup and restore.
- The **page** holds UI state only: filter inputs, the focused item ID, the selection set of item IDs, open dialogs, and the rows of the current window.

### Projection

Built on open from the stores, updated in place on every commit. One entry per item of a completed import: item ID; account index; kind; `createdAt` as a number; likes and reposts with `-1` for unknown; highest current risk (`-1` when no assessment); a bit mask of current assessment categories (at most 32 categories per workspace); the set of assessment source kinds; decision value; outcome value; and the text lowercased with `toLowerCase()` after NFC normalization. Text is not otherwise folded: `é` does not match `e`.

### Protocol

Messages are plain objects with a `type`, validated with zod on both sides. Every request carries a `requestId`; every reply names it. Errors carry a symbolic `code` and never a raw exception message, because messages can contain export text.

The request and reply schemas live in `packages/core/src/workspace/protocol.ts`, owned with the rest of the workspace service ([ADR-017](ADR-017-shared-workspace-service.md)). The browser worker and the local review server's HTTP API ([ADR-016](ADR-016-local-review-server.md)) both import them, so the two transports cannot drift. The handlers behind them are the same `ReviewService` and query code from `packages/core`.

| Request from the page | Reply |
|---|---|
| `open { workspaceId }` | `opened { summary }` with accounts, counts per decision and outcome, last backup time, schema version |
| `query { queryId, generation, accountKey, filter, sort, search }` | `queryResult { queryId, generation, total, counts }`; the worker keeps the ordered ID list for `queryId` |
| `window { queryId, generation, offset, limit ≤ 200 }` | `rows { queryId, generation, offset, rows }`; each row has ID, kind, date, short text of at most 280 characters, highest risk, categories, decision and outcome |
| `detail { itemId }` | `itemDetail { item, assessments, events }` with full text and every assessment and event for the item |
| `decide { commandId, itemIds ≤ 1,000, value, expected }` | `committed { commandId, actionId, revision, changed }` or `rejected { commandId, code: 'STALE' \| 'UNKNOWN_ITEM' \| 'STORAGE' }` |
| `previewBulk { previewId, queryId, generation, value, overwrite }` | `bulkPreview { previewId, total, willChange, unchanged, byCurrentValue, sample }`; the worker freezes the exact ID list and each item's current value. `overwrite` lists the current values that may change; the UI sends `['undecided', 'later']` unless the person ticks the option to include other decisions |
| `confirmBulk { commandId, previewId }` | `committed` or `rejected { code: 'STALE_PREVIEW', changedSince }` or `rejected { code: 'PREVIEW_EXPIRED' }` |
| `releasePreview { previewId }` | `released` |
| `undo { commandId }`, `redo { commandId }` | `committed { …, skipped }` or `rejected { code: 'NOTHING_TO_UNDO' }` |
| `history { limit }` | `historyEntries` with action ID, kind, value, size and time, newest first |
| `outcome { commandId, itemIds, value, expected }` | as `decide`, writing outcome events |
| `backup { target }`, `restore { file }`, `attachImport { port }` | progress messages, then `done` or `failed { code }` |

The worker also sends, unrequested, `changed { revision, itemIds | 'many', countsChanged }` after every commit, including commits made by another tab (each tab runs its own workspace worker; the workers announce new revisions over `BroadcastChannel('sp-workspace')`), and `storageState { persisted, usage, quota }` when it changes.

Rules the protocol enforces:

1. **Stale replies are dropped, older scans cancelled.** The page ignores any `queryResult` or `rows` whose `generation` is older than the latest it sent. A new `query` with the same `queryId` and a higher `generation` cancels the old scan: the worker scans in chunks of 5,000 rows, checks for a newer generation between chunks, and answers the cancelled request with `cancelled { queryId, generation }`. The page ignores that reply.
2. **Commands are idempotent by `commandId`.** A repeated `commandId` returns the first result without writing again.
3. **`expected` guards every change.** A command lists the value the person saw for each item; any mismatch rejects the whole command with `STALE`, and the page refreshes the affected rows.
4. **Frozen previews.** `confirmBulk` applies to exactly the frozen IDs. If any frozen item's value changed since the preview, it rejects with `STALE_PREVIEW` and the count; the person sees a new preview. A preview expires when it is confirmed, when the same page sends a new `previewBulk`, when the page leaves the review route (`releasePreview { previewId }`), or 10 minutes after it was made. Each page holds one open preview; over HTTP a session holds at most 4, one per page, and a fifth evicts the oldest. A confirm on an expired preview rejects with `PREVIEW_EXPIRED`. The same rules hold over HTTP ([ADR-016](ADR-016-local-review-server.md)), where the session ending also expires every preview of that session.
5. **History comes from the log.** Undo reverts the newest single or bulk action not yet undone. Redo is available only while no newer single or bulk action exists; a new action discards the redo branch. Because history is derived from the event log ([ADR-006](ADR-006-workspace-event-log.md)), it survives a reload.
6. **Acknowledged saves.** The page shows "Saved" only after `committed`. A `rejected { code: 'STORAGE' }` shows an error with a backup action and keeps the person's view unchanged.

### Queries

- One account at a time. Accounts are never mixed in one list.
- Default sort: highest risk descending, then `createdAt` descending, then item ID ascending. Items without an assessment sort after risk 0.
- Filters: decision values, outcome values, kinds, risk range, categories (any of), assessment source kinds, date range in the workspace time zone ([ADR-012](ADR-012-time-zone-grouping.md)), engagement thresholds with unknown kept separate, and literal substring.
- Templates such as "Older than two years without engagement" are saved filter definitions in the design specification, not verdicts. They produce a query; they never produce a decision.

**Decision made by:** maintainer
**Approved on:** pending

## Consequences

### Positive
- The page holds at most a few hundred rows, so memory no longer scales with the archive on the UI thread.
- Every decision path, including bulk and undo, goes through one tested command handler.

### Negative
- Search finds only literal, case-insensitive substrings. No ranking, no fuzzy matching, no accent folding.
- The protocol is a second public-ish contract inside the app; changing it needs care across the page, the worker and the tests.

### Risks
- **Worker substring scans exceed half a second on slow devices.** Mitigation: chunked cancellation keeps the UI responsive, a "Searching…" state appears after 150 ms, and the acceptance run records p50 and p95 per engine in the evidence. The revisit trigger above names the threshold.
- **Two tabs write at once.** Mitigation: IndexedDB transactions serialize writes; the `expected` guard rejects the second change to the same item, and the `changed` broadcast refreshes the other tab.

## Evidence

- Query, sort and search tables, the state canary and the worker scan: [evidence-2026-10.md, section 5](../evidence-2026-10.md#5-queries-search-and-time-zones). S1 memory figures: [S1](../../spikes/S1.md).
- MDN, [Using Web Workers, transferring data](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#transferring_data_to_and_from_workers_further_details); FlexSearch maintainers, [README 0.8.212](https://cdn.jsdelivr.net/npm/flexsearch@0.8.212/README.md); MiniSearch maintainers, [README 7.2.0](https://cdn.jsdelivr.net/npm/minisearch@7.2.0/README.md). All observed 2026-10-06.
- The decision rests on the Firefox sort times and the S1 memory figure. No source in the research shows how much memory a phone browser allows a page before ending it.

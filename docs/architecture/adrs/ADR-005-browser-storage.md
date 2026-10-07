# ADR-005: Browser storage engine and persistence

- **Status:** Proposed
- **Date:** 2026-10-06
- **Hard constraints touched:** 1 (no paid storage), 2 (local first), 5 (no promise that data survives)
- **Related:** [ADR-006](ADR-006-workspace-event-log.md), [ADR-007](ADR-007-review-data-worker.md)

## Context

A review session must survive a reload, a browser restart and a few days' pause. The workspace for 100,000 items is about 135 MB as canonical JSON. It holds imported items (written once, in bulk), assessments, the append-only decision log and a few settings ([ADR-006](ADR-006-workspace-event-log.md)). All storage access happens inside the workspace worker ([ADR-007](ADR-007-review-data-worker.md)), so the UI never touches the database.

This keeps the earlier default idb and records why. It changes the earlier storage decision that the browser keeps the working state in IndexedDB and OPFS: IndexedDB becomes the only store of record and OPFS becomes scratch space for writing backups. That change takes effect when the maintainer approves this record.

The sources disagreed. One research lane recommended idb 8.0.4, the literature review recommended Dexie 4.4.6, and the measured Chromium sample wrote faster with raw IndexedDB and Dexie than with idb:

| Chromium 153, 100 transactions of 1,000 puts | Write 100k | Full read | Bounded read | Event median / p95 |
|---|---:|---:|---:|---:|
| idb 8.0.4 | 9,638 ms | 2,491 ms | 1,795 ms | 0.60 / 2.10 ms |
| raw IndexedDB | 6,462 ms | 2,377 ms | 1,953 ms | 0.50 / 1.40 ms |
| Dexie 4.4.6 `bulkPut` | 6,632 ms | 2,310 ms | 1,832 ms | 0.50 / 1.20 ms |

**Spot check, 2026-10-06.** We read the trial code to find the cause of the write gap. The idb path pushed the promise of every `put` into an array and awaited them together with `tx.done`; it did not await each put in turn. The raw path attached no handler per request. The difference is therefore the per-request promise that idb's wrapper creates for each of the 100,000 puts, not serial awaiting and not the transaction layer. This is an inference from the trial code and idb's documented wrapping; no run measured idb with unwrapped puts. The same Chromium profile later took 21,600 ms for the idb write in the restart trial, so one sample per library does not support a ranking finer than this explanation.

## Decision Drivers

- Bulk import of 100,000 items must not take noticeably longer than raw IndexedDB.
- Each human decision commits durably with its projection in one transaction.
- Blocked upgrades, version changes and terminated connections must surface as visible states.
- Small dependency surface under [ADR-002](ADR-002-dependency-licenses.md); no WASM, no `SharedArrayBuffer`, no COOP or COEP headers, which Pages cannot send on the first visit.

## Options

### Option 1: idb 8.0.4, with unwrapped bulk writes

idb for opening, upgrades, typed schema, `blocked`, `blocking` and `terminated` hooks, and ordinary reads. The bulk item write path calls `unwrap()` on the store and issues raw `put` requests inside the transaction, awaiting only `tx.done`.

**Pros:**
- ISC, no runtime dependencies, a typed promise layer and the lifecycle hooks the update flow in [ADR-003](ADR-003-offline-app-shell.md) needs.
- The hot path avoids the measured per-request cost; the rest keeps idb's readable API.

**Cons:**
- Two styles of IndexedDB code in one module.
- The unwrapped path's speed is an inference until the acceptance measurement below runs.

**Effort:** not measured
**Risk:** Low.

### Option 2: Dexie 4.4.6

**Pros:**
- `bulkPut` matched raw speed in the trial; compound indexes and a query builder.
- Live queries for reactive UIs.

**Cons:**
- Live queries and the query builder solve a problem this design does not have: the worker owns a compact projection and answers queries itself ([ADR-007](ADR-007-review-data-worker.md)).
- A larger API and its own transaction rules to learn for a store that has six object stores.

**Effort:** not measured
**Risk:** Low.

### Option 3: Raw IndexedDB with an app-owned helper

**Pros:**
- Fastest write measured; no dependency.
- Full control of every request.

**Cons:**
- The project writes and tests its own promise layer and lifecycle hooks.
- More code in the place where a bug loses decisions.

**Effort:** not measured
**Risk:** Medium.

### Option 4: SQLite WASM on OPFS

**Pros:**
- Same engine as the CLI ([ADR-015](ADR-015-cli-storage-node-baseline.md)).
- Real SQL for queries.

**Cons:**
- The `opfs` VFS needs `SharedArrayBuffer` with COOP and COEP, which Pages cannot send on the first visit; the trial reported `crossOriginIsolated: false`. `opfs-sahpool` avoids that but holds a handle pool with single-owner tradeoffs.
- Needs `'wasm-unsafe-eval'` in the data worker's policy, and the package's license identity is compound: the registry says Apache-2.0 while the shipped JS carries MIT plus University of Illinois/NCSA and SQLite public-domain notices. No performance trial ran.

**Effort:** not measured
**Risk:** High.

## Decision

We chose **Option 1: idb 8.0.4, with unwrapped bulk writes** because it keeps the measured write speed within reach of raw IndexedDB while giving the lifecycle hooks and types that protect decisions, at the smallest dependency cost.

1. **Databases.** `sp-registry` holds the list of workspaces and the active pointer. Each workspace lives in its own database `sp-ws-<workspaceId>`. A restore or a migration writes a new database and switches the pointer in one transaction afterwards ([ADR-006](ADR-006-workspace-event-log.md)).
2. **Object stores per workspace.** They mirror the v2 workspace document in [ADR-006](ADR-006-workspace-event-log.md) and the SQLite tables in [ADR-015](ADR-015-cli-storage-node-baseline.md):

   | Store | Key | Indexes | Writes |
   |---|---|---|---|
   | `meta` | fixed key `'workspace'` | | header, `schemaVersion`, `settings`, `lastBackupAt` |
   | `imports` | `id` | | one record per import, status flipped once |
   | `items` | `id` | none; the worker builds its query projection in memory | inserted by imports; engagement fields updated by a newer import |
   | `assessments` | auto-increment `seq` (append order) | unique `assessmentId`; `itemId` | append only |
   | `submissions` | `submissionId` | | append only |
   | `decisionEvents` | auto-increment `seq` | unique `eventId`; `itemId` | append only |
   | `outcomeEvents` | auto-increment `seq` | unique `eventId`; `itemId` | append only |
   | `state` | `itemId` | | current decision and outcome per item, derived from the event stores |

   IndexedDB allows one key per store, so append order is the key and `assessmentId` is a unique index. An earlier draft keyed assessments by item and source, which would have overwritten older assessments and broken the append-only rule. The worker never calls `put` on an existing key in an append-only store; it uses `add`, which fails on a duplicate.
3. **Writes.** Items are written in batches of 1,000 per transaction through the unwrapped store. An import first writes an `imports` record with `status: 'incomplete'` and flips it to `complete` in the transaction of the last batch; the review only shows items of completed imports ([ADR-006](ADR-006-workspace-event-log.md)). Each human command writes its events and the `state` change in one `readwrite` transaction with `durability: 'strict'`. A label submission writes its `submissions` record and all its assessments in one transaction. A restore writes assessments and events in the document's array order, so `seq` reproduces the log order.
4. **Lifecycle.** On `versionchange` the worker closes the database and tells the UI. `blocked` and `terminated` become visible states with a reload action. Nothing relies on `unload` to commit.
5. **Persistence.** After the first successful import, and only in reaction to a click, the app calls `navigator.storage.persist()` and shows the result. A denial does not block anything. Settings show `estimate()` usage and quota and the persisted state, and the backup screen says that browser storage can be cleared by the browser or by the person, so a downloaded backup is the copy to keep. Before an import or restore, the worker checks `estimate()` against the file size and refuses with a clear message when the free space is smaller than three times the input; a `QuotaExceededError` mid-import discards the incomplete import and keeps the previous workspace.
6. **OPFS** is used only as scratch space for writing a backup file ([ADR-006](ADR-006-workspace-event-log.md)), never as the store of record.
7. **Acceptance measurement.** The import node measures 100,000 generated items into `items` through the production path in Chromium and Firefox, next to a raw IndexedDB control in the same run, and records both in the evidence. If the production path is more than 15 percent slower than the control in either engine, the implementation switches the bulk path to raw requests without changing this record.

Needs the maintainer's decision: approving this record changes the earlier storage decision from IndexedDB and OPFS to IndexedDB as the only store of record, with OPFS as backup scratch space.

**Decision made by:** maintainer
**Approved on:** pending

## Consequences

### Positive
- One small ISC dependency; the workspace never depends on headers Pages cannot send.
- A restart trial kept 100,000 items and 50 decision events after closing and reopening a Chromium profile.

### Negative
- Origin storage is shared by every Pages site under `socialprune.github.io`. The project uses its own GitHub organization so that this origin holds nothing else; database name prefixes prevent accidents, not access by another site published under the same organization. The organization therefore publishes no second Pages site ([ADR-019](ADR-019-pages-deployment.md)). A custom domain would also isolate the origin but costs money, which hard constraint 1 rules out.
- Firefox wrote 100,000 items in 15,154 ms in the final run (30,423 ms in an earlier one), so import progress must be honest about time on slower engines.

### Risks
- **Eviction.** Non-persistent origins can be evicted under storage pressure, and Safari's tracking prevention deletes script-writable storage after seven days of Safari use without interaction with the site. Mitigation: rule 5 copy, a "last backup" date on the review screen, and a backup prompt after each session with new decisions.
- **Quota on WebKit embedders and phones.** Mitigation: the `estimate()` check in rule 5, and a Safari pass on iOS before any release that claims iOS support.

## Evidence

- Storage table, method and restart trial: [evidence-2026-10.md, section 4](../evidence-2026-10.md#4-storage).
- idb maintainers, [README for 8.0.4](https://cdn.jsdelivr.net/npm/idb@8.0.4/README.md) (transaction lifetime, `tx.done`, `wrap` and `unwrap`); W3C, [Indexed Database API](https://w3c.github.io/IndexedDB/), live; MDN, [Storage quotas and eviction criteria](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria); WebKit, Sihui Liu, [Updates to Storage Policy](https://webkit.org/blog/14403/updates-to-storage-policy/), 2023-08-28; WebKit, John Wilander, [Full Third-Party Cookie Blocking and More](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/), 2020-03-24; SQLite, [WASM persistence](https://sqlite.org/wasm/doc/trunk/persistence.md). All observed 2026-10-06.

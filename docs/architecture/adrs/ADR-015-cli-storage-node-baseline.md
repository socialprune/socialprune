# ADR-015: CLI workspace storage on node:sqlite and the Node baseline

- **Status:** Accepted
- **Date:** 2026-10-06
- **Hard constraints touched:** 1 (no paid storage), 2 (the workspace stays in the folder the person names), 3 (decision history is append-only)
- **Related:** [ADR-002](ADR-002-dependency-licenses.md), [ADR-005](ADR-005-browser-storage.md), [ADR-006](ADR-006-workspace-event-log.md), [ADR-013](ADR-013-cli-framework-output.md), [ADR-016](ADR-016-local-review-server.md)

## Context

`socialprune import <export> --workspace <dir>` creates a workspace on disk that `summary`, `batch next`, `labels submit`, `review`, `export clicklist` and `backup` then share. Two processes can touch it at once: the local review server holds it open while an agent submits labels from another shell. The logical model is the v2 workspace document ([ADR-006](ADR-006-workspace-event-log.md)); the question is the physical store and the runtime it needs.

This changes the earlier storage decision that the CLI keeps the working state as a versioned file in the workspace folder. The working state becomes a SQLite database in that folder, and the versioned JSON document stays as the portable backup. The change takes effect when the maintainer approves this record.

A trial on 2026-10-06 wrote 100,000 generated items with one assessment and one decision each, all valid under the existing schemas, with data flushed in every format:

| Format | Bytes | Write | Read, parse and validate |
|---|---:|---:|---:|
| One JSON document | 94,937,642 | 1,282.76 ms | 5,038.67 ms read + 1,196.97 ms validate |
| Manifest plus NDJSON | 94,937,891 | 8,260.10 ms | 5,003.35 ms |
| SQLite, `journal_mode=DELETE` | 119,377,920 | 3,597.82 ms | 4,136.22 ms |
| SQLite, `journal_mode=WAL`, one connection | 119,377,920 | 6,655.33 ms | 3,668.92 ms |

Installs and builds overlapped during this run; an earlier, less contended sample measured DELETE at 3,669.52 ms write and 3,390.03 ms read, WAL at 4,623.85 ms and 3,172.29 ms. The numbers support capacity, not a speed ranking. SQLite read a 50-item indexed page near the end in 6.94 ms (DELETE) and 5.23 ms (WAL) and repeated 100,000 `INSERT OR IGNORE` with the row count unchanged. The WAL database peaked at 239,779,296 bytes with its journal before checkpoint, about twice the final size. A whole-JSON store would rewrite 95 MB per decision; NDJSON would need our own commit protocol, locks and compaction.

On Windows, renaming a file over a target that another Node process holds open failed with `EPERM`, and succeeded after the handle closed.

### Node versions, spot-checked

The sources disagreed on where `node:sqlite` stops warning. We read Node's tagged sources and the release index on 2026-10-06:

| Node | Released | `doc/api/sqlite.md` stability | `emitExperimentalWarning` in `lib/sqlite.js` | Embedded SQLite (`deps/sqlite/sqlite3.h`) |
|---|---|---|---|---|
| 24.14.1 | 2026-03-24 | 1.1, Active development | two lines: one import and one call | 3.51.2 |
| 24.15.0 | 2026-04-15 | 1.2, Release candidate | absent | 3.51.3 |
| 24.21.0 | 2026-09-07 | 1.2, Release candidate | not read; no warning observed at run time | 3.53.4 |

The SQLite WAL documentation (section 11, updated 2026-08-25) records a WAL-reset race in versions 3.7.0 through 3.51.2, fixed in 3.51.3. It affects only databases in WAL mode with two or more connections writing and checkpointing at the same moment. This record chooses the rollback journal (`DELETE`), so the race is not a reason for the Node floor. The floor rests on two other facts: Node 24.14.x prints an `ExperimentalWarning` when `node:sqlite` loads, and marks the module Stability 1.1, "Active development", while 24.15.0 is the first 24.x without the warning and marks it 1.2, "Release candidate".

A separate concurrency probe ran on Node 24.21.0 with SQLite 3.53.4 in WAL mode: two worker threads in one process, each with its own connection, committed 1,000 events each at the same time in 104.93 ms, and an `UPDATE` on the event table was rejected. It shows two connections working; it did not test two processes or the rollback journal.

### How a Node floor behaves

Measured during the architecture review on 2026-10-06, in a temporary project with no dependencies: on Node 24.14.1, `pnpm install` with pnpm 10.33.0 in a project whose root `package.json` has `"engines": { "node": ">=24.15.0" }` exits 0 and prints `WARN Unsupported engine`. A root `engines` field therefore warns and does not block installation. npm's `package.json` documentation describes `engines` as advisory unless the person sets `engine-strict`. Only a check in the code stops a command.

## Decision Drivers

- Atomic commits for import chunks, label files and human events, with two processes on one workspace.
- No new dependency and no native module to build on the person's machine.
- No warning text on every run of a privacy tool, and no reliance on a module its maintainers still mark as under active development.
- A workspace folder that a person can copy or back up without special knowledge.

## Options

### Option 1: node:sqlite, rollback journal, Node 24.15.0 or newer

**Pros:**
- Transactions, unique keys, indexed pages and two-process access without a dependency; SQLite is part of the Node runtime under [ADR-002](ADR-002-dependency-licenses.md), rule 5.
- One database file plus a short-lived journal during writes; no `-wal` or `-shm` files, no checkpoint growth. No warning on any run.

**Cons:**
- Readers wait while a writer commits. Every write transaction must stay short.
- Anyone on Node 24.14 or older must update before using workspace commands.

**Effort:** not measured
**Risk:** Low.

### Option 2: node:sqlite, rollback journal, Node 24.14.x with the warning

The same store, with the floor at Node 24.14.0 and the `ExperimentalWarning` left in place. Earlier 24.x releases were not checked.

**Pros:**
- Nobody on a recent Node 24 has to update.
- The WAL-reset race does not apply, because the journal is `DELETE`.

**Cons:**
- Every workspace command prints an `ExperimentalWarning` on stderr. In a tool whose output people check for privacy, an unexplained warning on every run teaches them to ignore stderr, where the sharing notice in [ADR-014](ADR-014-agent-interface.md) appears. Suppressing it would need `--no-warnings` or `--disable-warning` in the bin shebang, which also hides unrelated warnings.
- The module is Stability 1.1 there, one level below 24.15.0's release candidate, so API changes between 24.14 and later 24.x are more likely, and CI would need to cover both levels.

**Effort:** not measured
**Risk:** Medium.

### Option 3: node:sqlite, WAL, Node 24.15.0 or newer

**Pros:**
- Readers never wait for writers; the review server stays responsive during a label submission.
- Slightly faster indexed reads in the trial.

**Cons:**
- Two extra files that must stay with the database; copying only the `.sqlite` file can lose recent commits.
- Peak size about twice the database before checkpoint, and WAL is unsuitable on network file systems.

**Effort:** not measured
**Risk:** Medium.

### Option 4: JSON or NDJSON files with a lock file

**Pros:**
- Human-readable files; the JSON form equals the portable backup.
- Runs on any Node version.

**Cons:**
- Whole-file rewrites (95 MB) per decision, or our own append, commit, compaction and lock-recovery protocol.
- Needs a lock dependency such as proper-lockfile 4.1.2 (last release 2021-01-25) or a PID file that cannot detect stale owners reliably.

**Effort:** not measured
**Risk:** High.

## Decision

We chose **Option 1: node:sqlite with the rollback journal on Node 24.15.0 or newer**, because all writes are short, a single database file is the easiest form for people to copy and back up, and 24.15.0 is the first Node 24 release where the module neither warns nor carries the "Active development" label. Option 2 is the fallback if the maintainer keeps the floor lower; the store design is the same in both.

Decided by the maintainer on 2026-10-08: the Node floor is 24.15.0. The CLI workspace is a SQLite database, and the JSON document is its backup.

### Runtime and version checks

Four separate mechanisms, each with its own job:

| Mechanism | Value | What it does |
|---|---|---|
| Published npm package `engines` | `"node": ">=24.15.0"` | Documents the requirement. npm prints a warning on older Node and still installs; it does not stop anything. |
| Runtime check in the CLI | 24.15.0 | Every command that opens a workspace compares `process.versions.node` first and exits 1 with `NODE_TOO_OLD` and the message "SocialPrune needs Node.js 24.15 or newer for workspaces. You have <version>." `guide`, `structure`, `schemas` and `--help` still run on older Node 24, because they never load `node:sqlite`. This is the only mechanism that stops a command. |
| Root development `engines` | `"node": ">=24.15.0"` in the repository's `package.json` | pnpm 10.33.0 prints `WARN Unsupported engine` on older Node and installs anyway (measured above). Contributors on Node 24.14 or older can install, build and run the web tests; the CLI workspace tests stop with `NODE_TOO_OLD`. |
| CI | latest Node 24.x for the main jobs; one extra job pinned to 24.15.0 | The pinned job runs the CLI tests and the packed-CLI smoke test ([ADR-018](ADR-018-cli-distribution.md)), so a dependency on a newer 24.x API shows up. |

**User-visible consequence.** Anyone on Node 24.14 or older who runs a workspace command sees `NODE_TOO_OLD` and has to update Node; the current Node 24 LTS release was 24.21.0 on 2026-10-06. `structure` keeps working. No supported version prints an `ExperimentalWarning`.

`node:sqlite` is a release candidate on Node 24, not stable. A test suite pins the API surface we use (`DatabaseSync`, `prepare`, `exec`, `close`, `allowExtension: false`), so an API change shows up in the 24.15.0 CI job.

### Workspace folder

- `--workspace <dir>` holds one file, `socialprune.sqlite`. `import` creates the folder if it does not exist or is empty, and refuses a non-empty folder without that file (`MISSING_WORKSPACE`, exit 2). `--dry-run` creates nothing.
- The folder must be on a local disk. The docs say not to use network shares and not to let a sync client copy the folder while a command or `review` runs.

### Database settings

- Opened with `allowExtension: false`. Then `PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;`.
- Tables are `STRICT` and mirror the v2 document ([ADR-006](ADR-006-workspace-event-log.md)) and the browser stores ([ADR-005](ADR-005-browser-storage.md)):

  | Table | Primary key | Other constraints | Writes |
  |---|---|---|---|
  | `meta` | single row | | `format`, `schemaVersion`, workspace header, `settings`, `lastBackupAt`, plus the runtime `revision` and `last_event_seq` |
  | `imports` | `id` | | one row per import, status flipped once |
  | `items` | `id` | | inserted by imports; engagement columns updated by a newer import |
  | `assessments` | `seq INTEGER PRIMARY KEY` (append order) | unique `assessment_id`; index on `item_id` | append only |
  | `submissions` | `submission_id` | | append only |
  | `event_sequences` | `seq INTEGER PRIMARY KEY` | unique `event_id` | one row per decision or outcome event, so both logs share one `seq` |
  | `decision_events` | `seq INTEGER PRIMARY KEY` | unique `event_id`; index on `item_id`; `seq` references `event_sequences` | append only |
  | `outcome_events` | `seq INTEGER PRIMARY KEY` | unique `event_id`; index on `item_id`; `seq` references `event_sequences` | append only |
  | `state` | `item_id` | | current decision and outcome per item, derived |
  | `commands` | `command_id` | | one receipt per human command, so a repeated command returns its first result |
  | `migration_events` | `id` | index on time, kind and array position | temporary staging while a v1 workspace migrates |

  `PRAGMA user_version` tracks the physical layout. The append-only tables have triggers that raise on `UPDATE` and `DELETE`.
- Every write uses `BEGIN IMMEDIATE`: import in chunks of 1,000 items per transaction, one transaction per label file (its `submissions` row and all its assessments), one per human command. If the lock is not free within 5,000 ms, the command exits 1 with `WORKSPACE_BUSY` and `retryable: true`.
- SQL uses bound parameters only. Nothing from an export or a label file becomes SQL text, a table name or a file name.
- In `review`, a worker thread owns the connection so synchronous calls never block the HTTP event loop ([ADR-016](ADR-016-local-review-server.md)).

### Migration, backup and restore

- A layout migration runs inside `BEGIN EXCLUSIVE`, after copying the file to `socialprune.<UTC timestamp>.before-migration.sqlite` next to it.
- `backup export` streams the v2 document from one read transaction ([ADR-006](ADR-006-workspace-event-log.md)), including the submission records. It never copies the database file. After the file is written completely, it sets `meta.lastBackupAt`.
- `backup restore <file>` validates the whole file into a new `socialprune.restore-<random>.sqlite`, writing assessments, submissions and events in the document's array order so `seq` reproduces the log order. It then takes an exclusive lock on the current database to confirm no other process uses it, closes it, renames it to `socialprune.<UTC timestamp>.previous.sqlite`, and renames the new file into place. On Windows, a restore onto a file another process holds open reports `EBUSY` (observed on Node 24.21.0) or `EPERM`; both become `WORKSPACE_BUSY`. The output names the kept previous file. A downloaded SQLite file is never opened as a workspace; only the JSON document is accepted.

### Changes before acceptance

- The proposal's table had no shared event sequence, command receipts or migration staging. The built layout (`apps/cli/src/workspace/sqlite-store.ts`) adds `event_sequences`, `commands` and `migration_events`, and keeps the runtime revision and `last_event_seq` in `meta`; the table above now lists them.
- The proposal mapped only `EPERM` from a Windows rename to `WORKSPACE_BUSY`. A restore onto a locked file reported `EBUSY` on Node 24.21.0, so both codes now become `WORKSPACE_BUSY`; the `EPERM` observation of 2026-10-06 in the context above stays as it was measured.

**Decision made by:** maintainer
**Approved on:** 2026-10-09

## Consequences

### Positive
- No new dependency; transactions and uniqueness come from the runtime.
- One file per workspace; copying the folder while nothing runs copies everything.

### Negative
- Node 24.15 becomes the minimum for the CLI's workspace commands, which affects anyone on Node 24.14 or older. Root `engines` only warns, so contributors on older Node find out when a CLI test fails with `NODE_TOO_OLD`, not at install.
- The database is about 26 percent larger than the JSON document for the same data (119.4 MB against 94.9 MB in the trial).

### Risks
- **`node:sqlite` changes before it becomes stable on Node 24.** Mitigation: the API-surface tests and the pinned 24.15.0 CI job.
- **Readers stall behind a long write.** Mitigation: chunked imports and the 1,000-label limit keep transactions short; the acceptance run measures the review server's read latency during a 1,000-label submission.
- **A crash during import leaves a partial import.** Mitigation: the `incomplete` import status in [ADR-006](ADR-006-workspace-event-log.md) hides its items, and re-running the same import completes it; a crash test covers it.
- **Two processes in rollback-journal mode were not probed.** Mitigation: the CLI node's two-process test holds a write in one process and expects `WORKSPACE_BUSY` and then success in the other.

## Evidence

- Storage trial, concurrency probe and the Windows rename observation: [evidence-2026-10.md, section 8](../evidence-2026-10.md#8-cli-workspace-sqlite-and-review-server).
- Node.js tagged sources read 2026-10-06: `doc/api/sqlite.md`, `lib/sqlite.js` and `deps/sqlite/sqlite3.h` at [v24.14.1](https://github.com/nodejs/node/tree/v24.14.1) and [v24.15.0](https://github.com/nodejs/node/tree/v24.15.0); release dates from [nodejs.org/dist/index.json](https://nodejs.org/dist/index.json).
- pnpm 10.33.0 on Node 24.14.1 with root `engines.node` `>=24.15.0`: install exit 0 with `WARN Unsupported engine`, measured during the architecture review on 2026-10-06 in a temporary project with no dependencies.
- npm, [package.json, `engines`](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#engines); SQLite, [Write-Ahead Logging, section 11, the WAL-reset bug](https://www.sqlite.org/wal.html#walreset), updated 2026-08-25; SQLite, [Transactions](https://www.sqlite.org/lang_transaction.html); SQLite, [Copyright](https://www.sqlite.org/copyright.html). Observed 2026-10-06.

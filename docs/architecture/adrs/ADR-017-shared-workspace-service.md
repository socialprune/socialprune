# ADR-017: Package boundaries and the shared workspace service

- **Status:** Accepted
- **Date:** 2026-10-06
- **Hard constraints touched:** 3 (the capability to write decisions exists only on the review side)
- **Related:** [ADR-006](ADR-006-workspace-event-log.md), [ADR-007](ADR-007-review-data-worker.md), [ADR-014](ADR-014-agent-interface.md), [ADR-015](ADR-015-cli-storage-node-baseline.md), [ADR-016](ADR-016-local-review-server.md)

## Context

Phase 2 has two stores (IndexedDB in a browser worker, SQLite in Node) and three callers (the web review, the local review server, the CLI commands that agents use), with MCP to follow in 0.2. All of them need the same rules: re-import deduplication, the event chain, undo and redo, frozen bulk previews, assessment validation, queries, the backup format. If each store implements those rules on its own, the browser and the CLI will disagree on what a workspace means.

`AGENTS.md` sets one more boundary: a new platform is a new adapter package and must not need changes in `packages/core`. Phase 1 already meets it: `packages/core` defines `PlatformAdapter` with `platform`, `name`, `version`, `detect`, `parse` and `deletionHint`, and both adapters implement it.

## Decision Drivers

- One implementation of every workspace rule, tested once and used by both stores.
- The decision-writing capability is a separate object that CLI and MCP code cannot import by accident.
- Browser code never pulls in `node:` modules; Node code never pulls in DOM types.
- Adding a platform stays an adapter-only change.

## Options

### Option 1: Domain logic in `packages/core`, storage behind a port, two adapters in the apps

**Pros:**
- Rules live once, as plain functions over a small storage interface, with tests against an in-memory store.
- The apps own their storage technology, so `packages/core` stays free of IndexedDB and SQLite.

**Cons:**
- The storage port must express transactions in a way both IndexedDB and SQLite can honor.
- One more abstraction layer to learn.

**Effort:** not measured
**Risk:** Low.

### Option 2: A new `packages/workspace` package

**Pros:**
- Clear separation from the import pipeline.
- Its own version and tests.

**Cons:**
- `packages/core` already owns the model and schemas the service depends on; a new package splits one contract across two places.
- More workspace wiring for no new boundary.

**Effort:** not measured
**Risk:** Low.

### Option 3: Each app implements the rules on its store

**Pros:**
- Each store can use its native strengths, such as SQL for queries.
- No shared abstraction.

**Cons:**
- Two implementations of undo, re-import and validation that will drift.
- Twice the tests for the most sensitive logic.

**Effort:** not measured
**Risk:** High.

## Decision

We chose **Option 1: domain logic in `packages/core` behind a storage port, with an IndexedDB adapter in `apps/web` and a SQLite adapter in `apps/cli`**, because it keeps every workspace rule in one tested place without adding a package.

### Layout

| Path | Contents |
|---|---|
| `packages/core/src/model/` | v2 schemas ([ADR-006](ADR-006-workspace-event-log.md)), v1 schemas kept for migration |
| `packages/core/src/workspace/` | `WorkspaceStore` port; `migrateV1`; re-import merge; event chain rules; `deriveState`; assessment validation; backup writer and streaming reader; query projection and query evaluation; `dayKey` ([ADR-012](ADR-012-time-zone-grouping.md)) |
| `packages/core/src/workspace/review.ts` | `ReviewService`: decision and outcome commands, bulk preview and confirm, undo, redo, history |
| `packages/core/src/workspace/labels.ts` | `LabelService`: `batchNext`, `submitLabels`, `summary` |
| `packages/core/src/workspace/protocol.ts` | zod schemas for every request and reply of the review protocol ([ADR-007](ADR-007-review-data-worker.md)), shared by the browser worker and the local review HTTP API ([ADR-016](ADR-016-local-review-server.md)) |
| `packages/core/src/workspace/memory-store.ts` | in-memory `WorkspaceStore` for tests |
| `packages/core/src/browser-init.ts` | `z.config({ jitless: true })` only ([ADR-004](ADR-004-content-security-policy.md)) |
| `packages/core/src/guide/` | the export guide types and their checker; each adapter ships its own guide data in its `./guide` export ([ADR-022](ADR-022-export-guide-content.md)) |
| `apps/web/src/workspace/` | IndexedDB store ([ADR-005](ADR-005-browser-storage.md)), the workspace worker that answers the protocol ([ADR-007](ADR-007-review-data-worker.md)), the HTTP adapter for local review |
| `apps/cli/src/workspace/` | SQLite store ([ADR-015](ADR-015-cli-storage-node-baseline.md)) |
| `apps/cli/src/commands/` | one module per command, each exporting a Stricli command and a handler ([ADR-013](ADR-013-cli-framework-output.md)) |
| `apps/cli/src/review/` | the local review server and its database worker ([ADR-016](ADR-016-local-review-server.md)) |
| `skills/socialprune/` | the product Agent Skill ([ADR-014](ADR-014-agent-interface.md)) |

### The port

`WorkspaceStore` exposes `read(fn)` and `write(fn)`, each running `fn` inside one store transaction with typed accessors for meta, imports, items, assessments, decision events, outcome events and submissions. In both adapters a `write` either commits completely or not at all, and the shared contract suite tests that. Services never hold a transaction across an `await` on anything but the store.

### Capability split

- `ReviewService` is the only code that appends decision or outcome events. It is constructed only in `apps/web/src/workspace/worker.ts` and `apps/cli/src/review/`.
- `LabelService` has no method that touches decisions or outcomes.
- An ESLint `no-restricted-imports` rule in the root `eslint.config.js` forbids importing `workspace/review.ts` from `apps/cli/src/commands/**` and, later, from `packages/mcp/**`. The repository foundation step adds it, because `eslint.config.js` is a shared file.
- A unit test in `packages/core` walks the static import graph of every module under `apps/cli/src/commands/` and asserts that none reaches `workspace/review.ts`. The core owner writes it together with `ReviewService`, so the rule exists before the first CLI command does.

### Platform adapters

Phase 2 adds one field to `PlatformAdapter`: `clickListOrder`, either `'risk'`, which lists marked entries from the highest risk down, as X does, or `'day'`, which groups them by day, newest first, as Instagram does. Each entry's action and link come from the adapter's `deletionHint`: X gives the status URL with `delete` or `undo-repost`, Instagram gives `delete-comment` without a link. The review UI reads platform names, item kinds and click-list instructions from the adapter registry, not from platform checks in UI code. The contributor guide "Adding a platform" in `docs/architecture/README.md` lists the steps.

### Changes before acceptance

- The proposal described `PlatformAdapter` with an `export` description and a `clickList` description and called the contract unchanged in Phase 2. The code at the cited Phase 1 commit had `platform`, `name`, `version`, `detect`, `parse` and `deletionHint`, and Phase 2 added `clickListOrder`, so the click list knows how to order each platform's entries.
- The proposal placed the guide data in `packages/core/src/guide/`. Core holds only the guide types and the checker; each adapter ships its own guide data, so adding a platform needs no change in core ([ADR-022](ADR-022-export-guide-content.md)).

**Decision made by:** maintainer
**Approved on:** 2026-10-09

## Consequences

### Positive
- Undo, re-import and validation are written and tested once; browser and CLI cannot disagree about them.
- The rule that agents cannot decide is enforced by import structure and checked by a test, not only by convention.

### Negative
- Queries run in JavaScript over the projection even in SQLite, so the CLI does not use SQL for filtering.
- `packages/core` grows, and the S1 source binding over `packages/core/src` has to be renewed.

### Risks
- **The port leaks a store-specific behavior** such as IndexedDB auto-committing a transaction after an unrelated `await`. Mitigation: the rule above and a shared contract test suite that both adapters run.
- **A future contributor wires `ReviewService` into a CLI command.** Mitigation: the lint rule and the import-graph test.

## Evidence

- Phase 1 code at commit `7263d7d`, read 2026-10-06: `packages/core/src/adapter/index.ts` defines `PlatformAdapter` with `platform`, `name`, `version`, `detect`, `parse` and `deletionHint`; both `packages/adapter-x` and `packages/adapter-instagram` implement it; `packages/core/package.json` exports `./src/index.ts` and a Node-only `./node` entry; `apps/cli/src/main.ts` imports only from `@socialprune/core` and the adapters.
- `AGENTS.md` (Planned layout): "A new platform is a new adapter package and must not need changes in `packages/core`."
- No measurement decided this record; it follows from the shared rules in [ADR-006](ADR-006-workspace-event-log.md) and the two stores in [ADR-005](ADR-005-browser-storage.md) and [ADR-015](ADR-015-cli-storage-node-baseline.md).

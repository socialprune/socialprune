# ADR-006: Workspace model, decision event log, schema version 2 and portable backup

- **Status:** Proposed
- **Date:** 2026-10-06
- **Hard constraints touched:** 3 (a person decides; every decision records its source), 6 (backups in tests come from generated data)
- **Related:** [ADR-005](ADR-005-browser-storage.md), [ADR-007](ADR-007-review-data-worker.md), [ADR-014](ADR-014-agent-interface.md), [ADR-015](ADR-015-cli-storage-node-baseline.md), [ADR-020](ADR-020-demo-suggestions.md)

## Context

`packages/core` defines `WorkspaceSchema` with `schemaVersion: 1`. Its `decisions` array holds `Decision` records with `itemId`, `value` (`keep`, `delete`, `later`), `decidedAt` and `source: { kind: 'human', via: 'web-review' | 'local-review' }`. `Outcome` records hold `itemId`, `value` (`deleted-by-user`, `skipped`, `unknown`) and `recordedAt`, with no source at all. Assessments carry a source of kind `rules`, `model` or `agent`. No released build has written a v1 workspace file: Phase 1 had no persistence and no backup.

Phase 2 needs more than that shape can express:

- **Undo and redo** across a reload, without erasing what happened.
- **A return to "undecided"**, which v1 cannot represent.
- **Bulk actions** where 4,000 items change at once from a frozen preview, and undo reverts exactly those.
- **Re-import** of the same export, or a newer one, without duplicate items and without touching decisions.
- **Several assessment sources** on one item: an agent today, rules or a model after Phase 2a, hand-written examples in the demo ([ADR-020](ADR-020-demo-suggestions.md)).
- **Retries and backups** that can be deduplicated, which timestamps alone cannot do.
- **One portable file** that both the browser and the CLI read and write, so a review can move between them.

The CLI research also found an identity gap: `Item.id` is one string, and the schema does not require it to be unique across platforms. Both adapters already prefix it (`x:<tweet id>`, `instagram:<hash>`), but nothing enforces that.

## Decision Drivers

- Hard constraint 3: only a human action in the review UI creates a decision, and every decision keeps its source through every round trip.
- Undo never deletes history.
- The browser ([ADR-005](ADR-005-browser-storage.md)) and the CLI ([ADR-015](ADR-015-cli-storage-node-baseline.md)) store data differently but must agree on one logical model and one file.
- Later classifier tiers add assessments without another schema break.

## Options

### Option 1: Keep v1 and store undo state outside the schema

**Pros:**
- No migration.
- Smallest change to `packages/core`.

**Cons:**
- "Undecided" and undo would live in a side table that the backup does not carry, so a restored review loses its history.
- Bulk actions and retries cannot be deduplicated without event identity.

**Effort:** not measured
**Risk:** High. History and backup disagree.

### Option 2: Snapshot per item with a revision counter

Each item has one current decision row with a revision; changes overwrite it.

**Pros:**
- Simple reads.
- Small storage.

**Cons:**
- Overwrites history, which contradicts "every decision keeps its source" once a second source or a later correction appears.
- Undo needs a separate log anyway.

**Effort:** not measured
**Risk:** Medium.

### Option 3: Append-only event log with a derived state, schema version 2

Every human change is an event with its own identity and the value it replaced. Current state is derived from the log. Undo and redo append events.

**Pros:**
- One mechanism for single, bulk, undo, redo and "undecided"; the log is the audit trail.
- Retries and restores deduplicate by event ID.

**Cons:**
- A migration from v1 and new JSON schemas.
- The derived state must be maintained alongside the log in both stores.

**Effort:** not measured
**Risk:** Low.

## Decision

We chose **Option 3: an append-only event log with a derived state, as schema version 2**, because it expresses every Phase 2 requirement with one mechanism and keeps the full human history in the portable file.

### Item identity

`Item.id` must begin with `<platform>:` and is unique within a workspace. `importArchive` rejects an item that breaks the prefix rule and counts it under the existing `invalid-items` diagnostic. Both adapters already comply. `Item` also gains `mediaCount: number | null` ([ADR-021](ADR-021-archive-media.md)).

### Decision events

```ts
DecisionValue = 'keep' | 'delete' | 'later' | 'undecided'
DecisionEvent = {
  eventId: string          // crypto.randomUUID() when created
  itemId: string
  value: DecisionValue
  previous: DecisionValue  // the value the person saw when acting
  decidedAt: UtcTimestamp
  source: { kind: 'human', via: 'web-review' | 'local-review' }
  action: {
    id: string             // shared by all events of one user action
    kind: 'single' | 'bulk' | 'undo' | 'redo' | 'migrated'
    size: number           // number of events in this action
    reverts: string | null // action id this undo or redo reverses
  }
}
```

- **State.** An item's current decision is the `value` of its last event in log order, or `undecided` if it has none. Log order is the store's append order (IndexedDB `seq`, SQLite rowid, array position in the file), never `decidedAt`.
- **Single change.** One event, `action.kind: 'single'`, `size: 1`.
- **Bulk change.** One event per item, all sharing one `action.id`, written in one transaction, from a frozen preview ([ADR-007](ADR-007-review-data-worker.md)). Items whose value would not change produce no event.
- **Undo.** For each event of the reverted action, a new event with `value` set to that event's `previous`, `action.kind: 'undo'`, `reverts` naming the reverted action. Undo is refused for an item whose current value no longer equals the reverted event's `value`; the UI names how many items were skipped.
- **Redo.** The same, reversing an undo action, with `action.kind: 'redo'`.
- **Chain rule.** Each event's `previous` equals the item's value just before it in log order. Readers check this on restore. It catches corruption and hand edits that forgot the chain; it does not prove authorship, because anyone who can write the file can also write a consistent chain.
- **Who writes them.** Only the workspace worker's decision commands, called from the review UI in the browser or from the local review page through the session-authenticated API in [ADR-016](ADR-016-local-review-server.md). The CLI and the MCP server have no command that writes a decision event. A restore copies existing events verbatim with their original source; it never creates one.

### Outcome events

`OutcomeEvent` has the same shape with `value` and `previous` in `'deleted-by-user' | 'skipped' | 'unknown'`, `recordedAt` instead of `decidedAt`, and the same `action` object. Its `source` is `{ kind: 'human', via: 'web-review' | 'local-review' | 'v1-unrecorded' }`; `v1-unrecorded` exists only for outcomes migrated from version 1, which stored no source, and no command can write it. `unknown` is the starting value. A person records an outcome in the click list; undo works the same way.

### Assessments

`Assessment` gains `assessmentId: string` and `submissionId: string | null`, and its `source.kind` gains `'fixture'` for hand-written demo examples ([ADR-020](ADR-020-demo-suggestions.md)). Assessments are append-only. For each item and each `(source.kind, source.name)`, the last appended assessment is current; older ones stay in the log. Assessments never change a decision. A `fixture` assessment is accepted only in a workspace whose `kind` is `demo`, and `labels submit` accepts only `kind: 'agent'` ([ADR-014](ADR-014-agent-interface.md)).

### Submissions

Every accepted label file leaves one append-only record:

```ts
Submission = {
  submissionId: string       // from the label file, ^[A-Za-z0-9._-]{1,128}$
  contentHash: string        // 'sha256:' + hex of the canonical label file content
  source: AssessmentSource   // the file's source, kind 'agent'
  receivedAt: UtcTimestamp
  labelCount: number         // assessments written from this file
}
```

The record is what makes `labels submit` idempotent across stores and backups: the same `submissionId` with the same `contentHash` is a no-op, the same `submissionId` with a different hash is `SUBMISSION_CONFLICT` ([ADR-014](ADR-014-agent-interface.md)). Each assessment with a non-null `submissionId` names exactly one submission record.

### Re-import

- An item whose `id` already exists and whose `text`, `kind` and `createdAt` match is not added again. Its `engagement`, `url`, `reference` and `provenance` take the newer values when the new import's `exportCreatedAt` is not older.
- An existing `id` with different `text` is not changed. It is counted in a new `conflicting-items` diagnostic.
- Decisions, outcomes and assessments are never touched by an import. Each import appends its `ImportRecord`.
- An import that stops early leaves an `ImportRecord` with `status: 'incomplete'` and its items stay hidden until a later import of the same archives completes ([ADR-005](ADR-005-browser-storage.md)).

### Workspace document, version 2

The workspace document is also the portable backup. Keys appear in this order so a streaming reader meets the header first:

```ts
WorkspaceV2 = {
  format: 'socialprune-workspace'
  schemaVersion: 2
  id: string                       // random at creation
  kind: 'personal' | 'demo'
  createdAt: UtcTimestamp
  updatedAt: UtcTimestamp
  lastBackupAt: UtcTimestamp | null
  settings: { categories: CategoryId[], timeZone: string | null }
  counts: { imports, items, assessments, submissions, decisionEvents, outcomeEvents }  // integers
  imports: ImportRecord[]          // gains status: 'complete' | 'incomplete'
  items: Item[]                    // gains mediaCount: number | null
  submissions: Submission[]
  assessments: Assessment[]
  decisionEvents: DecisionEvent[]
  outcomeEvents: OutcomeEvent[]
}
```

`lastBackupAt` is the time the most recent complete backup of this workspace was written. A backup file carries its own creation time in this field. The store updates its value only after the backup file was written completely, so a cancelled or failed backup leaves the old value. `settings.timeZone` is `null` until the person picks a zone; then readers use it ([ADR-012](ADR-012-time-zone-grouping.md)).

### Migration from version 1

Readers accept v1 and v2; writers write only v2. Migration is deterministic, so migrating the same v1 file twice yields the same v2 file:

1. `decisions` becomes `decisionEvents` in array order. Each event gets `eventId = 'v1-' + sha256(JSON.stringify([index, record]))`, `previous` from the preceding migrated value of that item or `undecided`, and `action = { id: eventId, kind: 'migrated', size: 1, reverts: null }`. `source` is copied unchanged.
2. `outcomes` becomes `outcomeEvents` the same way, with `source: { kind: 'human', via: 'v1-unrecorded' }`, because v1 stored no source for outcomes and the migration does not invent one.
3. Each assessment gets `assessmentId = 'v1-' + sha256(JSON.stringify([index, record]))` and `submissionId: null`.
4. `id = 'v1-' + sha256(createdAt + every import id)`, `kind: 'personal'`, `format` added, `lastBackupAt: null`, `settings.timeZone: null`, `submissions: []`, every item gets `mediaCount: null`, every import gets `status: 'complete'`, and `counts` is computed last.
5. A v1 item whose `id` lacks the platform prefix fails the migration with a named error instead of being renamed, because renaming would detach its decisions.

### Backup and restore

- **Write.** Both the browser and the CLI stream the document in key order in bounded chunks; neither builds the whole JSON string. The browser writes to OPFS scratch, then offers the file through `showSaveFilePicker` (called inside the click, before any long work) or a `blob:` download link. The file name is `socialprune-backup-<YYYY-MM-DD>.json` and never contains a handle or account name.
- **Read.** `packages/core` provides one streaming reader built on its existing JSON cursor. It validates each record with its zod schema as it arrives, then checks at the end: `counts` match, item IDs, assessment IDs, submission IDs and event IDs are unique, every `itemId` refers to an item, every non-null `submissionId` on an assessment refers to a submission record, each submission's `labelCount` equals the number of assessments that name it, every event chain holds, and `fixture` assessments appear only in `demo` workspaces. Any failure rejects the file with a symbolic error and changes nothing.
- **Duplicates.** Within one file, a repeated `eventId`, `assessmentId` or `submissionId` with identical content is dropped; the same ID with different content rejects the file.
- **Submissions after restore.** A restore copies the submission records verbatim, so an agent that resubmits a file it already submitted before the backup gets the same no-op or `SUBMISSION_CONFLICT` as before. `lastBackupAt` keeps the value from the file.
- **Replace, not merge.** A restore replaces the active workspace. It writes a new store first and switches only after validation ([ADR-005](ADR-005-browser-storage.md), [ADR-015](ADR-015-cli-storage-node-baseline.md)). The confirmation offers to download a backup of the current workspace first. Merging two workspaces is not part of Phase 2.

### Schemas

`packages/core/schemas/` keeps the v1 files under `v1/` as the migration input and generates v2 files for the workspace, item, assessment, submission, decision event, outcome event and import record from the zod definitions, with the existing drift check.

**Decision made by:** maintainer
**Approved on:** pending

## Consequences

### Positive
- Undo, redo, bulk changes and "undecided" all survive reload, restore and the move between browser and CLI.
- Rules and model assessments in Phase 2a fit the existing `Assessment` shape; they add sources, not fields.

### Negative
- Every reader of `Decision` and `Outcome` in `packages/core` changes, and the S1 measurement, which is bound to a hash over `packages/core/src` and `apps/web/src`, no longer describes the current code and has to be repeated on the new import path.
- The log grows with every undo. A person who toggles one item 1,000 times leaves 1,000 events; a 100,000-item bulk change and its undo add 200,000.

### Risks
- **A forged human event.** An agent with shell access can append a consistent event to the file or database. Mitigation: no command path writes one, the skill forbids editing workspace files, and the click list shows each decision's `via` so the person can see an unexpected source. The chain check is not presented as authentication anywhere in the UI or docs.
- **Migration bug detaches decisions.** Mitigation: a v1 fixture with decisions and outcomes under `fixtures/synthetic/workspace/` migrates in a unit test, and the derived state is compared with an expected table written by hand in the test.

## Evidence

- Current model at commit `7263d7d`, read 2026-10-06: `packages/core/src/model/index.ts` defines `Decision` with `value` keep, delete or later and `source: { kind: 'human', via: 'web-review' | 'local-review' }`; `Outcome` with `itemId`, `value` and `recordedAt` and no source; `Assessment` with source kind rules, model or agent and a `reason` limited to one sentence; `WorkspaceSchema` with `schemaVersion: 1`.
- Both adapters prefix item IDs (`x:` and `instagram:`) at the same commit; the schema does not require it. The CLI research flagged the missing uniqueness rule on 2026-10-06.
- Backup trial: a schema-valid v1 workspace with 100,000 items streamed to OPFS in 1,818.5 ms as 135,427,980 bytes with no chunk over 2,501,748 bytes, and the downloaded file passed `WorkspaceSchema`: [evidence-2026-10.md, section 4](../evidence-2026-10.md#4-storage).
- CLI storage trial with the same item count: [evidence-2026-10.md, section 8](../evidence-2026-10.md#8-cli-workspace-sqlite-and-review-server).

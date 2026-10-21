# ADR-034: The cap on ticked criteria

- **Status:** Accepted on 2026-10-21 by the maintainer (card ADR-034, option A, card set v3: "Continue accordingly nach deiner Empfehlung")
- **Date:** 2026-10-21
- **Hard constraints touched:** 3 (the migration keeps ticked what the person saw before; ticking decides only what is suggested, and nothing is marked without the person's click), 6 (the reproducer uses a generated workspace). 1, 2, 4 and 5 stay as they are.
- **Supersedes in part:** [ADR-032](ADR-032-review-feed.md). See "Changes to accepted records".
- **Related:** [ADR-007](ADR-007-review-data-worker.md)

## Context

ADR-032 section 6 caps `settings.criteria.selected` at 30. The same section has migration 6 to 7 tick "every category the workspace lists or has a current assessment in, other than `harmless` and `unclear`" and says "Nothing is dropped". A valid version 6 workspace may list 32 categories, none of them `harmless` or `unclear`. No screen lets a person build such a list, but a restored backup can carry one. The migration must then tick 32 IDs, which the cap of 30 rejects. ADR-032 gives no reason for 30. It equals 32 minus `harmless` and `unclear`, a cap that holds only while both take two of the 32 slots, and this case breaks that. The only other limit is ADR-007's mask of 32 categories.

The slice 1 implementation reproduced this on 2026-10-21 with a generated workspace: the test failed against the cap of 30 (Evidence). On 2026-10-21, before approval, the slice 1 work was uncommitted and held the cap at 32 provisionally, and its comment named this record as pending. That code waited uncommitted for the maintainer's decision; as ADR-001 rule 7 says, nothing in this record took effect before he approved it.

## Decision Drivers

- Section 6: nothing is dropped, and the first tab differs from today's "Mark suggested entries" in exactly four ways.
- Section 6: backups restore versions 1 to 7.
- ADR-007's 32-bit category mask.

## Options

### Option A: `selected` holds at most 32 IDs

The cap becomes the size of ADR-007's mask. `harmless` and `unclear` stay unselectable, and every other rule of section 6 stays.

**Pros:** every earlier selection survives the migration; the cap follows the one limit the data model already has.
**Cons:** the cap no longer limits the picker, since a new workspace reaches at most 20 ticks (the 12 presets other than `harmless` and `unclear`, and 8 own criteria); tests must cover 32.
**Effort:** not measured. **Risk:** Low.

### Option B: Keep 30 and tick the first 30 in list order

The other categories stay listed and unticked. In the slice 1 work this means setting `CRITERIA_SELECTED_MAX` to 30; its migration already keeps the first IDs in list order up to that constant.

**Pros:** no change to the cap; one constant in code.
**Cons:** two earlier categories stop counting as hits, a fifth difference against section 6's four; "Nothing is dropped" no longer holds, and the order rule must be stated in this record and tested.
**Effort:** not measured. **Risk:** Medium.

### Option C: Refuse to migrate such a workspace

**Pros:** no change to the cap or the migration rule.
**Cons:** a valid backup no longer restores, against "restore 1 to 7", and the backup may be the person's only copy; the migration and the restore need a new refusal path with its own failure code.
**Effort:** not measured. **Risk:** High.

## Decision

We chose **Option A**, because it is the only option that keeps both promises of section 6, nothing dropped and every backup restored, with a cap the data model already enforces.

**Decision made by:** maintainer
**Approved on:** 2026-10-21

With approval, slice 1 can be committed with the cap at 32, and the reproducer is its proof: the migrated settings of 32 earlier categories pass the schema with all 32 ticked, and a selection with `harmless` or `unclear` fails it.

## Changes to accepted records

| Record | Rule it changes, and the new wording |
|---|---|
| ADR-032 | Section 6, first bullet: "`settings.criteria`: `{ selected (max 30), custom: { id, label, description, createdAt }[] (max 8), nextCustom, level: 0 \| 1 \| 2 }`" becomes "`settings.criteria`: `{ selected (max 32, without harmless and unclear), custom: { id, label, description, createdAt }[] (max 8), nextCustom, level: 0 \| 1 \| 2 }`". The rest of the bullet and of section 6 stays. |

## Consequences

### Positive

- A version 6 workspace with 32 earlier categories migrates with all of them ticked, as section 6 promises.
- One limit, ADR-007's 32, governs categories and ticks.

### Negative

- Such a workspace has no room for `harmless` and `unclear`. Today a label or an assessment in a category the workspace does not list fails with `UNKNOWN_CATEGORY` (`labels.ts`, Evidence). Under schema 7, ADR-032's row for ADR-014 checks a label against "each category in the file's `criteria`, or `harmless` or `unclear`" instead, so the failure code such a label gets is settled only in slice 6, while the restore still requires every stored category to be listed.
- Section 5 counts an entry as covered only when its run stored an assessment for it. Without `harmless`, no source can record a clear result in that workspace, so its entries stay "not checked" until an earlier category goes and the preset regains room.
- Neither point changes the choice: B and C leave the 32 listed categories, and so these limits, as they are.

### Risks

- **A later change ticks more IDs than the mask holds.** Mitigation: the schema cap of 32 and the reproducer.

## Evidence

Read on 2026-10-21 at `2e8806f` unless noted.

- `packages/core/src/model/index.ts`, line 183: `categories: z.array(v1.CategoryIdSchema).max(32)`; no rule requires `harmless` or `unclear` in the list.
- `packages/core/src/workspace/projection.ts`, lines 43 and 149: one bit per category in a `Uint32Array` mask (ADR-007).
- `packages/core/src/workspace/restore.ts`, lines 658 to 660: every assessment's category must be listed, so the migration never ticks more than the 32 listed IDs.
- `packages/core/src/workspace/labels.ts`, lines 258 to 259 (`labels submit`) and 355 to 356 (`appendAssessment`, for assessments without a submission such as the demo's examples): a category the workspace does not list fails with `UNKNOWN_CATEGORY`.
- Uncommitted slice 1 work, read on 2026-10-21 before approval: `packages/core/src/criteria/criteria.test.ts`, test "accepted migration of 32 earlier categories must keep all ticked and satisfy the selected-ID cap", where a generated workspace with `earlier-0` to `earlier-31` parses as version 6. Its migrated criteria failed the cap of 30 on 2026-10-21 and passed the then-provisional cap of 32, `CRITERIA_SELECTED_MAX` in `packages/core/src/criteria/schema.ts`, which `packages/core/src/criteria/migration.ts` applies with `.slice(0, CRITERIA_SELECTED_MAX)`.

## Questions for the maintainer

- Decided by the maintainer on 2026-10-21: option A, `settings.criteria.selected` holds up to 32 IDs, without `harmless` and `unclear` (card ADR-034, card set v3: "Continue accordingly nach deiner Empfehlung"). Every earlier selection survives the migration.

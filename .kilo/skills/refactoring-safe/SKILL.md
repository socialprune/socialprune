---
name: refactoring-safe
description: Use when restructuring repo files without changing their intended behavior or scope. Handles atomic edits, rollback thinking, and verification after each structural change. Triggers on 'refactor', 'restructure', 'rename', 'clean up'.
version: 1.0.1
author: Workflow Lab
created: 2026-04-19
updated: 2026-07-25
---

# Refactoring Safe

## Use when
- Existing content must be simplified, renamed, or reorganized without changing its meaning.
- A file should be compressed or clarified while preserving its contract.
- The main risk is structural drift rather than new functionality.

## Do not use when
- The task is primarily new implementation; use `feature-implementation`.
- The cause of breakage is still unknown; use `bug-diagnosis`.
- A redesign intentionally changes behavior; use `brainstorming` first.

## Behavior change
When loaded, the agent treats the work as behavior-preserving change:
1. isolate one structural change at a time,
2. preserve frozen behavior,
3. verify after each meaningful step,
4. prefer reversible edits over broad rewrites.

## Typical pairings
- `quality-gate-verification` to confirm no drift after refactor.
- `feature-implementation` when a refactor is part of a larger frozen build.

## Outputs
- Cleaner structure with unchanged intent.
- Verification notes showing behavior preservation.

## Procedure

### 1. Define invariants
- What must remain the same after the refactor?
- Which authorities freeze naming, count, or semantics?

### 2. Make atomic changes
- Rename one concept at a time.
- Reorder or compress sections without changing the contract.
- Remove duplication only when the replacement is already present.

### 3. Verify immediately
- Re-read the changed file.
- Check referenced inventory/count/path constraints still hold.

### 3.5 Gate deletion separately from restructuring
Removing content is not a refactor, and a partial archive is more dangerous than no archive because it looks safe.

Before any destructive cleanup:
- produce a full-text archive of everything in scope, plus byte or hash parity proof on the files whose loss would be unrecoverable. Directory presence is not archive proof.
- write the inventory and the exact deletion list, so the deletion set is enumerated rather than described.
- classify sensitive content explicitly before deletion is allowed: operator state, private documents, credentials, runtime configuration, and any protected-domain material.
- derive the archive scope from an inventory of every subtree that is actually written to, not from the directory that motivated the cleanup. The forgotten sibling is the one that gets lost.
- rank what stays by present operational, legal, onboarding, recovery, or audit value rather than by age or origin. Something old and untouched can still be the only copy of something needed.
- keep the source artifact untouched until the transformation, import, or move has completed and been verified. A half-transformed target plus a deleted source is unrecoverable, and that combination is usually reached one step at a time.
- if a parallel lane that was building the archive terminated, treat the archive as partial and reset deletion readiness to no until the gate is satisfied again.

### 4. Stop if scope starts to expand
- New capabilities belong to implementation, not refactoring.
- Reopen the approach if behavior change becomes necessary.

## Guardrails
- Do not infer deletion readiness from the existence of an archive directory; require full-text coverage, parity proof on critical files, and an explicit deletion list.
- Do not carry deletion readiness across a terminated parallel lane.
- Do not combine refactor and redesign silently.
- Do not delete structure that still carries frozen meaning.
- Do not leave old and new patterns mixed together.

## Completion checklist
- [ ] Invariants named
- [ ] Changes atomic
- [ ] Behavior preserved
- [ ] Verification rerun

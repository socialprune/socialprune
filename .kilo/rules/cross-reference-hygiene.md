# Cross-Reference Hygiene Rule

> **MANDATORY FOR ALL `.kilo` roles**
> Active references must stay real, aligned, and non-ambiguous.
> **Version:** 1.0.0
> **Updated:** 2026-04-19

---

## Constitutional Minimum

Broken doctrine references are system failures, not editorial nits.

---

## Hard Laws

1. Active references must point to real files.
1a. Registration is bidirectional. A declared component must exist, and an existing component that the runtime is expected to load must be declared. Check both directions, because an undeclared file is as invisible as a dead reference is broken.
2. Source-of-truth references and version-linked references must remain aligned when the source changes.
3. Shared doctrine must not silently drift across files.
4. Lower-authority or historical references may not override active canonical sources.
5. Workflow Bible drift is cross-reference drift when a workflow rule, skill, agent, support doc, or derivation standard changes.
6. Cross-reference discipline must stay compact here; bulk procedural maintenance logic belongs outside the constitutional core.

---

## Required Behaviors

### When editing a source-of-truth surface
- update linked references that depend on it,
- keep version-linked references synchronized,
- preserve clear authority ordering,
- and check whether `.kilo/WORKFLOW_BIBLE.md` must be updated because the changed workflow behavior affects shell understanding, bootstrap behavior, validation behavior, or distribution doctrine.

### When creating or updating references
- reference the canonical source,
- avoid duplicate full-text doctrine,
- and keep downstream summaries explicitly derivative.

---

## Failure Rule

If a live reference points to a missing file, stale authority, mismatched source/version relationship, or a Workflow Bible section that no longer matches changed workflow behavior, the artifact is constitutionally out of compliance.

---

*This rule is part of the thin `.kilo` constitutional core.*

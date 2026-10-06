---
name: workspace-surface-audit
description: Use when workflow work must discover what workflow surfaces actually exist in a repo or workspace before recommending new ones. Handles surface inventory, authority classification, drift detection, and anti-invention discipline for workspace audits.
version: 1.1.0
author: Workflow Lab
created: 2026-04-20
updated: 2026-08-03
---

# Workspace Surface Audit

## Use when
- Recommending new workflow files, shells, commands, memory surfaces, or governance artifacts for a repo or workspace.
- Auditing what workflow infrastructure already exists before proposing additions.
- Determining whether a missing capability is truly absent, merely hidden in another surface, or intentionally out of scope.

## Do not use when
- The task is a direct implementation request with already-frozen target paths.
- The audit is primarily about content quality inside a known surface; use `workflow-meta-audit`.
- The work is only cross-repo comparison after each repo surface has already been inventoried; use `cross-repo-audit`.

## Behavior change
When loaded, the agent stops inventing structure and first maps real workflow surfaces:
1. inventory what exists,
2. classify each surface by role and authority,
3. identify coverage gaps versus actual need,
4. recommend additions only after existence and ownership are clear.

## Why this exists
Workflow-surface planning often fails by recommending new files too early.
This skill prevents “just add another surface” behavior by making the current workspace reality explicit first: active shell files, compatibility surfaces, task artifacts, docs, commands, memory or checkpoint banks, and governance supports that actually exist in the audited repo.

## Template applicability note
In the template package, read root/template examples as parameterized methodology, not as a claim that the target repo is Workflow Lab root.
After bootstrap, the audit target is the repo's actual local surfaces first; root/template references matter only when the task is explicitly checking derivation or package drift.

## Typical pairings
- `pre-planning` when the surface audit is the first phase of a larger design task.
- `workflow-meta-audit` when existing surfaces also need coherence review.
- `repo-bootstrapping` when a repo may need a new baseline after the audit.
- `yagni-evaluation` when a proposed new surface still looks optional after inventory.

## Outputs
- Inventory of actual workflow surfaces.
- Classification of active, compatibility, historical, task-local, and absent surfaces.
- Recommendation set grounded in observed reality rather than assumption.
- Explicit note on what should stay local-only, package/template-worthy later, or out of scope.

## Surface classes
Use these classes during the audit:

| Class | Meaning |
|---|---|
| Active canonical | Live owner/runtime surface currently governing behavior |
| Active compatibility | Live but secondary runtime surface kept for compatibility or unattended use |
| Task-local | Per-task artifacts, checkpoints, or review evidence |
| Historical / provenance | Retained for archaeology or migration reference, not active guidance |
| Missing by design | Intentionally absent and should remain absent |
| Missing gap | Absent but likely needed for current goals |

## Audit scope examples
Look for real surfaces such as:
- current local shell surfaces like `.kilo/`, `AGENTS.md`, `kilo.jsonc`, and other live Kilo support files
- package/template/historical detection examples such as copied template folders, legacy compatibility folders, generated mode registries, backup runtime settings, or archived runtime folders when classification depends on context
- support docs such as `AGENTS.md`, the repo's system/source-of-truth docs if present, `.kilo/WORKFLOW_BIBLE.md`, and `docs/LESSONS_ARCHIVE.md`
- task-local landing zones under `docs/tasks/`
- memory or checkpoint surfaces under local docs/task folders when the repo actually has them
- template or backup surfaces only when they matter to the recommendation being made

## Procedure

### 1. Inventory before judgment
- List the workflow surfaces that actually exist in the target repo/workspace.
- Distinguish shell folders, support docs, task-local artifacts, and historical remnants.
- Record absence explicitly instead of silently assuming a standard layout.

### 2. Classify authority and role
- Mark which surfaces are active canonical, compatibility, historical, or task-local.
- Identify the active local surface versus copied package/template, derived, compatibility, or historical surfaces.
- Keep canonical-vs-compatibility ordering explicit.

### 3. Check purpose coverage
- For each important workflow function, ask whether a real surface already covers it.
- Examples: routing, lessons, checkpoints, task evidence, commands, compatibility runtime, package baseline.
- Search by the behavior and guarantees the function must provide, not only by an expected file, skill, command, or identifier name.
- If a function is already covered, prefer improving the existing surface over adding a new one.

### 4. Detect false gaps
- Do not call something missing just because it exists under a different but valid surface.
- An exact-name search returning no result is a discovery lead, not absence proof. Read the closest capability paths and compare their guarantees before classifying the gap.
- Do not recommend owner-only or package-only surfaces in an ordinary target repo unless the local ownership boundary truly requires them.
- Do not confuse historical backups with live runtime support.

### 5. Recommend only after inventory
- Propose new surfaces only when the inventory shows a real unmet need.
- State whether the recommendation belongs in the active local `.kilo`, a future package/template update, another downstream repo, or nowhere.
- Explain what existing surface was considered and why it was insufficient.

### 6. Verify recommendation honesty
- Read the recommendation against the inventory.
- Check that every proposed addition names the actual missing function and the intended owner.
- If the same need could be served by clarifying an existing surface, prefer that over expansion.

## Compact audit questions
- What workflow surfaces already exist here?
- Which are active now versus compatibility or historical?
- Which surface owns this function today?
- Is the perceived gap real, duplicated, or just hard to discover?
- Would a new surface reduce confusion, or create more surface area?

## Guardrails
- Do not recommend new files before checking what already exists.
- Do not treat historical or backup shells as active evidence.
- Do not collapse active local, package/template, compatibility, and historical surfaces into one bucket.
- Do not create surface sprawl when the real fix is discoverability or wording inside an existing surface.
- Do not claim a surface is absent without an explicit inventory pass.
- Do not claim a capability is absent without recording the behavior searched, plausible owners checked, closest alternatives found, and the unmet guarantee.

## Mini checklist
- [ ] Real surface inventory captured
- [ ] Authority class assigned
- [ ] Existing coverage checked before proposing additions
- [ ] False gaps ruled out
- [ ] Recommendation tied to a real missing function

## Completion checklist
- [ ] Workflow surfaces discovered from the actual workspace
- [ ] Canonical vs compatibility vs historical boundary made explicit
- [ ] Gaps classified as real, optional, or intentionally absent
- [ ] Recommendations grounded in observed surface reality

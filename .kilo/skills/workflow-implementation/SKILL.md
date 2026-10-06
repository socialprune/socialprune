---
name: workflow-implementation
description: Use when implementing or revising `.kilo` workflow artifacts in this repository, not product code or the product Agent Skill under `skills/`. Handles doctrine-first authoring for rules, skills, agents, support docs, and local workflow-surface changes with explicit root-vs-template derivation boundaries and workflow-specific readback.
version: 1.2.4
author: Workflow Lab
created: 2026-04-20
updated: 2026-07-26
---

# Workflow Implementation

## Placement note

Activated in SocialPrune on 2026-10-06 from the workflow template's optional layer. This repository writes its own skills and rules after Phase 1, and this skill is the procedure for that work.
Its references to root and template sources describe where shared doctrine comes from. They grant this repository no owner or distributor authority.

## Use when
- Creating or revising repo-local workflow artifacts such as rules, skills, agents, support docs, or doctrine surfaces in this repository.
- A task changes how the local repo shell behaves, guides, validates, or structures workflow-surface work.
- Generic implementation guidance is too broad and derived workflow-surface handling must be explicit.

## Do not use when
- The main task is generic feature delivery with no workflow-surface artifact; use `feature-implementation` instead.
- The task is only final approval; use `workflow-validation` for workflow-semantic judgment, or `quality-gate-verification` when only generic contract proof is required.
- The main need is open-ended design exploration; use `brainstorming` or `pre-planning` first.

## Behavior change
When loaded, implementation becomes repo-local workflow-surface work:
1. identify the workflow artifact and authority surface,
2. write for the local repo shell while keeping its derivation from root and template truth visible,
3. preserve root-vs-template-vs-target boundaries,
4. read back the artifact as workflow infrastructure before claiming completion.

## Typical pairings
- `feature-implementation` for compact file-creation discipline.
- `workflow-validation` before calling the workflow artifact ready.
- `quality-gate-verification` when a binary gate is needed after readback.

## Outputs
- Created or revised workflow artifact at the correct repo-local `.kilo` path.
- Brief implementation notes on doctrine source, derivation boundaries, and deferred rollout work.
- Readback-ready artifact specific enough to guide future workflow execution.

## Procedure

### 1. Define the workflow target
- Identify the artifact class: rule, skill, agent, support doc, or doctrine file.
- Confirm the local repo is the right home and the request belongs in its active `.kilo` shell rather than an owner/distributor governance surface.
- State exact target paths and explicit non-goals before the first edit.
- Before creating a new workflow surface, search the local live shell first or explicitly reuse passed-forward search evidence that already proved the surface does not exist.

### Artifact-class quick map
| Artifact class | Typical path | Minimum must-have |
|---|---|---|
| Rule | `.kilo/rules/*.md` | directive, laws, required behaviors, failure rule |
| Skill | `.kilo/skills/*/SKILL.md` | use when, behavior change, procedure, guardrails |
| Agent | `.kilo/agents/*.md` | role, scope, constraints, verification posture |
| Support doc | `.kilo/docs/*.md` for workflow support doctrine inside the repo shell; `docs/*.md` for broader repo-level architecture, lessons, or task-local authority | owner, purpose, authority boundary, update rule |
| Doctrine file | cross-cutting canonical doc | source-of-truth wording and sync implications |

### 2. Read owner authorities
- Read the current live repo truth, the derivation doctrine that shaped the template artifact, and the closest live pattern.
- Use historical backups only for substance mining, never as wording authority.
- Pull lessons that protect against stale doctrine, fake completion, truncation, or boundary drift.
- If support-doc guidance is relevant, read live `.kilo/docs/*.md` support docs when the target repo has that layer. If the layer is absent, use `.kilo/WORKFLOW_BIBLE.md`, `AGENTS.md`, and target-local docs instead of inventing missing support-doc paths.

### 3. Design for the live local shell
- Write to current `.kilo` terminology, section style, and runtime posture.
- Make the artifact operational on first read: clear use case, procedure, outputs, and guardrails.
- Ensure the artifact adds workflow-surface value beyond generic implementation or verification skills.
- Prefer reuse, extension, or composition of existing `.kilo` surfaces before inventing a new repo-local workflow file.

### 4. Respect boundaries while writing
- Keep the local target explicit: implement the repo-local artifact in `.kilo/` without turning package lineage into owner/distributor governance doctrine.
- Do not silently widen scope into root rollout, template sync, or downstream distribution.
- If the artifact discusses root or template sources, frame them as upstream authorities and derivation inputs, not the local operating owner.

### 5. Perform workflow-specific readback
- Read back the full artifact after writing.
- Check line-count reality, missing sections, and structural completeness.
- Check references, terminology, and whether the artifact would guide workflow work without extra explanation.
- Distinguish written reality from future rollout or documentation follow-ons.

### Integration checklist
- [ ] Correct repo-local shell path used
- [ ] Artifact class matches file shape and section expectations
- [ ] Search-before-build truth is visible or passed forward honestly
- [ ] References point to real live surfaces
- [ ] Upstream template wording and this repository's own wording stay distinguishable
- [ ] Distribution or parity implications are named only if actually in scope
- [ ] Follow-on sync work is separated from current implementation truth

### 6. Prepare the handoff
- Record what changed, what authority shaped it, and what was intentionally not touched.
- Name any downstream actions separately from current implementation truth.
- Route the artifact to `workflow-validation` when approval is required.

## Workflow-owner heuristics
- Prefer artifacts that govern workflow behavior, not project-domain behavior.
- Prefer compact operational guidance over long abstract doctrine.
- Treat owner-repo wording, derivation wording, and compatibility wording as separate concerns.
- If a workflow artifact still carries owner-repo lineage that would mislead a target repo, rewrite or mark that boundary explicitly.

## Guardrails
- Do not copy historical backup structure blindly.
- Do not write reusable-package or downstream-sync implications into a target-local change unless requested.
- Do not leave workflow artifacts generic enough that `feature-implementation` already covered them.
- Do not claim a workflow artifact exists or is complete until file write and readback are both done.

## Completion checklist
- [ ] Workflow target and local owner confirmed
- [ ] Live authorities and lessons read
- [ ] Root-vs-template-vs-target boundary preserved
- [ ] Full readback completed
- [ ] Workflow-specific value and deferrals recorded

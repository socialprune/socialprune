---
name: pre-planning
description: Use when analyzing a complex repo task before execution starts. Handles request decomposition, risk surfacing, output planning, and anti-shallow-execution checks. Triggers on 'pre-plan', 'analyze before starting', 'what do I need first', 'plan this first'.
version: 1.7.0
author: Workflow Lab
created: 2026-04-19
updated: 2026-08-10
---

# Pre-Planning

## Use when
- The task is multi-step, ambiguous, or high-blast-radius.
- Files, phases, or verification steps must be defined before execution.
- The work risks shallow implementation if started too quickly.

## Do not use when
- The task is a tiny obvious edit.
- The user only wants immediate execution on a fully frozen scope.
- The main problem is unknown failure behavior; use `bug-diagnosis` first.

## Behavior change
When loaded, the agent pauses execution and instead:
1. analyzes the request precisely,
2. completes discovery before pretending the plan is ready,
3. researches the relevant surfaces,
4. surfaces risks and protections,
5. plans outputs, proof, and phases before implementation begins.

## Typical pairings
- `workflow-routing` to choose the right lane for the plan.
- `brainstorming` if multiple valid execution strategies exist.
- `workspace-surface-audit` when the real live surfaces are still unclear.
- `quality-gate-verification` when the plan needs an explicit final proof bundle.
- `feature-implementation` after the plan is frozen.

## Outputs
- A task breakdown with scope, risks, and non-goals.
- A concrete phase plan with deliverables.
- Acceptance invariants and a proof map for each invariant.
- A dependency DAG with critical path, foundation nodes, independent nodes, integration order, and write-set owners when work is multi-lane.
- An Active Execution Contract that makes continuity, invalidation, and safe concurrency explicit.
- An execution-ready prompt or handoff note.
- A proportional Contribution Fit verdict before upstream implementation or a normal ready PR.

These outputs are visible structures, not automatic filesystem artifacts. The newest user request and Active Execution Contract determine whether any output may be written.

## Output authority

- If the task is read-only, inspection-only, explanation-only, planning-only without authorized writes, or has no authorized write domain, render plans, contracts, handoffs, protocols, explanations, and evidence inline.
- In that state, do not create `.kilo/plans/`, `docs/tasks/`, checkpoint, report, evidence, temporary, task, or other filesystem artifacts. Do not ask for write permission merely to satisfy this template. "Write" or "render the template explicitly" means visible structured output unless filesystem writing is already authorized.
- A durable artifact is legal only when the user explicitly requests or authorizes it, the accepted end state requires repository delivery, or it has named lasting recovery, compliance, forensic, irreversible-operation, or explicit cross-session handoff value.
- A skill, agent, mode, template, task procedure, tool capability, or frontmatter permission never creates write authority. Without authority, stay inline or fail closed as `needs_context` / `blocked`; do not take a permission-seeking artifact detour.
- Temporary storage is not a loophole. Read-only work may not create `%LOCALAPPDATA%\Temp\kilo` task files unless the user or an accepted runtime operation explicitly authorizes temporary output.

## Compact planning template

Use this shape when a visible pre-plan is needed:

```md
## Pre-Plan
- objective:
- request_anchor / accepted_plan:
- target_end_state:
- authorized_phases / current_phase:
- approval_boundaries / authorized_write_domains:
- governing authority:
- scope / non-goals:
- discovery complete:
- risks / mitigations:
- exact outputs:
- acceptance / proof:
- acceptance invariants:
- dependency DAG / critical path:
- foundation_gates / parallel_ready_nodes / next_ready_nodes:
- long-lived domain owners / integration order:
- plan_invalidation_conditions:
- phases:
- surface selection:
- first-edit checkpoint:
- handoff summary:
- contribution_fit: not-applicable | contribution type + implementation admission + evidence summary
```

## Compact risk matrix

Use this when the task has enough blast radius that plain bullets are too loose:

```md
| Risk | Why it matters | Mitigation | Verification |
|------|----------------|------------|--------------|
| scope drift | [effect] | [control] | [proof] |
| wiring miss | [effect] | [control] | [proof] |
| authority mismatch | [effect] | [control] | [proof] |
```

## Compact phase-output scaffold

Use this when phases need clearer execution shape:

```md
| Phase | Goal | Output | Verification |
|-------|------|--------|--------------|
| 1 | [goal] | [artifact/file] | [check] |
| 2 | [goal] | [artifact/file] | [check] |
```

## Acceptance / proof table

Use this when the plan needs stronger execution truth:

```md
| Output | Why it exists | Acceptance check | Proof method |
|---|---|---|---|
| [file/artifact] | [purpose] | [mechanically checkable condition] | [readback / command / diff / test] |
```

## Compact handoff shape

Use this when the plan is being handed to an implementation or review lane:

```md
[handoff]
  objective:
  locked_scope:
  governing_authority:
  first_edit_target:
  verification_targets:
  warnings:
```

## Procedure

### 1. Analyze the request
- Capture the newest request anchor, accepted plan, target end state, authorized phases, current phase, approval boundaries, authorized write domains, non-goals, acceptance invariants, and invalidation conditions.
- Treat the newest request and Active Execution Contract as the only write-authority source. Empty write domains or a read-only task force inline output.

### 2. Research the real context
- Read governing docs, related files, and existing patterns.
- Identify dependencies, prior art, and missing context.
- When the plan assumes a capability gap, search for the behavior across plausible entrypoints, workflows, state transitions, and owners. Do not stop at the function, filename, command, or label you expected.

### 2.5 Discovery-complete gate
- Do not call the plan ready while the executor would still need to search for obvious missing context during implementation.
- If implementation would still require hunting for current-state patterns, signatures, paths, or proof targets, discovery is incomplete.
- Minimum discovery-complete standard:
  - the governing authority is named,
  - the concrete target files or artifacts are named,
  - the live pattern or current-state file to follow is named,
  - the likely proof method for each output is named,
  - major unknowns are either resolved or explicitly blocked.
- If build-new depends on a missing-capability claim, discovery is incomplete until the plan records the capability-oriented search, the closest existing paths, the guarantees they already provide, and the exact unmet guarantee or intentional replacement reason.
- Reuse valid handoff authority, working paths, and recorded failed attempts. Discovery-complete does not mean every lane repeats the same search.
- For a bounded reversible config/runtime change, use about five discovery commands as a checkpoint: edit once authority and proof paths are clear, or name the real blocker. This is a self-control trigger, not a safety cap.

### 2.7 Contribution Fit for upstream work

Run this gate before editing when the intended outcome is upstream implementation or a normal ready pull request. It decides whether implementation is an appropriate contribution; it does not write the change or the PR.

Build the verdict in this order:
1. **Capability-gap proof** — reuse the capability-oriented search from discovery and state the exact unmet guarantee or intentional replacement reason.
2. **Architecture ownership and observed design intent** — identify the affected subsystem, contract, or workflow owner and cite the adopted repo's architecture, contribution guide, nearby implementation patterns, accepted issues/ADRs, or other observable design signals.
3. **Maintainer intent** — record direct evidence when it exists. If intent is not knowable, write `maintainer-intent: unknown`; do not infer approval.
4. **Material alternatives and tradeoffs** — compare the smallest credible alternatives across latency, cost, state, dependencies, security, privacy, maintenance, and operations where those dimensions can change materially.
5. **Contribution type** — select exactly one: `normal-pr`, `draft-or-prototype`, `issue-or-discussion`, `local-only`, `docs`, or `no-change`.
6. **Implementation admission** — select exactly one: `admitted`, `admitted-fast-path`, `blocked-material-choice`, or `not-an-implementation-contribution`.

Use `admitted-fast-path` only for a small obvious fix whose affected owner and intended behavior are clear, whose alternatives do not create a material design choice, and whose proof path is compact. Use `blocked-material-choice` when a normal ready PR would require guessing an open material latency, cost, state, dependency, security, privacy, maintenance, or operations decision. Route that uncertainty to `draft-or-prototype` or `issue-or-discussion`, or keep it `local-only`; do not silently promote it to `normal-pr`.

Use `not-an-implementation-contribution` with `docs` or `no-change` when no product/code implementation should begin. Record the verdict in the Active Execution Contract or handoff so `feature-implementation` can consume it without rerunning fit. Target-local doctrine must identify the canonical upstream/fork identities, default base, contribution guide, required public metadata, and required checks before publication.

### 3. Surface risks
- List breakage, drift, verification, and scope risks.
- Name the mitigation for each serious risk.
- If the risk set is non-trivial, write it as a compact matrix so each risk has a control and proof path.

### 4. Define safety rules
- State what must not be deleted, rewritten, or widened.
- Lock explicit non-goals to prevent scope creep.

### 5. Specify outputs
- List exact files or artifacts to create, modify, or verify.
- Distinguish required outputs from optional follow-ons.
- Distinguish inline structures from filesystem artifacts. Do not name a file output when the contract authorizes only visible inline output.

Output scaffold:
- artifact or file path,
- why it exists,
- whether it is created, modified, verified, or read-only,
- and what proof will show it is complete.

### 5.5 Check surface selection
- Before freezing the plan, confirm each output is landing in the right surface: rule, skill, support doc, temporary task area, or value-justified compact task-local artifact.
- Apply this selection only after write authority exists. Read-only work has no filesystem landing surface.
- If the surface is still ambiguous, route through `workflow-routing` before the first edit.
- Prefer the narrowest honest surface instead of creating a permanent doctrine file by default.

### 6. Plan the phases
- Order the work by dependency.
- Assign each phase a purpose, deliverable, and verification target.
- For multi-lane work, identify foundation nodes, the critical path, independent nodes, and integration order before dispatch.
- Assign one active owner per writable surface and semantic contract. Record disjoint write sets explicitly.
- Prefer one long-lived owner per domain rather than discovery, implementation, test, retry, review-summary, or commit micro-lanes.
- Apply the routing legality test before marking any nodes parallel. If one output is needed by another, use a baton pass.
- Keep each downstream node inactive until all foundation prerequisites have completed and passed their named proof gates.
- Mark currently safe nodes as `parallel_ready` and compute maximum safe concurrency with the canonical Parallelism ROI test in `workflow-routing`.
- Use inline or existing records when they preserve the contract; planning enables execution and should not create ceremony.
- Prefer a compact phase-output scaffold when more than one phase exists.
- If outputs are numerous or easy to misstate, add an acceptance/proof table instead of relying on narrative confidence.

### 7. Generate the execution handoff
- Produce a concise implementation-ready brief.
- Include an anti-shallow-execution checkpoint before the first edit.
- Include locked scope, first edit target, verification targets, and warnings in a compact handoff block.

### Complexity heuristic
- **Simple:** one clear file or one obvious surface -> inline pre-analysis is enough.
- **Complex:** multi-step, ambiguous, or meaningful blast radius -> render the compact planning template explicitly inline or in an already authorized existing artifact.
- **Sensitive but bounded:** apply the required backup, protected-boundary, credential, wiring, and proof controls without automatically increasing orchestration depth.

## Companion-skill expectations
- `workflow-routing` should be loaded when the correct surface, lane, or topology is still unclear.
- `workspace-surface-audit` should be loaded when the current workspace or workflow surface inventory is incomplete.
- `brainstorming` should be loaded when multiple real design options remain after discovery.
- `feature-implementation` should follow only after the discovery-complete gate is satisfied.
- For intended upstream work, `feature-implementation` should follow only when Contribution Fit returns `admitted` or `admitted-fast-path`.

## Guardrails
- Do not confuse planning with implementation progress.
- Do not hide uncertainty; name it and route around it.
- Do not create vague plans without explicit outputs and checks.
- Do not freeze a plan while the executor still needs basic discovery that could have been captured now.
- Do not use subjective acceptance language like "looks right" when a checkable proof path can be named.
- Do not guess maintainer intent or hide a material architecture choice inside a normal ready PR.

## Donor traceability
- Donor: `_external-workflow-audit/kilo-first/everything-claude-code/commands/prp-plan.md:10-15, 93-136, 117-125` — adapted the rule that a real plan captures enough context to avoid rediscovery during implementation; did not import PRP command packaging.
- Donor: `_external-workflow-audit/kilo-first/get-shit-done/get-shit-done/workflows/plan-phase.md:743-790, 756-760, 761-770` — adapted read-first and mechanically checkable acceptance criteria into compact planning doctrine; did not import XML task schema.
- Donor: `_external-workflow-audit/kilo-first/get-shit-done/get-shit-done/workflows/execute-plan.md:155-159, 161-167` — adapted the hard gate that acceptance criteria must be verified before calling work complete; did not import full execute-plan workflow.
- Donor: `_external-workflow-audit/kilo-first/get-shit-done/get-shit-done/references/thinking-models-planning.md:11-16, 23-28, 35-45` — adapted pre-mortem, constraint-first, and curse-of-knowledge checks into planning quality expectations; did not import the full model catalog.
- Donor: `https://www.anthropic.com/research/building-effective-agents` (2024-12-19) — adapted the rule to add complexity only when evidence demonstrates the need; did not import a universal agent-framework requirement.
- Donor: `https://github.com/obra/superpowers/blob/main/skills/brainstorming/SKILL.md` and `https://github.com/github/spec-kit` — adapted context-first inspection and what/why clarification. The capability-versus-identifier search distinction is Workflow Lab synthesis because direct external standardization is limited.

## Completion checklist
- [ ] Objective and end state clarified
- [ ] Relevant context researched
- [ ] Discovery-complete gate satisfied
- [ ] Any perceived capability gap is supported by capability-oriented evidence rather than an exact-name miss
- [ ] Contribution Fit recorded when upstream implementation or a normal ready PR is intended
- [ ] Risks and safety rules recorded
- [ ] Outputs and phases defined
- [ ] Acceptance / proof path defined
- [ ] Dependency DAG, critical path, and write-set ownership defined when multi-lane
- [ ] Execution handoff generated

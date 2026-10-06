---
name: workflow-routing
description: Use when choosing the right workflow lane, role, or execution topology before repo work begins. Handles role selection, path selection, and bounded delegation decisions. Triggers on 'which mode', 'route this', 'what lane', 'how should this run'.
version: 1.10.0
author: Workflow Lab
created: 2026-04-19
updated: 2026-08-10
---

# Workflow Routing

## Use when
- It is unclear which role should own the task.
- The task may need single-lane, phased, or parallel execution.
- A user request mixes design, implementation, debugging, and verification concerns.

## Do not use when
- The correct lane is already obvious and frozen.
- The task is already in active execution with no routing ambiguity.
- The task only needs external research; use `technology-research`.

## Behavior change
When loaded, the agent pauses execution long enough to choose the right path:
1. classify the task,
2. choose the narrowest honest surface,
3. select the primary role and escalation order,
4. select one primary procedural skill for the phase,
5. decide if delegation is needed,
6. name the intended verification close-out.

## Typical pairings
- `pre-planning` when the route depends on still-incomplete discovery.
- `brainstorming` when routing depends on unresolved design choice.
- `context-management` for complex, multi-phase work.
- `feature-implementation`, `bug-diagnosis`, or `quality-gate-verification` once the lane is selected.

## Lineage note

Old `mode-selection-guide` routing functionality now lives in two places:
- active lane selection and topology choice stay here in `workflow-routing`,
- broader catalog/reference material stays in the maintainer's workflow template library and is not part of this repository.

## Outputs
- Recommended lane/role.
- Recommended surface class when the work could land in more than one live surface.
- Execution topology: single-lane, sequential baton pass, or bounded wave.
- Key handoff or verification expectation.

## Procedure

### 1. Classify the task
Use the smallest accurate category:
- explain/research,
- design,
- implement,
- debug,
- review/verify,
- long autonomous run.

Before locking a route, confirm the task is understood well enough to avoid edit-first thrashing.

Read intent from the user's directive, not from the format of what they handed over. A prompt file, spec, checklist, or draft supplied with an operative instruction is the task to execute, not an artifact to review or rewrite. Route to review or authoring only when the user actually asked for critique, comparison, or a rewrite.

### 2. Choose the surface first
Use the narrowest surface that still fits the job.

| Need | Preferred surface | Why |
|---|---|---|
| deterministic always-on law | rule | should fire without model discretion |
| on-demand workflow or playbook | skill | richer task procedure that loads only when relevant |
| stable shared reference reused by multiple live surfaces | support doc | shared doctrine without turning it into a rule |
| scratch, raw output, staging, or intermediate run evidence | temporary task area | keep ordinary process residue outside Git under `%LOCALAPPDATA%\Temp\kilo\<task-slug>\` |
| compact durable task evidence | task-local artifact | use only when lasting recovery, compliance, forensic, or operator value justifies repository storage |

Decision order for surface choice:
1. Is this a deterministic always-on requirement? -> `rule`
2. Is it a task family workflow that should load only when needed? -> `skill`
3. Is it shared supporting doctrine reused by several live surfaces? -> `support doc`
4. Is it scratch, raw output, staging, or intermediate run evidence? -> temporary task area under `%LOCALAPPDATA%\Temp\kilo\<task-slug>\`
5. Does compact evidence have lasting recovery, compliance, forensic, or operator value? -> `task-local artifact`; otherwise keep it outside Git

Do not escalate to a heavier surface just because it feels more visible.

### 3. Pick the primary role
Default mapping:
- `workflow-ask` for explanation/research,
- `workflow-architect` for design/spec,
- `workflow-code` for implementation,
- `workflow-debug` for root cause,
- `workflow-reviewer` for independent review,
- `workflow-test-writer` for test creation,
- `workflow-orchestrator` for multi-lane topology design.

For bounded explanation/research/inspection with unknown files, symbols, or authority paths, assign one discovery owner before the first repository lookup. Keep it local only when the work is read-only, inside the current lane's authority, expected to close through one scoped search group plus no more than three targeted reads, and does not require protected-boundary specialization or independent judgment. Otherwise route one fresh `workflow-ask` lane before discovery. If a local bounded search exceeds that entry test, stop and hand off instead of widening. Discovery-first-then-delegate for duplicate confidence is prohibited.

If the chosen lane inherits unresolved findings from an earlier lane, do not stop at the vague phrase `route forward`.
Use this compact crosswalk instead:

| Label | Meaning |
|---|---|
| `stay-local` | the same lane can finish honestly without topology change |
| `revise-now` | immediate correction is required before handoff or acceptance |
| `replan` | pause and redesign the path because the current topology no longer fits |
| `later-wave` | real work remains, but it is intentionally deferred outside the current lane/task boundary |

`route forward` is the umbrella instruction: unresolved findings must leave the lane with one of the four labels above instead of dying as a passive note.

### 4. Choose escalation order
- Start deterministic-first when the task can be answered by inventory, path checks, readback, or other mechanically checkable evidence.
- Escalate semantic-second when interpretation, critique, prioritization, or design judgment is still genuinely needed after deterministic checks.
- If deterministic checks are still missing, do not jump straight to semantic review or architecture discussion.

Practical routing order:
1. inventory / readback / path resolution,
2. deterministic validation,
3. direct canary when the changed behavior has a safe direct path,
4. compact independent gate,
5. targeted revision,
6. one additional perspective only for a distinct unresolved risk,
7. full convergence only when the remaining risk is cross-cutting.

### 4.5 Separate sensitivity from complexity
- Sensitivity determines safety controls: protected-boundary discipline, credential handling, backup/rollback, approval boundaries, and proof strength.
- Complexity determines reasoning and orchestration depth: uncertainty, coupling, migration, irreversibility, architecture decisions, contradictory evidence, and distinct unresolved gap classes.
- Runtime, gateway, provider, credential, and security vocabulary alone does not justify Complexity 4 or a broad topology.

Use the **bounded reversible change fast path** when the change is known and exact, affects no more than two authoritative config/runtime surfaces, is backupable and atomic, is deterministically validatable and directly canary-testable, and has no migration, irreversible external action, open architecture decision, or unknown cause. Default to one implementation owner and at most one compact independent gate.

For bounded config/runtime work, use these as self-control checkpoints rather than safety caps:
- about 5 discovery commands before editing or declaring a blocker,
- about 10-15 commands total on the normal path,
- normally 1 restart,
- normally 1 direct canary per model or endpoint,
- extra exploration only when evidence conflicts or a new risk class appears.

Reuse valid authority, working paths, and failed attempts from handoff. Do not rediscover settled context.

### 4.6 Use the semantic-intent discovery ladder

Discovery locates likely meaning; acceptance later judges whether the implementation satisfies the contract.

- unknown concept/location: one scoped `semantic_search`, then targeted reads, then exact grep for callsites/counts/negative proof,
- explicit, source-identified, manifest-scoped corpus with model-free structural evidence: route bounded selection mechanics to `workflow-ask`,
- known identifier: direct grep, then targeted read,
- known file: direct read.

Pass forward only query, scope, top paths/symbols, source identity, and unresolved gap. Reuse it unless source changed.

Use the structural repo-map ladder only when corpus and exclusions are explicit, no persistent index or model ranking is needed, deterministic tie handling is defined, and source changes invalidate the result. Do not use it for ambient crawling, protected content, external donor discovery, or unknown corpora. An optional inert observation may follow only after ranking is frozen and must remain content-free, path-free, and unable to affect ranking.

### 4.7 Route contribution form from Contribution Fit

When `pre-planning` has produced a Contribution Fit verdict, routing selects the contribution form without reopening fit:

| Contribution type | Route |
|---|---|
| `normal-pr` | implementation may proceed only with `admitted` or `admitted-fast-path`; close with Git delivery and Published PR Identity when publication is in the end state |
| `draft-or-prototype` | make uncertainty visible; do not represent the result as a normal ready PR |
| `issue-or-discussion` | present the material choice, alternatives, evidence, and maintainer-intent unknown before implementation admission |
| `local-only` | keep the change out of upstream publication; local validation and delivery rules still apply to the accepted end state |
| `docs` | route to documentation-only work; use `not-an-implementation-contribution` for product/code implementation |
| `no-change` | close without implementation and preserve the reason |

Do not route a `blocked-material-choice` verdict to `normal-pr`. Small obvious fixes may use the `admitted-fast-path` route, but the compact fit record must still exist.

### 5. Choose topology
Apply the [orchestrator's self/internal-task/Agent Manager selection](../../agents/workflow-orchestrator.md#select-self-internal-task-or-agent-manager). Registered work follows [registered-session-lifecycle](../../rules/registered-session-lifecycle.md); [session-steering](../session-steering/SKILL.md) supplies registration and the full child-prompt obligations block. A topology choice never creates session or recursion authority.

- **Single lane** for one bounded domain; this is a work shape, not a serial mandate.
- **Sequential baton pass** when one step depends on the previous one.
- **Bounded wave** only when every active node passes the independent-domain legality test below.

Default execution shape: one accountable parent -> foundation gates -> maximum safe bounded wave -> long-lived domain-owner integration -> one final independent gate only when proportional acceptance requires it.

Default each phase to one primary procedural skill. Admit another only through the four-part gate in `skill-usage-discipline.md`. A new lane requires a new domain, independent authority, or genuinely new acceptance-risk class.

#### Independent-domain legality test

A bounded wave is legal only when all conditions are true:
1. one lane's output is not needed before another active lane can begin honestly,
2. write sets are disjoint,
3. each lane has a distinct acceptance result,
4. discovery, test-suite, and review perspectives are not duplicated,
5. integration order is known before dispatch.
6. no unsafe shared mutable runtime exists across the nodes.
7. expected wall-clock saving exceeds coordination and integration cost.

If two lanes need the same file or semantic contract, use one foundation/integration owner or a baton pass. Parallel reading does not justify parallel authorship.

This is the canonical **Parallelism ROI** test. Run every currently ready node that passes it. Keep migration/backfill serial when ordering, rollback, reconciliation, or shared data ownership makes parallel execution unsafe.

Thinking level is secondary to topology. Medium is often sufficient for known, reversible, deterministic work. High is appropriate for architecture, unknown cause, contracts, migration/recovery, or a contradictory gate. High thinking never justifies a larger topology by itself.

### 5.5 Regression examples

| Scenario | Route |
|---|---|
| known exact reversible change on one authoritative config/runtime surface | bounded fast path |
| same shape on two authoritative surfaces with sensitive credentials and protected boundaries | bounded fast path with stronger safety controls |
| migration, shared contract change, irreversible external action, or cross-cutting failure class | convergence path |
| failure cause is unknown | `bug-diagnosis` / debug-first before implementation |
| provider-specific credential source or request flag | target-local authority; do not universalize it |
| upstream change with a material unresolved architecture choice | `issue-or-discussion`, `draft-or-prototype`, or `local-only`; not a normal ready PR |
| fitted small obvious upstream fix | `normal-pr` with `admitted-fast-path`, then proportional verification |
| small single-lane work with sufficient direct proof | no task directory and no reviewer required by default |
| two independent domains after a shared foundation gate | maximum safe bounded wave, then domain-owner integration |
| two bugs in one domain and one invariant class | same long-lived domain owner; no per-bug lanes |

### 6. Name the close-out gate
- What evidence will prove the chosen path succeeded?
- Which role or verification step closes the loop?
- If the likely close-out is `quality-gate-verification`, name the expected bundle or readback shape up front instead of leaving the gate implied.

## Routing anti-patterns
- **panic-routing** — sending work to `workflow-orchestrator` just because it feels large
- **lane-blur** — mixing design, implementation, and review into one unnamed lane
- **premature-wave** — parallelizing work before dependency order is clear
- **shared-contract split** — giving concurrent ownership of one file or semantic contract to multiple lanes
- **edit-first thrash** — routing to implementation before authority or target contract is understood
- **review-as-summary** — calling something review when no independent critique or close-out gate exists
- **surface-bloat** — creating a rule, support doc, or new workflow surface when a task-local artifact or existing skill would carry the work honestly
- **semantic-first jump** — escalating to judgment-heavy review before deterministic checks and readback are done
- **sensitivity inflation** — treating security-sensitive nouns as proof that broad orchestration is required
- **skill-chain topology** — loading companions until the skill stack itself manufactures extra lanes
- **tool-shape drift** — importing a donor repo's packaging or product surface instead of its underlying decision logic

## Guardrails
- Do not route to `workflow-orchestrator` just because a task is large; use it when topology itself needs design.
- Do not keep separate routing helper skills once the umbrella exists.
- Do not blur design, implementation, and review into one unnamed lane.
- Prefer investigate-before-edit posture when authority or target contract is still unclear.
- If a routing decision feels hard only because the task is under-read, pause and inspect before escalating topology.
- Do not let unresolved findings drift as passive notes; either route forward with a named owner or replan explicitly.
- Do not create a permanent surface before proving a task-local artifact or existing surface is insufficient.
- Do not skip deterministic checks just because semantic review sounds more sophisticated.
- Companion skills load only when their actual condition holds. A pairing hint is not an automatic chain.

## Donor traceability
This skill projects the root routing procedure. Exact donor paths and root source observations are deliberately omitted under the root-to-template derivation boundary because they are not shipped runtime dependencies. The target retains the narrowest-surface choice and deterministic-first review order without importing donor packaging.

## Completion checklist
- [ ] Task classified
- [ ] Surface choice named
- [ ] Primary role selected
- [ ] Escalation order chosen
- [ ] Topology selected
- [ ] Close-out gate named

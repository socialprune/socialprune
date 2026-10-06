---
name: complex-implementation-convergence
description: Use for high-blast-radius implementation tasks that need invariant-owned implementation, integrated proof, class-based revision, and final independent validation. Triggers on cross-cutting contracts, migration/recovery, contradictory evidence, repeated distinct gap classes, or explicit adversarial/independent acceptance; 100/100 alone is insufficient.
version: 2.3.1
author: Workflow Lab
created: 2026-04-29
updated: 2026-07-25
---

# Complex Implementation Convergence

## Use when

- The task changes cross-cutting contracts, shared types, migration/recovery, persistence/queue/lifecycle behavior, irreversible effects, architecture boundaries, or multiple distinct acceptance-risk classes.
- The user explicitly asks for adversarial/independent acceptance, or logger-style/broad convergence where real cross-cutting risk is present.
- One implementation pass plus local checks cannot honestly prove the integrated result.

## Do not use when

- The task is tiny, single-surface, or directly provable.
- The failure cause is unknown; use `bug-diagnosis` first.
- The task is only final review; use `workflow-reviewer` or `quality-gate-verification`.
- A known exact change on no more than two authoritative config/runtime surfaces passes the bounded reversible fast-path test.
- Security-sensitive vocabulary is the only complexity signal. Sensitivity selects controls, not topology.
- `100/100` is the only signal. Treat it as a quality target and use the smallest proof path matching the real risk.

## Behavior change

When loaded, implementation follows an **Invariant-Owned DAG**:

1. freeze authority, scope, acceptance invariants, and proof paths,
2. follow the accepted plan and map its dependency DAG, critical path, foundation gates, write sets, and integration order,
3. assign one accountable parent, one primary procedural skill per phase, and one long-lived owner per domain, then run the maximum safe bounded wave,
4. run focused checks while each invariant changes,
5. integrate once and freeze the executable result,
6. run one broad relevant suite against the frozen executable source identity and dependency surface,
7. run one fresh independent acceptance gate,
8. send one routine targeted revision to the owner of a failed invariant,
9. make a decision after that revision instead of opening a quiet serial loop.

The goal is time to integrated proof, not lane count, review count, or artifact volume.

## Typical pairings

- `pre-planning` before implementation.
- `workflow-routing` when the DAG or ownership is not frozen.
- `feature-implementation` for implementation lanes.
- `workflow-test-writer` when durable test creation is a distinct DAG node.
- `synthesis` when multiple lane inputs must be merged once.
- `quality-gate-verification` and `workflow-reviewer` for independent acceptance.
- `context-management` for long or interruption-prone runs.

## Default execution budget

These are planning controls, not safety overrides:

- one accountable parent/integration owner,
- one broad discovery owner maximum,
- at most one architecture review, only for a genuine open architecture question or explicit adversarial independent review,
- the maximum safe number of independent domain nodes whose wall-clock saving exceeds coordination and integration cost,
- one implementation wave,
- one broad relevant suite per final frozen executable source identity,
- one multiprocess acceptance run when cross-process behavior is in scope,
- one final independent acceptance gate after integrated freeze,
- one routine targeted revision,
- no nested delegation unless explicitly authorized,
- one shared execution/evidence artifact,
- one compact closure artifact when required,
- no per-lane narrative files,
- no durable raw outputs by default.

Budget expiry never permits an unresolved acceptance defect to pass. Before any extra subagent, reviewer, test-writer, broad rerun, or revision, record remaining acceptance classes, missing/invalidated evidence, why the long-lived owner cannot close it, unique expected evidence, and coordination cost. Without a new risk class or independent-authority requirement, prohibit the extra work.

Keep the shared-board execution-budget tripwires visible. Crossing one triggers a topology reset and marginal-value decision, not automatic cancellation or another lane.

## Procedure

### 1. Freeze the authority packet

Before edits, record in the shared evidence board:

- Active Execution Contract, governing authority, scope, target end state, phases, boundaries, and non-goals,
- acceptance invariants and proof method for each,
- conditional high-risk controls,
- dependency DAG and critical path,
- foundation nodes and gates, parallel-ready nodes, next-ready nodes, and integration order,
- one long-lived owner per writable surface, domain, and semantic contract,
- close-out states and stop-loss criteria.

Foundation prerequisites must complete and satisfy their named proof gates before dependent or downstream nodes start. Keep downstream nodes inactive until that point, or model the dependency as a baton pass.

For cross-process work, the first executable command gate proves disposable shared state, real API/build start, tracked worker start/stop, production exclusion of fakes, and one asserted minimal lifecycle path. An unproven harness blocks the large matrix, broad review, and deep test-modernization work.

### 2. Prove legal parallelism

A bounded wave is legal only when all conditions hold:

1. one lane's output is not needed before another active lane can begin honestly,
2. write sets are disjoint,
3. acceptance results are distinct,
4. discovery, test-suite, and review perspectives are not duplicated,
5. integration order is known before dispatch.
6. no unsafe shared mutable runtime is active across the nodes.
7. expected wall-clock saving exceeds coordination and integration cost.

If two lanes need the same file or semantic contract, assign one foundation/integration owner or use a baton pass. Parallel reading does not justify concurrent authorship.

### 3. Implement by invariant

Each lane:

- consumes the frozen authority and current shared evidence,
- stays within its assigned write set,
- closes a named invariant or independent domain,
- runs focused checks during the change,
- returns changed paths, decisions, discoveries, warnings, proof, and invalidated evidence.
- retains discovery, implementation, focused tests, in-plan bug loopbacks, and build/canary proof for its domain instead of spawning micro-lanes.
- retains every callsite of the invariant class plus fixture, clock, path, stale-signature, scenario-isolation, focused test, and mechanical retry repairs. The lane cannot finish with failing required tests, missing proof, incomplete harness behavior, or fixable same-scope failures.

Use at most one broad discovery owner. Later lanes reuse settled discovery unless its source identity changed.

### 4. Integrate and freeze

The parent/integration owner:

- resolves integration order,
- confirms no overlapping ownership occurred,
- updates the shared board,
- freezes the integrated executable source identity and dependency surface,
- runs one broad relevant suite against that freeze.

Use the proof ladder: focused checks while implementation changes; one broad suite per repo per final frozen executable source identity and dependency surface; one multiprocess acceptance run when required; after a documentation-only or demonstrably isolated revision outside the suite boundary rerun only invalidated focused proof; after a targeted executable revision freeze a new identity and rerun focused proof plus the invalidated broad suite. Shared-contract, schema, fixture, generated-output, runtime-identity, and merge-resolution changes invalidate matching broad evidence. Test-side fixture, clock, path, stale-signature, and scenario-isolation failures stay with the implementation owner unless test architecture is unresolved.

### 5. Apply conditional high-risk controls

Use the matrix in `.kilo/rules/verification-before-completion.md` for matching risks:

- migration/backfill,
- queue/lease/retry/scheduler,
- recovery/backup/replay,
- cross-repo or deployed wiring,
- shared API/event/status/identity contract,
- irreversible or external operation.

These controls may require stronger fixtures, rollback proof, concurrency checks, restore drills, propagation proof, negative contract cases, approvals, or compensation plans. They do not automatically require more lanes or repeated broad suites.

### 6. Run one independent acceptance gate

The reviewer independently reconstructs the frozen contract, checks source identity and freshness, reads every changed artifact, reuses valid producer raw evidence, and takes bounded fresh samples of the highest-risk invariants. Independence means fresh judgment, not rerunning unchanged raw proof. The producer's PASS is never reusable. Every finding names `invariant_class` and consolidates all known in-scope callsites into one class packet.

Use an intermediate reviewer only when a real foundation result controls downstream safety or a distinct acceptance-risk class requires separation. Extra perspectives require positive marginal value.

Initial outcomes:

- `PASS`,
- `FAIL — one targeted revision`,
- `NEEDS_REVIEW — new risk class`,
- `BLOCKED`.

### 7. Revise once, then decide

Group findings by invariant or risk class. Send one routine targeted revision to the owner of the failed invariant. The owner fixes the class, not only the named callsite. A documentation-only or isolated revision reruns its invalidated focused proof; a targeted executable revision reruns focused proof and the broad suite invalidated by the new executable source identity or dependency surface.

After that revision, decide:

- `PASS`,
- `FAIL — replan`,
- `FAIL — split scope`,
- `NEEDS_REVIEW — authority decision`,
- `BLOCKED`.

A second quiet loop is forbidden. Another callsite of a known invariant is not a new class. An extra round is legal only for a genuinely new acceptance-class risk or invalidated evidence.

Out-of-plan findings are reported and routed only. A new lane or perspective requires plan belonging, a distinct acceptance risk, positive marginal value, invalidated or missing evidence, and acceptable coordination cost.

### 8. Keep evidence compact

Use one shared execution/evidence artifact for authority, DAG, ownership, D/F/W knowledge, evidence freshness, findings, and stop-loss decisions. Keep scratch, raw output, staging, and intermediate evidence under `%LOCALAPPDATA%\Temp\kilo\<task-slug>\`.

Before Git handoff, classify every changed and untracked path as product/source, durable test, migration, operational documentation, compact task evidence, generated/staging, or unrelated pre-existing work. Stage exact task-owned paths only.

## Evidence freshness

- `fresh` — directly observed against the current integrated executable source identity and dependency surface.
- `reused-valid` — unchanged evidence whose dependency surface and executable source identity still match.
- `invalidated` — covered executable source, shared contract, schema, generated output, fixtures, runtime identity, or merge resolution changed.
- `independent-sample` — fresh reviewer observation used for acceptance.

Fresh context is selective. It is most valuable for final acceptance and security, recovery, or transaction review, not for replaying settled discovery in every lane.

## Guardrails

- Do not optimize for the number of reviewers, rounds, or artifacts.
- Do not create a mandatory task-artifact warehouse.
- Do not split one file or semantic contract across active owners.
- Do not duplicate broad discovery, test suites, or review perspectives.
- Do not reopen callsites one by one or rerun broad proof without a named invalidation.
- Do not issue final PASS from broad-suite evidence tied to a stale executable source identity.
- Do not treat a known invariant at another callsite as a new risk class.
- Do not open a second quiet revision loop.
- Do not let the implementation lane self-certify acceptance.
- Do not accept unresolved defects because the budget expired.
- Do not claim 100/100 while an acceptance-class defect remains open.
- Do not widen the accepted plan because convergence exposed adjacent work.
- Keep migration/backfill serial when ordering, rollback, reconciliation, or shared data ownership makes parallel execution unsafe.

## Package applicability note

This baseline is active-shell procedure after adoption. Product, credential, operator, and protected-domain details remain repo-local. The template supplies the workflow controls, not a finished local risk model.

## Completion checklist

- [ ] Authority packet and acceptance invariants frozen
- [ ] Dependency DAG, critical path, write sets, and integration order recorded
- [ ] Legal-parallelism test passed for every parallel node
- [ ] Focused checks ran during implementation
- [ ] Executable source identity and dependency surface froze before the broad suite
- [ ] Conditional high-risk controls ran where applicable
- [ ] One independent gate returned a bounded verdict
- [ ] At most one routine targeted revision occurred
- [ ] Final decision matches evidence
- [ ] Evidence and Git-value classification stayed compact

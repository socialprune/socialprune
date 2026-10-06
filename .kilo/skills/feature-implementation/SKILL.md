---
name: feature-implementation
description: Use when implementing a new feature, workflow component, or scoped repo enhancement. Handles authority-first implementation, exact-scope execution, and verification-driven completion. Triggers on 'implement', 'build this', 'add feature', 'create component'.
version: 1.12.0
author: Workflow Lab
created: 2026-04-19
updated: 2026-08-10
---

# Feature Implementation

## Use when
- Building a new file or workflow artifact with clear authority and bounded scope.
- Converting a frozen plan into concrete implementation.
- Updating an existing artifact where the correct behavior is already defined.

## Do not use when
- The main problem is unknown root cause analysis; use `bug-diagnosis` first.
- The task is primarily architecture exploration; use `brainstorming` or `workflow-routing` first.
- The request is only a review/approval gate; use `quality-gate-verification` instead.

## Behavior change
When loaded, execution becomes authority-first and scope-locked:
1. read the governing spec/freeze before writing,
2. consume the frozen authority packet and shared evidence board,
3. map source-to-target and stay inside the assigned write set,
4. run focused checks against changed invariants,
5. retain the domain through focused proof, in-plan bug loopbacks, build/canary work, and compact integration handoff.

The first modification should happen only after authority, target contract, and non-goals are explicitly confirmed.

## Typical pairings
- `quality-gate-verification` for build/readback/validation closure.
- `complex-implementation-convergence` when the implementation is cross-cutting, migration/recovery-heavy, explicitly adversarial/independent, contradictory after direct proof, or needs invariant-owned integrated convergence. `100/100` alone is not enough.
- `refactoring-safe` when existing structure must change without behavior drift.
- `workflow-routing` when the correct lane is unclear before implementation starts.

## Outputs
- Implemented files at the frozen target paths.
- Compact updates to the shared execution/evidence artifact recording changed files, decisions, and focused proof.
- Explicit adopt-vs-build reasoning when the task could create new workflow machinery or support surfaces.

## Procedure

### 1. Lock scope
- Capture the exact requested phase and non-goals.
- Treat explicit deferrals as hard exclusions.
- Prefer the newest freeze artifact when planning docs conflict.

### 2. Read authorities
- Read the governing build/freeze/spec documents.
- Identify exact file paths, inventory count, and forbidden structures.
- Record any conflict resolution with authority basis.

### 2.5 Investigate-before-edit
- Confirm the task is truly implementation, not unresolved discovery.
- Confirm the chosen target is the highest-authority valid surface.
- Confirm what is intentionally not being added in the current wave.

### 2.6 Search-before-build gate
- Before adding a new capability, workflow file, helper surface, or support mechanism, check whether the behavior already exists in the live system under another name or path.
- Search by required behavior and guarantees across plausible owners and entrypoints; an exact symbol or filename miss is not gap proof.
- Use this decision order: **adopt** existing surface, **adapt** existing surface, **compose** multiple existing surfaces, then **build** new.
- Record the closest existing paths, the guarantees they already carry, and the exact missing guarantee or intentional replacement reason when build-new is still the honest outcome.
- Do not treat parity with another repo as sufficient reason to add a new local workflow surface.

### 2.7 Consume Contribution Fit
- When the accepted plan targets upstream implementation or PR publication, read the frozen Contribution Fit verdict from `pre-planning` before the first edit.
- Proceed with implementation only for `admitted` or `admitted-fast-path`, and preserve the selected contribution type in the handoff.
- `blocked-material-choice` stops normal ready-PR implementation until maintainer intent or the material choice is resolved; route the fitted work as draft/prototype, issue/discussion, or local-only instead of guessing.
- `not-an-implementation-contribution` means this skill does not implement product/code work; follow the selected `docs` or `no-change` route.
- Consume the verdict. Do not rerun Contribution Fit, silently upgrade its contribution type, or reinterpret unknown maintainer intent inside implementation.

### 3. Map source to target
- Reuse existing proven patterns where they fit.
- Compress or rewrite content to match successor-shell posture.
- Keep physical packaging Kilo-native: `skills/{skill}/SKILL.md`.

### 4. Implement only the authorized surface
- Create only the listed files.
- Stay inside the lane's disjoint write set. Do not edit a shared file or semantic contract assigned to the foundation/integration owner.
- Keep the first screen operationally legible.
- Do not silently add helpers, wrappers, overlays, or future-wave artifacts.
- Keep one long-lived domain owner for discovery, implementation, focused tests, in-plan bug fixes, build, direct canary, and authorized commit/push when the contract includes them. Do not split review, commit, push, status, or retry into micro-lanes.
- Keep fixtures, focused test/signature repairs, mechanical invocation retries, and one bundled class-based review revision with that owner. Three residual test-side failures of the same known invariant remain owner-local; a separate test-writer is justified only for a distinct durable test artifact or acceptance result.

### 4.2 In-plan and out-of-plan bugs
- An in-plan bug is inside the authorized write domain and must be fixed for an existing acceptance invariant. The same owner fixes multiple callsites of that invariant.
- An out-of-plan bug belongs to another surface, package, domain, or acceptance class. Report and route it without editing it.
- Stop at the Scope-Delta Gate when a fix needs a new surface, authority decision, architectural redesign, protected access, or unsafe ambiguous mutation.

### 4.5 Bounded reversible config/runtime fast path
Use this path when the exact known change affects no more than two authoritative config/runtime surfaces, can be backed up, applied atomically, validated deterministically, and directly canary-tested, with no migration, irreversible external action, open architecture decision, or unknown cause.

Fast-path sequence:
1. confirm authority and working path,
2. capture backup/rollback truth,
3. apply the atomic edit,
4. run deterministic validation,
5. restart once if the runtime requires it,
6. run one direct canary per changed model or endpoint,
7. route to at most one compact independent gate.

The normal command path is about 10-15 commands total. These numbers are checkpoint triggers, not safety caps; exceed them when contradictory evidence requires it and record why.

### 5. Verify before closure
- Read back every created file.
- Confirm exact inventory count.
- Confirm forbidden nested structures do not exist.
- Confirm the current canonical shell was not modified.
- During edits, run focused checks for the invariant just changed. Do not run the broad suite per lane.
- Hand changed paths, source identity, focused results, and invalidated evidence to the integration owner.
- Use Direct Proof Closure when focused evidence proves the bounded contract. After integrated shared-contract freeze, the parent owns the broad relevant suite and proportional independent gate.

### 5.2 Acceptance criteria progression gate
- Treat acceptance criteria as a hard progression gate, not a polite summary note.
- If the task or governing artifact names acceptance checks, run them before moving to the next task, lane, or closure claim.
- A task with failing acceptance criteria is still incomplete even if the files look finished.
- If one bounded fix round can plausibly clear the gap, revise the failed invariant and rerun its focused proof. Rerun broad proof only when its dependency surface was invalidated.
- If repeated fix attempts are no longer reducing the real acceptance gap, stop progression and route the result as `needs_review`, `blocked`, or explicit escalation instead of carrying a known-failing state forward.
- Never hide failing acceptance behind "follow-up later" when the current phase still depends on it.
- Do not return `done` or `done_with_concerns` while fixable red tests or obviously incomplete acceptance remain.

### 5.3 Test and fault-injection integrity
- Classify each in-scope test as `canonical-required`, `replaced-and-retired-in-this-change`, or `optional-but-compiling-with-current-signatures`. Never leave a skipped stale test.
- Assert claimed state transitions or durable effects; scenario names and process exit alone are not proof.
- Put fault injection and test mutations behind a test-only entrypoint or injected dependency. Prove they are unreachable from production entrypoints and normal runtime environments.
- At a safety boundary, exercise the negative or alternate branch whose failure causes harm through the real transition path. Do not infer decline from confirm, recovery from success, rollback from apply, or deny from allow.
- Keep the verification and documentation claim no broader than the entrypoint, branches, transitions, effects, and assertions the test actually exercised. A synthetic terminal state proves only behavior from that state.

### 5.35 Best-effort failure observability
- A best-effort or non-blocking path may keep the caller moving, but it must emit a correlated causal record when internal work fails.
- Use restart-surviving storage when restart, worker loss, or process loss could otherwise erase failed-work or causal evidence needed for diagnosis. Transient console or temporary-directory output is not enough for that claim.
- Keep severity and parent outcome proportional: handled internal failure evidence does not automatically mean the parent operation failed or that an operator must be paged.

### 5.4 Cross-process foundation gate
- Before a large matrix or broad review, prove disposable shared state is reachable; the real API/build entrypoint compiles and starts; workers start and stop through the tracked background-process lifecycle; production entrypoints cannot reach fakes; and one minimal real lifecycle path changes state as asserted.
- Keep downstream matrix/review work inactive while that harness is unproven.

### 5.5 Dependency and wiring reminder
- Confirm any referenced live path actually exists before treating the implementation as complete.
- If the new or changed artifact must be discovered, referenced, or consumed by another surface, run a compact wiring check per `.kilo/rules/wiring-verification.md`.
- If connectivity did not change, state that explicitly instead of silently skipping the check.
- For provider/model/transport-only acceptance, prefer a direct side-effect-free or non-persisting endpoint/transport canary. Do not route through agent, session, delivery, memory, or state paths unless that integration is itself in scope.
- Product-specific credential sources and transport request mechanics belong in target-local doctrine or task authority, not this universal skill.
- Deployment or activation is a separate approval only when it was not already authorized or is an explicit approval boundary. Continuation never invents it.

### 5.6 Effect receipt ledger

Use an append-only event/effect receipt ledger when an authorized effect can retry, become ambiguous, reconcile, or compensate. Bind each transition to operation, request, approval, source, prior receipt, effect, and compensation identities.

- accept only identical replay;
- require `reconcile` before retry from `ambiguous`;
- fail on duplicate effect or compensation identities;
- do not treat process completion or approval as proof that the effect occurred.

The ledger constrains an already authorized effect path. It does not grant effect authority.

### 5.7 Complex convergence escalation
- If the implementation has cross-cutting blast radius, changes shared/public contracts, requires migration/recovery, produces contradictory evidence, exposes repeated distinct gap classes, or the user explicitly requests adversarial/independent acceptance, load `complex-implementation-convergence` before claiming completion. A bare `100/100` label does not trigger it.
- Runtime/config wiring alone does not trigger convergence when the bounded reversible fast-path test passes.
- Local deterministic success closes bounded work through Direct Proof Closure when every invariant is covered; it is implementation evidence rather than final acceptance when an independent-acceptance condition applies.
- Complex work still uses one integrated freeze, one broad suite, one independent gate, and one routine targeted revision by default. Additional work needs a new acceptance-class risk or invalidated evidence.
- Do not carry a known audit finding forward as a follow-up if current acceptance depends on it.

### 5.8 Value/bloat preparation
- Classify changed and untracked paths before Git handoff: product/source, durable test, migration, operational documentation, compact task evidence, generated/staging, or unrelated pre-existing work.
- Keep scratch, raw output, staging, and intermediate evidence outside Git.
- Hand exact task-owned paths to the integration owner; do not imply an entire task directory should be staged.

### 5.9 Git delivery closure
- Classify delivery from the adopted repo's accepted end state as `required`, `pending authorization`, or `not required`.
- Commit and push without re-prompt only when the accepted plan or newest request already authorizes them. Otherwise leave them visibly pending.
- When delivery is required, keep it with the long-lived owner and record exact task-owned state, resulting commit hash, tracked upstream, fresh push result, and local/upstream equality.
- List unrelated dirty paths separately and leave them untouched. They do not excuse task-owned residue and are not part of the task commit.
- A validation PASS does not prove commit or push. Do not use full/no-open-points/safe-to-close language while required delivery remains uncommitted, ahead of upstream, or lacks fresh push proof.
- When the accepted end state includes a PR, push is not terminal. Hand the tested final commit and pushed branch identity to the Published PR Gate in `quality-gate-verification`; implementation does not self-certify the hosted PR object.

## Guardrails
- Never use shell commands for file creation or editing.
- Never expand scope because a neighboring capability seems useful.
- Never treat planned inventory as completed until readback proves it.
- Never treat candidate-shell precautions as active-shell doctrine after cutover; use `.kilo` as the current canonical shell.
- Never let "I know the pattern" replace authority readback before the first edit.
- Never build a new local workflow surface before checking whether an existing surface can carry the function.
- Never treat local green checks as final acceptance for complex convergence work.
- Never bypass or rerun a frozen Contribution Fit verdict during implementation.

## Completion checklist
- [ ] Authorities read
- [ ] Exact target files created
- [ ] No deferred scope added
- [ ] Readback completed
- [ ] Verification evidence recorded
- [ ] Complex convergence escalated when trigger conditions matched

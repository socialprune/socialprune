---
name: quality-gate-verification
description: Use when repo work must be approved with explicit evidence instead of narrative confidence. Handles readback, inventory checks, boundary checks, and PASS/FAIL closure. Triggers on 'verify', 'quality gate', 'review before complete', 'is this ready'.
version: 1.14.0
author: Workflow Lab
created: 2026-04-19
updated: 2026-08-10
---

# Quality Gate Verification

## Use when
- A phase claims completion and needs proof.
- Inventory, structure, or boundary rules must be checked.
- A candidate artifact needs PASS / FAIL evidence.

## Do not use when
- The work is still in exploration or open design.
- No artifact exists yet to verify.
- The problem is root-cause analysis of failure; use `bug-diagnosis` first.
- The primary judgment is whether a workflow rule, skill, agent, Bible, support doc, or placement decision is semantically correct and the optional `workflow-validation` skill is active; use that skill as the verdict owner.

## Exclusive ownership boundary

- This skill owns generic deterministic proof against an already-defined contract. In a combined workflow-validation topology, it is the sole deterministic-proof owner, not the semantic final-verdict owner.
- An active `workflow-validation` skill owns workflow-semantic doctrine, placement, and wiring judgment.
- Do not co-load both merely for duplicate PASS/FAIL framing. When the frozen topology combines them, `workflow-validation` owns semantic final judgment and this skill owns deterministic proof. Observations from either role transfer neither ownership, and workflow-validation local readback does not make it the proof owner.

## Behavior change
When loaded, the agent stops relying on narrative completion and instead:
1. identifies the required checks,
2. runs them against actual files,
3. records evidence,
4. applies the proportional gate type and returns a bounded verdict without expanding the plan.

## Typical pairings
- `feature-implementation` after file creation.
- `refactoring-safe` after structural cleanup.
- `continuous-learning` if verification catches a repeated process failure.

## Outputs
- PASS / FAIL — one targeted revision / NEEDS_REVIEW — new risk class / BLOCKED verdict.
- Verification evidence list.
- Explicit remaining blockers or accepted deferrals.

This template copy intentionally avoids references to root-only `.kilo/docs/*` support docs. If a target repo later adds equivalent local support docs, that repo can wire them in explicitly.

For repo bootstraps or workflow-shell readiness claims, include the local-doctrine gate from `repo-bootstrapping`: active target docs must describe the target repo, copied template/root wording must be adapted or explicitly non-active, and target-local support files required by active rules/skills must exist.

## Procedure

### Gate types

| Gate | Purpose | Closure effect |
|---|---|---|
| **Node Gate** | focused proof for one bounded node | closes the node and releases authorized dependents |
| **Foundation Gate** | proves a prerequisite that controls downstream safety or validity | releases listed parallel-ready or next-ready nodes |
| **Integrated Final Gate** | independent acceptance of a frozen shared-contract or convergence result | accepts, revises once, or escalates the integrated result |
| **Git Delivery Gate** | proves durable repository delivery when it belongs to the adopted repo's accepted end state | permits full closure or leaves delivery visibly pending |
| **Published PR Gate** | proves the hosted pull request is the intended object for the tested and pushed change | permits `PR identity verified` or leaves publication/identity visibly pending |
| **External Diagnosis Gate** | proves that a diagnosis destined for a third party rests on observed behavior of the real running system | permits publication or forces the artifact to state its own missing link |
| **Explicit Approval Gate** | user decision for a real scope delta or named approval boundary | may expand authority only through the newest request |

A gate checks the Active Execution Contract. It does not expand it, automatically ask the user, or create a lane for an out-of-plan bug.

For human-simple approval, verify two layers. The visible card is channel-neutral and mobile-first, and contains exact recipients, text, material values, exclusions, selected items, and whether approval is confirm-only, confirm-and-queue, or immediate-execute. The machine record holds card/review ID, version/hash, item IDs, expiry, evidence, and conversation/thread binding. Natural replies such as `yes`, `looks good`, or `do it` are examples, not required syntax. A natural reply resolves only the one fresh pending card most recently and immediately presented in that thread. If any visible term or declared effect changes, the old card is explicitly superseded and no longer pending and a new versioned card is presented. Confirmation aimed at the superseded card fails; confirmation of the immediately presented replacement stores reply plus card reference. Zero, two/multiple, expired, stale-thread, ambiguous, or free-floating confirmation fails closed. Never require UUIDs, hashes, JSON, or magic commands the system already knows.

### 1. Define the gate
- What would prove this phase is complete?
- Which authority document owns the pass condition?

### 1.5 Frame the gate backward from the goal
Before checking artifacts, walk the claim backward:
- **truth** — what must be true for the goal to count as achieved?
- **artifact** — what must exist for that truth to hold?
- **wiring** — what must be connected or consumed so those artifacts are real system behavior instead of isolated files?
- **proof** — what evidence would actually prove the truth instead of merely showing file presence?

This framing does not replace deterministic checks. It makes sure the checks are proving the right thing.

### 2. Run direct checks
Typical checks include:
- readback of created files,
- exact inventory count,
- forbidden-path absence,
- untouched-current-shell confirmation,
- local-doctrine readback for bootstrap/readiness claims,
- target-local support-file existence for active copied rules and skills,
- cross-process foundation proof before a large matrix: disposable shared state, real API/build start, tracked worker lifecycle, production exclusion of fakes, and one asserted minimal real lifecycle,
- test disposition: every in-scope test is canonical-required, replaced-and-retired now, or optional but compiling with current signatures; skipped stale tests fail,
- negative production reachability proof for fault injection and test mutations.
- capability-gap proof when build-new was justified: behavior-oriented search, plausible owners/entrypoints checked, closest alternatives and existing guarantees named, exact unmet guarantee or replacement reason stated.
- safety-claim traceability: each claimed property maps to the real negative or alternate branch, transition path, asserted state/effect, and actual entrypoint exercised.
- best-effort observability: a correlated causal failure record exists, and restart-surviving retention is proven when restart or worker loss could otherwise erase diagnostic truth.

Use evidence once when it proves multiple related claims. One fail-closed structured check may establish schema validity, required-field presence, forbidden-field absence, and reference resolution together. Do not rerun unchanged claims in every lane unless independent acceptance requires a fresh observation.

The gate reuses producer raw evidence when source identity and freshness remain valid. It may not reuse the producer's PASS. Independent acceptance is fresh judgment against the frozen contract, not unchanged command re-execution. An Integrated Final Gate reads every changed artifact, checks source identity, and takes bounded fresh samples; a Node or Foundation Gate reads only what its contract needs. No callsite-by-callsite reopening or broad rerun is allowed without a named invalidation.

For provider/model/transport-only acceptance, prefer one direct side-effect-free or non-persisting transport/endpoint canary per changed model or endpoint. Do not use agent, session, delivery, memory, or state paths unless integration with those paths is in scope. Target-local doctrine owns provider-specific credential sources and request flags.

### 3. Evaluate against authority
- Compare actual state to freeze/build/spec artifacts.
- Prefer newer freeze authority over older planning text when they conflict.
- Confirm that the gathered proof answers the truth claim, not just the artifact list.
- Reject a mechanism-wide claim when the proof exercised only a synthetic terminal state, convenient safe branch, or adjacent path.
- When diagnosis relies on a surfaced error from a best-effort path, require the correlated causal trace or mark first-cause certainty unproven.

### 3.5 Evaluate Git delivery separately

Classify delivery as `required`, `pending authorization`, or `not required` from the accepted target end state. Do not make push universal for inspection-only work, local prototypes, or another explicitly local outcome.

When delivery is required, gather one compact evidence set:
- exact task-owned staged, unstaged, and untracked state,
- resulting commit hash,
- target remote branch identity,
- fresh push command result,
- post-push equality between the local commit and that remote branch, read directly rather than through local tracking configuration,
- unrelated dirty state listed separately.

`git status` alone cannot prove a push. Task-owned residue, a task commit ahead of upstream, or missing fresh push evidence prevents full/no-open-points/safe-to-close approval. A valid implementation or validation PASS remains reportable as its own state. If commit or push was not already authorized, leave delivery pending rather than executing it or calling it irrelevant.

### 3.55 External Diagnosis Gate

Run this gate when a diagnosis will leave the workspace as an issue, pull request, comment, or third-party report. The Published PR Gate proves the artifact is the intended object; this one proves the claim inside it is true.

Require, before the artifact is drafted:
1. **Probe** — the smallest executable probe against the real running system, with its command and observed result recorded. Source reading, log correlation, and record correlation are leads, not proof.
2. **Boundary** — for a cross-project blame claim, a measurement taken at the boundary itself. Which side the symptom surfaces on does not prove which side produced it.
3. **Provenance** — for a regression claim, evidence from version history. A guard that is absent today may have been removed rather than never written.
4. **Separation** — proven and inferred kept visibly apart in the published text, with the missing link named.

FAIL when the claim rests only on structure, correlation counts, matching identifiers, or current source. If no probe is possible, the gate may pass only when the artifact says so in its own words.

### 3.6 Published PR Gate

Run this gate only when the adopted repo's accepted target end state includes PR publication. `pushed` is a prerequisite state, not terminal proof. A PR creation command, success message, or URL alone is insufficient; read back the actual hosting object. For GitHub, use `gh` with non-interactive, pager-free output.

First freeze the expected identities and publication contract:
- tested final commit SHA,
- pushed fork repository canonical owner/name/URL, branch, and SHA,
- canonical upstream repository owner/name/URL,
- intended base branch and expected base SHA,
- intended PR title, body, state/draft posture, material labels/reviewers/assignees/milestone or other required metadata,
- required changed-file/diff scope and current checks when acceptance requires them.

Then read back and verify the hosted object:
1. **Publication** — the PR exists in the canonical base repository and the returned URL resolves to that object. Only then report `PR published`.
2. **Commit binding** — tested final commit SHA = pushed fork-branch SHA = PR head SHA. If any mutation occurred after testing, rerun the proof invalidated by that mutation before acceptance.
3. **Canonical repository identity** — verify base and head repository owner, name, and URL; remote labels such as `origin` or `upstream` are not identity proof.
4. **Base identity** — verify base repository, base branch, and base SHA used by the hosted object.
5. **Head identity** — verify head repository, owner, branch, and SHA.
6. **Object state** — verify open/closed/merged state and draft/ready state match the accepted end state.
7. **Commit and scope** — read the PR commit list and changed-file list or diff; confirm the intended commits and scope, with no missing or unrelated files.
8. **Content and metadata** — read back title, body, and intended material metadata. Do not add unsolicited AI/model/tool/generated-by/co-author attribution unless the user requested it or the target repository requires it.
9. **Checks** — read current checks when the acceptance contract requires them; stale check evidence does not survive a head or relevant base mutation.

Evidence invalidation is claim-specific:
- head/source mutation invalidates commit binding, commit list, diff scope, and head-dependent checks;
- base repository/branch/SHA mutation invalidates base identity and any mergeability or base-dependent check claim;
- title/body/metadata mutation invalidates only the changed content/metadata claim unless it also changes source;
- changed-file or commit-list mutation invalidates scope acceptance;
- check rerun or status mutation invalidates the prior current-check claim.

Report `PR identity verified` only after every required field above matches the frozen publication contract. If PR creation or mutation was not authorized, do not perform it; report the publication state as pending. Target-local doctrine must identify the canonical upstream and fork repositories, default base, contribution guide, required public metadata, and required checks.

### 4. Return the acceptance result
- `PASS` when evidence fully satisfies the gate.
- `FAIL — one targeted revision` when a known invariant failed; return one class-based packet to the same owner.
- `NEEDS_REVIEW — new risk class` when a genuinely new acceptance class or authority conflict appears.
- `BLOCKED` when required authority, artifact, or proof cannot be obtained.
- Required tests still failing, required proof missing, required harness behavior incomplete, or a fixable same-scope failure means `FAIL — one targeted revision` or `BLOCKED`, never a passing result with concerns.
- A passing Node or Foundation Gate releases only already-authorized downstream nodes. No permission prompt is needed unless an explicit approval boundary is next.
- An out-of-plan bug is reported and routed; the gate does not open an implementation lane for it.
- Report terminal state explicitly as `implementation complete`, `validation complete`, `committed`, `pushed`, `PR published`, and `PR identity verified`, using `not required` where the accepted end state excludes durable delivery or PR publication.
- Also report migration/deploy, runtime wiring, reconciliation, and activation separately when they are accepted phases. Green tests do not close a later phase.

If the gate exposes a real gap, classify the next step explicitly:
- `stay-local` when the gap is small, local, and immediately fixable without changing the task shape.
- `revise-now` when the producer must correct the output before any honest completion claim.
- `replan` when the gap shows the current approach or scope is wrong.
- `later-wave` only when the missing work is genuinely outside the active task boundary and current acceptance does not depend on it.

If the gate failed and no route-forward was named, the gate is incomplete.

After the one routine targeted revision, issue a fresh decision. Do not open a second quiet loop. Another callsite of the known invariant is not a new risk class.

### PASS / FAIL evidence checklist

Record the gate in explicit checklist form instead of narrative summary:

- [ ] **Authority named** — which doc, spec, or rule owns the pass condition
- [ ] **Positive proof captured** — what exists, passed, or matched
- [ ] **Negative proof captured** — what was absent, not broken, or not widened
- [ ] **Readback completed** — changed files or target artifacts were read after the change
- [ ] **Verdict justified** — PASS, FAIL, or NEEDS_REVIEW tied to the evidence above
- [ ] **Local-doctrine gate passed when applicable** — target active workflow docs speak as target truth and all required target-local support files exist
- [ ] **Delivery state proved when applicable** — exact task residue, commit hash, upstream, fresh push result, equality, and unrelated dirt are distinguished
- [ ] **Published PR identity proved when applicable** — hosted-object readback matches tested/pushed commit, canonical base/head identities, scope, content/metadata, state/draft, and required checks
- [ ] **External diagnosis measured when applicable** — probe command and observed result recorded, cross-boundary blame measured at the boundary, regression provenance taken from version history, and proven separated from inferred in the artifact

Use the checklist like this:

- **PASS** only when every required box is checked.
- **FAIL** when any required proof is missing or contradicted by readback.
- **NEEDS_REVIEW** when the implementation exists but authority conflict, boundary ambiguity, or unresolved caveat remains visible.

## Guardrails
- Do not equate file presence with correctness.
- Do not say 'should work' without evidence.
- Do not skip negative checks such as forbidden-path absence.
- Do not approve a safety claim from the convenient branch while the harmful branch remains unexercised.
- Do not approve a capability-gap premise from an exact-name miss or a best-effort path whose relevant failure evidence disappears across restart.
- Do not stop at artifact presence when the real claim depends on truth, wiring, or proof that the artifact alone cannot show.
- Do not approve a 100/100 bootstrap/readiness claim from copied baseline inventory alone; require local-doctrine evidence.
- Do not turn this delivery gate into an automatic universal push or a commit/push micro-lane.
- Do not treat a PR creation command, URL, remote label, or pushed branch as hosted-object identity proof.

## Completion checklist
- [ ] Pass condition identified
- [ ] Evidence gathered
- [ ] Authority comparison completed
- [ ] Bounded acceptance verdict recorded

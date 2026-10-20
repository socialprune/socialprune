# Verification Before Completion Rule

> **MANDATORY FOR ALL `.kilo` roles**
> Iron Law: no completion claim without fresh verification evidence.
> **Version:** 1.14.0
> **Updated:** 2026-10-20

---

## Constitutional Minimum

Before claiming any task is done, complete, finished, or working:

1. **Identify** the evidence that would prove the outcome.
2. **Run** the relevant verification.
3. **Read** the actual result rather than assuming success.
4. **Verify** that the result satisfies the required outcome.
5. **Claim** completion only after the evidence is real.

---

## Hard Laws

14. An intermediate independent gate is justified only when a foundation result controls downstream safety, a distinct high-risk class needs separation, or the accepted plan explicitly requires it.
33. A deliberately best-effort, non-blocking, or error-swallowing path may suppress propagation but may not erase diagnostic truth. It must emit a correlated causal record; when restart, worker loss, or process loss could erase the evidence needed to distinguish success from failure, that record must survive the boundary. Read the causal trace before treating the surfaced symptom as the first cause.
38. A diagnostic claim that leaves the workspace for a third party requires observed behavior of the real running system. Source reading, log correlation, and record correlation are leads, not proof.
42. A failed verification route proves that the route failed, not that the claim cannot be tested. Try another route before recording something as unverifiable.
43. A state label an artifact carries about itself is a claim and needs the same proof as any other claim. Version headers, status badges, baseline names, counts, coverage numbers, and `complete` markers must be derived from the artifact's actual content at the moment they are written, never from the intent of the change in progress. Write the label after the check that establishes it, not before. A label written from intent is false when written, and later finishing the intended work does not retroactively make it true.
44. Before you report the state of something another session, lane or system owns, read it again, or give the time of your last reading (LL-2026-10-001).

Numbers missing from this section belong to laws the Workflow Lab removed after measurement on Opus 5.5 and GPT-6.1 Sol, and they stay retired. `.kilo/RETIRED_DOCTRINE.md` keeps each one with its wording and evidence.

---

## Red-Flag Phrases

Treat these as constitutional warning signs when not backed by evidence:

- should work
- likely works
- no errors expected
- based on the pattern
- I believe

## Anti-Rationalization Guard

Treat these as self-justification red flags:

- "close enough"
- "the rest is obvious"
- "I already know how this works"
- "the reviewer can catch it later"

If one of these thoughts appears, verification depth must increase rather than shrink.

Treat an operator question about certainty as a stop condition, not a request for reassurance. Answer it with a new measurement or an explicit confidence downgrade, never with more explanation of the same evidence.

When the operator disproves a premise, retire it and move to the next evidence layer. Do not defend a premise that has been refuted, and do not rebuild the same conclusion on a narrower version of it.

When the operator names a source as the authority, inspect that exact source and check the output against its real constraints. A similar artifact, a remembered version, or a nearby document is not the named source.

---

## Minimum Acceptable Proof

Proof may be build output, test output, lint output, readback, structural validation, or another task-appropriate verification artifact, but it must be:

- fresh,
- directly observed,
- relevant to the actual claim,
- and strong enough to refute narrative momentum.

## Proof Shape Expectation

Verification evidence should normally answer three things in plain view:

1. **Target** — what claim is being proven
2. **Method** — what command, readback, diff, or structural check proved it
3. **Observed result** — what actually happened

Compact example:

```md
[VERIFY]
- target: task-local docs were created
- method: readback of `docs/tasks/foo/REQUEST_CAPTURE.md`
- observed: file exists and contains populated sections
```

## Verification Order

Use deterministic-first, semantic-second sequencing:

1. deterministic proof first — file existence, readback, build/test/lint output, path resolution, diff checks, grep-style checks
2. semantic judgment second — review quality, completeness judgment, wording quality, higher-level critique

Do not skip deterministic proof just because semantic review sounds stronger.

### Self-asserted state labels

A version header, status badge, baseline name, or `complete` marker is the artifact talking about itself. Readers treat it as fact and rarely recheck it, which is exactly why it has to be earned.

Derive the label from the content, then write it. A structural comparison against the source of truth, a count, or a diff establishes the state, and the label records what that check found. Writing the label first and finishing the work afterwards leaves a file that was lying for the whole gap, and the gap is when someone else reads it. Intent is not a substitute: a header naming a target release is false until the content matches.

Release automation solves this by taking the decision away from the author. semantic-release derives the version from commit evidence and runs a release-conformity step before it creates the tag, on the stated grounds that this removes the connection between human feelings and version numbers. Files maintained by hand have no such pipeline, so the ordering discipline has to do the work the tooling would.

```md
[VERIFY]
- target: the file sits at the claimed baseline
- method: normalized line comparison against the source of truth, expecting only known local deltas
- observed: 498 of 498 lines, 4 differences, each one a documented local adaptation
- label: written after this check, not before
```

### Git Delivery Closure

When durable repository delivery is part of the accepted end state, closure proof must show:

- the exact task-owned paths and their staged/unstaged/untracked state,
- the resulting commit hash,
- the target remote branch identity,
- a fresh push result,
- equality between the local commit and that remote branch after the push,
- and unrelated dirty paths listed separately.

Equality proof must not depend on local tracking configuration. A branch can be pushed and current while having no configured upstream, in which case `git status` silently omits the ahead and behind line and `@{u}` fails. Read the remote branch directly, for example with `git ls-remote origin refs/heads/<branch>`, and compare that hash to the local commit. A check that returns nothing because its precondition is absent is not a passing check.

`git status` alone is not push proof. If commit or push lacks authority, report implementation and validation honestly while marking delivery pending; do not reinterpret the missing authority as proof that delivery was irrelevant.

When PR publication belongs to the accepted end state, continue to the Published PR Gate in `quality-gate-verification`. Report `PR published` and `PR identity verified` separately; neither is implied by `pushed`.

### External diagnosis proof

The published-object gates prove that an artifact is the intended one. They do not prove that the diagnosis inside it is true.

Before a diagnosis leaves the workspace as an issue, pull request, comment, or third-party report:

- reduce it to the smallest executable probe against the real running system, and record the command and the observed result,
- measure a cross-boundary attribution at the boundary itself. Which side a symptom surfaces on does not prove which side produced it,
- derive a regression claim from version history. A guard that is absent today may have been removed rather than never written,
- separate proven from inferred inside the published text, and name the missing link instead of smoothing over it.

If no probe is possible, the artifact must say so in its own words rather than presenting the inference as settled.

### Direct Proof Closure

Use focused deterministic evidence to close a bounded node or task when the proof directly covers every acceptance invariant and no independent-acceptance condition applies. The same domain owner may fix an in-plan loopback bug and rerun focused proof.

### Proof ladder and invalidation

Use this order: focused proof while implementation changes; one broad relevant suite per repo against the final frozen executable source identity and dependency surface; one multiprocess acceptance run when required; after a documentation-only or demonstrably isolated revision outside the suite's proof boundary rerun only invalidated focused proof; after a targeted executable revision rerun focused proof and the broad suite invalidated by the changed executable source identity or dependency surface.

Fixture, clock, path, stale-signature, and scenario-isolation failures stay with the implementation owner unless test architecture itself is unresolved.

### Integrated Independent Acceptance

For convergence-sensitive work, use: frozen contract and invariants -> focused checks during edits -> frozen executable source identity and dependency surface -> one broad relevant suite -> one fresh independent judgment using valid raw evidence plus bounded high-risk samples -> at most one routine targeted revision -> focused proof plus any broad suite invalidated by an executable revision -> decision gate.

Evidence remains `reused-valid` only when its dependency surface and executable source identity still match. A documentation-only change outside the proof boundary does not invalidate executable proof; a separately proven data-only change does not invalidate unrelated unchanged UI or API proof unless executable source, schema, fixtures, generated output, runtime identity, or contract dependencies changed.

Normal Complexity-4 proof budget is one broad suite per affected repo per final frozen executable source identity, one multiprocess acceptance run when in scope, one independent acceptance gate, and at most one bundled class-based revision before a decision. An executable revision creates a new freeze identity and requires the invalidated suite again; a second revision loop still requires a new risk class or contradictory/invalidated evidence.

### Cross-process foundation proof

The first executable cross-process command gate proves: disposable datastore/shared state reachable; real API compiles and starts; worker processes start and stop under tracked lifecycle; fakes cannot enter production; and one minimal real lifecycle path asserts state changes. Matrix, broad review, and deep test modernization stay blocked until PASS.

### Approval proof

For approval-bound actions, verify the user-visible card shows exact recipients, text, material values, exclusions, selected items, and the effect of approval. Verify the machine record binds card/review ID, version/hash, item IDs, expiry, evidence, and conversation/thread. Natural replies such as `yes`, `looks good`, or `do it` are examples. A natural confirmation may resolve only the one fresh pending card most recently and immediately presented in that thread. If any visible term or declared effect changes, verify the old card becomes explicitly superseded and no longer pending and a new versioned card is presented. Confirmation aimed at the superseded card must fail; confirmation of the immediately presented replacement must store reply plus card reference. Zero, two/multiple, expired, stale-thread, ambiguous, or free-floating confirmation fails closed. Pending approval survives handoff/compaction and blocks only the affected action.

For provider/model/transport-only acceptance, use a direct side-effect-free or non-persisting transport/endpoint canary where available. Agent, session, delivery, memory, and state paths belong in the canary only when their integration is part of the acceptance claim. Target-local doctrine supplies provider-specific credential and request details.

### Effect and capability proof

- Retryable or ambiguous effects require an append-only receipt chain, identity binding, duplicate prevention, and exact next action. `ambiguous` must prove `reconcile` before retry.
- Confirmed or compensated effects require effect or compensation identity from the receipt chain. Approval and process completion are not effect proof.
- External capabilities require independent policy, provenance, recorded signature/trust, approval, and canonical-path gates. Passing admission permits only a later explicit adoption decision; it does not prove installation or activation.
- Target-local doctrine supplies trust stores, signature mechanics, and runtime-specific effect evidence.

### Best-effort and safety-boundary proof

- A non-blocking caller outcome and an internal failure record are separate facts. Do not fail the parent operation merely to make the failure visible, and do not erase the internal failure merely because the parent may continue.
- Use the lightest correlated record that preserves causal truth. When the failed work or evidence must remain diagnosable after restart or worker loss, use restart-surviving storage with an owned inspection path; transient console or temporary-directory output is insufficient for that claim.
- Diagnose from the earliest relevant correlated evidence, then test competing causes. The last surfaced state-machine or API error is not automatically the first cause.
- For a safety claim, map each claimed property to the real branch and asserted effect that proves it. Synthetic state setup is acceptable only when the claim is explicitly limited to behavior from that state.

## Conditional High-Risk Control Matrix

Activate only the rows matching the task's real risk:

| Risk class | Required focused proof before the integrated gate |
|---|---|
| migration or backfill | forward/rollback plan, representative fixture, idempotence or reconciliation proof |
| queue, lease, retry, or scheduler | ownership/expiry semantics, duplicate/retry path, interruption or concurrency check |
| recovery, backup, or replay | restore/replay drill, integrity check, bounded failure behavior |
| cross-repo or deployed wiring | producer/consumer compatibility and live propagation or explicit deployment proof |
| shared API, event, status, or identity contract | schema/type compatibility, negative contract case, all in-scope consumers checked |
| irreversible or external operation | approval boundary, dry run or preview, rollback/compensation plan, side-effect confirmation |
| retryable or ambiguous effect | append-only receipt chain, duplicate-effect/compensation negative case, exact `reconcile` before retry, confirmed effect identity |
| external capability admission | independent policy/provenance/signature/approval gates, canonical-path negative case, explicit no-install/no-activation result |

These controls strengthen proof. They do not mandate more lanes or repeated broad suites by themselves.

## Mechanically Checkable Examples

Good examples:
- `README.md` contains `## Installation`
- readback of `.kilo/rules/foo.md` shows the new `Failure Rule` section
- `git status --short` shows only the allowed files changed
- build command exits 0 and output shows no errors

Weak examples:
- "docs look complete"
- "the wording seems right"
- "should be wired now"
- "reviewer can validate the rest later"

---

## Failure Rule

If verification has not been run or read, the task is not complete. A safety claim without harmful-branch proof, a mechanism-wide claim broader than the exercised path, or a swallowed failure with no adequate causal trace is also unverified. If required Git delivery remains uncommitted, unpushed, or unproven, the task is not fully closed even when validation passed. If PR publication is required, a created URL or pushed branch without hosted-object identity readback is also incomplete. A diagnosis published to a third party without an executed probe against the real running system, or with inference presented as settled fact, is also unverified. A verification plan that invokes a destructive entrypoint without explicit consent has failed regardless of what it proved. A version header, status badge, or completeness marker written from the intent of the change rather than from the artifact's actual content is a false claim at the moment it is written, whatever lands afterwards.

---

*This rule is part of the thin `.kilo` constitutional core.*

---
name: workflow-validation
description: Use when validating a repo's workflow artifacts as workflow artifacts. Handles local doctrine checks, target-vs-reusable-package boundary checks, workflow wiring, and readiness verification for rules, skills, agents, and support docs.
version: 1.4.0
author: Workflow Lab
created: 2026-04-20
updated: 2026-07-26
---

# Workflow Validation

## Use when
- A target-repo workflow artifact (rule, skill, agent, support doc, or doctrine edit) needs approval beyond generic completion checks.
- Validating workflow surfaces inside the target repo's own `.kilo` shell.
- Confirming a change is correct for the target repo's workflow surface before claiming readiness.

## Do not use when
- The work is still being authored; use `workflow-implementation` or `feature-implementation` first.
- The main problem is unknown failure behavior; use `bug-diagnosis` first.
- The target is ordinary app code rather than workflow infrastructure.
- The artifact is the product Agent Skill under `skills/`. It is product code for users' agents and goes through `quality-gate-verification`.
- The task only asks for generic deterministic proof against an already-defined contract; use `quality-gate-verification`.

## Behavior change
When loaded, validation becomes workflow-owner specific:
1. verify the artifact against live `.kilo` doctrine,
2. verify target/template boundaries and activation or rollout posture,
3. verify workflow wiring and cross-references,
4. return a release-quality verdict for workflow use.

## Typical pairings
- `workflow-implementation` after creating or revising workflow artifacts.
- `continuous-learning` when validation exposes a repeat workflow mistake.

`quality-gate-verification` is not an automatic companion. Add it only when a combined validation topology has a distinct deterministic-proof result. In that topology, this skill remains the sole semantic final-judgment owner and `quality-gate-verification` remains the sole deterministic-proof owner.

## Exclusive ownership boundary

| Primary | Owns | Does not own |
|---|---|---|
| `workflow-validation` | semantic acceptance of rules, skills, agents, local workflow doctrine, placement class, workflow wiring, and target/template truth | ordinary app-code acceptance or generic proof formatting as a second verdict |
| `quality-gate-verification` | deterministic proof against the frozen workflow contract in a combined validation topology | workflow-semantic placement, doctrine judgment, or a second semantic final verdict |

A workflow-validation verdict may perform local readback and record observations needed for semantic judgment. That local readback does not transfer combined-topology deterministic-proof ownership away from `quality-gate-verification`. Observations from either skill transfer neither semantic-final-verdict nor proof ownership. Do not load both merely to obtain duplicate PASS/FAIL wording.

## Outputs
- Workflow-owner verdict: PASS / NEEDS_REVIEW / FAIL.
- Evidence covering doctrine, boundaries, wiring, and workflow-specific defects.
- Explicit notes on what must be fixed before target-shell acceptance, activation, or rollout.
- Explicit replan note when unresolved findings should feed the next implementation or remediation lane.

## Activation contract
Filled for SocialPrune on 2026-10-06:

- Workflow authority: `.kilo/WORKFLOW_BIBLE.md`, with `AGENTS.md` for the hard constraints.
- Reusable-package relationship: activated from the maintainer's workflow template, which lives outside this repository. Template updates do not arrive on their own, and local changes stay local (Bible section 7).
- Local lessons authority: `docs/LESSONS_ARCHIVE.md`.
- Review-bundle and traceability support docs: none, there is no `.kilo/docs/`. The evidence stack is readback, `git status`, and `kilo debug skill`, `kilo debug config` and `kilo debug agent <name>` run on a disposable copy of the shell. `kilo debug config` prints credentials from the global config, so keep only the fields the check needs and do not store the dump.

## Validation matrix
| Check area | What to confirm | Typical failure |
|---|---|---|
| Doctrine | live `.kilo` terminology and authority posture | stale legacy or compatibility wording treated as canon |
| Boundaries | target vs reusable-package vs downstream separation | activation or rollout implied without evidence |
| Structure | frontmatter, sections, operational clarity | thin or malformed artifact |
| Wiring | references, companion surfaces, reachability | orphaned or broken workflow path |
| Readiness | verdict matches real evidence | approval language stronger than proof |

## Procedure

### 1. Identify the workflow object
- Classify the target as rule, skill, agent, support doc, or doctrine surface.
- Name the owning authority: user request, local system or project source of truth, `.kilo/WORKFLOW_BIBLE.md`, the workflow template's Bible during bootstrap work (it lives outside this repository), local lessons, or live shell pattern.
- State whether the check is target-local only or also preparing future template/distribution work.

### 2. Run doctrine checks
- Confirm terminology matches the current live `.kilo` shell, not legacy `.kilocode/` language.
- Confirm the artifact respects canonical `.kilo/` ownership and any legacy-runtime wording is scoped honestly to historical compatibility context rather than implied current runtime.
- Confirm workflow wording reflects extension-runtime reality, not generic repo-governance abstraction.

### 3. Run boundary checks
- Confirm target-local content stays in the target repo shell and does not silently act like owner/distributor doctrine.
- Confirm reusable-package concerns are named correctly: the package is a distribution source, and the target repo owns its active local adaptation.
- Confirm the artifact does not imply rollout, activation, or parity happened unless evidence exists.

### 4. Run artifact-quality checks
- Read back the whole changed workflow artifact.
- Check frontmatter, naming, section structure, and operational clarity.
- Check for placeholders, stale runtime references, broken paths, or dead-skill phrasing.
- Check that the guidance is specific enough to change how workflow work is executed.
- If the artifact is derivative rather than primary authored doctrine, verify it follows local traceability expectations. If no local traceability support doc exists, treat the root traceability concept as optional and record the evidence available.

### 5. Run workflow wiring checks
- Verify referenced files actually exist.
- Verify companion docs and related skills are the right authority surfaces.
- Verify the artifact is not orphaned conceptually: its usage target, owner, and verification path are explicit.
- If connectivity did not change, record that wiring expansion was intentionally not part of this pass.

### 6. Run bundle checks
- Use local review-verification bundle guidance when the target repo has such a support doc and the validation result needs a named evidence stack.
- If no local bundle support doc exists, name the evidence stack actually used instead of pretending a missing owner-repo doc is present.
- Name which bundles were actually used and which were intentionally skipped.
- For delegated or handoff-heavy work, use the strict `pre-search passed forward` vs `local search still required` distinction before approving new build/create decisions.
- If the validation depends on earlier reconnaissance or search-before-build work, verify that the handoff actually includes reusable evidence.
- If an expected bundle is missing, route the gap forward instead of inventing a local severity rule.

### 7. Return the workflow verdict
- PASS: doctrine, boundaries, structure, and wiring are all confirmed.
- NEEDS_REVIEW: artifact is useful but has unresolved authority or rollout caveats.
- FAIL: stale doctrine, broken references, false target/owner framing, or missing evidence remains.

### 8. Route unresolved findings forward
- If the verdict is not PASS, say whether the next step is `stay-local`, `revise-now`, `replan`, or `later-wave`.
- Do not leave unresolved validation findings as passive notes.
- Keep target-now versus template-later follow-through explicit.

## Route-forward routing
Use this compact routing language for unresolved validation findings:

| Route | Use when | Next action |
|---|---|---|
| `stay-local` | The finding is small, same-scope, and safe to fix in the current lane | Fix now and re-read the changed surface |
| `revise-now` | The artifact is close but needs a targeted revision before approval | Send a bounded fix packet to the producing lane |
| `replan` | The finding changes scope, authority, or placement | Stop approval and route through planning/routing before more edits |
| `later-wave` | The finding has real value but is outside the active task boundary | Record a backlog or task note with a trigger; do not imply it is done |

## Validation output format
Use this compact result shape:

```md
## Workflow validation result
- Target: `path/to/file.md`
- Artifact type: rule | skill | agent | support doc | doctrine
- Verdict: PASS | NEEDS_REVIEW | FAIL

| Check area | Status | Notes |
|---|---|---|
| Doctrine | PASS/FAIL | ... |
| Boundaries | PASS/FAIL | ... |
| Structure | PASS/FAIL | ... |
| Wiring | PASS/FAIL | ... |

### Bundles used
| Bundle | Status | Evidence |
|---|---|---|
| contract_bundle | PASS/SKIPPED | ... |
| readback_bundle | PASS/SKIPPED | ... |
| verification_bundle | PASS/SKIPPED | ... |
| wiring_bundle | PASS/SKIPPED | ... |
| handoff_bundle | PASS/SKIPPED | ... |

### Required fixes
1. ...

### Replan routing
- Next step: stay-local | revise-now | replan | later-wave
- Reason: ...
```

## Workflow-owner checks
- Does this artifact help with workflow artifacts, not generic feature work?
- Does it distinguish target shell, template layer, and downstream adaptation correctly?
- Does it protect against claiming rollout, sync, activation, or parity without proof?
- Does it preserve current `.kilo` terminology and live target-shell posture?
- Would a repo owner know exactly what to verify next from this artifact alone?

## Guardrails
- Do not approve based on file presence alone.
- Do not treat generic build-style verification as sufficient for workflow doctrine.
- Do not let historical backup wording override live shell terminology.
- Do not mark template or distribution readiness as complete without explicit boundary evidence.
- Do not reference owner-repo support-doc paths as if they were shipped inside a target repo.

## Donor traceability
- Activated in SocialPrune on 2026-10-06 from the workflow template's optional skill layer. The activation contract, the Agent Skill exclusion, step 1 and this section differ from that copy.
- Upstream lineage: the owner shell's `workflow-validation` 1.6.0, projected into the template's optional layer with a target-safe bundle, traceability, and exclusive-verdict adaptation.

## Completion checklist
- [ ] Artifact type and authority identified
- [ ] Doctrine checks completed
- [ ] Target/template boundary checks completed
- [ ] Workflow wiring and cross-references checked
- [ ] Workflow verdict recorded with evidence

---
name: synthesis
description: Use when converging parallel audits, competing recommendations, or multi-lane findings into one stronger active-shell result. Handles agreement mapping, disagreement resolution, evidence weighting, and merged recommendation output. Triggers on 'synthesize', 'merge findings', 'compare outputs', 'resolve competing recommendations'.
version: 1.2.0
author: Workflow Lab
created: 2026-04-20
updated: 2026-07-18
---

# Synthesis

## Use when
- Multiple audits, review lanes, or analysis passes produced overlapping but non-identical outputs.
- The active shell needs one merged recommendation rather than a stack of competing findings.
- Consensus, disagreement, and recommendation quality must be made explicit before closure.

## Do not use when
- The task is simple summarization of one document.
- Inputs are still incomplete or unverified; finish the audit/review lanes first.
- The main need is fresh analysis rather than convergence; use the relevant audit or planning skill first.

## Behavior change
When loaded, the agent stops additive note-stacking and instead:
1. inventories each input and its authority,
2. compares findings by topic and evidence strength,
3. resolves conflicts explicitly,
4. produces one repo-ready merged recommendation.

Synthesis also becomes responsible for input sufficiency. If the incoming lane set cannot honestly answer the governing question yet, stop pretending convergence is possible and force the next action openly.

## Typical pairings
- `workflow-meta-audit` when the inputs are root-shell audit findings.
- `cross-repo-audit` when multiple repo comparisons must converge into one action plan.
- `pre-planning` when the merged result will drive a later implementation wave.

## Outputs
- Agreement / disagreement map across the input set.
- Conflict-resolution decisions with justification.
- One merged recommendation package suitable for active-shell action.

## Convergence protocol

Track each candidate conclusion with these labels:
- **consensus** — materially supported by multiple inputs
- **partial-consensus** — same direction, different implementation details
- **disagreement** — materially conflicting recommendation or interpretation
- **novel-merge** — better result that emerges only after comparison
- **discarded** — rejected after evidence and authority review

## Procedure

### 1. Register the inputs
- List every input artifact, lane, or audit source.
- Record what each source was responsible for and how trustworthy it is.
- Reject synthesis if the source set is incomplete, duplicated, stale, or too weak to answer the governing purpose.

### 1.5 Check input sufficiency
- Ask: do these inputs actually answer the question the convergence artifact is supposed to close?
- If the answer is no, name the missing topic, evidence, or authority instead of blending weak material into a fake merge.
- If one lane looks finished on paper but missed the purpose behind the request, issue targeted follow-up retrieval before trying to merge.
- If the weakness is structural across the whole input set, reroute or escalate rather than forcing a synthesis paragraph.

### 2. Normalize the comparison surface
- Merge the input set once, grouping findings by acceptance invariant or risk class rather than by lane or callsite.
- Separate factual findings from suggested actions.
- Keep active-shell scope explicit so domain-local noise does not dominate.

### 3. Identify consensus first
- Mark what multiple sources agree on without forcing wording parity.
- Prefer repeated evidence over repeated phrasing.
- Treat consensus items as the high-confidence baseline for the merged result.

### 4. Expose disagreements cleanly
- For each conflict, state:
  - what Source A says,
  - what Source B or others say,
  - whether the conflict is factual, interpretive, or prioritization-based.
- Do not hide disagreement inside vague blended prose.

### 5. Resolve by authority and evidence
- Prefer the stronger authority surface when sources are not equal.
- Prefer verified evidence over elegant reasoning.
- Prefer current-repo safety, anti-drift, and operational usefulness over abstract completeness.
- If neither side is sufficient alone, create a `novel-merge` and state why it is better than both.

If the conflict survives because the inputs are still underpowered, close the step as unresolved and name the next honest move: targeted follow-up, revision, reroute, or escalation.

### 6. Produce one merged recommendation
- Return one action path, not multiple undecided options unless the task explicitly asks for a decision menu.
- Include: final recommendation, why it won, what was rejected, and what remains uncertain.
- Make the output directly usable for active-shell planning, doctrine changes, or remediation sequencing.

If a known invariant failed, send one targeted revision packet to the same owner. After that revision, make one decision:
- `PASS`,
- `FAIL — replan`,
- `FAIL — split scope`,
- `NEEDS_REVIEW — authority decision`,
- `BLOCKED`.

A second quiet loop is forbidden. Another callsite of a known invariant is not a new class; extra rounds require a genuinely new acceptance-class risk.

### 6.5 Weak-input follow-up behavior
- Use targeted follow-up when one or two specific gaps are blocking convergence and the missing evidence is realistically retrievable.
- Use `revision` language when an input exists but is too weak, too shallow, or too loosely scoped to merge honestly.
- Use `escalation` when repeated follow-up is not reducing the disagreement or ambiguity.
- Use `abort` only when continuing the convergence step would create misleading closure or propagate unsafe assumptions.

### 7. Perform merge-quality checks
- Confirm every major input was addressed, accepted, or explicitly discarded.
- Confirm every major disagreement has a visible resolution.
- Confirm the final recommendation is stronger than any single input, not just shorter.
- Confirm the closeout is honest: consensus reached, unresolved conflict escalated, or weak-input follow-up explicitly opened.

## Conflict closeout states

Use one of these closeout states explicitly:

| State | Meaning | Honest closeout |
|---|---|---|
| `consensus-closeout` | the inputs support one merged path strongly enough to act | return the merged recommendation |
| `follow-up-closeout` | convergence is plausible, but one or more targeted gaps must be filled first | request the exact missing input |
| `escalation-closeout` | disagreement or ambiguity is no longer shrinking | surface the decision upward |
| `discard-closeout` | one candidate path was rejected decisively | record why it lost |

## Active-shell heuristics
- Synthesis is convergence work, not summary writing.
- Preserve traceability: a later reviewer should see why the merged result exists.
- Separate root-owner recommendations from template or child-repo rollout implications.
- When parallel lanes disagree because they optimized different goals, name the governing goal before choosing.

## Template applicability note
In a target repo, `active-shell` means the repo's live local shell, not Workflow Lab root.
Only bring root/template distinction into the merge when the task is explicitly about package derivation, rollout, or upstream/downstream drift.

## Guardrails
- Do not average conflicting recommendations into mush.
- Do not reward verbosity over evidence quality.
- Do not let one weak but confident input dominate the merged result.
- Do not claim consensus when the inputs only share vague intent.
- Do not leave the final result as "A says this, B says that" without an explicit active-shell resolution.
- Do not call the step complete if the real outcome is "we still need better input".
- Do not keep inputs separated by lane after their findings can be grouped by invariant or risk class.

## Completion checklist
- [ ] Inputs and authorities registered
- [ ] Consensus vs disagreement mapped
- [ ] Conflicts resolved with explicit basis
- [ ] One merged recommendation produced
- [ ] Rejected or uncertain items recorded

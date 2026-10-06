---
name: context-management
description: Use when work spans multiple authorities, phases, sessions, or handoffs and exact state must survive. Handles scope capture, shared evidence, checkpointing, handoff, and recovery. Triggers on 'context', 'handoff', 'checkpoint', 'recover state', 'context overflow'.
version: 1.8.0
author: Workflow Lab
created: 2026-04-19
updated: 2026-07-27
---

# Context Management

## Use when
- Work involves many authority files or long-running execution.
- State must survive across phases, reviews, or handoffs.
- The risk of forgetting scope, deferrals, or prior decisions is real.

## Do not use when
- The task is tiny and self-contained.
- No cross-phase state or artifact handoff is needed.
- It would become ceremony without reducing risk.
- The only pressure is unattended duration; use `overnight-run` for execution control and add this skill only if continuity risk is real.
- The only pressure is an imminent compaction boundary; use `strategic-compact` for that narrow decision.

## Behavior change
When loaded, the agent treats context as a managed resource:
1. anchor the newest user request together with the accepted plan,
2. preserve the Active Execution Contract and active scope,
3. keep decisions and proof in one inline/shared board,
4. prefer source-identified filesystem truth over conversational memory,
5. create a filesystem checkpoint only for real cross-session recovery, irreversible work, compliance/forensics, or explicit durable handoff.

## Typical pairings
- `feature-implementation` for multi-authority build work.
- `overnight-run` for long autonomous execution.
- `workflow-routing` when deciding whether a task needs decomposition.

## Outputs
- Request capture or checkpoint artifact.
- Clear scope/deferral summary.
- Handoff-ready state notes where needed.

## Compact artifact shape

Use this when checkpoint, handoff, or recovery state must stay recoverable without writing a long narrative:

```md
[context_artifact]
  request_anchor:
  accepted_plan:
  target_end_state:
  authorized_phases:
  current_phase:
  approval_boundaries:
  authorized_write_domains:
  plan_invalidation_conditions:
  next_ready_nodes:
  source_identity:
  contract_hash:
  checkpoint_hash:
  source_record_hashes:
  summary_hash:
  unresolved_warnings:
  approval_reference:
  effect_receipt_reference:
  active_owner:
  open_invariant_classes:
  reusable_proof:
  invalidated_proof:
  execution_budget_state:
  active_authorities:
  decisions:
  open_risks:
  changed_or_reviewed_files:
  next_step:
  resume_from:
```

Use it three ways:
- **checkpoint:** freeze current truth before a long phase, review, or compaction boundary.
- **handoff:** give the next lane the exact state without replaying the whole conversation.
- **recovery:** re-anchor quickly after drift, interruption, or partial context loss.

For multi-lane work, keep this state in the shared execution/evidence artifact. Raw output, staging, and intermediate evidence belong under `%LOCALAPPDATA%\Temp\kilo\<task-slug>\`.

## Procedure

### 1. Capture scope early
- Preserve the user request in the shared board, an existing durable artifact, or another approved recoverable surface.
- Set `request_anchor` to the newest request and retain the accepted plan beside it. Record the exact phase, end state, boundaries, non-goals, active authorities, and next ready nodes.

### 1.5 Session-boundary posture bootstrap
Treat these moments as state-protection boundaries:
- session start,
- pre-compaction / pre-condensing,
- stop / pause,
- end of task.

At each boundary, re-anchor to request, authority set, current state, and intended next step.

### 2. Manage context budget
- Read only what is needed.
- Summarize decisions once they become stable.
- Avoid reopening settled scope repeatedly.

### 3. Checkpoint only when durability has real value
Use a filesystem checkpoint when another session needs exact recovery, an irreversible or expensive operation needs restart evidence, compliance/forensics requires it, or an explicit durable handoff cannot remain inline. File count and phase length alone do not justify another artifact.

Checkpoint shape:
- `request_anchor` = original user outcome, not your local sub-goal.
- `current_phase` = where the work actually is.
- `active_authorities` = files or docs that currently govern truth.
- `next_step` + `resume_from` = the shortest honest restart path.
- `resume_from` must remain inside the active plan. `continue`, `proceed`, or `keep going` authorizes execution through the accepted end state when the contract is unchanged; it does not activate historical roadmaps or invented phases.

### 3.5 Handoff with compact truth
- Pass forward decisions, active risks, and exact next action.
- Name changed or reviewed files so the next lane does not rediscover them.
- Carry the working paths, governing authority, successful validation route, and failed attempts so later lanes do not repeat settled exploration.
- Mark which claims are already proven and which need fresh independent observation. Independence does not require every unchanged claim to be re-proven.
- Mark evidence `fresh`, `reused-valid`, or `invalidated`. Invalidate it when source, schema, generated output, fixtures, runtime identity, or merge resolution changes.
- Reserve fresh-context reconstruction for places where it adds value, especially final acceptance and security, recovery, or transaction review.
- Keep the handoff short enough to scan, but specific enough to resume from.
- When the handoff crosses sessions or repositories, name for each part: its destination repository or workspace, the role or lane it should run as, whether it is standalone or an addendum to an existing thread, and its position in the send order. Without those four, the recipient has to guess where it belongs, and a package meant for several destinations gets applied to one.

### 3.6 Source-bound continuity summary

When exact recovery truth matters, bind the summary to the current contract, checkpoint, source-record, and summary hashes. Carry unresolved warnings, approval reference, and current effect-receipt reference when present. Changed source identity invalidates the summary.

If the current effect receipt is `ambiguous`, set `next_action: reconcile` and block retry until reconciliation records whether the effect is absent or confirmed.

### 4. Recover from drift
- Re-anchor to the request artifact.
- Re-read the authorities that define current truth.
- Prefer filesystem truth over remembered narrative.

Recovery order:
1. read the latest context artifact,
2. confirm the request anchor still matches the user's real end state,
3. re-open only the active authorities and touched files,
4. continue from `resume_from`, not from memory.

## Workflow-Surface Security Framing

Treat these as authority-sensitive workflow surfaces:
- skills,
- rules,
- agent definitions,
- tool or MCP outputs,
- generated artifacts,
- memory or checkpoint artifacts.

Do not trust any of them casually once drift or ambiguity is detected.

## Guardrails
- Do not rely on memory for exact inventories or deferrals.
- Do not let long context blur planned vs created artifacts.
- Do not use context management as an excuse for unnecessary process overhead.
- Do not create per-lane narrative context files when the shared board already preserves the state.
- Do not narrate checkpoints or mechanical retries unless the narration changes a decision, warning, recovery path, or operator action.

## Completion checklist
- [ ] Request captured
- [ ] Scope summarized
- [ ] Checkpoints used where needed
- [ ] Final state remains recoverable

---
name: overnight-run
description: Use when work should continue unattended for an extended period under a frozen bounded plan. Handles phase sequencing, checkpointing, stop conditions, and bounded next-value work. Triggers on 'overnight', 'autonomous run', 'unattended', 'run for several hours'.
version: 1.2.0
author: Workflow Lab
created: 2026-04-19
updated: 2026-07-25
---

# Overnight Run

## Use when
- The task should run for a long period without constant user prompts.
- A bounded execution plan exists and can be followed autonomously.
- Progress, checkpoints, and stop conditions matter more than conversation.

## Do not use when
- The work needs frequent human decisions.
- Scope is still unclear or unfrozen.
- The task is short enough that normal execution is sufficient.
- The user only says `continue`, `proceed`, or `keep going`; those words resume the accepted plan and do not create unattended-run authority by themselves.

## Behavior change
When loaded, the agent optimizes for autonomous progress:
1. define phases and stop conditions,
2. checkpoint progress,
3. continue through clear substeps without asking for needless confirmation,
4. if core work ends early, choose bounded next-value work inside the same run.

## Typical pairings
- `context-management` only when real multi-authority continuity, handoff, or recovery state exists.
- `workflow-routing` to decide whether work is single-lane, phased, or wave-based.
- `quality-gate-verification` before claiming the run completed a phase.

## Outputs
- Execution plan with checkpoints.
- Progress artifact(s).
- End-of-run summary with completed work, deferred work, and verification status.

## Compact run-control block

Use this when the run needs explicit autonomous structure without turning into a long playbook:

```md
[run_control]
  phases:
    - name:
      goal:
      checkpoint:
  stop_conditions:
    - [real blocker]
    - [scope boundary reached]
    - [operator review required]
  if_time_remains:
    - [bounded follow-up]
```

Keep it short. It should show the intended autonomous path, the checkpoint after each meaningful segment, and the exact reasons the run must stop rather than improvise.

## Procedure

### 1. Define the run
For explicitly authorized registered sessions, apply [registered-session-lifecycle](../../rules/registered-session-lifecycle.md) and the [Session Steering child prompt](../../skills/session-steering/SKILL.md#parameterized-child-prompt). Record real per-link roundtrip evidence, including a middle parent/child, before unattended admission. An overnight request alone does not authorize Agent Manager or recursion.

- State the main objective.
- State the bounded scope and explicit stop triggers.

Run-control minimum:
- named phases,
- one checkpoint per meaningful phase boundary,
- explicit stop conditions,
- one bounded `if_time_remains` branch if early completion is plausible.

### 2. Break into phases
- Sequence the work into coherent chunks.
- Attach a checkpoint to each meaningful phase boundary.

Phase shape:
- `name` = short label for the segment,
- `goal` = what must become true,
- `checkpoint` = what artifact or summary proves the phase can be resumed.

### 3. Run autonomously
- Continue through low-ambiguity steps without surfacing every micro-decision.
- Escalate only for real blockers or genuine decision forks.

Stop-condition rule:
- stop for blockers, authority conflicts, or review gates,
- do not stop for routine execution friction that the current scope already covers,
- do not treat "I could keep polishing" as a valid overnight extension reason.

### 4. Use remaining time intelligently
If core work completes and time remains:
- pick the highest-value in-scope follow-up,
- prefer already-authorized cleanup or verification,
- avoid inventing new scope.

### 5. Close with evidence
- Summarize what completed.
- Summarize what was intentionally deferred.
- Include verification status for the run outcome.

## Guardrails
- Do not ask for 'continue' every few steps when the path is already clear.
- Do not fill remaining time with off-scope invention.
- Do not lose checkpoint truth in long execution.

## Completion checklist
- [ ] Objective defined
- [ ] Phases bounded
- [ ] Checkpoints recorded
- [ ] Autonomous progress maintained
- [ ] End-of-run evidence captured

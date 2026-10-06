---
name: yagni-evaluation
description: Use when deciding whether a proposed repo enhancement should be implemented now, deferred, or rejected. Handles YAGNI scoring, decision thresholds, and reasoning transparency. Triggers on 'should we build', 'is this needed', 'evaluate feature', 'YAGNI check'.
version: 1.0.1
author: Workflow Lab
created: 2026-04-19
updated: 2026-07-25
---

# YAGNI Evaluation

## Use when
- A proposed feature or improvement may be unnecessary right now.
- Scope creep is tempting during implementation.
- A possible enhancement needs a consistent decision framework.

## Do not use when
- A blocking bug, data-loss issue, or security issue is already confirmed.
- The user already froze the enhancement as in-scope and required now.
- The task is pure implementation with no defer-or-build decision.

## Behavior change
When loaded, the agent stops opportunistic expansion and instead:
1. evaluates current need,
2. scores the proposal,
3. applies a decision rule,
4. explains the outcome transparently.

## Typical pairings
- `feature-implementation` if the score says implement now.
- `workflow-routing` when ownership or lane is unclear.
- `continuous-learning` if the same unnecessary idea keeps reappearing.

## Outputs
- YAGNI score from 0-100.
- Decision: implement now, ask user, defer, or reject.
- Short reasoning with trigger condition for future activation.

## Procedure

### 1. Load context
- Read current goals, active priorities, and existing backlog context.

### 2. Define the proposal
- State exactly what would be added and why it is being considered.

### 3. Score the proposal
- Assess blocking impact, user value, timing, scale need, effort, and risk.
- Normalize the result to a 0-100 score.

### 4. Apply the decision rules
- High score -> implement now.
- Mid score -> ask user.
- Low score -> defer or reject depending on confidence and usefulness.

### 5. Explain the decision
- State the score, reason, and trigger for reevaluation.
- If deferred, record when it becomes worth doing.

## Guardrails
- Do not use YAGNI to dodge already requested in-scope work.
- Do not defer blocking issues automatically.
- Do not output a score without reasoning and a decision.

## Completion checklist
- [ ] Current context loaded
- [ ] Proposal defined clearly
- [ ] Score calculated
- [ ] Decision rule applied
- [ ] Reason and trigger stated

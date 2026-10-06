---
name: strategic-compact
description: Use only when an actual compaction, condensing, or context-window boundary threatens expensive-to-reconstruct state. Handles boundary timing and the minimum recovery package. Triggers on 'compact', 'compaction', 'condense', 'context window near limit', 'checkpoint before compaction'.
version: 1.1.0
author: Workflow Lab
created: 2026-04-20
updated: 2026-07-25
---

# Strategic Compact

## Use when
- A long task has concrete evidence that compaction, condensing, or a context-window boundary is near.
- Progress should be preserved at meaningful phase boundaries instead of arbitrary token pressure moments.
- The work needs a deliberate choice between continue now, checkpoint now, or stop now.

## Do not use when
- The task is short enough that ordinary context management is sufficient.
- No real continuation risk exists.
- The work is blocked on missing authority rather than compaction timing.
- The task is merely long or unattended; duration alone belongs to `context-management` or `overnight-run`.

## Behavior change
When loaded, the agent treats compaction as a strategic boundary, not a surprise:
1. identify the current phase and remaining objective,
2. checkpoint before high-risk condensation moments,
3. compact only at a clean boundary or deliberate stop point,
4. leave a short recovery path for the next pass.

## Typical pairings
- `context-management` for broader request capture and recovery discipline.
- `task-documentation` when the work already needs a task-local landing zone.
- `overnight-run` when long autonomous execution is expected.

## Outputs
- A compact phase-state note or checkpoint artifact when needed.
- Clear next-step recovery guidance tied to the current phase.
- Fewer mid-thought or mid-wave compaction losses.

## Activation in SocialPrune
Activated on 2026-10-06. Phase 1 and the later build phases run as long sessions that cross compaction boundaries, so the checkpoint at a phase boundary is worth its cost here.

## Procedure

### 1. Name the live phase
- State what phase is active now.
- State what must still finish before the phase is honestly complete.
- Distinguish active work from later follow-ons.

### 2. Check compaction risk
Checkpoint before compaction when:
- a meaningful phase is about to close,
- many authority reads or decisions would be expensive to reconstruct,
- the next pass would otherwise need to rediscover the same state,
- a stop, pause, or condense boundary is near.

### 3. Prefer clean boundaries over panic saves
- Finish the smallest honest unit that closes the current thought.
- Do not keep pushing if that risks losing the phase story.
- Do not compact in the middle of unresolved branching if a short stabilizing step can close it first.

### 4. Write the minimum recovery package
Keep it short and operational:
- current phase,
- completed facts,
- open edge or blocker,
- exact next step.

### 5. Re-enter deliberately
After compaction or continuation:
- re-read the checkpoint or phase note,
- re-anchor to the governing authority,
- resume from the named next step instead of re-scanning everything.

## Heuristics
- Checkpoint at phase boundaries, not every minor action.
- If a short final step can make the next pass obvious, do that before compacting.
- If the phase is not stable enough to summarize honestly, stabilize first or stop explicitly as blocked.

## Guardrails
- Do not treat compaction as proof that the phase is done.
- Do not save long narrative journals when a short recovery package is enough.
- Do not reopen the full authority set after compaction unless the checkpoint no longer covers the state safely.

## Completion checklist
- [ ] Active phase named
- [ ] Compaction risk checked
- [ ] Checkpoint created only if needed
- [ ] Recovery path left clear

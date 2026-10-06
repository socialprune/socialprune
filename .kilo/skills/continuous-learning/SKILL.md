---
name: continuous-learning
description: Use when feedback, criticism, or repeated mistakes should change future repo workflow behavior. Handles lesson capture, root-cause reflection, explicit prevention rules, and immediate process correction. Triggers on explicit criticism, repeat-mistake signals, 'log lesson', 'already told you', 'you forgot', 'that's wrong'.
version: 1.5.0
author: Workflow Lab
created: 2026-04-19
updated: 2026-08-17
---

# Continuous Learning

## Use when
- The user points out a mistake, omission, or repeated failure.
- A lesson should be captured so the same issue is less likely to recur.
- A process correction needs to be made immediately, not merely noted.

## Do not use when
- No feedback or lesson signal is present.
- The task is simple implementation with no learning event.
- The issue belongs only to technical verification and needs no process update.

## Behavior change
When loaded, the agent shifts from pure task execution to closed-loop improvement:
1. acknowledge the mistake,
2. capture or apply the lesson against `docs/LESSONS_ARCHIVE.md`,
3. fix the current work,
4. reference the lesson in similar future work.

## Durable learning binding
Durable lessons live in the target repo's declared local lessons authority. The template default is `docs/LESSONS_ARCHIVE.md`. A target repo may declare a documented replacement such as `docs/LESSONS_LEARNED.md` in `AGENTS.md` or the local Workflow Bible; this skill then reads, writes, and verifies against the declared file rather than the default filename.
In an unadapted template bootstrap, the declared authority is `docs/LESSONS_ARCHIVE.md`.

## Typical pairings
- `quality-gate-verification` when verification reveals a repeat problem.
- `bug-diagnosis` when the learning event follows a failure investigation.
- `context-management` when long-task drift caused the mistake.

## Outputs
- Lesson entry or lesson application note tied to `docs/LESSONS_ARCHIVE.md`.
- Immediate fix linked to the captured lesson.
- Clear prevention rule for future tasks.
- Detection pattern or verification hook when the lesson needs stronger recurrence prevention.

## Trigger matrix
Use this skill aggressively when signals like these appear:

| Signal type | Example phrases | Default action |
|---|---|---|
| Explicit repeat mistake | "I already told you this", "already said", "wieder", "again" | capture or update lesson immediately |
| Explicit omission | "you forgot", "du hast X vergessen" | capture or update lesson immediately |
| Explicit error | "that's wrong", "das ist falsch" | capture or update lesson immediately |
| Misunderstanding | "that's not what I wanted" | capture or update lesson immediately |
| Explicit lesson request | "log lesson", "remember this" | capture new lesson unless existing one already covers it |
| Implicit repeat-risk | same correction pattern appears again | check for existing lesson before continuing |

## Lesson creation specifics
- **ID format:** `LL-YYYY-MM-NNN`
- **Uniqueness rule:** check `docs/LESSONS_ARCHIVE.md` before assigning the next ID
- **Severity:** `CRITICAL | HIGH | MEDIUM | LOW`
- **Default posture:** update an existing lesson if the failure mode already matches; create a new lesson only when the pattern is materially distinct

## Compact lesson schema
When creating a new lesson, strongly prefer the current archive schema:
- ID
- Severity
- Category
- Expires
- Feedback
- Problem
- 5 Whys Analysis
- Rule(s)
- Detection Pattern
- Affected Files
- Related Lessons
- Regression / Verification Note
- Metrics

## Procedure

### 1. Acknowledge immediately
- State the concrete mistake.
- Do not continue as if nothing happened.
- If the criticism is explicit, treat lesson handling as same-flow work.
- After acknowledgment, pause normal task execution until lesson handling is completed, except for inspection of the lessons archive itself.

### 2. Check whether an existing lesson already covers it
- Read `docs/LESSONS_ARCHIVE.md` first.
- If an existing lesson clearly applies, reference it and update metrics or application state if needed.
- If no lesson covers the failure pattern, create a new one.

### 3. Build the lesson with root-cause depth
Use a compact 5-Whys shape:
```md
**5 Whys Analysis:**
1. Why? ->
2. Why? ->
3. Why? ->
4. Why? ->
5. Why? -> [root cause]
```
- Prefer actionable prevention rules over vague promises.
- Include a detection pattern whenever recurrence can be checked concretely.
- Reject shallow root causes such as "I rushed", "I misunderstood", or "I was careless" unless they are expanded into the missing control or workflow failure that allowed the mistake.
- The fifth why must name a controllable process failure, not merely a personal-state label.
- Write rule 1 as the principle without its example, so a later cleanup can retire the dead example without discarding the live rule. Rules 2 and later may name the exact tool, path, mode, provider, or threshold.
- Put the incident in the lesson and the standing rule in the rule. When a lesson would restate an operative rule that belongs in doctrine, write the rule there and let the lesson carry the incident, the analysis, and a pointer. Two copies of the same instruction drift apart, and the archive is the copy nobody reads, so it is the copy that goes stale unnoticed.
- Date every measured count, limit, duration, provider behavior, version, path, and command name, and say what would invalidate it. `Expires: Never` covers the kernel, not those details.

### 4. Wire the retrieval anchor when the lesson mandates a pre-action check
A lesson is mandating when it requires a check, order, or precondition before a named action, for example "always run X before changing Y".

- Decide where the actor will be standing when that action happens.
- Put the trigger on the always-loaded surface for that context, normally the repo instruction file, or on the action-adjacent document the actor is already reading for that step.
- Keep it to one line: the condition, the required check, and the lesson ID.
- Verify the line now exists. A planned anchor is not an anchor.
- Record the anchor in `Affected Files` or `Regression / Verification Note`. Do not add a new schema field.

Skip this step for explanatory, architectural, or historical lessons.

### 5. Apply the correction now
- Fix the current work in the same flow.
- Reference the lesson when the same pattern appears again, using the root archive as the durable authority.
- If the lesson changes process expectations, say what changes next time.
- If the criticism affects current-task correctness, do not resume normal progress until the output is corrected or a real blocker is declared.

### 6. Close the loop visibly
- Distinguish one-off error from systemic pattern.
- Make the loop visible: capture -> persist -> retrieve -> apply -> verify.
- If the work is multi-lane or multi-round, pass the lesson or lesson-application forward in the next handoff as decisions, discoveries, warnings, or equivalent `prior_knowledge`; archive persistence alone is insufficient.
- Verify the learning step with fresh evidence: successful archive update/readback, or explicit mapping to an existing lesson plus corrected work.

## Recurrence handling
- If the same lesson was relevant but still violated, increment its `Violated` metric.
- If the same failure repeats, update the existing lesson unless the root cause is materially different.
- Repeated violations should strengthen the prevention rule rather than creating near-duplicate lessons.

## Prevention evidence
When a lesson actively prevents a mistake in later work, update its `Prevented` metric with a short note about what was avoided and where.

## Mini validation checklist
- [ ] Feedback or failure signal was explicitly acknowledged
- [ ] Existing lesson checked before creating a duplicate
- [ ] New lesson or lesson-application note tied to `docs/LESSONS_ARCHIVE.md`
- [ ] 5 Whys reached a real root cause, not surface wording
- [ ] Root cause identifies a failed control/process boundary, not just the symptom
- [ ] Prevention rule is actionable
- [ ] Mandating lesson has a verified retrieval anchor on an always-loaded or action-adjacent surface
- [ ] Current work corrected in the same flow

## Guardrails
- Do not delay lesson capture after explicit criticism.
- Do not write vague lessons with no prevention rule.
- Do not log learning without applying it to the active task.
- Do not invent unsupported `.kilo` learning structure when the root archive already satisfies durable storage needs.
- Do not rationalize criticism away as harmless wording when it reveals workflow risk.
- Do not stop at a surface-level cause when a repeat-risk pattern exists.
- Do not create a duplicate lesson if an existing lesson already covers the same failure mode.
- Do not treat archiving a mandating lesson as sufficient. Without a trigger where the action happens, the lesson protects only the reader who already knows the risk.

## Compact example

```md
### [LL-2026-04-999] 2026-04-20 ORCHESTRATION: Example Title

**ID:** LL-2026-04-999
**Severity:** HIGH
**Category:** ORCHESTRATION
**Expires:** 2026-10-20

**Feedback:** User said I claimed a file existed when it did not.
**Problem:** I blurred planned artifacts with written artifacts.
**5 Whys Analysis:**
1. Why? -> I described intention as reality.
2. Why? -> I summarized before verifying.
3. Why? -> I let narrative momentum outrun filesystem truth.
4. Why? -> I lacked a hard verify-before-claim boundary in that moment.
5. Why? -> Root cause: I did not enforce filesystem truth as the authority.
**Rule(s):** Never claim a file exists without write + readback verification.
**Detection Pattern:** completion summary references file path but no successful write/readback exists in the flow.
**Affected Files:** docs/LESSONS_ARCHIVE.md, relevant closure artifacts
**Related Lessons:** LL-2026-04-020
**Regression / Verification Note:** verify write + readback before completion claims
**Metrics:**
- Prevented: 0 times
- Violated: 0 times
```

## Completion checklist
- [ ] Feedback acknowledged
- [ ] Lesson captured or applied
- [ ] Retrieval anchor wired and verified when the lesson mandates a pre-action check
- [ ] Current work corrected
- [ ] Prevention rule made explicit

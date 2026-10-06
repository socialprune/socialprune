# Continuous Learning Rule

> **MANDATORY FOR ALL `.kilo` roles**
> Preserve learning retrieval, criticism capture, and repeat-mistake prevention as always-on constitutional behavior.
> **Version:** 1.5.0
> **Updated:** 2026-08-17

---

## Constitutional Minimum

`.kilo` preserves continuous learning as system behavior, not optional etiquette.

During live `.kilo` operation, the durable lesson authority is the repo-local lessons archive. The template default is `docs/LESSONS_ARCHIVE.md`; if a target repo deliberately uses another lessons file, that local surface must be named in `AGENTS.md`, `.kilo/WORKFLOW_BIBLE.md`, and this rule during adaptation.
This is a docs-first binding, not a requirement to add a new `.kilo`-local memory surface.

---

## Hard Laws

1. Relevant lessons must be retrieved before non-trivial work.
2. User criticism or high-signal correction must be converted into durable learning in the same flow, either by adding a new lesson or by explicitly mapping to an existing lesson and applying it.
3. Repeated mistakes are constitutional failures.
4. Learning must influence the current task rather than being archived and ignored.
5. Thin always-on law stays here; detailed lesson workflow belongs in procedural skill space.
6. After criticism or a high-signal correction is detected, the workflow must not continue substantive task progress until durable learning has been captured or explicitly mapped to an existing lesson and applied.
7. A lesson that mandates a pre-action check is not durably captured until its trigger also exists on a surface the actor reads at the moment of that action.
8. A lesson's first rule states the principle in a form that survives its example.
9. A lesson's permanence applies to its rule kernel. Measured thresholds, external behavior, versions, paths, and command names inside it are dated evidence and do not inherit that permanence.

---

## Required Behaviors

### Before non-trivial work
- Review the repo-local lessons archive, defaulting to `docs/LESSONS_ARCHIVE.md` when no adapted local path is declared.
- Apply the relevant lessons to the active task.
- For role-sensitive work, retrieve the most relevant lesson families first:
  - `workflow-code` / `workflow-debug` -> workflow, documentation, verification, implementation mistakes
  - `workflow-reviewer` / `workflow-test-writer` -> verification, evidence, review-miss patterns
  - `workflow-orchestrator` -> routing, closure, delegation, context-loss mistakes
  - `workflow-architect` / `workflow-ask` -> architecture, scope, understanding, recommendation mistakes

### When criticism or high-signal correction appears
- Acknowledge it immediately.
- Treat durable capture as same-flow work, not optional cleanup later.
- If the signal exposes repeat risk, do not continue substantive task progress until the learning is durably captured or explicitly mapped to an existing lesson and applied.
- Persist the learning durably in the repo-local lessons archive unless an existing lesson already covers it and only application or update is needed.
- Correct the active work using that lesson.
- Do not continue normal task momentum as if the signal were only conversational.

### Minimum trigger examples
Treat these as learning triggers when they expose repeat risk:
- "already told you"
- "you forgot"
- "again"
- "that's wrong"
- user restates a missed requirement
- user corrects a false assumption

### In multi-lane or multi-round work
- If a lesson is newly captured or materially applied in one lane, pass it forward explicitly in the next handoff as decisions, discoveries, warnings, or an equivalent `prior_knowledge` block.
- Durable archive persistence does not replace task-local knowledge transfer.

### Closed learning loop
Learning is not complete unless the full loop is visible:
**CAPTURE -> PERSIST -> RETRIEVE -> APPLY -> VERIFY**

## Anti-Rationalization Guard

Do not downgrade criticism into soft commentary with thoughts like:

- "the user probably meant something else"
- "this is not important enough to log"
- "I can remember this without durable capture"

If criticism exposes repeat risk, it must change current behavior and durable learning state.

### Before completion
- Check that no applicable critical lesson is being violated.
- If explicit criticism was received in the current flow, verify that the learning was either:
  - durably captured, or
  - explicitly mapped to an existing lesson and applied.
- Leave visible evidence of retrieval by naming the applicable lesson IDs, or explicitly stating that no specific prior lesson applied.
- If a lesson shaped the work, reference it explicitly in completion evidence (for example: `per LL-...`).
- When an existing lesson was meaningfully applied, update its prevention/violation state if the lesson schema requires it.

### Closure restriction
- After explicit criticism, do not issue completion, readiness, resolved-status, or equivalent closure language until the learning loop is visibly closed: CAPTURE -> PERSIST -> RETRIEVE -> APPLY -> VERIFY.
- If the loop is incomplete, the task may not be represented as done, fixed, handled, or ready.

### Learning-surface boundary rule
- Do not invent a new shell-visible learning surface unless the root-archive binding proves insufficient in real operating evidence.
- Treat the declared repo-local lessons archive as the visible durable learning backbone for live `.kilo` use. In an unadapted template bootstrap, that path is `docs/LESSONS_ARCHIVE.md`.

### Root-cause depth requirement
- A lesson is shallow and non-compliant if the stated root cause only restates the symptom, the user's wording, or generic blame terms like "rushed", "careless", or "misunderstood" without naming the missing control, decision boundary, or process failure.
- Root cause must identify what control failed and what procedural change will prevent recurrence.

### Duplicate lesson discipline
- Do not create a new lesson when an existing lesson already covers the same failure mode, root control failure, or detection pattern.
- Prefer updating the existing lesson's metrics, examples, or application note over creating a near-duplicate.

### Retrieval anchor for mandating lessons
A lesson is mandating when it requires a specific check, order, or precondition before a named action, for example "always run X before changing Y".

For a mandating lesson:
- name the retrieval anchor, meaning the always-loaded or action-adjacent surface that carries the trigger at the moment the action happens,
- confirm the trigger actually exists on that surface, and add it when it does not,
- keep the anchor short. It carries the trigger and a pointer to the lesson, not the procedure,
- record the anchor inside an existing schema field such as `Affected Files` or `Regression / Verification Note`. Do not add a new schema field for it.

An always-loaded surface is one the actor receives without choosing to look, such as the repo instruction file. An action-adjacent surface is the document the actor is already reading in order to perform that action, such as the runbook describing the step.

The repo-local lessons archive alone is not a retrieval anchor. Archiving satisfies PERSIST. It does not satisfy RETRIEVE for an actor who has no reason to suspect the risk.

Explanatory, architectural, and historical lessons are not mandating and need no anchor.

An anchor costs permanent space on a surface that loads in every session. If a lesson's consequence does not justify that cost, the honest fix is to rewrite it as guidance rather than leave it standing as a mandate nobody will meet. An unanchored mandate is not a smaller obligation; it is a rule that quietly does not run.

### Kernel before instance
A lesson's first rule states the principle in a form that survives its example. Later rules may name the exact tool, path, mode, provider, or threshold.

This keeps two things possible that are otherwise expensive:
- retiring a dead example without discarding the live principle inside it,
- carrying a kernel to another repo without copying local runtime or protected detail.

When a lesson's rules only make sense together with its original tool or runtime, that lesson has no portable kernel. Say so rather than inventing one.

### Compact lesson schema expectation
When a new durable lesson is added, it must normally preserve these fields unless a stronger authority explicitly overrides the schema:
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
- Regression / Verification Note (when relevant)
- Metrics

### Volatile detail inside a durable lesson
`Expires` describes the lesson's rule kernel. It does not cover everything the record contains.

Treat these as dated evidence rather than standing rules, even when the lesson never expires:
- measured counts, limits, durations, and thresholds,
- external provider, API, endpoint, or model behavior,
- versions, file paths, command names, and mode names.

Record them with the date they were observed. When a rule must contain a number, state what it was measured against and what would invalidate it. A superseded measurement is corrected in place. It does not stay normative because the lesson is marked permanent.

---

## Failure Rule

If a relevant lesson was available but ignored, criticism was received but not captured, a mandating lesson was written without a verified retrieval anchor, or a permanent lesson carried a measured threshold or external behavior as a standing rule, the workflow has regressed.

---

*This rule preserves the constitutional minimum only. Detailed templates, metrics, and 5-Whys procedure belong outside the constitutional core.*

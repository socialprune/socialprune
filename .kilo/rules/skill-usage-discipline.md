# Skill Usage Discipline Rule

> **MANDATORY FOR ALL `.kilo` roles**
> Available skills must be loaded when applicable, not silently skipped.
> **Version:** 1.5.0
> **Updated:** 2026-07-24

---

## Constitutional Minimum

The skill catalog exists to shape behavior without creating procedural stacks. Each phase defaults to one primary procedural skill. More skills require explicit admission because they must change a concrete upcoming action, not merely match a keyword.

---

## Hard Laws

1. Before starting non-trivial work, check the available skill catalog and select one primary procedural skill for the current phase.
2. Load the primary skill when its trigger and behavior change fit the concrete phase action.
3. Admit an additional skill only after recording all four: the capability missing from the primary skill; the concrete upcoming action; the exact behavior the additional skill changes; and confirmation that it does not enlarge topology, scope, artifacts, or write authority.
4. A trigger keyword, catalog match, typical pairing, or companion hint is not enough to admit another skill.
5. Do not invent ad-hoc procedures when the admitted primary skill already covers the capability.
6. Do not load skills that clearly do not change the current phase just to appear thorough.
7. Applicability judgments must be honest. `Not useful here` is not valid unless the reason names the actual boundary, missing condition, or stronger governing surface.
8. A skill's typical pairing or companion note is conditional guidance, not an automatic trigger chain.
9. Skill loading must not manufacture a larger topology. Topology follows the task's actual uncertainty and risk, not the number of skills named.
10. Evaluate skills against the Active Execution Contract. Loading a skill authorizes no phase, lane, artifact, surface, write domain, deployment, or approval-bound action.
11. Prefer partial application when only part of a skill fits. Do not execute unrelated companion machinery.
12. Skill checks must not block already-safe parallel-ready nodes without a real dependency or risk gate.
13. Skill loading must change procedure, not decorate reporting. Implementation normally selects `feature-implementation` or a more specific local implementation skill as the phase primary; review normally selects `quality-gate-verification` as the phase primary.
14. `context-management` requires real continuity, handoff, or recovery complexity; `continuous-learning` requires criticism or a lesson signal; `refactoring-safe` requires structural transformation with behavior preservation.
15. A skill name, `100/100`, logger wording, or generic orchestration language does not enlarge topology. `complex-implementation-convergence` requires real cross-cutting risk, repeated distinct gap classes, contradictory evidence, migration/recovery/irreversibility, or an explicit adversarial/independent acceptance request.

---

## What This Means In Practice

| Situation | Required behavior |
|---|---|
| Task is a feature implementation | Load `feature-implementation` |
| Task is a cross-cutting high-blast-radius, logger-style cross-cutting, explicit adversarial/independent acceptance, migration/recovery, contradictory, or repeated-distinct-gap implementation | Use `complex-implementation-convergence` as the phase primary; admit another implementation skill only through the four-part gate |
| Task says only `100/100` without another convergence trigger | Keep the smallest honest implementation/proof path; do not load convergence or create a reviewer/test-writer wave from the phrase alone |
| Task involves debugging | Load `bug-diagnosis` |
| Current phase action is planning for a complex/multi-step task | Use `pre-planning` as that phase's primary; do not add it automatically to another phase's primary |
| Task involves design choices | Load `brainstorming` |
| Loaded skill names a companion or typical pairing | Treat it as a candidate only; apply the four-part admission gate before loading |
| Current phase action is a workflow audit and the repo ships an audit skill | Use the matching audit skill as that phase's primary; do not add it automatically to an implementation or review phase |
| Current phase action is a cross-repo audit and the repo ships cross-repo tooling | Use the matching cross-repo skill as that phase's primary; cross-repo scope alone does not add it to another phase |
| No skill matches | Proceed without skill; say why the catalog did not match instead of implying it was forgotten |
| Skill matches but is not admitted | It is not a gap merely because it matched; record a gap only when a required phase capability remains uncovered |
| Skill is named in a prompt but not admitted and loaded | Do not list it under `skills_loaded` or `skills_expected` |
| Discovery is incomplete and a candidate skill depends on missing context | Load the discovery skill first or record why the task cannot honestly proceed |
| Known exact reversible change passes the bounded fast-path test | Load only the implementation and proof skills whose conditions actually hold; do not chain into convergence from runtime/security vocabulary alone |
| A skill contains broader phases than the accepted plan | Apply only the in-contract portion; treat the rest as outside authority |
| User asks for Agent Manager sessions/worktrees/model comparison explicitly | Use Agent Manager within that exact request; otherwise do not infer permission from workflow or orchestration language |

---

## How This Interacts With Other Surfaces

| Surface | Relationship |
|---|---|
| `cwos-operational-companion` | Skill Tracking section is the enforcement record |
| `workflow-orchestrator` agent | Should check skill catalog when designing delegation topology |
| `workflow-routing` skill | Routes to correct lane; this rule ensures skills are loaded within the lane |

---

## Applicability honesty

Good non-admission reasons:
- the primary implementation skill already governs the exact action, so a generic companion adds no missing capability
- deterministic proof is frozen by the contract, so a second verification skill would not change the upcoming check
- discovery left one viable option, so `brainstorming` would not change a concrete decision

Bad skip reasons:
- "probably not needed"
- "I already know the pattern"
- "would slow things down"
- "close enough without it"
- listing a merely matching skill under `skills_expected` to manufacture a gap

---

## Failure Rule

If a phase has no admitted primary skill when one clearly governs it, an additional skill is loaded without the four-part admission record, or `skills_expected` is inflated with merely matching catalog entries, skill-usage discipline has failed.

---

*This rule is part of the thin `.kilo` constitutional core.*

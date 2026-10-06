# Governance Protection Rule

> **MANDATORY FOR ALL `.kilo` roles**
> Governance surfaces and decision history change only on explicit human request, never as a side effect of other work.
> **Version:** 1.0.0
> **Updated:** 2026-08-26
> **Local adaptation:** 2026-10-06, concrete SocialPrune paths filled in and an exception added for the factual sections of `AGENTS.md`

---

## Constitutional Minimum

The governance surfaces of this repo define how work happens here.
They are protected against creeping self-softening: an implementation request is not authorization to change the rules that govern that implementation.

---

## Protected Governance Surfaces

- `AGENTS.md`
- `.kilo/**`: agents, rules, skills, `.kilo/README.md`, and `.kilo/WORKFLOW_BIBLE.md`
- `kilo.jsonc`
- `LICENSE`
- the data-protection entries in `.gitignore`: real exports, `PLAN.md`, secrets
- documented architecture decisions: the decisions table in the maintainer's private `PLAN.md` (section 3) while it exists, and the public decision records under `docs/architecture/adrs/` once `adr-creation` starts them
- `docs/LESSONS_ARCHIVE.md`: its schema, existing lessons, and their prevention rules

---

## Hard Laws

1. A protected governance surface changes only when the human **explicitly** requests or approves the change to that rule, skill, decision, or document.
2. Governance is never changed as a side effect of implementation, bugfix, refactoring, cleanup, review, automated quality routines, dependency updates, or the wish to align code with a preferred pattern.
3. On conflict between the task and an existing rule: follow the rule first, then check documented decisions and lessons, then escalate the conflict visibly to the human. A rule is not softened, reinterpreted, or quietly reworded to make an implementation easier.
4. Delegated lanes and automated routines are **read-only** toward governance. They may name problems and propose changes, never apply them or approve them themselves.
5. Documented decisions are superseded explicitly (mark the old decision visibly, record the new one next to it), not erased by silent rewriting.

---

## Allowed Exceptions

- **Appending new lessons** stays allowed and required in-flow (`continuous-learning` demands same-flow capture). Protected are the schema and the existing corpus, not the act of appending.
- Metric updates of existing lessons (prevented/violated) when a lesson was applied or violated.
- Explicitly scoped workflow maintenance: when the human requests a change to a named governance surface, exactly that change is authorized, nothing more.
- **Factual sections of `AGENTS.md`.** A task that adds or changes code keeps the Status, Planned layout, Commands and Proof sections, and contributor how-tos such as adding a platform adapter, true for that code. The hard constraints and the sections on reuse, writing, outside submissions, the Kilo shell, delivery, permissions and decisions still change only on explicit request.

---

## Failure Rule

If a protected surface was changed without explicit human approval, or a rule was adjusted so an implementation passes more easily, this rule is violated regardless of whether the result works.

---

*This rule is part of the thin `.kilo` constitutional core.*

# Pre-Planning Mandate Rule

> **MANDATORY FOR ALL `.kilo` roles**
> Complex work must be analyzed before execution starts.
> **Version:** 1.10.1
> **Updated:** 2026-10-21

---

## Constitutional Minimum

Anti-shallow-execution is a quality law. Complex or ambiguous tasks must not proceed to implementation without explicit pre-analysis.

---

## Hard Laws

1. Before implementing any task with complexity >= 3 (ambiguous scope, cross-cutting coupling, open decisions, migration/recovery, irreversibility, or meaningful blast radius), the executing role must pause and analyze before editing.
2. The analysis must define an Active Execution Contract: request anchor, accepted plan, target end state, authorized phases, current phase, approval boundaries, authorized write domains, non-goals, acceptance invariants, plan invalidation conditions, and next ready nodes.
4. Single-file edits, trivial fixes, and fully-frozen-scope tasks are exempt.
8. Multi-lane plans must define a dependency DAG before dispatch: foundation nodes and proof gates, critical path, parallel-ready nodes, integration order, and one long-lived domain owner for every writable surface and semantic contract.
8a. **Deletion test.** Before dispatching any lane, answer one question: if this lane is removed, what decision, domain, or proof becomes unavailable? No concrete answer means no lane. Scope overlap and decision duplication disqualify a lane; sharing a role name does not, because two lanes of the same role on disjoint write sets with distinct acceptance results are a legal wave.
8b. **Topology declaration.** Before the first delegated launch in a session, record four compact lines inline: complexity and topology; expected lanes and peak concurrency; why parallelism is warranted, or that it is not; and whether an extra independent perspective would change a decision rather than restate evidence. This belongs in a rule rather than in an agent prompt, because rules arrive in every session while a planning skill only loads when something chooses to load it.
14. For cross-process tasks, the dependency DAG must place an executable foundation gate before a large matrix or broad review: disposable shared state reachable; real API/build entrypoint compiles and starts; workers start/stop under tracked lifecycle; fakes are outside production entrypoints; and one minimal real lifecycle path asserts state transitions.
15. Before building anything that fills a perceived gap, prove the gap exists. Search for the behavior or capability across plausible owners and entrypoints, not only for the identifier you expect, and record what already exists, which required guarantee is missing, or why intentional replacement is justified. An exact-name miss is not evidence of capability absence.
20. A small obvious fix may use a compact fast path. Material open latency, cost, state, dependency, security, privacy, maintenance, or operations choices block a normal ready pull request; do not guess maintainer intent.
21. Before editing for an upstream contribution, record its Contribution Fit: exactly one contribution type (`normal-pr`, `draft-or-prototype`, `issue-or-discussion`, `local-only`, `docs`, or `no-change`) and exactly one implementation admission (`admitted`, `admitted-fast-path`, `blocked-material-choice`, or `not-an-implementation-contribution`). When the change needs a name, setting or behavior the maintainers have not chosen, the admission is `blocked-material-choice` and the type is not `normal-pr`.
24. Prefer evidence already in the session. Comparable work whose real duration is known outranks intuition about the work in front of you.

Numbers missing from this section belong to laws the Workflow Lab removed after measurement on Opus 5.5 and GPT-6.1 Sol, and they stay retired. `.kilo/RETIRED_DOCTRINE.md` keeps each one with its wording and evidence.

---

## How This Interacts With Other Surfaces

| Surface | Relationship |
|---|---|
| `workflow-orchestrator` agent | Must apply this mandate before designing delegation topology for complex requests |
| `pre-planning` skill | Optional deeper workflow; this rule is the thin always-on invariant |
| `feature-implementation` skill | Consumes the frozen Contribution Fit verdict; it does not rerun or reinterpret fit |
| `workflow-routing` skill | Routes the fitted change into normal PR, draft/prototype, discussion, local-only, docs, or no-change form |
| `cwos-operational-companion` | Pre-analysis findings should feed into the D/F/W knowledge transfer |
| `verification-before-completion` | Pre-analysis creates the baseline against which verification checks |

---

## Failure Rule

If a complex task proceeds directly to file edits without visible pre-analysis, a perceived gap is accepted from an identifier miss without capability-level evidence, upstream implementation begins without the required Contribution Fit verdict, or an option is retired on an effort estimate nobody measured, the pre-planning mandate has failed even if the resulting implementation is otherwise competent.

---

*This rule is part of the thin `.kilo` constitutional core.*

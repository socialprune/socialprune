# Pre-Planning Mandate Rule

> **MANDATORY FOR ALL `.kilo` roles**
> Complex work must be analyzed before execution starts.
> **Version:** 1.8.0
> **Updated:** 2026-08-30

---

## Constitutional Minimum

Anti-shallow-execution is a quality law. Complex or ambiguous tasks must not proceed to implementation without explicit pre-analysis.

---

## Hard Laws

1. Before implementing any task with complexity >= 3 (ambiguous scope, cross-cutting coupling, open decisions, migration/recovery, irreversibility, or meaningful blast radius), the executing role must pause and analyze before editing.
2. The analysis must define an Active Execution Contract: request anchor, accepted plan, target end state, authorized phases, current phase, approval boundaries, authorized write domains, non-goals, acceptance invariants, plan invalidation conditions, and next ready nodes.
3. The analysis may be inline (a brief section in the execution artifact) or use the `pre-planning` skill for deeper work. The obligation is the analysis, not the format.
4. Single-file edits, trivial fixes, and fully-frozen-scope tasks are exempt.
5. "I will figure it out as I go" is not an acceptable substitute for pre-analysis on complex work.
6. Security sensitivity determines required safety controls, not orchestration depth by itself. Runtime, gateway, provider, credential, and security vocabulary alone does not make work Complexity 4.
7. A known exact change on no more than two authoritative config/runtime surfaces may use inline pre-analysis when it is backupable, atomic, deterministically validatable, directly canary-testable, and has no migration, irreversible external action, open architecture decision, or unknown cause.
8. Multi-lane plans must define a dependency DAG before dispatch: foundation nodes and proof gates, critical path, parallel-ready nodes, integration order, and one long-lived domain owner for every writable surface and semantic contract.
8a. **Deletion test.** Before dispatching any lane, answer one question: if this lane is removed, what decision, domain, or proof becomes unavailable? No concrete answer means no lane. Scope overlap and decision duplication disqualify a lane; sharing a role name does not, because two lanes of the same role on disjoint write sets with distinct acceptance results are a legal wave.
8b. **Topology declaration.** Before the first delegated launch in a session, record four compact lines inline: complexity and topology; expected lanes and peak concurrency; why parallelism is warranted, or that it is not; and whether an extra independent perspective would change a decision rather than restate evidence. This belongs in a rule rather than in an agent prompt, because rules arrive in every session while a planning skill only loads when something chooses to load it.
9. A bounded wave is legal only when its nodes have disjoint write sets and distinct acceptance results. Shared files or semantic contracts require a foundation/integration owner or baton pass.
10. A downstream node may start only after every foundation prerequisite has completed and satisfied its named proof gate.
11. Planning exists to expose safe concurrency and stop conditions, not to create ceremony. Inline or existing records are valid when they preserve the contract and proof map.
12. Complexity is evaluated inside the accepted plan. Continuation resumes authorized phases; it does not authorize an invented deployment, activation, surface, or write domain.
13. `100/100` alone is a quality target, not a Complexity-4, convergence, reviewer-wave, test-writer, or Agent Manager trigger. It changes topology only with real cross-cutting risk or an explicit adversarial/independent acceptance requirement.
14. For cross-process tasks, the dependency DAG must place an executable foundation gate before a large matrix or broad review: disposable shared state reachable; real API/build entrypoint compiles and starts; workers start/stop under tracked lifecycle; fakes stay outside production entrypoints; and one minimal real lifecycle path asserts state transitions.
15. Before building anything that fills a perceived gap, prove the gap exists. Search for the behavior or capability across plausible owners and entrypoints, not only for the identifier you expect, and record what already exists, which required guarantee is missing, or why intentional replacement is justified. An exact-name miss is not evidence of capability absence.
16. Before adding any extra lane, reviewer, test-writer, broad rerun, or revision, record remaining acceptance classes, missing/invalidated evidence, owner insufficiency, unique expected evidence, and coordination cost. No new risk class or independent-authority requirement means no extra work.
17. Approval boundaries must distinguish human-simple confirmation from machine-bound authorization. Plan one fresh pending card, exact visible terms and selected items, thread/expiry binding, most-recent immediate-presentation binding, explicit supersession plus replacement versioning for any changed term/effect, fail-closed confirmation of superseded cards, and whether approval confirms, queues, or executes.
18. When implementation is intended for upstream or the accepted end state includes a normal ready pull request, proportional Contribution Fit must be decided before editing.
19. Contribution Fit must connect capability-gap proof to the affected architecture owner and observed design intent, maintainer-intent evidence or an explicit unknown, material alternatives and tradeoffs, contribution type, and implementation admission.
20. A small obvious fix may use a compact fast path. Material open latency, cost, state, dependency, security, privacy, maintenance, or operations choices block a normal ready pull request; do not guess maintainer intent.
21. Contribution Fit selects one contribution type: `normal-pr`, `draft-or-prototype`, `issue-or-discussion`, `local-only`, `docs`, or `no-change`; and one implementation admission: `admitted`, `admitted-fast-path`, `blocked-material-choice`, or `not-an-implementation-contribution`.
22. An effort, cost, or duration estimate that closes an option is a claim and carries the same evidence burden as any other claim. Do not retire an option on an unmeasured number.
23. When the cheapest way to learn the cost is to run the thing once, run it. A bounded trial beats an estimate, and its result replaces the guess rather than confirming it.
24. Prefer evidence already in the session. Comparable work whose real duration is known outranks intuition about the work in front of you.

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

If a complex task proceeds directly to file edits without visible pre-analysis, a perceived gap is accepted from an identifier miss without capability-level evidence, or upstream implementation begins without the required Contribution Fit verdict, the pre-planning mandate has failed even if the resulting implementation is otherwise competent.

---

*This rule is part of the thin `.kilo` constitutional core.*

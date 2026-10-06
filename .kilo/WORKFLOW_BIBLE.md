# SocialPrune Workflow Bible

> **Version:** 1.2.0 | **Last updated:** 2026-10-06
> **Scope:** the live `.kilo` shell of this repository
> **Owner:** the maintainer. Changes follow `.kilo/rules/governance-protection.md`.

---

## 1. Why this shell exists

SocialPrune is built by one maintainer working with AI agents in Kilo. The product handles the most private data a person has online, it must not cost anyone money, and it must not act on X or Instagram. Agents drift on exactly those points when nothing stops them: they reach for a paid API key that happens to be set, they test with a real export because it is at hand, they call a feature done because a stub passed.

The shell exists so every session starts with those limits loaded. It makes complex work get planned before editing, keeps claims tied to fresh evidence, and keeps public text sounding like the maintainer rather than an assistant.

## 2. Where truth lives

| Question | Authority |
|---|---|
| What the maintainer wants now | the newest request in the current conversation |
| Hard constraints, layout, conventions | `AGENTS.md` |
| How work is done and proven | `.kilo/rules/` |
| Product decisions, phases, gates, spikes | `PLAN.md` (maintainer-local, git-ignored, German) |
| Procedures for a kind of task | `.kilo/skills/` |
| Mistakes not to repeat | `docs/LESSONS_ARCHIVE.md` |
| Deferred workflow work | `docs/BACKLOG.md` |
| What this shell is and why | this file and `.kilo/README.md` |

When `AGENTS.md` and `PLAN.md` disagree, `AGENTS.md` wins until the maintainer settles it, and the conflict is reported instead of resolved silently.

## 3. How work usually runs here

- **Entry.** Sessions start in `workflow-orchestrator`. It classifies the task, keeps simple work in one lane and admits subagents only for distinct domains or independent review.
- **Planning.** Phase work from `PLAN.md` with more than one surface or an open decision runs through `pre-planning` before the first edit.
- **Implementation.** `feature-implementation` is the primary skill. Parsers and the classifier grow test-first against generated fixtures under `fixtures/synthetic/`.
- **Spikes.** `technology-research` covers documentation questions. A spike that runs something is a bounded trial whose result replaces the estimate (`rules/pre-planning-mandate.md`).
- **Real exports.** Only with explicit maintainer scope, under `rules/protected-surface-boundary.md`. Findings come back as counts, structure and new synthetic fixtures.
- **Long runs.** A build phase the maintainer hands over to run unattended uses `overnight-run`, and `strategic-compact` sets a checkpoint before a phase boundary would be lost to compaction.
- **Decisions.** A decision that changes `PLAN.md` section 3 or that contributors need later becomes an ADR under `docs/architecture/adrs/` through `adr-creation`.
- **Shell work.** New `.kilo` skills or rules are written with `workflow-implementation` and accepted with `workflow-validation`.
- **Agent Skill.** `skills/socialprune/SKILL.md` is a product file for users' agents, not shell doctrine. It is built with `feature-implementation`, checked against the Agent Skills specification with `technology-research`, and accepted through Gate G2.
- **Proof.** `quality-gate-verification` closes a claim with readback, command output or tests. The network-audit test observes real browser requests and never stubs the mechanism it checks.
- **Public text.** README, docs, issues, pull requests and commit messages follow `rules/human-writing-style.md`, with `human-writing` loaded before the first draft. Launch posts, Hacker News comments and awesome-list entries are written by the maintainer.
- **Outside venues.** Before submitting anywhere, read that venue's written rules (`AGENTS.md`, section Outside submissions).

## 4. Active surfaces

### 4.1 Agents

| Agent | Mode | Role |
|---|---|---|
| `workflow-orchestrator` | primary | entry point, complexity gate, topology and closure |
| `workflow-architect` | subagent | specifications, boundaries, design decisions |
| `workflow-ask` | subagent | bounded research, explanation and inspection |
| `workflow-code` | subagent | implementation and refactoring with proof |
| `workflow-debug` | subagent | root-cause analysis for unknown failures |
| `workflow-reviewer` | subagent | independent review and acceptance |
| `workflow-test-writer` | subagent | tests and validation scenarios |

No agent pins a model. Sessions use the model the maintainer selects.

### 4.2 Rules

| Rule | What it enforces |
|---|---|
| `backlog-management` | deferral only with an explicit `docs/BACKLOG.md` entry and a trigger |
| `continuous-learning` | lessons are read before non-trivial work, and criticism becomes a lesson |
| `cross-reference-hygiene` | references resolve, and deliberate omissions carry a reason |
| `cwos-core`, `cwos-operational-companion` | structured status and handoff for delegated work |
| `governance-protection` | governance files change only on explicit request |
| `human-writing-style` | voice and named AI tells for all human-facing text |
| `knowledge-accumulation` | decisions, discoveries and warnings pass between lanes |
| `pre-planning-mandate` | complex work is analyzed before editing; a claimed gap is proven first |
| `protected-surface-boundary` | real exports stay out of ordinary work and out of Git (activated here) |
| `registered-session-lifecycle` | duties for Agent Manager parents and children |
| `skill-usage-discipline` | one primary skill per phase, more only with a reason |
| `task-documentation` | scratch outside Git, durable evidence compact |
| `tool-usage-discipline` | file tools for files, tracked processes for long commands |
| `verification-before-completion` | no completion claim without fresh evidence |
| `wiring-verification` | a correct but unwired part counts as failure |

### 4.3 Skills

| Skill | Use it for |
|---|---|
| `adr-creation` | public decision records under `docs/architecture/adrs/` (activated) |
| `brainstorming` | comparing real design options |
| `bug-diagnosis` | failures with an unknown cause |
| `commit-message` | commit messages in the repository's convention |
| `complex-implementation-convergence` | high-blast-radius work with real cross-cutting risk |
| `context-management` | work that spans sessions or handoffs |
| `continuous-learning` | capturing a lesson |
| `feature-implementation` | building features and components |
| `human-writing` | any human-facing prose, before the first draft |
| `overnight-run` | a build phase handed over to run unattended (activated) |
| `pre-planning` | analyzing complex work before it starts |
| `quality-gate-verification` | evidence-based PASS or FAIL |
| `refactoring-safe` | restructuring without behavior change |
| `session-steering` | Agent Manager sessions, only when the maintainer asks for them |
| `strategic-compact` | a checkpoint before compaction would lose phase state (activated) |
| `synthesis` | merging several lane results |
| `technology-research` | decisions that depend on current external evidence |
| `workflow-implementation` | writing or revising this repository's own skills and rules (activated) |
| `workflow-routing` | choosing lane and topology |
| `workflow-validation` | accepting a changed skill, rule or agent as workflow doctrine (activated) |
| `workspace-surface-audit` | inventory before recommending a new surface |
| `yagni-evaluation` | deciding whether an enhancement is worth building now |

Some skills mention template skills that are not installed here: `workflow-meta-audit`, `cross-repo-audit` and `repo-bootstrapping`. Those mentions are conditional pairings and stay inactive. Section 6 gives the reason and the trigger for each.

## 5. Local truth surfaces

- `AGENTS.md`, the always-loaded summary for every agent and contributor.
- `PLAN.md`, the maintainer's working plan. It is git-ignored because it holds personal notes, so contributors will not have it.
- `docs/LESSONS_ARCHIVE.md`, the lesson authority for `continuous-learning`. It starts empty.
- `docs/BACKLOG.md`, the deferral record for `backlog-management`.
- `kilo.jsonc`, minimal: `$schema`, `default_agent` set to `workflow-orchestrator`, and `instructions`, which loads `.kilo/rules/*.md`. New keys are added only after checking the current Kilo docs.
- `.kilo/skills/human-writing/OPERATOR_VOICE.local.md`, the maintainer's voice samples. The `human-writing` skill reads them. The file is local only, ignored through `.kilo/.gitignore`, and contributors will not have it.
- `.kilo/plans/`, drafts written by Kilo's plan mode. They draw on the private `PLAN.md`, so `.kilo/.gitignore` keeps them local.

There is no `docs/tasks/` folder. Scratch and raw evidence stay outside Git under the local temp path (`rules/task-documentation.md`), and nothing so far has needed a durable task record.

## 6. Activation decisions

Each optional surface is decided on its own, against the work `PLAN.md` schedules next. An exclusion names what would reverse it.

| Template surface | Decision | Reason | Reversed when |
|---|---|---|---|
| Baseline agents, rules and skills | kept | all apply to a solo-maintainer product built with agents | |
| Rule `protected-surface-boundary` | activated, filled | real exports are this project's protected data | |
| Rules `fiona-closure-companion`, `fiona-completion-contract` | not copied | they write closure records for the maintainer's operator dashboard, and this repository is not connected to it | the repository is registered for operator routing |
| Rule `academic-content-boundary` | not copied | no course or academic material here | never expected |
| Skill `overnight-run` | activated | Phase 1 and later phases are handed to one session that runs for hours | |
| Skill `strategic-compact` | activated, adapted | those long sessions cross compaction boundaries | |
| Skill `adr-creation` | activated, adapted | `PLAN.md` holds a dozen architecture decisions, and contributors need public records (BL-002) | |
| Skill `workflow-implementation` | activated, adapted | repeated procedures in the plan, such as adding a platform adapter (0.3) or rebuilding a real-export deviation as a synthetic fixture (S4, Phase 3), are candidates for `.kilo` skills | |
| Skill `workflow-validation` | activated, adapted | accepts those `.kilo` skills and rule changes as workflow doctrine. Product code and the product Agent Skill go through `quality-gate-verification` | |
| Skill `workflow-meta-audit` | not copied | a 22-skill shell with no local skills yet has nothing to audit for drift | the shell carries several repo-local skills, or sessions misroute |
| Skill `memory-curation` | not copied | lessons, backlog, ADRs and `PLAN.md` already hold every kind of durable knowledge here | a fifth knowledge surface appears |
| Skill `knowledge-base-topic-setup` | not copied | no topic or knowledge base | the docs grow a topic index |
| Skills `repo-bootstrapping`, `pattern-distribution`, `cross-repo-audit` | not copied | this repository does not bootstrap, feed or audit other repositories | never expected |
| Domain skills in the maintainer's other repositories, for example LLM provider integration, plugin architecture or frontend components | not copied | written for those products and their stacks | a procedure repeats in SocialPrune often enough to deserve its own skill |
| Third-party design skill `impeccable`, vendored in another of the maintainer's repositories | deferred | no UI yet, and its benchmark is still open | Phase 2b or the benchmark verdict (BL-003) |
| `CATALOG_TEMPLATE.md` | not copied | only for operator catalog routing | as for the Fiona rules |
| `CROSS_REPO_DISPATCH_TEMPLATE.md`, `REPO_ORCHESTRATION_SUMMARY_TEMPLATE.md` | not copied | no cross-repository dispatch | never expected |
| Root `README.md` | not written at bootstrap | it is the product README, not workflow doctrine | a short status README comes with the first push, the launch README in Phase 4 |
| `docs/tasks/` | not created | no task has needed durable evidence | a task produces evidence with lasting recovery or forensic value |
| Wake plugin | not copied | the maintainer's global Kilo config carries a copy. A roundtrip here is unproven (BL-001), so no unattended Agent Manager parent and child work runs until it passes. A single session under `overnight-run` is not affected | BL-001 |
| Template library | not copied | reference material, kept with the template | |
| Legacy shell residue | none | new repository | |

## 7. Changing this shell

- Change a governance surface only on the maintainer's explicit request, and change exactly what was asked.
- Add a line to the changelog below for every shell change.
- The workflow template evolves separately. Its updates do not arrive here on their own, and local changes stay local unless the maintainer distributes them on purpose.
- When a template surface is left out, record it in section 6 with the reason, so a later sync does not add it back.

## 8. Changelog

- **2026-10-06, 1.2.0.** The independent review of 1.1.0 returned FAIL with one targeted revision and ten findings, all fixed. Removed the name of a private repository from tracked files. Ignored `.kilo/plans/` and extracted export folders. Allowed the maintainer's own classification run through an endpoint he names, with aggregate-only reads by agents. Limited BL-001 to Agent Manager parent and child work. Let the factual sections of `AGENTS.md` follow the code. Routed the product Agent Skill to `feature-implementation`. Adapted `adr-creation` and the descriptions of `workflow-implementation` and `workflow-validation`. Recorded the comparison with domain skills of other repositories, and added the S2 labelling rules to `AGENTS.md`. Kilo 7.8.3 rediscovered 22 of 22 skills afterwards.
- **2026-10-06, 1.1.0.** Audit after the maintainer asked whether anything was missing. Activated `overnight-run`, `adr-creation` (unchanged), `strategic-compact`, `workflow-implementation` and `workflow-validation` (activation notes adapted), so the shell has 22 skills. Copied the local voice samples for `human-writing`. Ignored the files Kilo writes into `.kilo/` on startup. Added `$schema` and `default_agent` to `kilo.jsonc` and a `.gitattributes` for LF line endings. Replaced the single optional-layer row in section 6 with a decision per item. Proved discovery with `kilo debug skill` and `kilo debug config` 7.8.3 on a disposable copy: 22 of 22 skills, 16 of 16 rules, 7 of 7 agents.
- **2026-10-06, 1.0.0.** Shell set up from the workflow template: 7 agents, 15 baseline rules and 17 skills copied with hash parity. `protected-surface-boundary` activated and filled. `governance-protection` and `workflow-routing` adapted. `AGENTS.md`, `kilo.jsonc`, `.gitignore`, `LICENSE` (Apache-2.0), `docs/LESSONS_ARCHIVE.md`, `docs/BACKLOG.md`, this file and `.kilo/README.md` written for SocialPrune.

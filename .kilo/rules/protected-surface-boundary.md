# Protected Surface Boundary Rule

<!-- local: replaces 3 baseline lines #26ddfcec "> **OPTIONAL TEMPLATE RULE**" | Activated repository boundary header; WORKFLOW_BIBLE.md section 6 -->
> **MANDATORY FOR ALL `.kilo` roles IN SOCIALPRUNE**
> Real social media exports are the most private data this project touches. Workflow and product work never reads, copies or changes them without an explicit, narrow scope from the maintainer.
<!-- /local -->
> **Version:** 1.1.0-socialprune.3
> **Updated:** 2026-10-21
<!-- local: adds | Keep the recorded activation and classification exception; WORKFLOW_BIBLE.md sections 6 and 9 -->
> **Activated:** 2026-10-06, from the optional protected-surface-boundary rule of the workflow template (1.1.0), with the activation contract filled for this repository. Revision 2 on the same day allows the maintainer's own classification run through an endpoint he names
<!-- /local -->

---

## Purpose

<!-- local: replaces 9 baseline lines #49efbb86 "Some repos contain files the agent must not read or edit dur" | Real-export boundary replaces generic candidate wording; AGENTS.md hard constraint 6 -->
SocialPrune exists to keep people's old posts from leaking. Its own development must not become the leak. This rule fences off every real export, including the maintainer's, from ordinary workflow and product work, and it says what proof closes a task that stayed outside the fence.
<!-- /local -->

## Activation contract

<!-- local: replaces 3 baseline lines #7b3ba323 "Do not activate this rule until the target repo fills this t" | Local activation table already filled; WORKFLOW_BIBLE.md section 6 -->
| Field | SocialPrune value |
<!-- /local -->
|---|---|
<!-- local: replaces 7 baseline lines #d4e0bc5a "| Protected path/categories | `<PROTECTED_PATHS_OR_CATEGORIE" | Concrete real-export and synthetic-fixture boundary; AGENTS.md hard constraints 2 and 6 -->
| Protected path/categories | Every real social media export and anything derived from it: export ZIPs and their extracted contents, CLI workspaces created from a real export, the maintainer's private export folder outside the repository, and local `exports/`, `private/` and `cleanup/` folders inside it. Browser profiles that are signed in to a real X or Instagram account. `.env*`, `**/secrets/**`, `**/credentials/**`. |
| Workflow-safe paths | Everything tracked in Git, including `.kilo/`, `AGENTS.md`, `docs/`, source, tests and `fixtures/synthetic/`. |
| Private but readable | `PLAN.md` (git-ignored). Read it for planning. Never copy its personal section or private paths into tracked files. |
| Explicit-scope authority | The maintainer, in the current conversation, naming the exact file or folder and the purpose. |
| Allowed protected-task types | Running the parser or classifier on a real export to find format deviations (spike S4), and the maintainer's own cleanup (Phase 3). That cleanup may classify the maintainer's own export through a model endpoint he names in the current conversation. An agent may start that run but reads only its aggregate output; item-level results stay in the review UI for the maintainer. Otherwise results leave the protected area only as aggregate counts or key-path and type structure without values. |
| Never-read surfaces | Direct messages and chats inside any export (for example Instagram `messages/`, X `direct-messages*.js`), and login, IP, device, contact and security files, unless the maintainer scopes that exact file. |
| Never-edit surfaces | Real exports. They stay read-only: never modified, moved, renamed or deleted by an agent. Signed-in browser profiles outside a disposable copy. |
| Required proof after workflow-only work | The `[PROTECTED_BOUNDARY]` block below, backed by `git status` and, once it exists, a passing data guard. |
<!-- /local -->

<!-- local: replaces 1 baseline lines #cc6036b0 "If this table is not filled with target-local truth, the rul" | Activated rule needs no unfilled-table warning; WORKFLOW_BIBLE.md section 6 -->
---
<!-- /local -->

## Hard Laws

<!-- local: replaces 1 baseline lines #a2190577 "#. Workflow-only tasks may read and edit only workflow-safe " | Local boundary also governs ordinary product tasks; AGENTS.md hard constraint 6 -->
1. Workflow-only and ordinary product tasks read and edit workflow-safe paths only.
<!-- /local -->
<!-- local: replaces 1 baseline lines #21ec3d4d "#. Protected paths/categories require explicit user scope be" | Explicit maintainer scope and broad-task exclusions; AGENTS.md hard constraint 6 -->
2. A protected path needs explicit maintainer scope before any read, parse, summary, index or analysis. A broad audit, a cleanup pass, a failing test or a format question is not that scope.
<!-- /local -->
<!-- omitted: 1 baseline lines #e239d76f "#. A broad repo audit, workflow cleanup, template refresh, o" | Broad-task exclusion is expressed in local law 2 | WORKFLOW_BIBLE.md section 6 and AGENTS.md hard constraint 6 -->
<!-- local: replaces 1 baseline lines #eb837031 "#. Protected content must not be copied into generic workflo" | Preserve the scoped own-export classification exception and synthetic reproductions; WORKFLOW_BIBLE.md section 9 revision 2 -->
3. Content from a real export never enters a tracked file, test fixture, issue, pull request, commit message, log line, screenshot or prompt to a remote model. The one exception is the maintainer's own classification run in the allowed task types, which sends item text only to the endpoint he named. A finding from a real export is reproduced as generated data under `fixtures/synthetic/`.
<!-- /local -->
<!-- local: adds | Protected findings stay aggregate-only; AGENTS.md hard constraints 2 and 6 -->
4. Protected work reports aggregate counts or key-path and type structure without values, the same shape the `structure` command produces.
<!-- /local -->
<!-- local: replaces 1 baseline lines #63dc24e3 "#. If the task needs protected content but the user did not " | Unscoped real-export access stops; AGENTS.md hard constraint 6 -->
5. If a task needs protected content that was not scoped, stop and ask for a narrower boundary.
<!-- /local -->
<!-- local: replaces 1 baseline lines #26827f6e "#. Completion requires proof that protected paths were not t" | Local protected-boundary completion proof; WORKFLOW_BIBLE.md section 6 -->
6. Completion of a workflow-only task includes proof that no protected path was touched.
<!-- /local -->

<!-- local: adds | Keep local section spacing; WORKFLOW_BIBLE.md section 6 -->
---
<!-- /local -->

## Required Behaviors

<!-- local: replaces 1 baseline lines #54a97b9d "### During workflow-only work" | Local scope includes product work; AGENTS.md hard constraint 6 -->
### During workflow-only or product work
<!-- /local -->

<!-- local: replaces 5 baseline lines #63478895 "- Stay inside `<WORKFLOW_SAFE_PATHS>`." | Synthetic fixtures and signed-in profile effects are explicit; AGENTS.md hard constraints 4 and 6 -->
- Stay inside the workflow-safe paths.
- Use generated fixtures for every test, demo and screenshot.
- Before a spike starts a program against a signed-in browser profile, list what the run can change in that profile, and read it back afterwards.
<!-- /local -->

<!-- local: replaces 1 baseline lines #0146f5d8 "### During protected-content work" | Local protected-work heading; WORKFLOW_BIBLE.md section 6 -->
### During scoped protected work
<!-- /local -->

<!-- local: replaces 7 baseline lines #f635730e "Only proceed when the user explicitly scopes the protected t" | Protected work uses copies and aggregate findings; AGENTS.md hard constraint 6 -->
- Read the minimum files the scoped purpose needs.
- Run against a working copy outside the repository, never against the original export.
- Keep results to counts and structure, and record which protected paths were read.
<!-- /local -->

### Before completion

<!-- local: replaces 1 baseline lines #8a3df232 "For workflow-only work, record proof such as:" | Local proof introduction; WORKFLOW_BIBLE.md section 6 -->
Workflow-only work:
<!-- /local -->

```md
[PROTECTED_BOUNDARY]
- protected paths read: none
- protected paths changed: none
- workflow-safe paths changed: <list>
<!-- local: replaces 1 baseline lines #d3a029a4 "- proof method: git status / readback / path inventory" | Local data-guard proof; AGENTS.md Proof this project relies on -->
- proof method: git status, plus the data guard once it exists
<!-- /local -->
```

<!-- local: replaces 1 baseline lines #2517e9ca "For protected-content work, record:" | Local scoped-proof introduction; WORKFLOW_BIBLE.md section 6 -->
Scoped protected work:
<!-- /local -->

```md
[PROTECTED_BOUNDARY]
<!-- local: replaces 1 baseline lines #c65fa148 "- explicit scope: <user-scoped task>" | Maintainer-scoped proof field; WORKFLOW_BIBLE.md section 6 -->
- explicit scope: <maintainer's scoped task>
<!-- /local -->
- protected paths read: <list>
<!-- local: replaces 2 baseline lines #734682db "- protected paths changed: <list or none>" | Real exports remain unchanged and unquoted; AGENTS.md hard constraint 6 -->
- protected paths changed: none
- export content copied into tracked files: none
<!-- /local -->
- proof method: <method>
```

<!-- local: replaces 34 baseline lines #cfddd33e "## Adaptation examples" | Activated export boundary replaces unrelated domain and business-source examples; WORKFLOW_BIBLE.md sections 6 and 9 -->
---
<!-- /local -->

## Non-Goals

<!-- local: replaces 6 baseline lines #6b4e2e98 "This rule does not:" | Local rule and data guard remain separate; AGENTS.md hard constraint 6 -->
This rule does not write the product's privacy policy, authorize protected analysis on its own, or replace the data guard. The data guard catches mistakes mechanically; this rule keeps agents from making them.

---
<!-- /local -->

## Failure Rule

<!-- local: replaces 7 baseline lines #00f406eb "If a workflow-only task reads, summarizes, edits, indexes, o" | Concrete export and scoped-endpoint failure boundary; WORKFLOW_BIBLE.md section 9 revision 2 -->
If any task reads, summarizes, indexes, edits or copies real export content without explicit scope, or if export content reaches a tracked file, a public artifact, or any remote model other than the endpoint the maintainer named for his own classification run, this rule has failed, whatever the task produced.
<!-- /local -->

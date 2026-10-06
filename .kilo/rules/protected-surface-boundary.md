# Protected Surface Boundary Rule

> **MANDATORY FOR ALL `.kilo` roles IN SOCIALPRUNE**
> Real social media exports are the most private data this project touches. Workflow and product work never reads, copies or changes them without an explicit, narrow scope from the maintainer.
> **Version:** 1.1.0-socialprune.2
> **Activated:** 2026-10-06, from the optional protected-surface-boundary rule of the workflow template (1.1.0), with the activation contract filled for this repository. Revision 2 on the same day allows the maintainer's own classification run through an endpoint he names

---

## Purpose

SocialPrune exists to keep people's old posts from leaking. Its own development must not become the leak. This rule fences off every real export, including the maintainer's, from ordinary workflow and product work, and it says what proof closes a task that stayed outside the fence.

## Activation contract

| Field | SocialPrune value |
|---|---|
| Protected path/categories | Every real social media export and anything derived from it: export ZIPs and their extracted contents, CLI workspaces created from a real export, the maintainer's private export folder outside the repository, and local `exports/`, `private/` and `cleanup/` folders inside it. Browser profiles that are signed in to a real X or Instagram account. `.env*`, `**/secrets/**`, `**/credentials/**`. |
| Workflow-safe paths | Everything tracked in Git, including `.kilo/`, `AGENTS.md`, `docs/`, source, tests and `fixtures/synthetic/`. |
| Private but readable | `PLAN.md` (git-ignored). Read it for planning. Never copy its personal section or private paths into tracked files. |
| Explicit-scope authority | The maintainer, in the current conversation, naming the exact file or folder and the purpose. |
| Allowed protected-task types | Running the parser or classifier on a real export to find format deviations (spike S4), and the maintainer's own cleanup (Phase 3). That cleanup may classify the maintainer's own export through a model endpoint he names in the current conversation. An agent may start that run but reads only its aggregate output; item-level results stay in the review UI for the maintainer. Otherwise results leave the protected area only as aggregate counts or key-path and type structure without values. |
| Never-read surfaces | Direct messages and chats inside any export (for example Instagram `messages/`, X `direct-messages*.js`), and login, IP, device, contact and security files, unless the maintainer scopes that exact file. |
| Never-edit surfaces | Real exports. They stay read-only: never modified, moved, renamed or deleted by an agent. Signed-in browser profiles outside a disposable copy. |
| Required proof after workflow-only work | The `[PROTECTED_BOUNDARY]` block below, backed by `git status` and, once it exists, a passing data guard. |

---

## Hard Laws

1. Workflow-only and ordinary product tasks read and edit workflow-safe paths only.
2. A protected path needs explicit maintainer scope before any read, parse, summary, index or analysis. A broad audit, a cleanup pass, a failing test or a format question is not that scope.
3. Content from a real export never enters a tracked file, test fixture, issue, pull request, commit message, log line, screenshot or prompt to a remote model. The one exception is the maintainer's own classification run in the allowed task types, which sends item text only to the endpoint he named. A finding from a real export is reproduced as generated data under `fixtures/synthetic/`.
4. Protected work reports aggregate counts or key-path and type structure without values, the same shape the `structure` command produces.
5. If a task needs protected content that was not scoped, stop and ask for a narrower boundary.
6. Completion of a workflow-only task includes proof that no protected path was touched.

---

## Required Behaviors

### During workflow-only or product work

- Stay inside the workflow-safe paths.
- Use generated fixtures for every test, demo and screenshot.
- Before a spike starts a program against a signed-in browser profile, list what the run can change in that profile, and read it back afterwards.

### During scoped protected work

- Read the minimum files the scoped purpose needs.
- Run against a working copy outside the repository, never against the original export.
- Keep results to counts and structure, and record which protected paths were read.

### Before completion

Workflow-only work:

```md
[PROTECTED_BOUNDARY]
- protected paths read: none
- protected paths changed: none
- workflow-safe paths changed: <list>
- proof method: git status, plus the data guard once it exists
```

Scoped protected work:

```md
[PROTECTED_BOUNDARY]
- explicit scope: <maintainer's scoped task>
- protected paths read: <list>
- protected paths changed: none
- export content copied into tracked files: none
- proof method: <method>
```

---

## Non-Goals

This rule does not write the product's privacy policy, authorize protected analysis on its own, or replace the data guard. The data guard catches mistakes mechanically; this rule keeps agents from making them.

---

## Failure Rule

If any task reads, summarizes, indexes, edits or copies real export content without explicit scope, or if export content reaches a tracked file, a public artifact, or any remote model other than the endpoint the maintainer named for his own classification run, this rule has failed, whatever the task produced.

# `.kilo`: SocialPrune workflow shell

This folder is the Kilo workflow shell the maintainer uses to build SocialPrune with AI agents. It holds the rules, agent modes and skills those sessions follow. Contributors who use other tools can ignore it, because `AGENTS.md` in the repository root carries everything a contributor or agent needs.

The shell was set up on 2026-10-06 from the maintainer's workflow template and then adapted to this repository. `.kilo/WORKFLOW_BIBLE.md` explains every active surface, the local adaptations and, for each surface left out, why and what would bring it in.

## What loads when

| Surface | Path | Loaded |
|---|---|---|
| Rules (16) | `.kilo/rules/` | every Kilo session, through the `instructions` entry in `kilo.jsonc` |
| Agents (7) | `.kilo/agents/` | as Kilo modes; `workflow-orchestrator` is the default entry, the other six run as subagents |
| Skills (22) | `.kilo/skills/` | on demand, when a task matches a skill's description |
| Repository summary | `AGENTS.md` | every session |
| Lessons | `docs/LESSONS_ARCHIVE.md` | before non-trivial work |
| Backlog | `docs/BACKLOG.md` | when work is deferred |

A rule added to `.kilo/rules/` reaches a fresh Kilo instance, not one that is already running. Kilo 7.8.3 discovered all 16 rules, 7 agents and 22 skills on a disposable copy of this shell on 2026-10-06.

## Local adaptations

- `rules/protected-surface-boundary.md` is active, with its activation contract filled for real social media exports.
- `rules/governance-protection.md` names this repository's concrete governance files.
- `skills/workflow-routing/SKILL.md` no longer points at the template library, which is not part of this repository.
- `skills/overnight-run` was activated unchanged. `skills/adr-creation`, `skills/strategic-compact`, `skills/workflow-implementation` and `skills/workflow-validation` were activated with local adaptations, each named in the skill itself.
- `AGENTS.md`, `kilo.jsonc`, `docs/LESSONS_ARCHIVE.md`, `docs/BACKLOG.md` and both files in this folder were written for SocialPrune.

Every other agent, rule and skill matches the template copy byte for byte.

## Local-only files

`.kilo/.gitignore` keeps these out of Git:

- `skills/human-writing/OPERATOR_VOICE.local.md`, the maintainer's voice samples, which the `human-writing` skill reads when present,
- `package.json`, `package-lock.json` and `node_modules/`, which Kilo writes on startup to install its plugin package,
- `plans/`, the drafts Kilo's plan mode writes, because they draw on the private `PLAN.md`,
- wake-plugin state.

## Changing the shell

These files are governance surfaces (`rules/governance-protection.md`). They change only when the maintainer asks for that exact change. New lessons go to `docs/LESSONS_ARCHIVE.md`, and each shell change gets a line in the changelog at the end of `.kilo/WORKFLOW_BIBLE.md`.

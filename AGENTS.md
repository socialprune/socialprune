# AGENTS.md: SocialPrune

SocialPrune helps people review and clean up their old posts and comments on X and Instagram. It reads the platform's official data export, flags risky or pointless items with rules and an optional local AI model, explains each flag in one sentence, and lets a person decide what goes. The final delete click always happens on the platform, by that person.

**Status on 2026-10-06.** Repository, license and Kilo workflow shell are set up. There is no product code yet. Phase 1 builds the foundation: monorepo, JSON schemas, a synthetic fixture generator, both export parsers, streaming ZIP import, the data guard and CI.

The maintainer's working plan is `PLAN.md` in the repository root. It is written in German, kept out of Git on purpose, and exists only on the maintainer's machine. When it is present, read it before planning work. It holds the decisions, phases, gates and spikes.

## Hard constraints

These hold in every phase. Changing one takes an explicit decision by the maintainer.

1. **Nothing costs money.** No paid API, no hosting beyond GitHub Pages, no code-signing certificate, no store fee, and no paid fallback hidden inside a dependency.
2. **Local first.** Export content stays on the user's device. It leaves only when the user deliberately sets up their own model endpoint or lets an agent label items, and the UI says so at that point. Never read API keys from environment variables or from other tools' config files, because any key that happens to be present would silently arm a paid path. A key comes only from a file the user names explicitly.
3. **A person decides.** Rules, models and agents only suggest. An item is marked for deletion only by a human action in the review UI. The CLI and the MCP server have no approve command, and every decision records its source.
4. **Nothing acts on the platform.** No code clicks, scrolls, types or sends requests on X or Instagram. Optional helpers may only read the page and highlight items. A program started against a real browser profile can change that profile on its own, so before a spike runs one, list what the run can change and read it back afterwards.
5. **No safety promises.** Never write "safe", "undetectable", "bypass", "guaranteed" or "deletes everything" in the app, the docs or launch posts. "Official" describes platform exports and platform features only, never this tool.
6. **No real data in the repository.** Tests, demos and screenshots use generated data from `fixtures/synthetic/`. Real exports, including the maintainer's own, are protected surfaces under `.kilo/rules/protected-surface-boundary.md`.

## Planned layout

Nothing below exists yet. Phase 1 creates it.

| Path | Purpose |
|---|---|
| `apps/web` | static PWA on GitHub Pages with export guide, demo, review UI and exports |
| `apps/cli` | `npx socialprune` for people and agents |
| `packages/core` | data model, JSON schemas, pipeline, storage adapter |
| `packages/adapter-x`, `packages/adapter-instagram` | detect an export, parse it into items, describe the click-list steps |
| `packages/classify` | rules, the local model backend, user-configured endpoints |
| `packages/mcp` | MCP server, from 0.2 on |
| `fixtures/synthetic` | generated test data, never real |
| `tools/` | fixture generator and data guard |
| `skills/socialprune/SKILL.md` | Agent Skill for people who run SocialPrune through their own agent |

A new platform is a new adapter package and must not need changes in `packages/core`.

The planned stack is TypeScript, pnpm workspaces, Vite with React, TanStack Virtual, zip.js in a web worker, idb, vite-plugin-pwa, Vitest, Playwright against our own app only, and GitHub Actions. It can still change before Phase 1 starts.

## Commands

None yet. When Phase 1 adds the workspace, list the exact install, build, test, lint and data-guard commands here.

## Proof this project relies on

- Parsers are tested against generated fixtures for every known export variant.
- A Playwright test records every browser network request while demo data is imported and classified, and fails on any request that leaves the app's origin. It observes real requests and never stubs `fetch`, because a stub would only test itself.
- A data guard in pre-commit and CI blocks ZIP files and files with export signatures (`window.YTD.`, `string_map_data`, `media_owner`) outside `fixtures/synthetic/`.
- No classifier tier becomes a default before it is measured on a synthetic set whose expected labels the maintainer set by hand before any tier saw it. A large reference model runs alongside the tiers as one more measured candidate, not as ground truth.

## Reusing other projects

Prior art and what to take from it is in `PLAN.md`, section 4. GPL-3.0 projects (Cyd, DeleteX, twitter-archive-parser), tweetXer with its "Do No Harm" license, and repositories without a license are sources of ideas only, never of code. MIT and Apache-2.0 code may be reused with an entry in `THIRD_PARTY_NOTICES`. Before adding a dependency, check its license and maintenance, and pin its version.

## Writing

- Launch posts, Hacker News comments and awesome-list entries are written by the maintainer personally, because those venues reject generated text. Agents may draft the README and docs.
- No AI, model or tool attribution in commits, issues, pull requests or release notes.
- The UI ships in German and English from 0.1 on. README and code comments are in English.
- Every human-facing text follows `.kilo/rules/human-writing-style.md`.

## Outside submissions

Before posting to Hacker News or Reddit, submitting to an awesome list or the MCP Registry, or opening a pull request in another repository, read that venue's current written rules and follow every pointer between them: guidelines, sidebar rules, `CONTRIBUTING.md`, templates. An earlier accepted entry is a precedent, not the rule. The planned launch sequence is in `PLAN.md`, section 12.

## Kilo workflow shell

The maintainer develops with Kilo. Contributors who use other tools can ignore `.kilo/`, because this file holds everything they need.

| Surface | Location | Loaded |
|---|---|---|
| this file | `AGENTS.md` | every session |
| rules | `.kilo/rules/` | every Kilo session, through `kilo.jsonc` |
| agents | `.kilo/agents/` | as Kilo modes, with `workflow-orchestrator` as the entry |
| skills | `.kilo/skills/` | on demand |
| shell guide | `.kilo/README.md`, `.kilo/WORKFLOW_BIBLE.md` | when the shell changes |
| lessons | `docs/LESSONS_ARCHIVE.md` | before non-trivial work |
| backlog | `docs/BACKLOG.md` | when work is deferred |

Governance surfaces change only on the maintainer's explicit request. They are `AGENTS.md`, `.kilo/**`, `kilo.jsonc`, `LICENSE`, the data-protection entries in `.gitignore`, and the lessons archive (`.kilo/rules/governance-protection.md`). The exception is this file's factual sections, Status, Planned layout, Commands and Proof, which follow the code a task changed.

Agent Manager sessions need the maintainer's explicit request. [registered-session-lifecycle](.kilo/rules/registered-session-lifecycle.md) holds the parent and child duties, and [session-steering](.kilo/skills/session-steering/SKILL.md) holds the procedure. This repository ships no wake plugin. The maintainer's global Kilo config carries one, and a full parent-child roundtrip has not been proven here yet (`docs/BACKLOG.md`, BL-001).

## Delivery

- Commit and push only when the maintainer asks, and stage exact task-owned paths.
- Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, with an optional scope such as `feat(adapter-x):`), so release notes can be generated later.
- Before the first push, confirm that no real export, `PLAN.md` or secret is tracked, with `git ls-files` and, once it exists, the data guard.
- A closure report names implementation, validation, commit and push separately.

## Permissions

Permissions are allow-by-default and `read: allow` is normal. The hard limits are `.env*`, `**/secrets/**`, `**/credentials/**`, real exports, and generated output such as `**/node_modules/**`, `dist/`, `build/` and `coverage/`.

## Decisions

After analyzing alternatives, pick the recommended option, record why, and continue. Escalate only when options are genuinely equal or a choice touches a hard constraint.

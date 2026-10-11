# AGENTS.md: SocialPrune

SocialPrune helps people review and clean up their old posts and comments on X and Instagram. It reads the platform's official data export, flags risky or pointless items with rules and an optional local AI model, explains each flag in one sentence, and lets a person decide what goes. The final delete click always happens on the platform, by that person.

**Status on 2026-10-06.** Phase 1 is built: workspace, data guard and CI, the core data model with JSON schemas, a synthetic fixture generator, the X and Instagram parsers, streaming ZIP import in a web worker, and the `structure` command. Gate G1 is met: the evidence is in `docs/evidence/G1.md`, and an independent review accepted it at commit `feb6748`. Spikes S1 and S3 are recorded in `docs/spikes/`. Spike S2 has its unlabelled evaluation set and harness and waits for the maintainer's labels.

**Phase 2, status on 2026-10-08.** The architecture is in `docs/architecture/` and `docs/design/`: 22 decision records, all `Accepted` by the maintainer on 2026-10-09. Built so far: the workspace v2 model with its store port, review, label and click-list services, queries and streaming backup in `packages/core`; the offline web shell with its policy layers and worker gate, and the workspace worker on IndexedDB in `apps/web`; a card review that shows one entry at a time like a post, with the suggestion, big keep, delete and later buttons, keys and one-click "apply suggestions", and the review grid as its list view with detail view, single and bulk decisions, undo and history, and an account, filter, sort and search that the workspace keeps across a restart; the click lists with a delete mode that opens one entry at a time on the platform for the person to delete; a private archive in a timeline layout with own threads joined, replies marked, entries the person deleted on the platform badged, year jump, search and a recap of counts; the backup and settings screens, the demo with bundled example data, and the export guide with a calendar reminder; the local-review build of the web app (`dist-review/`, no service worker, reached only after a session exchange with the review server); the CLI on Stricli with one JSON envelope per call, its SQLite workspace with `import`, `summary`, `backup export`, `backup restore` and `export clicklist`, `guide`, `review`, the local review server on 127.0.0.1 that hands the browser a one-use token and records decisions only from the page, and the agent commands `batch next` and `labels submit`, which share entry text only with `--share-with-agent` and record suggestions, never decisions, and `labels submit` warns with a count when suggestions at risk 2 or 3 carry no quote; the Agent Skill in `skills/socialprune/` with `docs/agent-setup.md`, which asks the agent to read each entry it rates at risk 2 or 3 and to quote it; and the demo export under `fixtures/synthetic/demo/`. The guide data lives in each adapter's `./guide` export. Its facts come from the public help pages, every one is still unchecked by a person, and the Instagram steps are missing because those pages could not be read, so the release build refuses them. Measurements are in `docs/evidence/phase2-measurements.md`. A browser test drives the local review against the real server in three engines, with a recorder in place of the browser opener, so opening the browser on Windows is proven only up to the PowerShell call. No real agent has run the skill yet (Gate G2), the npm package is not published, and nothing is deployed, so nothing is usable for end users.

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

Phase 1 has built `packages/core`, both adapters, `tools/`, `fixtures/synthetic/` (generated X and Instagram variants, plus the hand-written S2 evaluation set under `classify/`), the `structure` command in `apps/cli` and the worker import in `apps/web`. Phase 2 has added the review UI and `skills/socialprune/`. `packages/classify` and `packages/mcp` come later.

| Path | Purpose |
|---|---|
| `apps/web` | static PWA on GitHub Pages with export guide, demo, review UI and exports |
| `apps/cli` | `npx socialprune` for people and agents |
| `packages/core` | data model, JSON schemas, pipeline, storage adapter |
| `packages/adapter-x`, `packages/adapter-instagram` | detect an export, parse it into items, describe the click-list steps |
| `packages/classify` | rules, the local model backend, user-configured endpoints |
| `packages/mcp` | MCP server, from 0.2 on |
| `fixtures/synthetic` | generated test data, never real |
| `tools/` | fixture generator, data guard, copy check, license check, and the tests of the project's lint restrictions |
| `skills/socialprune/SKILL.md` | Agent Skill for people who run SocialPrune through their own agent |
| `docs/architecture`, `docs/design` | the architecture map, the decision records and their evidence; the design specification of the web app |

A new platform is a new adapter package and must not need changes in `packages/core`.

The stack is TypeScript, pnpm workspaces, Vite with React, zod for schemas, zip.js in a web worker (its native entry in the browser, without WASM), IndexedDB through idb, an app-owned service worker for the offline shell, Base UI and CSS Modules for components and styles, TanStack Virtual for the review grid, Lucide for icons, React Intl for the German and English catalogs, Stricli for the CLI with `node:sqlite` for its workspace and Rolldown for its npm bundle, Vitest, Playwright against our own app only, and GitHub Actions. Every dependency is pinned to an exact version, and `pnpm licenses:check` admits only the licenses that `docs/architecture/adrs/ADR-002-dependency-licenses.md` lists.

Packages run as TypeScript source through Node 24 type stripping, without a build step. Relative imports carry the `.ts` extension, and workspace packages export `./src/index.ts`. `tsc` is TypeScript 7. typescript-eslint still needs the TypeScript 6 API, so the `typescript` package name is an alias for `@typescript/typescript6`. Vite 8 declares Lightning CSS (MPL-2.0) as a dependency; a pnpm override removes it, and CSS goes through PostCSS and esbuild instead.

## Commands

Node 24.15 or newer and pnpm 10.33.0 (`packageManager` in `package.json`). On older Node 24, install, build and the web tests still work, but the CLI workspace commands and their tests stop with `NODE_TOO_OLD`, so `pnpm test` fails there (ADR-015).

| Task | Command |
|---|---|
| install, also installs the pre-commit data guard | `pnpm install` |
| install as in CI | `pnpm install --frozen-lockfile` |
| data guard over all tracked files | `pnpm guard` |
| data guard over staged files, as in pre-commit | `pnpm guard:staged` |
| format check, format write | `pnpm format:check`, `pnpm format` |
| lint | `pnpm lint` |
| typecheck | `pnpm typecheck` |
| unit tests | `pnpm test` |
| build | `pnpm build` |
| synthetic fixtures, regenerate and drift check, optionally one platform | `pnpm fixtures:generate`, `pnpm fixtures:check`, add `--platform x` or `--platform instagram` |
| large synthetic archive | `pnpm fixtures:large --platform x --count 100000 --out <file.zip> [--seed <n>] [--zip64]` |
| demo export under `fixtures/synthetic/demo/`, regenerate; `fixtures:check` also checks it for drift | `pnpm fixtures:demo` |
| JSON schemas, regenerate and drift check | `pnpm schemas:generate`, `pnpm schemas:check` |
| German and English message catalogs: same IDs and arguments in both, and no drift in their generated types; regenerate the types | `pnpm i18n:check`, `pnpm i18n:generate` |
| words hard constraint 5 rules out, in the catalogs, CLI messages, guide data, skill, READMEs and `docs/` | `pnpm copy:check` |
| dependency licenses against the list in ADR-002 | `pnpm licenses:check` |
| export guide facts: shape, sources and dates; with `--release`, also that a person checked every fact within the given number of days, as the release build requires | `pnpm guide:check`, `pnpm guide:check --max-age 120 --release` |
| export steps in the terminal, from the same guide data | `pnpm -s socialprune guide <x or instagram> [--lang de] [--json]` |
| browser tests in Chromium (once before: `pnpm --filter @socialprune/web exec playwright install chromium`) | `pnpm test:e2e` |
| screenshots of the card review, delete mode, archive and recap on the demo, into the system temp folder `socialprune-screens` | `pnpm --filter @socialprune/web exec playwright test --config playwright.prototype.config.ts` |
| local-review build of the web app into `apps/web/dist-review/`, and its build check | `pnpm --filter @socialprune/web build:review`, `pnpm --filter @socialprune/web build:review:check` |
| browser tests in Chromium, Firefox and WebKit with the CSP positive controls, the production build check and the local-review build with its session-denial tests, as CI runs them (once before: `pnpm --filter @socialprune/web exec playwright install chromium firefox webkit`) | `pnpm test:e2e:all` |
| browser test of the local review against the real review server in Chromium, Firefox and WebKit; it builds `dist-review` first | `pnpm --filter socialprune test:e2e` |
| npm package of the CLI into `apps/cli/dist/package/`, its file-list check, and an offline install of the packed tarball that runs every command; nothing is published | `pnpm --filter socialprune build:release`, `pnpm --filter socialprune pack:check`, `pnpm --filter socialprune smoke:package`; the first two also as `pnpm build:cli`, `pnpm pack:cli` |
| other test server ports, when 4180, 4181 or 4183 are taken (the offline tests also use 4182) | set `SP_E2E_PORT`, `SP_E2E_PROBE_PORT`, `SP_E2E_DEV_PORT` |
| Gate G1 measurements through the workspace import path into IndexedDB (100,000 tweets three times, ZIP64 over 4 GiB, abort halfway), Windows only, writes about 4.7 GB to temp and removes it, one JSON document on stdout | `pnpm -s measure:g1` |
| CLI | `pnpm socialprune --help` |
| key paths and types of an export, without values (`-s` stops pnpm from printing the command line, which contains the path) | `pnpm -s socialprune structure <zip or folder...> [--json]` |
| import exports into a local workspace folder, then count its items and decisions; writers take `--dry-run` | `pnpm -s socialprune import <zip or folder...> --workspace <dir>`, `pnpm -s socialprune summary --workspace <dir>` |
| portable JSON backup of a workspace, and restore into a workspace | `pnpm -s socialprune backup export --workspace <dir> --out <file.json>`, `pnpm -s socialprune backup restore <file.json> --workspace <dir>` |
| agent commands: the next entries for labelling, after the person agreed to share their text, and a label file of suggestions; `labels submit` takes `--dry-run` | `pnpm -s socialprune batch next --workspace <dir> --share-with-agent --json`, `pnpm -s socialprune labels submit <file.json> --workspace <dir> --json` |
| review a workspace in the browser through the local review server; build `dist-review` first; `--dry-run` binds nothing | `pnpm --filter @socialprune/web build:review`, then `pnpm -s socialprune review --workspace <dir>` |
| click list of the decisions a person made in review, as CSV or JSON, with calendar days in `--time-zone`, else the workspace setting, else the system zone | `pnpm -s socialprune export clicklist --workspace <dir> --account <key> --format csv --out <file>` |

CI (`.github/workflows/ci.yml`) runs five jobs on every push to `main` and every pull request: checks (install, guard, license check, copy check, catalog check, format check, lint, typecheck, unit tests, fixture check, schema check, guide check, build), cli-node-floor (the CLI tests on exactly Node 24.15.0), e2e (`pnpm test:e2e:all` in Chromium, Firefox and WebKit), review-e2e (`pnpm --filter socialprune test:e2e`) and cli-package (the release build, the pack check and the packed-install smoke test on Node 24 and 24.15.0). `.github/workflows/release-cli.yml` runs only when started by hand, and its publish job stays off until the repository variable `NPM_PUBLISH_ENABLED` is `true`. `.github/workflows/pages.yml` also runs only by hand; it deploys only with its `publish` input set, on `main`, and with the repository variable `PAGES_ENABLED` set to `true`. Both refuse to build while any export guide fact is unchecked. Prettier skips Markdown, so prose keeps its exact wording.

Run one package with `pnpm exec vitest run --project <name>`, where the name is the folder name (`core`, `adapter-x`, `adapter-instagram`, `web`, `cli`, `fixture-gen`, `data-guard`, `copy-check`, `licenses-check`, `lint-rules`).

Spikes under `spikes/` are standalone pnpm projects with their own lockfile, outside the workspace and outside CI. Each one documents how to rerun it in `docs/spikes/`.

## Proof this project relies on

- Parsers are tested against generated fixtures for every known export variant, loaded as folders and as ZIPs.
- Expected values and forbidden lists in these tests come from the fixture data, never from the code under test (lesson LL-2026-10-002).
- A Playwright test records every browser network request during the app's flows and fails on any request that leaves the app's origin. It observes real requests and never stubs `fetch`, because a stub would only test itself. Today it covers the import of every fixture whose format is recognised, the demo with its example suggestions, bulk decisions, undo, both click lists, backup and restore, and the guide, and a control test proves it fails on a request to a second origin. Classification joins it once `packages/classify` exists.
- Archive content is parsed as data and never executed. The X `injection` fixture is imported in unit tests and in the browser, and both check that its code did not run.
- `structure` is tested against every fixture, run on the export folder, on the fixture folder around it and on the whole platform folder: no handle, account key or export folder name may appear in its report, and in the export folder's report no leaf value either. A browser's ` (1)` suffix on an export folder or ZIP is recognised. A third-party handle used as an ordinary key in an unknown file is not detected, and neither is an export folder renamed beyond the export pattern (BL-004). So the CLI asks people, in its human-readable output and in `--help`, to check a report before they share it.
- The web app's policies are tested in Chromium, Firefox and WebKit, and positive controls prove that a planted violation is caught. A first visit claims the service worker before anything reads an export, and with registration blocked the file input stays absent. The production build check fails on any WebAssembly in the bundle.
- A restart test closes and reopens a browser profile and finds the decisions, the history and the review's account, filter, sort and search where the person left them. Backups move between the browser and the CLI in both directions: a CLI backup restores in the browser with its items, assessments and submission, and a browser backup with a person's decision and review view restores in the CLI.
- The local review server is tested over real sockets against the wire status table, hostile Host and Origin values, foreign-origin pages in three browsers and a localhost Host, and none of the rejected requests changes the workspace. The one-use token is checked in every output stream, and on Linux under a real pseudo-terminal.
- The packed CLI package is installed offline into an empty folder in CI, on Node 24 and 24.15.0, and every command runs through the installed entry.
- A data guard in pre-commit and CI blocks ZIP files and files with export signatures (an X `window.YTD.<name>.part<n> =` assignment, or the JSON keys `string_map_data`, `string_list_data` and `media_owner`) outside `fixtures/synthetic/`.
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
- Read the remote's last CI result in its own step before every push and stop on red; a local gate proves only the platform it ran on and only the steps it ran (LL-2026-10-004).
- A closure report names implementation, validation, commit and push separately.

## Permissions

Permissions are allow-by-default and `read: allow` is normal. The hard limits are `.env*`, `**/secrets/**`, `**/credentials/**`, real exports, and generated output such as `**/node_modules/**`, `dist/`, `build/` and `coverage/`.

## Decisions

After analyzing alternatives, pick the recommended option, record why, and continue. Escalate only when options are genuinely equal or a choice touches a hard constraint.

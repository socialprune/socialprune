# Architecture decision records

Each record states one decision, the options it was weighed against, the evidence that decided it and what it costs. [ADR-001](ADR-001-decision-records.md) sets the format and the rule for changing a record: once accepted, a record changes through a new record that supersedes it in full or in part. The partial form was approved on 2026-10-24 (card ADR-TEIL v1 A); the old record keeps its status and gains one line per changed rule. Shared measurement tables are in [evidence-2026-10.md](../evidence-2026-10.md). The overview of how the pieces fit is in [docs/architecture/README.md](../README.md).

The maintainer accepted records 001 to 022 on 2026-10-09, so their status is `Accepted` and `Approved on` carries that date. The last column states the choices he made where a record left one to him. A record that was corrected before acceptance lists each correction under "Changes before acceptance". Records 023, 026, 027 and 029 follow his change of hard constraint 4 on 2026-10-11. He accepted 023, 026 and 029 on 2026-10-24 at 19:28:04Z (cards ADR-023 v1 A, ADR-026 v1 A and ADR-029 v1 A); only 027 remains `Proposed`. He accepted 028, 030 and 031 on 2026-10-16, and 032 on 2026-10-20.

| ADR | Title | Status | Date | Decided by the maintainer |
|---|---|---|---|---|
| [001](ADR-001-decision-records.md) | Decision records and supersession | Accepted | 2026-10-06 | on 2026-10-24 at 19:28:04Z (ADR-TEIL v1 A): partial supersession keeps the old status and adds one line per changed rule |
| [002](ADR-002-dependency-licenses.md) | Dependency license policy | Accepted | 2026-10-06 | |
| [003](ADR-003-offline-app-shell.md) | Offline app shell and update flow | Accepted | 2026-10-06 | own service worker instead of vite-plugin-pwa |
| [004](ADR-004-content-security-policy.md) | Content Security Policy layers, Trusted Types and the worker gate | Accepted | 2026-10-06 | hard service-worker gate: no real browser import without one, the CLI instead, no override |
| [005](ADR-005-browser-storage.md) | Browser storage engine and persistence | Accepted | 2026-10-06 | IndexedDB as the only store of record, OPFS only as backup scratch space |
| [006](ADR-006-workspace-event-log.md) | Workspace model, decision event log, schema version 2 and portable backup | Accepted | 2026-10-06 | |
| [007](ADR-007-review-data-worker.md) | Review data in a workspace worker, its protocol, queries and search | Accepted | 2026-10-06 | |
| [008](ADR-008-review-ui-primitives.md) | UI primitives, review grid, keyboard model and accessibility checks | Accepted | 2026-10-06 | |
| [009](ADR-009-navigation.md) | Navigation with hash routes | Accepted | 2026-10-06 | |
| [010](ADR-010-styling-tokens.md) | Styling with CSS Modules, cascade layers and design tokens | Accepted | 2026-10-06 | |
| [011](ADR-011-internationalization.md) | Internationalization with React Intl and checked catalogs | Accepted | 2026-10-06 | |
| [012](ADR-012-time-zone-grouping.md) | Day grouping in an explicit time zone | Accepted | 2026-10-06 | |
| [013](ADR-013-cli-framework-output.md) | CLI framework, command tree and machine output contract | Accepted | 2026-10-06 | |
| [014](ADR-014-agent-interface.md) | Agent interface, Agent Skill and the MCP path | Accepted | 2026-10-06 | `--share-with-agent` with the stderr notice is the consent point; the agent asks the person before the first batch |
| [015](ADR-015-cli-storage-node-baseline.md) | CLI workspace storage on node:sqlite and the Node baseline | Accepted | 2026-10-06 | Node floor 24.15.0; a SQLite workspace with the JSON document as its backup |
| [016](ADR-016-local-review-server.md) | Local review server and session token handling | Accepted | 2026-10-06 | the remaining token exposure is accepted; the skill still forbids `--no-open` |
| [017](ADR-017-shared-workspace-service.md) | Package boundaries and the shared workspace service | Accepted | 2026-10-06 | |
| [018](ADR-018-cli-distribution.md) | CLI release bundle and npm package contents | Accepted | 2026-10-06 | |
| [019](ADR-019-pages-deployment.md) | GitHub Pages deployment kept manual | Accepted | 2026-10-06 | |
| [020](ADR-020-demo-suggestions.md) | Demo data and honest example suggestions | Accepted | 2026-10-06 | |
| [021](ADR-021-archive-media.md) | Archive media is not shown in Phase 2 | Accepted | 2026-10-06 | |
| [022](ADR-022-export-guide-content.md) | Export guide content as verified, dated data | Accepted | 2026-10-06 | agents prepare the guide facts from the public help pages; the maintainer checks each one before a release |
| [023](ADR-023-acting-in-own-account.md) | The tool acts in the person's own account, on the person's order | Accepted | 2026-10-11 | on 2026-10-11: hard constraint 4 changes; fetch originals and delete through a signed-in session; no paid API. Accepted on 2026-10-24 at 19:28:04Z (ADR-023 v1 A), including PA-1 to PA-16 and the hand-signed-in dedicated profile in a folder the person names; open question 2 answered by ADR-TEIL v1 A |
| 024 | not in the repository | | | a draft for deleting through X's paid developer API, rejected by the maintainer on 2026-10-11 because it can cost money; the number is not reused |
| 025 | reserved | | | a draft "the review session survives a reload", kept outside the repository until the maintainer decides on it; it would supersede ADR-016 |
| [026](ADR-026-x-originals-fetch.md) | Fetching the originals of the person's replies and quotes on X | Accepted | 2026-10-11 | on 2026-10-11: fetch the originals; accepted as written on 2026-10-24 at 19:28:04Z (ADR-026 v1 A) |
| [027](ADR-027-x-deletion-browser.md) | Deleting the person's own X entries through their signed-in browser session | Proposed | 2026-10-11 | on 2026-10-11: automated deletion on X, account risk accepted |
| [028](ADR-028-instagram-signed-in-session.md) | Instagram: reading the post of each comment through the person's signed-in session (revised 2026-10-15; until then "context and deletion") | Accepted | 2026-10-16 | on 2026-10-11: read context and delete through his signed-in session; gated by spike S5. On 2026-10-14 (IG-1, IG-2 B) and 2026-10-15 (IG-3): find in the list, confirm on the post; keep the post's context; deletion later in its own record. On 2026-10-16 (IG-4): accepted, profile adopted, the agent may accept the canary by its automatic checks, pace as a ramp from 30 s and 200 a day to 10 s and 600, comments without an owner by three checks |
| [029](ADR-029-signed-in-originals-pass.md) | The signed-in originals pass on X | Accepted | 2026-10-11 | on 2026-10-11: the originals as complete as possible, signing in is accepted; what works without a login stays anonymous; accepted as written on 2026-10-24 at 19:28:04Z (ADR-029 v1 A) |
| [030](ADR-030-instagram-context-record.md) | Instagram post context as its own workspace record | Accepted | 2026-10-16 | on 2026-10-15 (IG-3 point 2): what is kept per confirmed comment; accepted on 2026-10-16 (IG-4), workspace version 5 with a copy first |
| [031](ADR-031-desktop-app.md) | A Windows desktop app around the review and the engine | Accepted | 2026-10-16 | on 2026-10-16 (DESK-1): Electron, the platform in the installed browser beside the app, Microsoft Store first with a Partner Center account in his name, the GitHub download unsigned until SignPath Foundation accepts, his SignPath application after the first release |
| [032](ADR-032-review-feed.md) | The review feed with criteria, keep rules and one final mark | Accepted | 2026-10-20 | on 2026-10-20: a feed that scrolls like X with tabs, criteria he ticks one by one and his own criteria, keep rules the program checks on the export's numbers, one counted final mark; new workspaces start with nothing ticked, politically incorrect is its own category, S2 gains 160 invented items he reads first, entries set to Later are marked only one by one |
| [033](ADR-033-suggestion-sources.md) | Suggestion sources, the person's own endpoint and their subscriptions | Accepted | 2026-10-21 | on 2026-10-21: an endpoint tier that `scan` runs, for his own runs his CCS proxy with the model he picks per run; entries go in batches whose size a measurement sets; the first run stops after 50 entries; a risk 2 or 3 answer needs an exact quote; a key only from a file the person names; no own ChatGPT sign-in for now |
| [034](ADR-034-criteria-selection-cap.md) | The cap on ticked criteria | Accepted | 2026-10-21 | on 2026-10-21: up to 32 ticked criteria, without harmless and unclear, so every earlier selection survives the migration |

## Earlier choices these records replace

Before Phase 1, the project chose some technologies by default and made some storage decisions. Three of these records change one of them, and each replacement took effect when the maintainer accepted the record:

- [ADR-003](ADR-003-offline-app-shell.md) replaces the earlier technology default vite-plugin-pwa with an app-owned service worker. This is the only technology default that a Phase 2 record replaces.
- [ADR-005](ADR-005-browser-storage.md) changes the earlier storage decision for the browser: IndexedDB becomes the only store of record, and OPFS becomes scratch space for writing backups. It keeps the earlier default idb.
- [ADR-015](ADR-015-cli-storage-node-baseline.md) changes the earlier storage decision for the CLI: the working state becomes a SQLite database in the workspace folder, and the versioned JSON document stays as the portable backup.

[ADR-008](ADR-008-review-ui-primitives.md) keeps the earlier default TanStack Virtual. The rest of the stack in `AGENTS.md` (TypeScript, pnpm workspaces, Vite with React, zod, zip.js in a web worker, Vitest, Playwright, GitHub Actions) stays as it is.

## Adding a record

Copy the shape of an existing record, take the next free number, and set the status to `Proposed` and `Approved on` to `pending`. The record becomes `Accepted`, with the approval date, when the maintainer approves it after an independent review. Records are governance surfaces under `.kilo/rules/governance-protection.md`.

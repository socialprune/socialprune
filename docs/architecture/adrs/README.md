# Architecture decision records

Each record states one decision, the options it was weighed against, the evidence that decided it and what it costs. [ADR-001](ADR-001-decision-records.md) sets the format and the rule for changing a record: once accepted, a record changes only through a new record that supersedes it. Shared measurement tables are in [evidence-2026-10.md](../evidence-2026-10.md). The overview of how the pieces fit is in [docs/architecture/README.md](../README.md).

The maintainer accepted all records below on 2026-10-09, so their status is `Accepted` and `Approved on` carries that date. The last column states the choices he made on 2026-10-08 where a record left one to him. A record that was corrected before acceptance lists each correction under "Changes before acceptance".

| ADR | Title | Status | Date | Decided by the maintainer on 2026-10-08 |
|---|---|---|---|---|
| [001](ADR-001-decision-records.md) | Decision records and supersession | Accepted | 2026-10-06 | |
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

## Earlier choices these records replace

Before Phase 1, the project chose some technologies by default and made some storage decisions. Three of these records change one of them, and each replacement took effect when the maintainer accepted the record:

- [ADR-003](ADR-003-offline-app-shell.md) replaces the earlier technology default vite-plugin-pwa with an app-owned service worker. This is the only technology default that a Phase 2 record replaces.
- [ADR-005](ADR-005-browser-storage.md) changes the earlier storage decision for the browser: IndexedDB becomes the only store of record, and OPFS becomes scratch space for writing backups. It keeps the earlier default idb.
- [ADR-015](ADR-015-cli-storage-node-baseline.md) changes the earlier storage decision for the CLI: the working state becomes a SQLite database in the workspace folder, and the versioned JSON document stays as the portable backup.

[ADR-008](ADR-008-review-ui-primitives.md) keeps the earlier default TanStack Virtual. The rest of the stack in `AGENTS.md` (TypeScript, pnpm workspaces, Vite with React, zod, zip.js in a web worker, Vitest, Playwright, GitHub Actions) stays as it is.

## Adding a record

Copy the shape of an existing record, take the next free number, and set the status to `Proposed` and `Approved on` to `pending`. The record becomes `Accepted`, with the approval date, when the maintainer approves it after an independent review. Records are governance surfaces under `.kilo/rules/governance-protection.md`.

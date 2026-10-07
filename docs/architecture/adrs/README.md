# Architecture decision records

Each record states one decision, the options it was weighed against, the evidence that decided it and what it costs. [ADR-001](ADR-001-decision-records.md) sets the format and the rule for changing a record: once accepted, a record changes only through a new record that supersedes it. Shared measurement tables are in [evidence-2026-10.md](../evidence-2026-10.md). The overview of how the pieces fit is in [docs/architecture/README.md](../README.md).

All records below are proposals. They wait for the independent architecture review and the maintainer's approval; until then their status is `Proposed` and `Approved on` is `pending`. The last column names the choices each record leaves to the maintainer.

| ADR | Title | Status | Date | Needs the maintainer's decision |
|---|---|---|---|---|
| [001](ADR-001-decision-records.md) | Decision records and supersession | Proposed | 2026-10-06 | |
| [002](ADR-002-dependency-licenses.md) | Dependency license policy | Proposed | 2026-10-06 | |
| [003](ADR-003-offline-app-shell.md) | Offline app shell and update flow | Proposed | 2026-10-06 | replacing the earlier default vite-plugin-pwa |
| [004](ADR-004-content-security-policy.md) | Content Security Policy layers, Trusted Types and the worker gate | Proposed | 2026-10-06 | no real import without a service worker |
| [005](ADR-005-browser-storage.md) | Browser storage engine and persistence | Proposed | 2026-10-06 | changing the earlier browser storage decision |
| [006](ADR-006-workspace-event-log.md) | Workspace model, decision event log, schema version 2 and portable backup | Proposed | 2026-10-06 | |
| [007](ADR-007-review-data-worker.md) | Review data in a workspace worker, its protocol, queries and search | Proposed | 2026-10-06 | |
| [008](ADR-008-review-ui-primitives.md) | UI primitives, review grid, keyboard model and accessibility checks | Proposed | 2026-10-06 | |
| [009](ADR-009-navigation.md) | Navigation with hash routes | Proposed | 2026-10-06 | |
| [010](ADR-010-styling-tokens.md) | Styling with CSS Modules, cascade layers and design tokens | Proposed | 2026-10-06 | |
| [011](ADR-011-internationalization.md) | Internationalization with React Intl and checked catalogs | Proposed | 2026-10-06 | |
| [012](ADR-012-time-zone-grouping.md) | Day grouping in an explicit time zone | Proposed | 2026-10-06 | |
| [013](ADR-013-cli-framework-output.md) | CLI framework, command tree and machine output contract | Proposed | 2026-10-06 | |
| [014](ADR-014-agent-interface.md) | Agent interface, Agent Skill and the MCP path | Proposed | 2026-10-06 | where the person is told that content leaves |
| [015](ADR-015-cli-storage-node-baseline.md) | CLI workspace storage on node:sqlite and the Node baseline | Proposed | 2026-10-06 | the Node floor; changing the earlier CLI storage decision |
| [016](ADR-016-local-review-server.md) | Local review server and session token handling | Proposed | 2026-10-06 | the remaining token exposure |
| [017](ADR-017-shared-workspace-service.md) | Package boundaries and the shared workspace service | Proposed | 2026-10-06 | |
| [018](ADR-018-cli-distribution.md) | CLI release bundle and npm package contents | Proposed | 2026-10-06 | |
| [019](ADR-019-pages-deployment.md) | GitHub Pages deployment kept manual | Proposed | 2026-10-06 | |
| [020](ADR-020-demo-suggestions.md) | Demo data and honest example suggestions | Proposed | 2026-10-06 | |
| [021](ADR-021-archive-media.md) | Archive media is not shown in Phase 2 | Proposed | 2026-10-06 | |
| [022](ADR-022-export-guide-content.md) | Export guide content as verified, dated data | Proposed | 2026-10-06 | who reads the platforms' help pages |

## Earlier choices these records would replace

Before Phase 1, the project chose some technologies by default and made some storage decisions. Three proposed records would change one of them. Each replacement takes effect only when the maintainer approves the record:

- [ADR-003](ADR-003-offline-app-shell.md) replaces the earlier technology default vite-plugin-pwa with an app-owned service worker. This is the only technology default that a Phase 2 record replaces.
- [ADR-005](ADR-005-browser-storage.md) changes the earlier storage decision for the browser: IndexedDB becomes the only store of record, and OPFS becomes scratch space for writing backups. It keeps the earlier default idb.
- [ADR-015](ADR-015-cli-storage-node-baseline.md) changes the earlier storage decision for the CLI: the working state becomes a SQLite database in the workspace folder, and the versioned JSON document stays as the portable backup.

[ADR-008](ADR-008-review-ui-primitives.md) keeps the earlier default TanStack Virtual. The rest of the stack in `AGENTS.md` (TypeScript, pnpm workspaces, Vite with React, zod, zip.js in a web worker, Vitest, Playwright, GitHub Actions) stays as it is.

## Adding a record

Copy the shape of an existing record, take the next free number, and set the status to `Proposed` and `Approved on` to `pending`. The record becomes `Accepted`, with the approval date, when the maintainer approves it after an independent review. Records are governance surfaces under `.kilo/rules/governance-protection.md`.

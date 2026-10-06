# Backlog: SocialPrune

> Deferred workflow and repository work, per `.kilo/rules/backlog-management.md`. Each entry says what is deferred, why it sits outside the current task, and what brings it back.

Product phases, gates and spikes live in the maintainer's `PLAN.md`. This file holds the items that fall outside those phases.

## Open

### BL-001: Prove the registered-session roundtrip here

- **Added:** 2026-10-06
- **What:** one real parent and child Agent Manager roundtrip in this repository, with registration readback, observed model identity, wake delivery, parent action and cleanup, as `.kilo/rules/registered-session-lifecycle.md` law 15 requires.
- **Why deferred:** no Agent Manager work is planned, and the bootstrap needs none.
- **Trigger:** the first time the maintainer asks for Agent Manager sessions in this repository. Until it passes, no unattended Agent Manager parent and child work runs here. A single session under `overnight-run` is not affected.

### BL-002: Public record of project decisions

- **Added:** 2026-10-06
- **What:** move the decisions contributors need, such as license, repository layout, local-first processing, no platform automation and the classifier tiers, from the private `PLAN.md` into public ADRs under `docs/architecture/adrs/`, written with the `adr-creation` skill (activated 2026-10-06).
- **Why deferred:** there is no code and no outside contributor yet, and the README is planned for Phase 4.
- **Trigger:** the start of Phase 4 or the first outside contributor, whichever comes first. A decision made during the build that changes `PLAN.md` section 3 gets its ADR right away.

### BL-003: Decide on a design skill for the web app

- **Added:** 2026-10-06
- **What:** decide whether `apps/web` gets the third-party design skill `impeccable` (pbakaus/impeccable), which another of the maintainer's repositories vendors and the maintainer's own benchmark is evaluating for UI work.
- **Why deferred:** there is no UI yet, and the benchmark result that decides its portfolio placement was still open on 2026-10-06. Vendoring it now would add 56 files, a signed binary and its own license notice without a single UI task to use them.
- **Trigger:** the start of Phase 2b (web app) or a published benchmark verdict, whichever comes first. If adopted, record it in `.kilo/WORKFLOW_BIBLE.md` section 6 and in `THIRD_PARTY_NOTICES`.

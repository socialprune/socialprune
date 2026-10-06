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

### BL-004: Third-party handles as plain keys in `structure` reports

- **Added:** 2026-10-06
- **What:** `structure` cannot recognise someone else's username when an unknown, non-private export file uses it as an ordinary JSON key and the object has 50 keys or fewer. Today it masks digit runs, keys with `@`, URLs and long keys, handles taken from archive and folder names, and it skips follower and following lists before opening them. A plain handle in an unknown file still shows up as a key name. Folder names below the top folder also stay visible when a file's own path contains no known export directory. A third gap came out of the Gate G1 review on 2026-10-06: an export folder or ZIP whose name departs from the exact export pattern, such as a browser's ` (1)` suffix or a renamed folder, is not recognised as an export name, so the user's own handle is not masked in keys (`instagram-rev_handle-2026-01-02-zz9q (1)` printed `rev_handle`). The sweep cannot catch that case, because its archive-name tokens use the same pattern as the code.
- **Why deferred:** Gate G1 asks that `structure` returns keys and types, and it does. Telling a username from an ordinary field name such as `caption` needs either a list of every known key name per export file, which only real exports can supply, or a heuristic that would also hide the field names a bug report needs. The CLI prints a notice asking people to check a report before sharing it.
- **Trigger:** two steps. Before spike S4 runs, because S4 is the first time a report from a real export leaves the maintainer's machine: let both export-name patterns accept a trailing ` (<n>)`, and add a unit test with a ` (1)` folder and ZIP whose forbidden strings are written out literally rather than derived from the pattern. During S4, when the maintainer's real exports show which files use usernames as keys: add those files to the private list or build a per-file allowlist of known key names, and reproduce the case in `fixtures/synthetic/`.

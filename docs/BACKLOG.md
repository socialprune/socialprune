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
- **Progress, 2026-10-09:** the first step is done. `0aa051b` lets both patterns accept ` (<n>)` and `(<n>)`, with or without `.zip`, and `packages/core/src/structure/duplicate-suffix.test.ts` writes its forbidden strings out literally. Still open: a third-party handle used as a plain key in an unknown file, folder names below the top folder when a path holds no known export directory, and an export folder renamed beyond the pattern. S4 has not yet been pointed at this question, so the second step stays open.

### BL-005: Return to the focused entry after a restart

- **Added:** 2026-10-08
- **What:** ADR-009 says the focused item stays in the workspace settings like the filters. Since decision D58 the review keeps its account, filters, sort and search across a restart, but it opens at the top of that list instead of at the entry the person last had focused.
- **Why deferred:** I1 acceptance invariant 2 asks for decisions, history and filters, and those survive. Jumping back to an entry needs its position in the current query result, which the workspace protocol cannot answer today, and that grid code was the source of the stale-window defect fixed in `724efa6`. The selection is deliberately not kept: a selection restored after a restart could feed a bulk action the person did not prepare in that session.
- **Trigger:** a person reports losing their place after reopening the review, or the protocol gains a request that returns an item's position in a query.

### BL-006: Linux WebKit import stall without inspector access

- **Added:** 2026-10-11
- **What:** CI run 38092157557 on `29ffb12`, attempt 1, had one import that stayed at `importing` with 0 entries for 15 seconds in Linux WebKit (`apps/web/e2e/import.spec.ts:47`, `x/malformed-tweets`). The earlier WebKit stalls were traced to Playwright evaluating code inside the import worker before its first import; this test does not do that. A Docker run of `import.spec.ts` in Linux WebKit, four times each and without retries, passed 220 of 220 on `29ffb12` and 220 of 220 on its parent `7232cb9`, and the rerun of the failed CI job passed.
- **Why deferred:** the stall did not reproduce in 440 runs, so there is nothing to diagnose or test a fix against yet, and the commit that hit it does not touch the worker, the import path or that test. Whether Safari users can hit it is unproven either way.
- **Trigger:** a second import stall in CI on a test that does not evaluate code in the worker, or a report from a person whose import stops in Safari. Then reproduce it in the Linux WebKit container with worker-side timing that does not use the inspector, and decide whether the product needs a stall detector that tells the person to retry.

### BL-007: HTML entities and hidden parts in the shown text of X originals

- **Added:** 2026-10-15
- **What:** the local review shows the stored text of some X originals with HTML entities such as `&amp;`, with the leading reply mentions and with a trailing t.co link, all of which X's own page does not show. The signed-in pass already compares the display text with entities decoded and those parts left out ([ADR-029](architecture/adrs/ADR-029-signed-in-originals-pass.md)), so only the display differs.
- **Why deferred:** the fix needs a choice between decoding at display and rewriting stored text, which would touch backups, and it changes no stored data. The originals pass uses the daily page budget now.
- **Trigger:** before the maintainer starts deciding on his X entries in the review, or a report from a person who sees the entities.
- **Partly done on 2026-10-16:** the review now decodes `&amp;`, `&lt;` and `&gt;` once, as text, for every original, and leaves out the leading mentions and a trailing media or quote link when the stored anonymous answer proves them through its display range and link lists. On the maintainer's workspace the anonymous answers count that range and the link positions on the escaped text (19 of 19 range ends and 45 of 45 link positions), which is the order the review uses. Originals read only by the signed-in pass still show their mentions and links, because that pass does not store the display range or the hidden short links. Storing them needs a field in the signed-in record, so a schema change. Trigger for that rest: the maintainer finds those parts in the way while he reviews.

### BL-008: The fill and deletion browser suites run only in the local gate

- **Added:** 2026-10-15
- **What:** `pnpm --filter socialprune test:delete` and the fill suite (`apps/cli/e2e/fill.playwright.config.ts`) drive the generated fake X in Chromium. CI runs neither, so they run only in the parent's gate on Windows, and Linux is not covered for that code.
- **Why deferred:** together they take about 20 minutes, and nothing is published yet.
- **Trigger:** before `NPM_PUBLISH_ENABLED` is set, or the first change to `apps/cli/src/browser/**` from outside the maintainer's own runs.

### BL-009: Timing failures that pass on rerun

- **Added:** 2026-10-15
- **What:** known kinds, each green in isolation and in a full rerun. Node 24.21 crashes some test workers with exit code 3221226505 (0xC0000409), seen in vitest forks (`server.test.ts`, `injection.test.ts`) and in a Playwright worker. `apps/web/e2e/review.spec.ts:230` fails on Linux Chromium in CI under load. The ordered fill tests (`order-*`) ran out of their 15 second wait for the confirmation page or their 60 second limit on a busy machine on 2026-10-15, five different cases in two runs of four repeats, none twice. On 2026-10-16 three web cases each timed out once on a visibility wait and passed on rerun: `workspace-protocol.spec.ts:37` in Chromium and `update.spec.ts:38` in WebKit on a busy Windows machine, and `demo.spec.ts:467` in WebKit on Linux in CI, where the failed job passed on its second attempt. Also on 2026-10-16 the Instagram context suite's case "manual canary window-full writes only the precise settling result" failed once on a busy machine and passed 3 of 3 alone and 101 of 101 in a full rerun; on the same day its sibling case "manual canary time writes only the precise settling result time, no record" waited 30 seconds for Continue while other lanes ran browser suites, and passed 8 of 8 three times alone and 135 of 135 in a full rerun. On 2026-10-17 a context-suite timeout left the fake Instagram bound on its port and the following cases failed with `EADDRINUSE`; the suite's cleanup now releases the port after a timeout. The same day a vitest fork running `apps/cli/src/review/server.test.ts` exited with code 2147483651, the known V8 crash of Node 24.21, while all 1,432 tests passed; the file alone and the full rerun were green. In the packaged desktop suite, `runs.spec.ts` once found two browser processes still alive right after the app closed, gone two minutes later, so the check now waits up to 15 seconds for those exact processes; and `browser.spec.ts` and the planted-node control in `controls.spec.ts` once passed their 60 second limits in a 5.7 minute full run on a loaded machine, passed 3 of 3 alone and in two traced full runs at 6.5 to 7.6 and 2.6 to 3.3 seconds, with no unbounded wait left but the utility probe reply, which now has a 30 second bound; their cause is not proven. Two unit tests ran past their limits on a busy machine that day and now carry measured limits instead: the worker case in `apps/web/src/workspace/instagram-context.test.ts`, which failed twice, and the fixture generator's CLI check, whose child run passed 20 seconds.
- **Why deferred:** no assertion failed and no case failed twice, so there is nothing to fix yet.
- **Trigger:** the same test failing twice in a row, a failure on a quiet machine, or a Node release that names the crash.

### BL-010: Small gaps seen while using the package

- **Added:** 2026-10-15
- **What:** `socialprune --version` answers `INVALID_ARGUMENTS`; `socialprune review` started without a terminal opened no browser; an error from `browser setup` was reported with the code `DELETE_FAILED`; a heading on the backup screen is indented.
- **Why deferred:** none of them blocks a run or changes data.
- **Trigger:** the next change in the same command or screen, and before the package is published.

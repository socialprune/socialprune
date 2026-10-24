# Phase 2 measurements

This file records the acceptance measurements Phase 2 has taken so far: the bulk-storage check that ADR-005 rule 7 asks for, the substring search latency that ADR-007 names as its revisit trigger, and the memory behaviour of the query projection and of restore. The implementing lanes measured them on 2026-10-07, and the import measurement in section 6 on 2026-10-08; this file only collects their numbers. Every row names the commit or source hash it belongs to.

The browser runs in sections 1 to 6 used the desktop and the Playwright 1.63.0 browsers listed in [section 1 of the architecture evidence](../architecture/evidence-2026-10.md#1-trial-environment): Chromium 153.0.8010.12, Firefox 155.0 and WebKit 26.6, which is Playwright's Windows build and not Safari on macOS or iOS. Node runs in sections 1 to 5 used Node 24.14.1. The browser runs and the Node projection run were announced on the shared board, and the other lanes held their heavy work while they ran. The restore run in section 5 was not announced, so it may have shared the machine with other lanes' tests. The machine was never isolated from the operating system's own background tasks. Each browser row is one run per engine unless it says otherwise.

## 1. Bulk storage: production path against raw IndexedDB

ADR-005 rule 7 switches the bulk path to raw requests if idb is more than 15 percent slower than a raw IndexedDB control. Both paths wrote the same 100,000 generated items in 100 transactions of 1,000 into stores with the same indexes, in the same browser run.

| Run | Engine | Production path | Raw control | Difference |
|---|---|---:|---:|---:|
| final, source `46b28b67…6869`, 04:40 UTC | Chromium | 8,091.6 ms | 8,928.3 ms | -9.37 % |
| final, source `46b28b67…6869`, 04:40 UTC | Firefox | 23,275 ms | 26,781 ms | -13.09 % |
| earlier, source `2291ff38…aee9`, 04:20 UTC | Chromium | 8,682.5 ms | 9,366.1 ms | -7.30 % |
| earlier, source `2291ff38…aee9`, 04:20 UTC | Firefox | 18,938 ms | 17,681 ms | +7.11 % |

Neither run crosses the 15 percent threshold, so no switch is needed. The production path already writes with unwrapped native requests and awaits one transaction completion. In Firefox the difference moved by about 20 percentage points between the two runs, so one run does not rank the two paths; it only shows that both stay inside the threshold.

## 2. Substring search over 100,000 items

ADR-007 revisits its search design if the acceptance measurement shows a substring p95 above 500 ms in any engine. The harness `apps/web/e2e/measurement.workspace.ts` imports a generated 100,000-tweet X archive through the page, the import worker and the workspace worker into IndexedDB, then sends 20 literal substring queries per engine through the worker protocol. Of the 20 sorted timings, p50 is the 10th and p95 the 19th.

| Source | Engine | p50 | p95 |
|---|---|---:|---:|
| `00a7754`, before the cached projection | Chromium | 4,616.6 ms | 5,177.9 ms |
| `00a7754`, before the cached projection | Firefox | 5,860 ms | 7,390 ms |
| `dc699cb` with the web wiring in `6e882f7` | Chromium | 200.4 ms | 218.6 ms |
| `dc699cb` with the web wiring in `6e882f7` | Firefox | 94 ms | 153 ms |
| `dc699cb` with the web wiring in `6e882f7` | WebKit | 155 ms | 179 ms |

Before `dc699cb`, `QueryEngine` read the whole store and derived every item's state on each query. With the cached projection, every engine stays under 500 ms, so ADR-007 keeps plain substring search and needs no index. The page held zero item records in every run.

The measured source for the last three rows has the hash `46a4c758…6fda4`. After the measurement, one fix to keyboard focus in the lazy review component went into `6e882f7`; the import, query, storage and notification code the harness exercises did not change.

Twenty queries per engine say little about the tail beyond p95, and all runs used one desktop.

## 3. Import time for 100,000 items

The same runs timed the import from file selection to the terminal receipt.

| Source | Chromium | Firefox | WebKit |
|---|---:|---:|---:|
| `00a7754` | 16,980.4 ms | 34,998 ms | not measured |
| `dc699cb` with `6e882f7` | 18,467.1 ms | 39,125 ms | 44,784 ms |

Since `6e882f7` the import builds the query projection before its terminal receipt, which accounts for part of the increase. **Inference:** the projection build took 1.76 s in Node for the same item count (section 4).

These numbers are not comparable with spike S1, which kept every item on the page and wrote nothing to IndexedDB. Section 6 has the S1-style measurement through the workspace path, with memory, ZIP64 and abort.

## 4. Query projection in Node

Measured at 05:39:54 UTC on the code of `dc699cb`: `query.ts` `e3455a96…8628`, `projection.ts` `09de8ff5…7dbf9`, `review.ts` `2ad6e58c…de9b`. The workspace was a memory store with 100,000 generated items and 50,000 assessments.

| Measurement | Result |
|---|---:|
| projection build | 1,759.48 ms |
| retained heap of the projection | 23,172,576 bytes, 231.73 bytes per item |
| typed-array columns | 6,029,312 bytes, 60.29 bytes per item |
| total per item | 292.02 bytes |
| 24 mixed substring queries, p50 | 290.26 ms |
| 24 mixed substring queries, p95 | 352.81 ms |
| slowest query, including a cold sort | 381.51 ms |
| in-place update after one decision | 0.1007 ms |
| in-place update after a 1,000-item bulk change | 1.9341 ms |
| whole command, one decision | 75.78 ms |
| whole command, 1,000-item bulk change | 109.93 ms |

The queries mixed hits, a term without hits, short and long terms, and queries with and without filters and sorting. Query times include the revision checks and the yields between 5,000-row chunks. Heap is measured against a garbage-collected baseline taken before the projection was built, so it excludes the stored records.

## 5. Restore memory

Restore streams a backup into an empty staging store and keeps only the indexes its checks need. Measured from 03:12:48 to 03:12:52 UTC on the code of `fe8909d`, in fresh Node processes. The run exercises the reader, bounded staging writes, item readback and the derived-state application; the sink discards record bodies, so the numbers isolate the reader and the apply step from the destination store.

| Items | Serialized bytes | Peak heap, sampled | Live heap after batch-boundary GC |
|---:|---:|---:|---:|
| 10,000 | 4,257,124 | 19,386,576 | 13,985,248 |
| 40,000 | 17,127,124 | 21,998,664 | 16,093,920 |

Over the additional 30,000 items, the sampled peak grew by 87.07 bytes per item and the live heap by 70.29 bytes per item, against 429 serialized bytes per item. Before this design, the reader kept the whole parsed document, and reader and writer together peaked at 69,757,848 bytes for 20,000 items.

## 6. Import, ZIP64 and abort through the workspace path

`pnpm measure:g1` repeats the three Gate G1 measurements on the current path. It was ported in `d8f6300`. It serves the built app, selects a generated archive in headless Chromium and times from file selection to the import's terminal receipt. Items go through the import worker and the workspace worker into IndexedDB, and the page keeps none of them. Every row checks the stored count against the generator's manifest three ways: in IndexedDB, through `window.workspace.open()` and through a projection query. Memory is the sum over all Chromium processes that CDP reports, sampled from the operating system with the S1 sampler. The mean sampling interval was 143.6 to 156.4 ms, the longest gap 204 ms, and no garbage collection was forced.

Two full runs on 2026-10-08, from 22:53 to 22:57 and from 22:58 to 23:03 UTC, both exited 0. They are bound to the executable source and served build `3d4f4aa7…6d97`, 168 files hashed before and after each run: the web, core and adapter source, the lockfile, `apps/web/dist`, the fixture generator, the web tooling and the measurement scripts. The machine was Windows 10.0.26200 on an i9-11900K with 64 GiB of RAM, with Node 24.21.0 and Chromium 153.0.8010.12. Other programs kept running, and the table gives the CPU load at the start of each row.

| Run | Row | Receipt | Abort acknowledged | Peak private memory | CPU at start |
|---|---|---:|---:|---:|---:|
| 1 | M1, 100,000 tweets | 19.83 s | | 719.6 MiB | 41 % |
| 1 | M1, 100,000 tweets | 21.80 s | | 694.1 MiB | 40 % |
| 1 | M1, 100,000 tweets | 21.93 s | | 746.0 MiB | 40 % |
| 1 | M2, ZIP64 archive | 18.88 s | | 713.2 MiB | 30 % |
| 1 | M3, abort halfway | 19.08 s | 8.62 s | 535.4 MiB | 33 % |
| 2 | M1, 100,000 tweets | 23.92 s | | 716.4 MiB | 60 % |
| 2 | M1, 100,000 tweets | 22.20 s | | 726.0 MiB | 55 % |
| 2 | M1, 100,000 tweets | 21.98 s | | 738.3 MiB | 46 % |
| 2 | M2, ZIP64 archive | 24.95 s | | 680.1 MiB | 46 % |
| 2 | M3, abort halfway | 21.74 s | 10.04 s | 532.2 MiB | 48 % |

Every M1 and M2 row stored 100,000 items. The M2 archive has 4,703,857,916 bytes, its central directory and all four data entries lie beyond 4 GiB with ZIP64 offsets, and the data entries match M1's CRC32 values and lengths. Its 20 recorded reads came to 12,484,590 bytes, and none touched the padding.

M3 fires Abort at exactly 50,000 stored items. The acknowledgement now waits until the import's rows are deleted for good, so its 8.62 and 10.04 s do not compare with G1's 30.1 ms, which only discarded an array on the page. Right after the acknowledgement and again five seconds later, the import, item, state and event stores held no rows, and the summary and the projection returned no items.

G1 took 7.61 to 8.72 s with a peak of 483 to 497 MiB, but it kept every item on the page, wrote nothing to IndexedDB and built no projection. Section 3 measured the same workspace path in Chromium at 18,467 ms without memory, and the new rows fall in that range. Ten rows from one desktop under 30 to 60 percent foreign CPU load are not a latency distribution and say nothing about other engines, Linux or phones. M3 aborts into an empty workspace, so it shows nothing about an abort into a workspace that already holds a review.

## 7. Open points

- In CI, the WebKit abort test failed once on Ubuntu at `54e648e`. After the atomic purge in `00a7754` it passed in the CI runs of `c66c412` and `dc699cb`. Two passing runs do not prove the fix.

## 8. Connected review feed scale, 2026-10-23

ADR-032 section 7 sets three latency targets: counts p95 below 500 ms at 100,000 entries, a first card below 1,000 ms after a tab switch, and no frame above 50 ms while scrolling 6,000 suggestions. It also limits each feed response to 50 cards and the web's card window to 300. The harness is `apps/web/e2e/scale.measurement.ts`, run through `pnpm --filter @socialprune/web exec playwright test --config e2e/scale.config.ts --project <engine> --workers 1`. The config builds production before serving it on its own strict loopback port. A web unit build probe can replace `dist` with code whose development gate refuses import; two rejected Chromium startups showed that state and contribute no scale samples.

The generated workspace expands `@socialprune/fixture-gen`'s `createDemo` items with `createRandom`, seed `20261023`. The first workspace has 6,000 entries with 6,000 political risk-2 agent suggestions, no decisions, no keep rules and no media or originals. Its 5,433,211 serialized bytes have SHA-256 `b353bde4b370d0a6193b5c674761cc5922f52ead73880e1ed26d4b1c752c1499`. Restore, counts, windows and preview use the production page, workspace client, worker and IndexedDB, not a fake bridge. The preview is cancelled; nothing is marked for deletion.

The tab measurement alternates All and Suggested ten times, from the click until the new feed is no longer busy and a card intersects the panel, followed by two animation frames. The traversal sends real Playwright ArrowDown keys through the feed's keyboard handler. Before the next key, it checks the exact next generated ID, focus, panel visibility and an idle feed, then waits two animation frames. It neither changes scroll positions after initial setup nor dispatches synthetic scroll events or calls the feed's private navigation methods. This follows the person's one-card-at-a-time keyboard path through the same window loader and virtualizer as wheel scrolling; the expected consecutive IDs prevent skipped render commits from counting as coverage. A ten-second focus/visibility timeout ends traversal and preserves the partial result. The sampler continues through loading and waiting, so its frame intervals include those periods. Wheel, touch and scrollbar gestures are not measured.

An earlier Chromium attempt moved 70 percent of the panel per animation frame. It reached near the last item but sampled only 1,522 distinct visible entries, so it does not prove a 6,000-card traversal. That attempt measured cold-count p95 4,486.1 ms, a maximum frame of 116.7 ms with 98 intervals over 50 ms, and tab maximum 259.6 ms. Its raw file is `chromium-2026-10-23T22-20-10-168Z.json`, SHA-256 `e8c46da8118de1c5886c4c86d59eb2c207e725e32102c63c56fe29663aab9090`, source hash as below and harness hash `ff236bc29b9d13efcb920564f9a4370639f35e15cbfe41566020d538cb313644`. The sequential-key results below replace that scrolling method, not its historical observations.

For the count measurement, a second generated workspace holds 100,000 entries and assessments, still with exactly 6,000 suggestions. Twenty cold reads follow alternating level changes between 0 and 2, which invalidate the criteria-dependent count cache; the timing starts after each settings reply. Each cold read is followed by a warm read without changes. These are configuration-cold counts after restore, not a fresh worker or a decision-revision rebuild. Five plan previews check the same 6,000 count without confirmation. For twenty samples, p95 is the nineteenth sorted value.

The host is Windows 10.0.26200, an Intel Core i9-11900K at 3.50 GHz, 16 logical CPUs and 68,603,314,176 bytes of physical RAM, with Node 24.21.0 and Playwright 1.63.0 at 1,440 by 1,000 pixels. Each engine runs alone in this lane, admitted only with at least 12 GiB free physical RAM both before the command and inside the test. Other programs and lanes remain running; these are loaded-desktop observations, not isolated benchmarks. The executable source is base `3fc6de9b987beca00223ba8cd6fa827a9d568e7c`, measurement source hash `f9602373dede5bf8741116f37fa7c7f448c9df9238012df8d4ff90c33b916bca`, checked again before each report finishes. The common measured harness hash is `836019875f17cec62a976b569c14c871b05e51274c0ac3139aa3c883a25ccfb4`. After these runs, only the stdout digest calculation changed to hash the saved file rather than a report object that cleanup events could still change. The WebKit stdout digest differed from its file; the evidence hashes below come from file readback. That reporting-only edit does not change timings or the recorded harness identity.

| Observation | Chromium 153.0.8010.12 | Firefox 155.0 | WebKit 26.6 |
|---|---:|---:|---:|
| Run start, UTC on 2026-10-23 | 22:51:05.986 | 22:59:27.750 | 23:08:40.982 |
| Run end, UTC on 2026-10-23 | 22:58:47.145 | 23:08:13.977 | 23:22:30.896 |
| CPU load at admission, percent | 80 | 100 | 97 |
| Free physical bytes at in-test admission | 18,173,624,320 | 17,052,270,592 | 17,761,202,176 |
| Cold counts at 100,000 entries, p95, ms | 5,607.6, miss | 6,675, miss | 4,440, miss |
| Warm counts, p95, ms | 2.3 | 3 | 18 |
| Tab switch first card, maximum of ten, ms | 128.2, met | 228, met | 226, met |
| Scroll frame interval, p95, ms | 16.7 | 27.78 | 35 |
| Scroll frame interval, maximum, ms | 66.7, miss | 111.1, miss | 107, miss |
| Frame intervals above 50 ms | 1 of 6,673 | 2 of 6,593 | 47 of 4,892 |
| Largest observed feed response, cards | 50, met | 50, met | 50, met |
| Largest observed mounted card count | 23, below 300 | 23, below 300 | 23, below 300 |
| Consecutive focused and visible cards before timeout | 2,248 of 6,000 | 548 of 6,000 | 1,248 of 6,000 |
| Distinct cards intersecting the viewport | 2,255 | 556 | 1,253 |
| First expected card that did not become focused and visible | 2,249 | 549 | 1,249 |
| Traversal duration including timeout, ms | 111,286.5 | 62,035 | 99,719 |
| Initial review navigation to a card, ms | 1,889.6 | 3,331.6 | 6,159.5 |
| 6,000-suggestion human preview ready, ms | 1,486.6 | 1,821.7 | 4,752.9 |
| Plan preview at 100,000 entries, median of five, ms | 6,084.1 | 8,683 | 8,224 |
| Restore of 6,000 entries, ms | 5,106.8 | 12,948 | 31,184 |
| Restore of 100,000 entries, ms | 191,829.7 | 265,503 | 554,389 |
| Owned browser tree private bytes after 100,000-entry restore | 1,098,940,416 | 1,392,369,664 | 3,630,522,368 |
| Owned browser tree working-set bytes at that point | 1,222,795,264 | 1,385,005,056 | 2,717,077,504 |

All three configuration-cold count measurements exceed 500 ms. Warm-cache reads meet that time but do not replace the cold results. All three traversal attempts contain frame intervals over 50 ms and fail to visit all 6,000 consecutive cards. These are partial-traversal misses, not proof of acceptable scrolling over the whole set, nor proof that the remaining cards are unreachable by every UI path. Card responses and mounted-card counts stay within their bounds in the observed portion; the 300-card loaded-window bound is not independently observed as an internal heap count. Each run reports zero page errors and zero observed off-origin requests. The unmeasured remainder, gestures other than ArrowDown, Instagram, media, originals, small screens, isolated-host performance and repeated-run variance remain outside this measurement. No feed product code changed; the cold-count, frame-time and sequential-navigation findings go to the feed owner before slice 8 acceptance.

Raw JSON reports, the six generated screenshots and command outputs are retained outside Git under `socialprune-handoff/phase2/s8-scale-evidence/`. Their original working directory is the system temp folder `kilo/phase2/s8/`. All numbers above come from the JSON files, rounded to at most two decimal places, and all three reports use the same 88,124,025-byte 100,000-entry data set, SHA-256 `cef2d23b6d889ab70ed948ec799c838da68222226d8430c81b7e7aa18d217428`. An exit-zero Playwright run means the measurement procedure completed, including its saved misses; it does not mean the performance targets passed.

| Raw file | SHA-256 from file readback |
|---|---|
| `chromium-2026-10-23T22-51-05-986Z.json` | `888f54bef9824c725236b9c3037e980204e55ce6f6b7a6b375053c2fd011bec0` |
| `firefox-2026-10-23T22-59-27-750Z.json` | `586580309e2a6f5f1e992f9f638cabfe98d270899cee5e7aeb1780abcf991e61` |
| `webkit-2026-10-23T23-08-40-982Z.json` | `d31d4b0f8c0af2829bfc76d59a6d92230a74aac4e674ab1bf364c658edddf332` |

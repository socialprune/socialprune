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

ADR-032 section 7 originally set three latency targets: counts p95 below 500 ms at 100,000 entries, a first card below 1,000 ms after a tab switch, and no frame above 50 ms while scrolling 6,000 suggestions. FRAME-1 B, decided on 2026-10-25, supersedes only that scroll target with at least 99.9 % of measured frames at most 50 ms and none over 200 ms, always reporting the maximum and over-50 count. The dated FRAME-1 B subsection below records the new proof; earlier strict-target misses stay visible as historical measurements. Each feed response remains limited to 50 cards and the web's card window to 300. The harness is `apps/web/e2e/scale.measurement.ts`, run through `pnpm --filter @socialprune/web exec playwright test --config e2e/scale.config.ts --project <engine> --workers 1`. The config builds production before serving it on its own strict loopback port. A web unit build probe can replace `dist` with code whose development gate refuses import; two rejected Chromium startups showed that state and contribute no scale samples.

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

### Feed-owner repair measurement, 2026-10-24

The table above remains the 2026-10-23 baseline. This follow-up uses base `2676f150808986f111bf1c84ffe79e582e296b44` plus the feed-owner candidate, measurement source hash `7f05eb3d9e195eb0abbce62777dc2c88cb023db7ab16e14997c57a9040384b76`. All four scale harness files are byte-identical to that base, with common harness hash `969ac27576f6cad73cb26ca036e86db8170a14fbee73b1c06a5ef07caeca0ad2`. Exactly one final run per engine used the same host, Node, browser versions, viewport, strict port 4781, one worker and unchanged targets. Free physical RAM passed the 12 GiB admission check before each command and inside each test. Two earlier command starts below that limit were rejected without starting a browser. CPU load differed from the baseline, so these are separate loaded-desktop samples, not a controlled speedup estimate.

A smaller generated case failed at card 301 when the first 300-card retention trim changed local virtual indices: focus fell to the page and the mounted range moved to positions 317 through 338. Checking focused-target visibility alone did not repair it. A window rebase now invalidates the earlier focus acknowledgement and restores the retained keyboard destination; pointer or newer key input releases that ownership. A 600-key regression covers repeated trims in all three engines. A separate generated browser probe measured 40 date-format calls for one ArrowDown before stable card models, callbacks and memoized mounted cards, then two calls in each engine. Empty original lookups no longer publish an equivalent empty map on each visible-range change. These probes establish specific repeated rendering work, not the cause of every frame outlier.

Configuration changes formerly rebuilt the feed from all stored items, assessments and events and computed the current checks repeatedly. The shared core query now retains one data-revision-bound source and one account/definition-bound basis for checks, event state, popularity and order. Changing the level, selected criteria or rules recomputes membership and counters without rereading entry bodies. Changed definitions rebuild the checked-hash basis; a committed data revision invalidates the source. Generated tests cover those invalidations, thresholds, rules and a decision followed by configuration. The SQLite consumer uses the same query; whole core, CLI and web unit projects passed. This trades retained worker memory for configuration-cold latency. The incremental projection-memory target of eight bytes per entry in ADR-032 section 7 is not established by these process-tree samples; the source and basis retain more than the compact membership columns. A compact-memory redesign is not part of the measured candidate, and this result must not be read as acceptance of that memory bound.

| Observation, 2026-10-24 | Chromium 153.0.8010.12 | Firefox 155.0 | WebKit 26.6 |
|---|---:|---:|---:|
| Run start, UTC | 08:38:41.012 | 08:45:40.455 | 08:55:09.014 |
| Run end, UTC | 08:45:08.824 | 08:54:21.885 | 09:05:39.614 |
| CPU load at admission, percent | 50 | 60 | 14 |
| Free physical bytes at in-test admission | 15,480,524,800 | 15,435,677,696 | 14,194,020,352 |
| Configuration-cold counts at 100,000 entries, p95, ms | 100.1, met | 184, met | 213, met |
| Configuration-cold counts, maximum, ms | 2,425.5 | 3,303 | 1,707 |
| Warm counts, p95, ms | 0.9 | 2 | 12 |
| Tab switch first card, maximum of ten, ms | 113.8, met | 142, met | 152, met |
| Scroll frame interval, p95, ms | 16.8 | 16.34 | 17 |
| Scroll frame interval, maximum, ms | 16.8, met | 56.74, miss | 53, miss |
| Frame intervals above 50 ms | 0 of 13,469 | 1 of 16,587 | 1 of 18,764 |
| Largest observed feed response, cards | 50, met | 50, met | 50, met |
| Largest observed mounted card count | 23, below 300 | 23, below 300 | 23, below 300 |
| Consecutive focused and visible cards | 6,000 of 6,000 | 6,000 of 6,000 | 6,000 of 6,000 |
| Distinct cards intersecting the viewport | 6,000 | 6,000 | 6,000 |
| Owned browser tree private bytes after 100,000-entry restore | 1,175,056,384 | 1,438,871,552 | 3,133,779,968 |
| Owned browser tree working-set bytes at that point | 1,287,311,360 | 1,465,597,952 | 2,226,036,736 |

M1 traversal and M3 configuration-cold p95 meet their targets in these three runs. M2 remains open: Firefox and WebKit each have one interval above 50 ms, and no causal trace attributes those final two outliers. Chromium alone meets all measured targets. The first count after the restored data revision remains a multi-second maximum in each run, although the nineteenth sorted sample meets p95; a fresh-worker or decision-revision p95 is not measured here. Responses stay at most 50, and the unchanged session tests enforce the 300-card retained UI window while observed mounted DOM cards peak at 23. Each run reports zero page errors, zero off-origin requests and no traversal stop. No threshold, ADR target or harness setting changed, and no run was repeated to replace an outlier.

The generator, seed, item counts and serialized sizes match the earlier procedure. This run's generated 6,000-entry JSON hash is `4991f02480060bf0c394dca07633f58ee77903d73b0a29e6d01b00c4a4c3aa82`; the 100,000-entry JSON hash is `652abba5831fad8ec60103cf846dd6d5f68b29540880656b411ba6c37cf3997e`. All three new reports use the same new hashes, but these differ from the baseline's hashes; the fixture outputs are not byte-identical across the two source identities, and that difference has not been attributed. The complete raw reports, six screenshots, failing-first traces and verification logs are retained outside Git under `socialprune-handoff/phase2/w-s8/`. The original reports remain under `s8-scale-evidence/` unchanged.

| New raw file | SHA-256 from file readback |
|---|---|
| `chromium-2026-10-24T08-38-41-012Z.json` | `148c00245889042dfaef779e33d01911913b5df8ca501c9eabb60a083387dd78` |
| `firefox-2026-10-24T08-45-40-455Z.json` | `97bc6a297d2e59381c0b6acc18da22c6124effdd048fd8113fad092198a2224e` |
| `webkit-2026-10-24T08-55-09-014Z.json` | `d788996ff935658b035e9ff7654062dc1644fc9c0ccdce1c2a22aad1166472e8` |

Wheel, touch and scrollbar traversal, Instagram, media, originals, small screens, isolated-host performance, repeated-run variance, the eight-byte incremental projection budget and fresh-data-revision count distributions remain outside this evidence. The two remaining frame misses keep the feed from full slice 8 performance acceptance.

### Retained count inputs and frame attribution, 2026-10-24

This bounded follow-up starts at `bf8843f174ff173b974abc8410ff619ba379f4b0`. The maintainer changed the first memory measurement from a Chromium worker to a Node probe on 2026-10-24 at 09:38 UTC after the browser RAM gate refused admission. No foreign process was stopped. `apps/web/e2e/feed-heap.measurement.ts` is an explicit, opt-in Node entrypoint, not a test suite or a memory-budget assertion. It creates the same generated 100,000-entry workspace as `scale-data.ts`, retains it in the core in-memory store, releases the parsed input and script-local workspace, and records `process.memoryUsage()` after two explicit `gc()` calls separated by released async turns. Separate Node 24.21.0 processes measure before the first `planCounts`, after it, after a level change and after twenty alternating configuration-cold queries. All four design samples reuse one 88,124,025-byte input file, SHA-256 `652abba5831fad8ec60103cf846dd6d5f68b29540880656b411ba6c37cf3997e`.

These are increments over an already retained in-memory store, not total browser-worker heap and not an isolated heap-snapshot size for a single object. `heapUsed` does not include typed-array backing stores, so the table also reports `arrayBuffers`, which is already included in Node's `external` total. Adding `external` again would count those bytes twice. A GC delta includes runtime bookkeeping and carries no repeated-run confidence interval.

| Node design | Heap increment after first count, bytes | ArrayBuffer increment, bytes | Combined increment per entry, bytes | Combined after level change per entry, bytes | Configuration-cold p95, ms |
|---|---:|---:|---:|---:|---:|
| `2676f15`, original transient source, retained map projection | 20,969,704 | 0 | 209.69704 | 209.92928 | 4,145.84 |
| `bf8843f`, retained workspace and basis | 172,080,024 | 0 | 1,720.80024 | 1,721.02696 | 402.50 |
| Initial body-free columns, source `c43b866d` | 7,838,984 | 4,400,004 | 122.38988 | 122.75276 | 30.19 |
| Final adaptive columns, source `ca1eeff9` | 7,838,936 | 4,400,004 | 122.38940 | 122.75276 | 37.49 |

The final candidate drops retained `Item`, `Assessment`, workspace and event objects. It keeps IDs and their index, account indices, numeric timestamps and engagement, eligibility and decision columns, creation order, offsets into encoded criterion/status/risk checks, and the small membership/base/rule-mask projection. Full bodies and explanations remain in storage and are read for the bounded card response; the preview path retains its existing full-text semantics. Definition changes invalidate the encoded checked-hash basis, and data revisions rebuild it; decision-only commits update the numeric decision and tab state. Current-check source precedence is resolved before encoding, using the existing implementation, rather than retaining assessment reasons or per-source labels in the count cache. Generated equivalence cases cover multiple sources, changed definitions, all risk levels, all keep-rule kinds, multiple accounts and decisions. The body-retention test fails against `bf8843f`. A further red test found that a fixed byte criterion index would impose a new limit on archives with 260 historical category IDs; the final representation chooses a wider index when needed and passes that test.

The measured final combined count-cache increment is 12,238,940 bytes for 100,000 entries, about 93 percent below the retained-workspace candidate. This whole-cache measurement is not the per-item projection growth named by ADR-032. A subsequent direct allocation check on the same input separates membership (one byte), base membership (one), holding-rule mask (two) and order index (four): exactly 800,000 typed bytes for 100,000 entries, or eight per entry. Counters have six tab fields, fourteen criterion fields and one unchecked field in this fixture, plus per-configuration metadata and array headers; the measured projection call adds 6,936 heap bytes beyond its 400,000 newly allocated output-array bytes, while the 400,000-byte order array already exists in the basis. That fixed-size overhead is not a per-item column. The remaining 3,600,004 typed bytes are retained count inputs, and the roughly 7.84 MB heap increment covers IDs, their index and runtime bookkeeping. They remain owned cache memory even though the store also holds these identifiers and source data. The previous return's statement that the projection missed eight bytes compared different boundaries; the projection's linear columns meet eight, while the complete cache uses 122.3894 combined bytes per entry on this sample. No ADR amendment card follows from this split. The final Node sample's first query took 3,289.87 ms and its level-change query 32.06 ms; its twenty-query p95 does not establish a fresh-data-revision p95.

F2 adds opt-in instrumentation only in the test harness, enabled by `SP_FEED_FRAME_DIAGNOSTICS=1` in the test process. It installs performance marks at window request/reply boundaries and React production commit callbacks, observes DOM changes, times layout reads and retains bounded event overlap for intervals above 50 ms. No such flag is read by a shipped runtime entrypoint. React's production build exposes commit timestamps here but no actual render duration. An asynchronous window request spanning an interval is not evidence that it occupied the main thread. The observer changes frame cadence, so the diagnostic samples below are not plain acceptance measurements.

| Diagnostic sample before final adaptive-column freeze | Firefox | WebKit |
|---|---:|---:|
| Start, UTC | 10:18:24.489 | 10:27:51.721 |
| Maximum interval, ms | 137.82 | 109 |
| Intervals above 50 ms captured | 3 | 31 |
| Captured intervals overlapping a window request/reply lifetime | 3 | 25 |
| Captured intervals with a React commit timestamp | 2 | 30 |
| Largest timed layout read inside those intervals, ms | none recorded | 1 |
| Captured intervals with no recorded event overlap | 0 | 1 |
| Consecutive focused and visible cards | 6,000 | 6,000 |

Firefox's three outliers follow window replies at offsets 650, 5,150 and 5,750; two also end at React commit timestamps. WebKit has several overlapping work classes and one interval with no recorded event. These observations do not identify the duration or cause of the missing main-thread time, and no F2 production rendering fix was made from this correlation. GC, scheduling and unobserved render work remain competing explanations rather than findings. The two diagnostic runs, a prior plain Chromium run and the initial compact heap sample retain their original source identity `d4ab3da4` or `c43b866d`; they are not relabelled as final-source proof. The historical-category correction invalidated that executable identity and prompted a new final freeze and its own unit, browser and plain scale proofs.

The final executable measurement identity is `ca1eeff9d500a85eabdacc42f4094d494d2010fbf7205be1bdf674349aaabe7e`, with harness hash `6ccd2faa4597c6cb6fbb73ec79830717343ce5d11a0116c72b34909fc2e5661d`. Only the opt-in diagnostic addition changes the scale harness; targets, thresholds, generated counts, viewport, request limits and keyboard procedure are unchanged. The final plain runs leave diagnostics disabled. Each engine ran once against this final identity, serially at port 4781 after the 12 GiB admission check, on the same Windows host and Node/browser versions as the preceding table. The whole web, core and CLI unit projects pass at one worker, with 1,674 tests passed and the existing Linux-only PTY test skipped on Windows. Feed and person-view specs pass 45 tests across three engines on the final freeze. All these are local Windows proofs, not Linux acceptance.

| Final plain measurement, 2026-10-24 | Chromium 153.0.8010.12 | Firefox 155.0 | WebKit 26.6 |
|---|---:|---:|---:|
| Run start, UTC | 11:00:13.743 | 11:08:49.752 | 11:17:43.723 |
| Run end, UTC | 11:08:27.920 | 11:17:25.484 | 11:30:58.519 |
| CPU load at in-test admission, percent | 76 | 85 | 37 |
| Free physical bytes at in-test admission | 16,220,311,552 | 14,955,692,032 | 15,926,403,072 |
| Configuration-cold counts at 100,000 entries, p95, ms | 16.8, met | 33, met | 27, met |
| Configuration-cold counts, maximum, ms | 3,108 | 3,063 | 3,484 |
| Warm counts, p95, ms | 1.2 | 2 | 16 |
| Scroll frame interval, p95, ms | 16.7 | 6.96 | 19 |
| Scroll frame interval, maximum, ms | 33.4, met | 125, miss | 107, miss |
| Frame intervals above 50 ms | 0 of 16,249 | 26 of 35,371 | 24 of 19,660 |
| Consecutive focused and visible cards | 6,000 of 6,000 | 6,000 of 6,000 | 6,000 of 6,000 |
| Largest feed response, cards | 50 | 50 | 50 |
| Largest mounted card count | 23 | 23 | 23 |
| Owned browser tree private bytes after 100,000-entry restore | 1,146,458,112 | 1,413,324,800 | 3,334,201,344 |

The final plain runs preserve M1 and meet M3 configuration-cold p95 in all engines. F1 reduces retained count inputs substantially; the whole-cache and eight-byte projection boundaries are separated above. F2 remains open: Firefox and WebKit still miss the frame target, and their final plain outliers carry no causal attribution. They are not described as repaired, nor attributed to host load from these observations. The initial compact plain Chromium sample had one 66.7 ms outlier; it remains in the raw evidence rather than being erased by the final-source result. No run on an unchanged source identity was repeated to replace a miss in this round. The 300-card retained-window contract remains enforced by session tests; the measured 23-card DOM maximum is a separate observation. First data-revision query maxima remain above three seconds. No original or media-rich, touch, wheel, small-screen, isolated-host or repeated-variance claims follow from this table.

The complete raw Node, diagnostic and plain reports, six final screenshots, input bytes and command logs are retained outside Git at `socialprune-handoff/phase2/w-s9/`; the subsequent projection split is in `w-s10/projection-heap.json`. The final plain reports use the same generated 6,000/100,000-entry hashes as the earlier feed-owner follow-up. The unresolved frame target and matched attribution remain pending before full slice 8 acceptance; this record changes no ADR.

| Follow-up raw file | SHA-256 |
|---|---|
| `heap-2676f15.json` | `043148656332dc38a20d801593ca8a97cd8a7dcc8a84ea6042d00f30f59c4749` |
| `heap-bf8843f.json` | `756de63aee992cfad9e8eb018369b0285d0712328523b9ccd9f97a8f5ff73058` |
| `heap-compact.json` | `9a72d11d95426dc29d955999bd9710881d824d684536a526a2a56ebee4b3b5f8` |
| `heap-compact-final.json` | `d8e9376a86dc027e8789ea488ebae12b5144e5305dedc86f61a68f0dbd454205` |
| `chromium-2026-10-24T10-10-14-426Z.json`, pre-final plain | `9c436b86667fe234918ddb919e579c7652559bafac7ea84c6d579265edba4ca3` |
| `firefox-2026-10-24T10-18-24-489Z.json`, diagnostic | `c320e8c9aa26fc44abcf4d7d221f3901e3e37eac89126ee6d5130e68a41a8765` |
| `webkit-2026-10-24T10-27-51-721Z.json`, diagnostic | `6637253cf36712c1295d954272fc69dcea66c9315156c1f4ba8a9c3ea5f48079` |
| `chromium-2026-10-24T11-00-13-743Z.json`, final plain | `7b8f0ebbc52e1dad60c68f325537bdf1d79fc2ea4aed5fe6d5bdf01032fa05c8` |
| `firefox-2026-10-24T11-08-49-752Z.json`, final plain | `451d1a68c06c7bb334a9004492806da5737e3eafb03a77589d54a40cd0dc3043` |
| `webkit-2026-10-24T11-17-43-723Z.json`, final plain | `4c02da5572b25d6709badbe8a5bdb9af7a541595d51df4ee43375ecad81e1146` |

### Matched attribution and projection boundary, 2026-10-24

The maintainer requested an interleaved A/B check because the previous plain samples contradicted the morning frame numbers. A uses the exact `bf8843f` query implementation; B uses the compact candidate without a production change. Each command rebuilds production and runs the byte-identical `bf8843f` scale harness, SHA-256 `969ac27576f6cad73cb26ca036e86db8170a14fbee73b1c06a5ef07caeca0ad2`, with diagnostics absent. A's source-tree measurement identity is `6367076766052c5f80337eaa7e770eea47f7f8c49fd9913e35a03bf89f5fac5d`: the extra compact module remains on disk but the exact baseline query does not import it. B's identity remains `ca1eeff9d500a85eabdacc42f4094d494d2010fbf7205be1bdf674349aaabe7e`. The query file hashes are `42435798ebb10c597cbbed08da59c3184a1a81002d601900da0294aa0d756311` for A and `6c7f6df961691e7d9cddb6747a3a28ec0e9ee899aa64b6011386e55206bb6c2a` for B. The generated fixture hashes match the earlier follow-up.

At admission and every thirty seconds during a run, a metadata-only process census groups browser descendants by known lane worktree. Another lane's browser appearing causes only this lane's own run to stop; that interrupted sample is excluded and retained separately. This establishes no observed concurrent lane browser in the accepted samples, not the absence of sub-thirty-second overlap or other host CPU work. Start CPU/free-memory measurements below precede the production build; each raw report separately records the later in-test admission. The host remains loaded, and neither CPU nor free RAM is held constant between commands.

| Accepted Firefox sequence | CPU at command admission, percent | Free physical bytes at command admission | Other lane browser processes at start | Thirty-second census samples, all with zero other lane browser processes | Maximum frame interval, ms | Intervals above 50 ms | Configuration-cold count p95, ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| A1, 11:57:51 UTC | 36 | 15,813,713,920 | 0 | 20 | 83.32 | 17 | 414 |
| B1, 12:53:27 UTC | 38 | 18,745,692,160 | 0 | 17 | 48.60 | 0 | 29 |
| A2, 13:02:34 UTC | 58 | 16,657,461,248 | 0 | 18 | 62.50 | 3 | 323 |
| B2, 13:24:09 UTC | 51 | 15,643,361,280 | 0 | 20 | 90.28 | 13 | 42 |

All four reach 6,000 consecutive focused and visible suggestions. The candidate improves the first pair and worsens the second, so it is not worse in both pairs. The baseline itself now produces 17 and three long intervals instead of the morning sample's one. These mixed samples do not reproduce a consistent compact-cache regression; they also do not identify a single host-load cause. No production fix was made from that ambiguity. The frame target remains unproven across the observed host conditions rather than being silently promoted from the good B1 sample.

| WebKit frame phase | CPU at command admission, percent | Free physical bytes at command admission | Other lane browser processes at start | Thirty-second census samples, all with zero other lane browser processes | Maximum frame interval, ms | Intervals above 50 ms |
|---|---:|---:|---:|---:|---:|---:|
| A1, 14:33:37 UTC | 76 | 13,998,190,592 | 0 | 30 | 167 | 42 |
| B1, 17:24:40 UTC | 57 | 14,424,920,064 | 0 | 30 | 209 | 309 |

Both WebKit frame phases reach all 6,000 focused and visible cards and contain the full raw frame arrays. Both complete scale commands then hit the unchanged fifteen-minute timeout in the later 100,000-entry phase, so neither has a new count p95 or a full-run success claim. The frame-phase recovery verifies the raw frame count, maximum, above-target count, final destination, harness hash and absence of another lane browser in the sampled censuses before exposing these numbers. WebKit B is worse in this single frame pair, but its command starts almost three hours after A because RAM admission repeatedly failed and one startup attempt stopped with the worker gate unavailable before restoring generated data. Other attempted runs were stopped when lane browsers appeared, and their numbers are excluded. Start CPU readings differ, and both accepted WebKit runs include later high CPU readings despite zero observed lane browsers. Neither a compact-cache regression nor a host-load-only explanation is established by this one unequal-host pair plus the opposing Firefox pairs. The requested repeated-worse condition for a causal repair was not observed, and production code remains unchanged from the compact candidate.

The completed and recovered raw reports, failed/contaminated admission records, process censuses and exact variant patch remain in `socialprune-handoff/phase2/w-s10/`. Failed startup and interrupted commands are not counted as A/B results. The frame target is still open, and the mixed attribution result is not an integration approval. The S10 repository delta is limited to this evidence correction and a generated projection-byte regression test, within the existing eight-path candidate; no worker-runtime or workspace-client file changed.

The allocation-boundary correction above is backed by `w-s10/projection-heap.json`, SHA-256 `844dbea0f1a0ecd82dc81eda10e396d6a6b430707b28d05962c10edb8bc1ce64`, and a generated unit test at ten and 1,000 entries. At 100,000 entries, membership/base/holding/order consume 100,000/100,000/200,000/400,000 bytes, exactly eight linear projection bytes per entry. Retained account, date, likes, reposts, eligibility, decision and encoded-check inputs consume 3,600,004 additional typed bytes; IDs, the ID index and runtime bookkeeping account for the separately measured roughly 7.84 MB heap increment. Counters and headers add per-configuration overhead, not a new per-entry column. The complete owned cache remains 122.3894 measured combined bytes per entry; meeting the narrower eight-byte projection growth does not make the other retained inputs free. The direct projection call added 6,936 heap bytes beyond the new output arrays. No ADR amendment is proposed from this split.

### Frame work attribution on DESIGN-H S1, 2026-10-25

This round uses `9f02d1be50d61f6c21a61ab791bffa0e10668f06`, which includes the maintainer-passed DESIGN-H S1 feed CSS. It does not reuse the previous base's timing identity or edit lane H's held feed TSX, CSS, settings or shared styles. A test-only Vite mode, `e2e-frame`, substitutes an entrypoint and wrappers at the feed's virtualizer and session module boundaries. The normal production, review, desktop and release entrypoints do not import the probes. Built-bundle readback verifies that the attribution marker is present in the attribution build and absent from a normal production build.

The producer chain is explicit: test-only Vite resolution selects the wrappers; wrappers around virtualizer measurement/scroll methods, layout reads, React DOM writes, the Scheduler's message-port callback, worker message handlers and feed count/window updates record synchronous wall spans; an rAF observer associates those spans with each interval above 50 ms. The JSON consumer recomputes interval union coverage, exclusive nested-call totals and unobserved time. React production commit callbacks are zero-duration markers, not render durations. The pinned React package advertises but does not contain its optional profiling entry, so no development React timing is substituted for production. Asynchronous window-request lifetimes are retained as a separate class and cannot contribute to synchronous-duration totals. Firefox and WebKit expose no Long Tasks entry in this procedure; unrecorded browser style, layout, paint, scheduling, GC or host preemption remains unassigned.

A controlled browser case in each engine records a deliberate 65 ms synchronous span and checks that it appears in a long interval, alongside real commit, Scheduler and virtualizer coverage. A planted accounting defect that classified an asynchronous wait as synchronous work fails the deterministic unit guard. That guard also checks nested spans are not counted twice and cross-frame spans are clipped. These controls prove producer reachability and the accounting rule, not full engine CPU coverage. The wrappers change the workload, so the following intervals are diagnostic observations, not uninstrumented target acceptance.

| Diagnostic observation | Firefox 155.0 | WebKit 26.6 |
|---|---:|---:|
| Run start, UTC | 10:39:48.623 | 11:33:06.468 |
| Run end, UTC | 10:45:24.744 | 11:39:03.522 |
| CPU load at in-test admission, percent | 91 | 59 |
| Free physical bytes at in-test admission | 13,117,526,016 | 15,878,545,408 |
| Consecutive focused and visible suggestions | 6,000 | 6,000 |
| Mounted-card maximum | 23 | 23 |
| rAF interval maximum, ms | 118.04 | 112 |
| Intervals above 50 ms, all with attached work records | 63 | 36 |
| Dropped work records | 0 | 0 |
| Union of measured synchronous wall time in long intervals, ms | 1,699.74 | 332 |
| Unobserved time in long intervals, ms | 2,355.42 | 1,933 |
| Unobserved share of long-interval time, percent | 58.08 | 85.34 |
| Long intervals with more than half their duration unobserved | 36 of 63 | 36 of 36 |
| Layout-read exclusive wall time in long intervals, ms | 506.10 | 160 |
| Of that, `offsetHeight` reads nested under virtualizer measurement, ms | 466.78 | 139 |
| `scrollToIndex` exclusive wall time in long intervals, ms | 476 | 2 |
| DOM attribute writes plus DOM mutation calls in long intervals, ms | 564 | 102 |
| Worker message-handler exclusive wall time in long intervals, ms | 89 | 29 |
| Feed count/window update exclusive wall time in long intervals, ms | 1 | 2 |

The capture source identity is `257feb4e930846b57b8a53b539c1699f9221a703037320aba3114d6f3d336c75`, with harness identity `ebd0a7dc5fb97ffc8def932e0461df62c4a27cc1ba761474743c7ab43f208b01`. Both runs cover only the 6,000-suggestion phase; no 100,000-entry count p95 was measured in this round. The known-source and generated-input hashes, every raw rAF delta, attached work records, aggregate hook coverage and resource-census logs are retained outside Git under `phase2/w-s11/` in the maintainer's evidence archive. The monitor admitted only at at least 12 GiB free and no browser descendants of another `phase2/wt-*` lane, and would stop its owned run below 6,144 MiB. One WebKit attempt was stopped when another lane browser appeared; it is not one of the two completed captures. Admission refusals and a startup-gate failure are preserved separately. No foreign process was stopped.

The layout wrapper also sees the harness's own geometry polling. The `offsetHeight` reads nested under virtualizer methods are attributable to that app call path, while other rectangle reads and rAF callback spans can include measurement work. All synchronous spans are wall duration, so an enclosing method can include OS preemption rather than continuous CPU execution. The aggregate attribution is therefore not a claim that application JS consumed every recorded millisecond. A later report-field addition saves the frame phase's response log before the optional early return; these two earlier captures do not contain that field and are not described as proving a new maximum response size. No repeat capture was made just to populate it.

The delivered harness hash after that report-only addition is `d1a42d61e48bad28e488b7e8a9a8f5120a74e605b068e468c8f3e4307d20b3c1`. Instrumentation code and source identity remain unchanged. The renamed opt-in control measurement additionally switches tabs to assert worker-handler and count/window-update coverage; that final control passes in both engines and stays outside the ordinary `*.spec.ts` suite. Earlier capture hashes remain attached to their original bytes.

| Engine | Proven contributor | Inference and remaining gap |
|---|---|---|
| Firefox | `offsetHeight`/layout reads nested under virtualizer measurement and `scrollToIndex` are the two largest named synchronous categories; count/window updates do not dominate the measured spans. | The missing 58.08 percent prevents a dominant overall cause. Coarse clocks and preemption affect callback wall time. Layout/style interaction is a candidate, not a proven fix. |
| WebKit | Layout reads are the largest named synchronous category; DOM calls are next. Worker handlers and count/window updates are smaller measured contributors. | The missing 85.34 percent dominates every long interval. Browser layout/paint, scheduling, GC and host contention are not separated by these marks. No dominant overall cause is proven. |

No application repair follows from those incomplete causal traces. A conditional callsite plan for H is returned outside Git, not applied to its held files: inspect duplicate `scrollToIndex` requests across a retention rebase and focus retry, and compare ResizeObserver measurements with the `offsetHeight` fallback only if the quiet trace confirms that path. Existing focus/visibility acknowledgement, 50-card responses, 300-card retained windows and variable-height cards must remain intact. This is a hypothesis plan, not a claim that the current focus path is defective. The 50 ms target remains open and the feed is not accepted at this scale.

For the independent host, the S11 version of `.github/workflows/scale-measure.yml` prepared one Firefox and one WebKit job on `ubuntu-latest`, triggered by pushes to `measure/**` or `workflow_dispatch`. The parent-owned branch is `measure/adr032-s11-frame-attribution`. Jobs use pinned actions, read-only contents, frozen dependencies and no configured secrets, deployment or `ci.yml` change. Each job validates the known-work control, runs the plain production scale procedure, then captures the attribution-only 6,000-entry phase separately. Artifacts named `feed-scale-firefox-<commit SHA>` and `feed-scale-webkit-<commit SHA>` are retained even on failure. Their consumers are the parent and this evidence record: read `renderer`, `scope`, `host`, `sourceHash`, `harnessHash`, `completed`, `framePhaseOnly`, `targetResults` or `frameTargetResults` before comparing any number. Linux memory reporting is summed owned-tree `VmRSS`, not Windows private bytes, and the original 12 GiB admission is retained. S11 ended before the parent pushed it; the executed run and personal artifact readback follow below.

The evidence producer changed here is test-only instrumentation and host reporting. The downstream AGENTS status sentence is proposed to the parent, not edited by this lane, and must continue to name the unresolved frame target rather than imply a repair. No criterion, worker/client behavior, decision semantics, architecture target or UI CSS changed.

| Raw attribution file | SHA-256 |
|---|---|
| `firefox-2026-10-25T10-39-48-623Z.json` | `fb7db57c02d74364555673fb3107eb681e0802f991497437f36d8c75267d5ba1` |
| `webkit-2026-10-25T11-33-06-468Z.json` | `4bb3828481f31f6a24199bec8286dd53e7de08aea3642b6f98a7f45b7f350e5f` |

### Quiet Linux runner and production outlier positions, 2026-10-25

The parent committed S11 as `deb3e2b` and corrected the artifact output path in `cf653cb74dc36a9c6f39007f5120e8b0c8cbc462`. [Run 40193782563](https://github.com/socialprune/socialprune/actions/runs/40193782563) completed both jobs on `ubuntu-latest`. The following values were read from the downloaded JSON, not inferred from a green job. A job's success means the procedure completed; its `noScrollFrameOver50` target is false in both production reports.

Both VMs report Linux `7.0.0-1017-azure`, four logical CPUs and Node `v24.21.0`. Firefox's CPU is AMD EPYC 9V74, with 16,759,443,456 total and 15,060,742,144 free physical bytes at admission; WebKit's is AMD EPYC 9V45, with 16,759,439,360 total and 14,998,138,880 free. Both record zero percent CPU load in the short admission sample, not continuous idle during traversal. This is an independent quiet-host sample, not a controlled host-load-only comparison with Windows. Browser, OS and scheduling differences remain confounders. The measured Linux source hash is `6937946e60368469f0aedac4255798a23ba3668e280ba37b6769605a7ec0ec70`; the common harness hash is `d1a42d61e48bad28e488b7e8a9a8f5120a74e605b068e468c8f3e4307d20b3c1`.

| Measured production observation, run 40193782563 | Firefox 155.0 | WebKit 26.6 |
|---|---:|---:|
| Start, UTC | 12:36:12.762 | 12:36:21.701 |
| End, UTC | 12:44:24.135 | 12:42:26.228 |
| Frame intervals | 14,427 | 13,329 |
| Frame p95, ms | 17.10 | 17 |
| Maximum interval, ms | 50.26 | 81 |
| Intervals above 50 ms | 1 | 1 |
| Consecutive focused and visible cards | 6,000 | 6,000 |
| Mounted-card maximum | 23 | 23 |
| Tab first-card maximum, ms | 181 | 114 |
| Configuration-cold count p95, ms | 31 | 11 |
| First count after restored revision, ms | 3,356 | 1,465 |

All reported targets except the strict frame maximum pass. The count p95 is the nineteenth sorted sample of twenty; it does not erase the multi-second first projection or establish a fresh-revision p95. The separate attribution builds reached 6,000 cards with maxima of 34.22 ms in Firefox and 40 ms in WebKit, zero intervals above 50 ms and empty `frameDiagnostics.frames`. They do not attribute either production outlier. The much smaller quiet-runner miss count compared with the loaded-desktop diagnostic 63/36 supports host sensitivity, but does not prove that load caused a particular interval or that the app cannot produce one.

The old production arrays permit only derived positions: Firefox interval index 5,744 is 50.26 ms, after 96,049.40 ms of summed recorded deltas, with 16.08/17.10 ms neighbors; WebKit index 101 is 81 ms, after 1,718 ms, with 31/18 ms neighbors. These sums omit the initial unsampled rAF and are not measured scroll-start timestamps. No focused-card or pending-request state was captured for those old intervals.

| Raw file from run 40193782563 | SHA-256 |
|---|---|
| `firefox-2026-10-25T12-36-12-762Z.json`, production | `8fe6d8e7e01fa22307c8b1439e4cf9afcfbd790c071de7f89ea421f8d46e6c90` |
| `webkit-2026-10-25T12-36-21-701Z.json`, production | `82319122994bc58b800a3e8c36b6cce4b3885c96bacc9581fb467a8e9da458b1` |
| `firefox-2026-10-25T12-44-29-148Z.json`, attribution | `8486896d2825c8e9bc24a22c51992cdd8e019888f1a49fc6b4d75602988c4a2e` |
| `webkit-2026-10-25T12-42-29-537Z.json`, attribution | `6d4301cd0d86053a2f9100312cdb88e3d27b16685be88780b7b916ad45cd039d` |

The S12 follow-up adds content-free interval context in Playwright's page evaluation only. It records zero-based frame and focused-card indexes before and after each interval above 50 ms, elapsed time from scroll start, endpoint loading flags, feed-window and actual worker-message pending flags, any request-lifetime overlap since the preceding rAF, and the preceding/following durations. Null means no focused article or no adjacent frame at the capture boundary. A reply arriving before the next rAF still leaves overlap evidence; neither a pending flag nor overlap measures main-thread work. GC, renderer work and OS preemption are not separated by this observer. Build readback rejects these observer markers in the production bundle; no application module imports them.

The measurement workflow now has three independent VM jobs per engine, with the same generated input, caps, targets, one browser/worker per job, pinned actions, read-only permissions and no configured secrets. The branch is `measure/w-s12-production-outliers`, measurement commit `472ab58d9720d515069385485cc0bdb2b181ec98`. Each job runs the plain production scale procedure and checks the built bundle, without attribution wrappers. Artifact names include the engine, repetition and commit. Added observers can change sampling cost, so old and new harnesses are not treated as byte-identical. Repetitions are retained together, never selected to replace a miss.

[Run 40198692212](https://github.com/socialprune/socialprune/actions/runs/40198692212) completed all six jobs successfully. Personal readback checks every reported outlier's index, duration and neighbors against the complete raw frame array. All six use source hash `6937946e60368469f0aedac4255798a23ba3668e280ba37b6769605a7ec0ec70` and new harness hash `8de99b9accc17b2ae13b9bd8cd79c5bc05ea2042ef5ee8f15f37f5bc72c97975`. Each restores the same 5,433,211-byte 6,000-entry input, SHA-256 `c698798c9703080b37b45e0680e7ff0f8e12e856c91c7c3ad6cf50c67e0895cc`, and 88,124,025-byte 100,000-entry input, SHA-256 `7dace3b02d7b0ce9ed769f1987a320bf3c6b33c9e35168f691519faea06a5362`. These are the Linux-generated bytes for these jobs; earlier Windows input hashes are not silently substituted.

All jobs report Linux `7.0.0-1017-azure`, Node `v24.21.0`, four logical CPUs, Firefox `155.0` or WebKit `26.6`, with the unchanged 1,440 by 1,000 desktop viewport. Five VMs report AMD EPYC 7763; Firefox repetition 3 reports Intel Xeon Platinum 8370C at 2.80 GHz. Admission CPU load below is a roughly 100 ms sample, not proof of no later VM contention. Total physical bytes are 16,759,435,264 for Firefox 1, 16,758,403,072 for Firefox 3 and 16,759,443,456 for the other four.

| Engine/repetition | Job ID | Start/end UTC | Free physical bytes at admission | Admission CPU, percent |
|---|---|---|---:|---:|
| Firefox 1 | 121185017071 | 13:41:10.765 / 13:50:13.247 | 14,981,328,896 | 0 |
| Firefox 2 | 121185016914 | 13:41:10.914 / 13:49:47.070 | 14,701,584,384 | 2.50 |
| Firefox 3 | 121185017085 | 13:41:13.659 / 13:49:08.893 | 14,713,950,208 | 2.44 |
| WebKit 1 | 121185017091 | 13:41:24.573 / 13:50:03.555 | 14,909,693,952 | 0 |
| WebKit 2 | 121185017056 | 13:41:24.702 / 13:49:50.814 | 14,960,214,016 | 2.50 |
| WebKit 3 | 121185016844 | 13:41:19.723 / 13:49:46.835 | 14,918,238,208 | 2.63 |

| Measured production repetition | Frames | Frame p95, ms | Maximum, ms | Above 50 ms | Count p95, ms | First revision count, ms | Tab maximum, ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| Firefox 1 | 15,560 | 17.12 | 66.54 | 3 | 32 | 3,603 | 462 |
| Firefox 2 | 14,477 | 17.12 | 34.18 | 0 | 31 | 3,336 | 196 |
| Firefox 3 | 14,334 | 17.10 | 34.18 | 0 | 30 | 3,530 | 167 |
| WebKit 1 | 14,324 | 19 | 151 | 4 | 62 | 2,321 | 156 |
| WebKit 2 | 14,188 | 19 | 138 | 4 | 58 | 2,209 | 167 |
| WebKit 3 | 14,210 | 19 | 135 | 2 | 50 | 2,180 | 158 |

Every repetition reaches all 6,000 consecutive focused/visible cards, mounts at most 23 DOM cards and returns at most 50 cards per feed response. Every count-p95 and tab target passes, with zero observed page errors or off-origin requests. The strict frame target passes only in Firefox repetitions 2 and 3. The other four misses remain misses despite successful workflow jobs. A percentile is not substituted for the maximum.

The following is the complete measured outlier set. Card indexes and frame indexes are zero-based. Loading, pending-window and pending-worker flags are endpoint snapshots; the two overlap flags record any lifetime overlap during that interval. Loading before/after distinguishes an interval that ends just after a request completes. All times are rounded to at most two decimal places; the JSON retains full precision.

| Engine/repetition | Frame index | Elapsed, ms | Card before/after | Interval, ms | Previous/next, ms | Loading before/after | Window pending / overlap | Worker pending / overlap |
|---|---:|---:|---|---:|---|---|---|---|
| Firefox 1 | 3,520 | 59,063.82 | 1,449 / 1,449 | 50.28 | 16.08 / 16.12 | yes / no | no / yes | yes / yes |
| Firefox 1 | 6,180 | 103,714.06 | 2,550 / 2,550 | 50.40 | 16.20 / 16.10 | yes / yes | yes / yes | yes / yes |
| Firefox 1 | 13,599 | 228,064 | 5,349 / 5,350 | 66.54 | 17.06 / 49.34 | yes / yes | yes / yes | yes / yes |
| WebKit 1 | 102 | 1,838 | 48 / 48 | 151 | 40 / 19 | yes / yes | yes / yes | yes / yes |
| WebKit 1 | 5,078 | 82,816 | 2,148 / 2,148 | 58 | 16 / 26 | yes / yes | yes / yes | yes / yes |
| WebKit 1 | 13,290 | 217,040 | 5,584 / 5,584 | 53 | 21 / 10 | no / no | no / no | no / no |
| WebKit 1 | 14,115 | 230,648 | 5,920 / 5,920 | 51 | 20 / 11 | no / no | no / no | no / no |
| WebKit 2 | 102 | 1,849 | 48 / 48 | 138 | 41 / 15 | yes / yes | yes / yes | yes / yes |
| WebKit 2 | 5,076 | 82,716 | 2,148 / 2,148 | 65 | 16 / 23 | yes / yes | yes / yes | yes / yes |
| WebKit 2 | 6,324 | 103,040 | 2,689 / 2,689 | 57 | 16 / 19 | no / no | no / no | no / no |
| WebKit 2 | 12,945 | 210,573 | 5,476 / 5,476 | 54 | 19 / 11 | no / no | no / no | no / no |
| WebKit 3 | 103 | 1,843 | 48 / 48 | 135 | 47 / 16 | yes / yes | yes / yes | yes / yes |
| WebKit 3 | 12,924 | 210,367 | 5,466 / 5,466 | 51 | 20 / 12 | no / no | no / no | no / no |

WebKit reproduces a first-window outlier at card index 48 in all three jobs, at 1,838 to 1,849 ms after scroll sampling starts, with 135 to 151 ms duration. The earlier run's frame index 101 and derived 1,718 ms position are also near the beginning, but its missing card context prevents claiming an exact matching card. WebKit also repeats card index 2,148 in two of three jobs. Its later nonloading outliers occur at different positions with no observed window/worker overlap. Firefox has three outliers in one job and none in the other two, so these do not establish a deterministic Firefox card position. The result is a mixed pattern, not one random interval per engine per run.

Source readback maps the first pending-window boundary to `ReviewFeed.tsx:353-359` near-end paging, `FeedWorkspace.tsx:233-247` anchor capture and `FeedSession.load` at `session.ts:101-147`. The session publishes loading before its 50-card request; the workspace passes loading as `busy` to mounted cards through `ReviewFeed.tsx:160-175,535-549`. That identifies a plausible loading/render/layout path, not the CPU cause of the measured interval. The pending flags cannot distinguish work before the request, structured cloning, worker reply processing, busy-card rerenders, browser layout, GC or scheduler preemption. The previous attribution build did not reproduce the interval. No product repair or exact repair patch is justified by these artifacts, and H's files remain untouched. The precise remaining investigation is the first offset-50 loading transition in WebKit, not another broad loaded-desktop run.

The strict 50 ms target and full slice 8 acceptance remain open. The condition for a noise-only target-choice card is not met because WebKit's first-window miss repeats. No percentile amendment is recommended from this evidence. Wheel, touch, scrollbar gestures, Instagram/media/original-rich feeds, small screens, fresh-revision count distributions and causal CPU/GC attribution remain unmeasured here. The mounted-card count is not a new measurement of the separate 300-card retained-window heap bound.

Raw baseline and six-repeat artifacts, personally executed reader/consistency checks and the H investigation handoff are retained outside Git under `phase2/w-s12/` in the maintainer's evidence archive. No local browser was launched. No product code, decisions, target or architecture record changed.

| Raw repetition file | SHA-256 |
|---|---|
| `firefox-2026-10-25T13-41-10-765Z.json` | `e89896ba6dd88b024eb1ec1271141943d8c9e69f0a640d3a1e34abaa5de9ae70` |
| `firefox-2026-10-25T13-41-10-914Z.json` | `6ef2104a5972a4a5c3a5940ec67b60e57324662288b9f7fc6ed854a7c1e793e3` |
| `firefox-2026-10-25T13-41-13-659Z.json` | `b85eda5cd5c662a199e93bd224fb71798d4c9ef6dce636c1ac26393b4f419fab` |
| `webkit-2026-10-25T13-41-24-573Z.json` | `d99af6998466526df6b5488bd16d61bf62298d8f1cc2a513759465ca1adeaf27` |
| `webkit-2026-10-25T13-41-24-702Z.json` | `b0e22c34614454d9743b88c8e0c9f88acb184dab64d44216465c9d6e75aecfd6` |
| `webkit-2026-10-25T13-41-19-723Z.json` | `87de1efa2aede5e182a790667f000c3f86980476879cb3564c1a6efe013e5287` |

### FRAME-1 B acceptance and quiet-runner confirmation, 2026-10-25

At 16:48:34Z the maintainer chose option B on card FRAME-1 v1, "nach deiner Empfehlung". The accepted terms were at least 99.9 % of measured scroll frames at most 50 ms, no frame over 200 ms, the maximum always shown, and the WebKit pause kept in the backlog with its measurements. [ADR-032 section 7](../architecture/adrs/ADR-032-review-feed.md#7-protocol-and-performance) records that amendment beside the superseded strict maximum. No count, tab, response, retention, focus or visibility target changes. [BL-011](../BACKLOG.md#bl-011-webkits-first-paging-pause) retains the pause and the S13/S14 interventions and diagnostics with their run IDs; no experimental rendering or transport change is integrated.

The harness computes nearest-rank p99.9 from the complete scroll-frame array: sort ascending and take one-based position `ceil(0.999 * frame count)`. Exactly 50 ms passes the percentile bound; exactly 200 ms passes the maximum bound. An empty array or a non-finite or negative duration is rejected. A failing-first unit and source guard failed on the unchanged harness, then passed with the new computation and both report consumers. Full-scale `targetResults` and frame-only `frameTargetResults` now contain `scrollFramesP999Under50` and `noScrollFrameOver200`; `maxFrameMs` and `framesOver50Ms` remain in every scroll report, with `frameP999Ms` added. Computation occurs after scroll capture in the test process. The production bundle and page-sampling procedure are unchanged.

Applying the new helper to all six retained S12 arrays is a **derived reclassification**, not six new measurements. Firefox p99.9 is 33.40/33.24/33.20 ms, maxima 66.54/34.18/34.18 ms and over-50 counts 3/0/0. WebKit p99.9 is 43/41/43 ms, maxima 151/138/135 ms and over-50 counts 4/4/2. All six pass both new frame targets. Their old strict-target results are not rewritten.

Fresh [run 40215594359](https://github.com/socialprune/socialprune/actions/runs/40215594359) on `measure/w-s15-frame1b`, commit `93c9e67fb04204a1073bc5b55a2adf3baa744749`, completed all six independent VM jobs. Every job built and measured plain production, passed the observer/workflow contract tests and passed `frame-build-check.ts plain`. Raw-array readback independently recomputed all seven target results, maxima, p99.9, over-50 counts and outlier neighbors. It found every reported target true; successful workflow completion alone is not the acceptance evidence.

All six share unchanged product source hash `6937946e60368469f0aedac4255798a23ba3668e280ba37b6769605a7ec0ec70` and amended harness hash `0970829b89b03eada4803b68c5a30b8df11fe59841cbf8f292cc419222a3ab32`. Generated inputs retain S12's 5,433,211-byte 6,000-entry SHA-256 `c698798c9703080b37b45e0680e7ff0f8e12e856c91c7c3ad6cf50c67e0895cc` and 88,124,025-byte 100,000-entry SHA-256 `7dace3b02d7b0ce9ed769f1987a320bf3c6b33c9e35168f691519faea06a5362`.

| Engine/repetition | Job ID | Frames | Frame p99.9, ms | Maximum, ms | Above 50 ms | Count p95, ms | First revision count, ms | Tab maximum, ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Firefox 1 | 121235922233 | 13,402 | 17.26 | 34.18 | 0 | 18 | 2,972 | 128 |
| Firefox 2 | 121235922083 | 13,233 | 17.28 | 50.36 | 1 | 18 | 2,773 | 114 |
| Firefox 3 | 121235922281 | 14,018 | 33.18 | 49.46 | 0 | 30 | 3,204 | 489 |
| WebKit 1 | 121235922247 | 13,522 | 33 | 101 | 1 | 21 | 1,767 | 126 |
| WebKit 2 | 121235922157 | 14,177 | 41 | 119 | 1 | 47 | 2,186 | 172 |
| WebKit 3 | 121235922266 | 14,222 | 42 | 125 | 3 | 38 | 2,213 | 173 |

All seven exact `targetResults` keys are read back per run below. C is `countsP95Under500`; T is `firstCardAfterEveryTabUnder1000`; P is `scrollFramesP999Under50`; M is `noScrollFrameOver200`; R is `atMost50ResponseCards`; D is `atMost300DomCards`; V is `all6000SuggestionsVisible`.

| Engine/repetition | C | T | P | M | R | D | V |
|---|---|---|---|---|---|---|---|
| Firefox 1 | true | true | true | true | true | true | true |
| Firefox 2 | true | true | true | true | true | true | true |
| Firefox 3 | true | true | true | true | true | true | true |
| WebKit 1 | true | true | true | true | true | true | true |
| WebKit 2 | true | true | true | true | true | true | true |
| WebKit 3 | true | true | true | true | true | true | true |

Every run focuses and shows all 6,000 consecutive cards, returns at most 50 cards per response and mounts at most 23 cards. Page errors and observed off-origin requests are zero, with no traversal stop. The separate 300-card retained-window contract remains covered by unchanged session tests, not inferred from the DOM count. Between 99.9789 % and 100 % of frames are at most 50 ms in each run. WebKit still pauses at card index 48 in three of three repetitions: 101 ms at frame 100, 119 ms at frame 103, and adjacent 57/125 ms intervals at frames 105/106. Window and worker lifetimes overlap these intervals; that does not identify CPU work. Accepting the new target does not repair that pause or prove a host-load, layout or GC cause.

Each job uses Linux `7.0.0-1017-azure`, four logical CPUs, Node `v24.21.0`, Firefox `155.0` or WebKit `26.6` and the unchanged 1,440 by 1,000 viewport. Firefox 1/2 use AMD EPYC 9V45 VMs, Firefox 3 Intel Xeon Platinum 8573C, WebKit 1 AMD EPYC 9V74 and WebKit 2/3 AMD EPYC 7763. Free physical memory at admission ranges from 14,731,993,088 to 14,959,292,416 bytes and short-sample CPU load from 0 to 2.56 percent. These are separate quiet-runner samples, not matched-hardware or continuous-idle proof. The raw reports retain individual host values and timestamps, from 17:16:10.597Z to 17:25:25.031Z.

The feed is accepted at 100,000 entries under FRAME-1 B for the measured desktop, generated-data scope. The earlier Chromium proof's 33.4 ms maximum and zero over-50 frames also satisfy the amended bounds, a derived reclassification rather than a fresh Chromium run; these new Firefox/WebKit repetitions meet every reported target. The 100,000-entry phase measures configuration-cold count p95; traversal still uses 6,000 suggestions. It does not establish fresh-worker or fresh-data-revision count p95, and the first revision queries above remain multi-second. Wheel, touch and scrollbar gestures, Instagram/media/original-rich feeds, small screens, exact CPU/GC attribution, matched-hardware variance, a person's Safari installation and the later S4-restyled product source remain unmeasured. Acceptance here must not be carried to changed rendering without its own proof. The prior strict-target misses and unresolved causes remain historical facts, not claims that the pause disappeared.

Local verification passed the whole web project once at one worker (299 tests, 49 files), root typecheck, format and copy checks, and the data guard over 1,566 tracked files. Lint passed with one pre-existing unused-disable warning in `playwright.probe.config.ts`. A pinned dependency reinstall repaired a missing ESLint rule before that pass, without changing the lockfile or source. No local browser ran. Raw measurements, screenshots and the independent array readers are retained outside Git under `phase2/w-s15/` in the maintainer's evidence archive.

| Raw repetition file, run 40215594359 | SHA-256 |
|---|---|
| `firefox-2026-10-25T17-16-10-597Z.json` | `5d676f67575c6d16f9787c43518d38d3a5cbedda3e1074aea4d7bba0fe58f0aa` |
| `firefox-2026-10-25T17-16-14-489Z.json` | `6c0d771364f303fadc94a8d0b41ff6870d86f46e0a67a4734d41c7c0e926f840` |
| `firefox-2026-10-25T17-16-20-582Z.json` | `ed5250d0031720cc5ca40f2b0f70c4d904802f1011cc455f523552ecf8263516` |
| `webkit-2026-10-25T17-16-41-379Z.json` | `ed0a28628f3b02b968ea678557cb495d7a09d5317342ce8b33e8141f1e78e6c9` |
| `webkit-2026-10-25T17-16-53-542Z.json` | `a31b2d23738b1f10f2f948039316c0576608cab9a6334d3cbe080b299760bb13` |
| `webkit-2026-10-25T17-16-37-799Z.json` | `3fb96e382fb63a679f5b9ab2d1bf69208ea79b340572d9e2a0dfd56539dd1db7` |

### FRAME-1 B on the integrated Fokus feed, 2026-10-25

The integrated Fokus feed meets every measured FRAME-1 B target in three repetitions per engine in Firefox and WebKit. [Run 40223273860](https://github.com/socialprune/socialprune/actions/runs/40223273860) measured commit `58242e007d5c16cfb3affac086d6633fa1530b83` on `measure/design-23`, including the S2 through S4b rendering changes and the FRAME-1 B harness. This closes the earlier evidence gap for that integrated rendering in these two engines, rather than carrying the pre-restyle timings forward. No new measurement was started for this documentation update.

All six reports carry product source hash `6d42570077f44e04488ebf925f2df24d3c0199472870b97ec121a5d27188975d` and unchanged harness hash `0970829b89b03eada4803b68c5a30b8df11fe59841cbf8f292cc419222a3ab32`. The generated 6,000-entry input remains 5,433,211 bytes, SHA-256 `c698798c9703080b37b45e0680e7ff0f8e12e856c91c7c3ad6cf50c67e0895cc`; the 100,000-entry input remains 88,124,025 bytes, SHA-256 `7dace3b02d7b0ce9ed769f1987a320bf3c6b33c9e35168f691519faea06a5362`. Every job completed its plain production measurement, observer/workflow contracts and production-bundle exclusion check successfully. Independent readback recomputed the seven target results from the raw frame, count, tab and response samples, checked outlier neighbors, and matched this table and the raw-file hashes. A successful job alone is not the target proof.

| Engine/repetition | Job ID | Frames | Frame p99.9, ms | Maximum, ms | Above 50 ms | Count p95, ms | First revision count, ms | Tab maximum, ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Firefox 1 | 121259248787 | 14,415 | 33.42 | 49.48 | 0 | 32 | 3,222 | 201 |
| Firefox 2 | 121259249167 | 14,499 | 33.26 | 50.30 | 1 | 34 | 4,008 | 185 |
| Firefox 3 | 121259249062 | 13,749 | 17.44 | 34.18 | 0 | 20 | 2,222 | 127 |
| WebKit 1 | 121259249089 | 14,402 | 45 | 129 | 3 | 39 | 2,303 | 208 |
| WebKit 2 | 121259249064 | 14,224 | 42 | 132 | 2 | 52 | 2,240 | 177 |
| WebKit 3 | 121259248973 | 14,466 | 45 | 129 | 5 | 49 | 2,225 | 177 |

The exact `targetResults` keys use the same abbreviations as the preceding table: C is `countsP95Under500`, T is `firstCardAfterEveryTabUnder1000`, P is `scrollFramesP999Under50`, M is `noScrollFrameOver200`, R is `atMost50ResponseCards`, D is `atMost300DomCards`, and V is `all6000SuggestionsVisible`.

| Engine/repetition | C | T | P | M | R | D | V |
|---|---|---|---|---|---|---|---|
| Firefox 1 | true | true | true | true | true | true | true |
| Firefox 2 | true | true | true | true | true | true | true |
| Firefox 3 | true | true | true | true | true | true | true |
| WebKit 1 | true | true | true | true | true | true | true |
| WebKit 2 | true | true | true | true | true | true | true |
| WebKit 3 | true | true | true | true | true | true | true |

Each repetition focuses and shows all 6,000 consecutive suggestions, returns at most 50 cards per response and mounts at most 23 cards. No traversal stops, page errors or observed off-origin requests occur. At least 99.9654 % of measured frames are at most 50 ms in each run, and none exceeds 132 ms. The separate 300-card retained-window contract is not a new heap measurement here; the DOM count and response bound are the observations above.

WebKit's first-paging pause persists at zero-based card index 48 in all three repetitions, for 129/132/129 ms at frame indexes 110/104/104 and elapsed times 1,957/1,845/1,881 ms. These intervals overlap pending window and worker-message lifetimes, which do not measure CPU work. The result meets the amended bounds but does not repair the pause or identify a style/layout, GC or scheduling cause. It stays in [BL-011](../BACKLOG.md#bl-011-webkits-first-paging-pause); the entry is unchanged because this run has no frame over 200 ms, uses the same WebKit 26.6 and supplies no Safari user report or release change that meets its reopening triggers.

The six VMs report Linux `7.0.0-1017-azure`, four logical CPUs, Node `v24.21.0`, Firefox `155.0` or WebKit `26.6`, with the unchanged 1,440 by 1,000 viewport. Five use AMD EPYC 7763 processors; Firefox 3 uses AMD EPYC 9V45. Admission free memory ranges from 14,791,946,240 to 15,039,430,656 bytes, with short-sample CPU load from 0 to 2.50 percent. These are independent runner samples, not a matched-hardware comparison or continuous-idle proof. Raw measurement timestamps span 18:52:33.449Z to 19:03:07.540Z.

The integrated feed is accepted under FRAME-1 B for the measured Firefox/WebKit desktop generated-data scope at 100,000 entries, with traversal over 6,000 suggestions and configuration-cold count p95 at 100,000. This run contains no Chromium measurement of the integrated source; the earlier Chromium result remains evidence for its earlier source only. Fresh-worker and fresh-data-revision count distributions, wheel/touch/scrollbar gestures, Instagram/media/original-rich feeds, small screens, a person's Safari installation, matched-hardware variance and exact CPU/GC attribution remain unmeasured. The multi-second first revision queries above are not closed by the passing configuration-cold p95. The original strict-target misses and the historical pre-restyle boundary remain visible; this subsection supersedes only that rendering gap for the two measured engines.

Raw reports and screenshots are retained outside Git under `phase2/w-s16/run-40223273860/` in the maintainer's evidence archive; the documentation reader is under `phase2/w-s16/`. No archive contents enter the repository.

| Raw repetition file, run 40223273860 | SHA-256 |
|---|---|
| `firefox-2026-10-25T18-53-33-757Z.json` | `285361c6a8f8cf599f675f1735554263adaf7e846b92dcb5d8f4bcacfcbf654d` |
| `firefox-2026-10-25T18-54-26-522Z.json` | `f1a3bffd1bf27758145b0d2f97549a1e6d6d04d072a34ee6be832df7106899b0` |
| `firefox-2026-10-25T18-52-33-449Z.json` | `f6ba720a456517732cc1614c2580dfcbd77d99204ecdd1a300229ed99f9536c0` |
| `webkit-2026-10-25T18-52-52-260Z.json` | `4586caab75c1ad2adee160d224e8910a35715c653daea21757b974f1ab80ccdc` |
| `webkit-2026-10-25T18-52-48-074Z.json` | `b11462db7913d4f7f20eb729005c0671869ae9fd210a346e73efc46870a58822` |
| `webkit-2026-10-25T18-53-06-991Z.json` | `6e8d386be12a3ad509f6d59c4c68dbae838e132ef1fb7da317c6712688364c2e` |

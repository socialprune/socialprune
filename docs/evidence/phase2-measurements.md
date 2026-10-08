# Phase 2 measurements

This file records the acceptance measurements Phase 2 has taken so far: the bulk-storage check that ADR-005 rule 7 asks for, the substring search latency that ADR-007 names as its revisit trigger, and the memory behaviour of the query projection and of restore. The implementing lanes measured them on 2026-10-07, and the import measurement in section 6 on 2026-10-08; this file only collects their numbers. Every row names the commit or source hash it belongs to.

All browser runs used the desktop and the Playwright 1.63.0 browsers listed in [section 1 of the architecture evidence](../architecture/evidence-2026-10.md#1-trial-environment): Chromium 153.0.8010.12, Firefox 155.0 and WebKit 26.6, which is Playwright's Windows build and not Safari on macOS or iOS. Node runs used Node 24.14.1. The browser runs and the Node projection run were announced on the shared board, and the other lanes held their heavy work while they ran. The restore run in section 5 was not announced, so it may have shared the machine with other lanes' tests. The machine was never isolated from the operating system's own background tasks. Each browser row is one run per engine unless it says otherwise.

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

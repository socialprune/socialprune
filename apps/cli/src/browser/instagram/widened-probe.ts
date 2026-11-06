import type { Page } from 'playwright-core';
import { chooseFilterDate } from './filter.ts';
import { clickAllowed, filterWindowMatches } from './selectors.ts';
import {
  boundedProbe,
  emptyProbeView,
  probeWait,
  ProbeTimeout,
} from './list-probe.ts';
import type { listProbeReader } from './list-probe.ts';
import { ContextStop } from './report.ts';
import type { WidenedProbe } from './report.ts';

export function widenedWindow(at: string, radius: 7 | 31): [string, string] {
  const day = Date.parse(
    new Date(at).toISOString().slice(0, 10) + 'T00:00:00Z',
  );
  return [
    new Date(day - radius * 86400000).toISOString().slice(0, 10),
    new Date(day + radius * 86400000).toISOString().slice(0, 10),
  ];
}

/** Diagnostic only. Uses the main reader's dropdown choices and label readback. */
export async function widenedFilterProbes(
  page: Page,
  at: string,
  guard: () => void,
  checked: () => Promise<void>,
  navigate: () => Promise<unknown>,
  reader: Awaited<ReturnType<typeof listProbeReader>>,
  settleMs: number,
  reports: WidenedProbe[],
) {
  for (const radiusDays of [7, 31] as const) {
    const result: WidenedProbe = {
      radiusDays,
      filter: {
        readbackObserved: false,
        startMatches: false,
        endMatches: false,
        applied: false,
      },
      initial: emptyProbeView(),
      scrolls: [],
      scrollCount: 0,
      observationFailed: true,
      timeoutWait: null,
      failedStep: 'navigation',
    };
    reports.push(result);
    try {
      await navigate();
      await checked();
      result.failedStep = 'filter';
      await probeWait(
        'wider-open-filter',
        () =>
          clickAllowed(page, { kind: 'named', name: 'Sort & filter' }, guard),
        checked,
      );
      await probeWait(
        'wider-select-filter',
        async () => {
          await clickAllowed(
            page,
            { kind: 'named', name: 'Oldest to newest' },
            guard,
          );
          const dates = widenedWindow(at, radiusDays);
          await chooseFilterDate(page, 'start', dates[0], guard);
          await chooseFilterDate(page, 'end', dates[1], guard);
        },
        checked,
      );
      result.failedStep = 'readback';
      const readback = await probeWait(
        'wider-filter-readback',
        () => filterWindowMatches(page, widenedWindow(at, radiusDays)),
        checked,
      );
      Object.assign(result.filter, readback);
      if (
        !readback.readbackObserved ||
        !readback.startMatches ||
        !readback.endMatches
      )
        continue;
      result.failedStep = 'apply';
      await probeWait(
        'wider-apply',
        () =>
          clickAllowed(page, { kind: 'named', name: 'Apply' }, guard, () => {
            result.filter.applied = true;
          }),
        checked,
      );
      result.failedStep = 'settle';
      await probeWait('wider-settle', () => reader.settle(settleMs), checked);
      result.failedStep = 'read';
      Object.assign(
        result,
        await boundedProbe(
          () => reader.read(),
          () => reader.scroll(),
          () => reader.settle(settleMs),
          checked,
        ),
      );
      result.scrollCount = result.scrolls.length;
      if (!result.observationFailed) result.failedStep = 'none';
    } catch (error) {
      // Only a failed diagnostic filter/timeout is inconclusive. Every platform,
      // account, cancellation and network guard continues to stop the run.
      if (
        !(error instanceof ProbeTimeout) &&
        !(error instanceof ContextStop && error.token === 'filter-control')
      )
        throw error;
      await checked();
      result.observationFailed = true;
      if (error instanceof ProbeTimeout) result.timeoutWait = error.wait;
    }
  }
}

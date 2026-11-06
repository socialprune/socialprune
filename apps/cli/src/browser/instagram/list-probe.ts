import { setTimeout as sleep } from 'node:timers/promises';
import type { Page } from 'playwright-core';
import type { NavigationSnapshot } from './list-navigation.ts';
import { rowTextDiagnostic } from './list-diagnostic.ts';
import { normalize } from './plan.ts';
import { checkPage, relativeAgeMs, outsideProfilePaths } from './selectors.ts';
import { ContextStop } from './report.ts';
import { LIST_EMPTY_TEXTS } from './list-navigation.ts';
import type { ProbeWait } from './report.ts';
export const NEWEST_ORDER_ROWS = 3;
type TimeRange = { low: number; high: number };
export function rowTimeRange(
  date: string | null,
  label: string,
  now: number,
): TimeRange | null {
  if (date !== null)
    return /^\d{4}-\d{2}-\d{2}T/u.test(date) &&
      Number.isFinite(Date.parse(date))
      ? { low: Date.parse(date), high: Date.parse(date) }
      : null;
  // Without an actual time element, only the row's terminal age is evidence.
  // Dates inside comment text must not become an ordering assertion.
  const relative =
    /(?:^|\s)(\d+)\s*(years?|weeks?|days?|hours?|minutes?|seconds?|y|w|d|h|m|s)$/iu.exec(
      normalize(label),
    );
  if (!relative) return null;
  const duration = relativeAgeMs(relative[1]! + relative[2]!.toLowerCase());
  const unit = relativeAgeMs('1' + relative[2]!.toLowerCase());
  return duration === null || unit === null
    ? null
    : { low: now - duration - unit, high: now - duration };
}
export function newestRowOrder(times: readonly (TimeRange | null)[]) {
  const values = times.slice(0, NEWEST_ORDER_ROWS);
  const known = values.filter((value): value is TimeRange => value !== null);
  const nonIncreasing =
    values.length === NEWEST_ORDER_ROWS &&
    known.length === NEWEST_ORDER_ROWS &&
    known.every(
      (value, index) => index === 0 || known[index - 1]!.low >= value.high,
    );
  const distinct = known.some(
    (value, index) => index > 0 && known[index - 1]!.high > value.high,
  );
  return {
    required: NEWEST_ORDER_ROWS as 3,
    rows: values.length,
    timesKnown: known.length,
    nonIncreasing,
    distinct,
    proved: nonIncreasing && distinct,
  };
}

export class ProbeTimeout extends Error {
  readonly wait: ProbeWait;
  constructor(wait: ProbeWait) {
    super(wait);
    this.wait = wait;
  }
}
/** Only diagnostic waits are recoverable. Guards remain authoritative. */
export async function probeWait<T>(
  wait: ProbeWait,
  action: () => Promise<T>,
  checked: () => Promise<void>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (
      (error instanceof Error && error.name === 'TimeoutError') ||
      (error instanceof ContextStop && error.token === 'list-timeout')
    ) {
      await checked();
      throw new ProbeTimeout(wait);
    }
    throw error;
  }
}

type Age = 'same-day' | 'within-3-days' | 'older' | 'unknown';
type Container = {
  scrollable: boolean;
  clientHeight: number;
  backendNodeId: number | null;
};
type Snapshot = NavigationSnapshot & {
  documents: (NavigationSnapshot['documents'][number] & {
    nodes: NavigationSnapshot['documents'][number]['nodes'] & {
      backendNodeId?: number[];
    };
  })[];
};
const empty = () => ({
  observed: false,
  ownRows: 0,
  targetMatched: false,
  capped: false,
  rows: [] as ReturnType<typeof rowProjection>[],
  container: null as Container | null,
  order: newestRowOrder([]),
  markers: { empty: false, loading: false, container: false },
});

export function rowAgeClass(
  date: string | null,
  label: string,
  at: string,
  now: number,
): Age {
  let value =
    date && Number.isFinite(Date.parse(date)) ? Date.parse(date) : null;
  if (value === null) {
    const displayed =
      /\b(?:\d{4}-\d{2}-\d{2}|(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4})\b/iu.exec(
        label,
      )?.[0];
    const parsed = displayed
      ? Date.parse(
          /^\d{4}-/u.test(displayed)
            ? displayed + 'T00:00:00Z'
            : displayed + ' UTC',
        )
      : NaN;
    if (Number.isFinite(parsed)) value = parsed;
  }
  if (value === null) {
    const age =
      /(?:^|\s)(\d+\s*(?:years?|weeks?|days?|hours?|minutes?|seconds?|y|w|d|h|m|s))$/iu.exec(
        normalize(label),
      )?.[1];
    const duration = age ? relativeAgeMs(age.toLowerCase()) : null;
    if (duration !== null) value = now - duration;
  }
  const target = Date.parse(at);
  if (value === null || !Number.isFinite(target)) return 'unknown';
  if (
    new Date(value).toISOString().slice(0, 10) ===
    new Date(target).toISOString().slice(0, 10)
  )
    return 'same-day';
  if (Math.abs(value - target) <= 3 * 86400000) return 'within-3-days';
  return value < target ? 'older' : 'unknown';
}
function rowProjection(
  raw: string,
  label: string,
  text: string,
  at: string,
  handle: string,
  date: string | null,
  now: number,
) {
  const row = rowTextDiagnostic(raw, label, text, handle, new Set());
  const match =
    row.commentTextEqualsExport || row.exportStartsWithCommentPrefix;
  return {
    authorEqualsHandle: row.authorEqualsHandle,
    matcherExportStartsWithRow: row.matcherExportStartsWithRow,
    matcherRowStartsWithExport: row.matcherRowStartsWithExport,
    broadExportStartsWithRow: row.broadExportStartsWithRow,
    broadRowStartsWithExport: row.broadRowStartsWithExport,
    targetMatched: match,
    ageClass: rowAgeClass(date, label + ' ' + raw, at, now),
  };
}

/** Snapshot values and the transient container handle never enter the report. */
export function probeProjection(
  snapshot: NavigationSnapshot,
  text: string,
  at: string,
  handle: string,
  now: number,
) {
  const result = empty();
  if (!snapshot.documents.length) return result;
  const doc = (snapshot as Snapshot).documents[0]!,
    { nodes, layout } = doc;
  if (
    !nodes.nodeName ||
    !nodes.parentIndex ||
    !nodes.nodeType ||
    !nodes.nodeValue ||
    nodes.nodeName.length > 50000 ||
    !layout.scrollRects ||
    !layout.clientRects
  )
    return result;
  const names = nodes.nodeName.map((index) => snapshot.strings[index] ?? '');
  const attrs = names.map((_, index) => {
    const map = new Map<string, string>(),
      values = nodes.attributes?.[index] ?? [];
    for (let i = 0; i < values.length; i += 2)
      map.set(
        snapshot.strings[values[i]!] ?? '',
        snapshot.strings[values[i + 1]!] ?? '',
      );
    return map;
  });
  const texts = names.map((_, index) =>
    nodes.nodeType![index] === 3
      ? (snapshot.strings[nodes.nodeValue![index]!] ?? '').slice(0, 20000)
      : '',
  );
  const images = names.map((name) => name === 'IMG'),
    main: boolean[] = [],
    excluded: boolean[] = [];
  const positions = new Map(
    layout.nodeIndex.map((index, position) => [index, position]),
  );
  for (let i = names.length - 1; i >= 0; i--) {
    const parent = nodes.parentIndex[i]!;
    if (parent >= 0 && parent < i) {
      texts[parent] = (texts[i]! + ' ' + texts[parent]!).slice(0, 20000);
      images[parent] ||= images[i]!;
    }
  }
  const ownIndices: number[] = [];
  const ownTimes: (TimeRange | null)[] = [];
  for (const [index, name] of names.entries()) {
    const parent = nodes.parentIndex[index]!,
      role = attrs[index]!.get('role'),
      position = positions.get(index);
    main[index] = name === 'MAIN' || Boolean(main[parent]);
    excluded[index] =
      Boolean(excluded[parent]) ||
      ['NAV', 'ASIDE', 'HEADER', 'SCRIPT', 'STYLE'].includes(name) ||
      ['navigation', 'tablist', 'dialog', 'alertdialog'].includes(role ?? '') ||
      attrs[index]!.has('hidden') ||
      attrs[index]!.get('aria-hidden') === 'true';
    if (
      !main[index] ||
      excluded[index] ||
      role !== 'button' ||
      !attrs[index]!.has('aria-label') ||
      !images[index] ||
      position === undefined
    )
      continue;
    const visibility = snapshot.strings[layout.styles[position]?.[1] ?? -1];
    if (visibility === 'hidden' || visibility === 'collapse') continue;
    const value = rowProjection(
      texts[index]!,
      attrs[index]!.get('aria-label')!,
      text,
      at,
      handle,
      null,
      now,
    );
    if (!value.authorEqualsHandle) continue;
    ownIndices.push(index);
    result.ownRows++;
    if (result.rows.length < 30) {
      let date: string | null = null,
        timeCount = 0;
      for (let child = index + 1; child < names.length; child++) {
        let ancestor = nodes.parentIndex[child]!;
        while (ancestor > index) ancestor = nodes.parentIndex[ancestor]!;
        if (
          ancestor === index &&
          names[child] === 'TIME' &&
          attrs[child]!.has('datetime')
        ) {
          date = attrs[child]!.get('datetime')!;
          timeCount++;
        }
      }
      const row = {
        ...value,
        ageClass: rowAgeClass(
          date,
          attrs[index]!.get('aria-label')! + ' ' + texts[index]!,
          at,
          now,
        ),
      };
      if (ownTimes.length < NEWEST_ORDER_ROWS)
        ownTimes.push(
          timeCount > 1 ? null : rowTimeRange(date, texts[index]!, now),
        );
      result.rows.push(row);
      result.targetMatched ||= row.targetMatched;
    }
  }
  result.capped = result.ownRows > 30;
  result.markers.container = names.some((_, index) => {
    const position = positions.get(index);
    return (
      main[index] &&
      !excluded[index] &&
      position !== undefined &&
      ['auto', 'scroll'].includes(
        snapshot.strings[layout.styles[position]?.[2] ?? -1] ?? '',
      ) &&
      (layout.clientRects?.[position]?.[3] ?? 0) > 0
    );
  });
  result.observed = true;
  result.order = newestRowOrder(ownTimes);
  // Walk from the actual counted own row, not an arbitrary page scroller or
  // the immediate parent, which may only wrap a lazily rendered row group.
  for (const row of ownIndices) {
    for (
      let index = nodes.parentIndex[row]!;
      index >= 0;
      index = nodes.parentIndex[index]!
    ) {
      if (!main[index] || excluded[index]) break;
      const position = positions.get(index);
      if (position === undefined) continue;
      const overflow = snapshot.strings[layout.styles[position]?.[2] ?? -1],
        height = layout.scrollRects[position]?.[3],
        client = layout.clientRects[position]?.[3];
      if (height === undefined || client === undefined || client <= 0) continue;
      if (['auto', 'scroll'].includes(overflow ?? '') || height > client + 1) {
        result.container = {
          scrollable: height > client,
          clientHeight: Math.max(1, Math.round(client)),
          backendNodeId: nodes.backendNodeId?.[index] ?? null,
        };
        return result;
      }
    }
  }
  return result;
}
type Projection = ReturnType<typeof probeProjection>;
export const probeView = ({
  container,
  order: _order,
  markers: _markers,
  ...value
}: Projection) => ({
  ...value,
  scrollContainerObserved: container !== null,
  scrollHeightGreaterThanClient: container?.scrollable ?? null,
});
export const emptyProbeView = () => probeView(empty());
export async function boundedProbe(
  read: () => Promise<Projection>,
  scroll: () => Promise<boolean>,
  settle: () => Promise<void>,
  checked: () => Promise<void> = async () => {},
  settleZero: () => Promise<void> = settle,
) {
  const result = {
    initial: emptyProbeView(),
    zeroRows: undefined as import('./report.ts').FilteredProbe['zeroRows'],
    observationFailed: false,
    timeoutWait: null as ProbeWait | null,
    scrolls: [] as {
      rowsBefore: number;
      rowsAfter: number;
      targetMatched: boolean;
      observed: boolean;
      rows: Projection['rows'];
    }[],
  };
  try {
    let current = await probeWait('filtered-read', read, checked);
    result.initial = probeView(current);
    result.observationFailed = !current.observed;
    if (current.observed && current.ownRows === 0) {
      const started = performance.now();
      await probeWait('filtered-settle', settleZero, checked);
      const waitedMs = Math.min(5000, Math.round(performance.now() - started));
      const second = await probeWait('filtered-read', read, checked);
      result.zeroRows = {
        emptyStatePresent: current.markers?.empty ?? false,
        loadingPresent: current.markers?.loading ?? false,
        listContainerPresent: current.markers?.container ?? false,
        waitedMs,
        secondObserved: second.observed,
        secondOwnRows: second.ownRows,
        changed: second.ownRows !== current.ownRows,
        observationFailed: !second.observed,
      };
      current = second;
      result.observationFailed ||= !second.observed;
      result.initial = probeView(second);
    }
    for (let index = 0; index < 3; index++) {
      if (
        !current.observed ||
        !current.container?.scrollable ||
        !(await probeWait('filtered-scroll', scroll, checked))
      )
        break;
      const before = current.ownRows;
      await probeWait('filtered-settle', settle, checked);
      current = await probeWait('filtered-read', read, checked);
      result.observationFailed ||= !current.observed;
      result.scrolls.push({
        rowsBefore: before,
        rowsAfter: current.ownRows,
        targetMatched: current.targetMatched,
        observed: current.observed,
        rows: current.rows,
      });
      if (!current.observed || current.ownRows <= before) break;
    }
  } catch (error) {
    if (!(error instanceof ProbeTimeout)) throw error;
    result.observationFailed = true;
    result.timeoutWait = error.wait;
  }
  return result;
}

export async function listProbeReader(
  page: Page,
  text: string,
  at: string,
  handle: string,
  now: number,
  guard: () => void,
) {
  const client = await page.context().newCDPSession(page);
  let container: Container | null = null;
  const checked = async () => {
    guard();
    await checkPage(page);
    if (
      !(await outsideProfilePaths(page)).some(
        (path) => path.toLowerCase() === `/${handle.toLowerCase()}/`,
      )
    )
      throw new ContextStop('ACCOUNT_MISMATCH', 'account-changed');
  };
  return {
    async read() {
      await checked();
      await page.waitForLoadState('domcontentloaded', { timeout: 1000 });
      try {
        const snapshot = await client.send('DOMSnapshot.captureSnapshot', {
          computedStyles: ['display', 'visibility', 'overflow-y'],
          includeDOMRects: true,
        });
        const result = probeProjection(snapshot, text, at, handle, now);
        const main = page.locator('main');
        let empty = false;
        for (const label of LIST_EMPTY_TEXTS)
          empty ||= (await main.getByText(label, { exact: true }).count()) > 0;
        const markers = {
          empty,
          loading:
            (await main
              .locator(
                '[role="progressbar"],[aria-busy="true"],svg[aria-label="Loading" i]',
              )
              .count()) > 0,
          container:
            (await main
              .locator('[role="list"],ul,div[style*="overflow"]')
              .count()) > 0 ||
            result.container !== null ||
            result.markers.container,
        };
        container = result.container;
        return { ...result, markers };
      } catch (error) {
        await checked();
        if (error instanceof Error && error.name === 'TimeoutError')
          throw error;
        container = null;
        return empty();
      }
    },
    async scroll() {
      if (!container?.backendNodeId || !container.scrollable) return false;
      await checked();
      const box = await client.send('DOM.getBoxModel', {
        backendNodeId: container.backendNodeId,
      });
      const quad = box.model.content;
      if (quad.length !== 8) return false;
      const viewport = await client.send('Page.getLayoutMetrics');
      const left = Math.max(0, quad[0]!),
        right = Math.min(viewport.cssLayoutViewport.clientWidth, quad[2]!),
        top = Math.max(0, quad[1]!),
        bottom = Math.min(viewport.cssLayoutViewport.clientHeight, quad[5]!);
      if (right <= left || bottom <= top) return false;
      const x = (left + right) / 2,
        y = (top + bottom) / 2;
      guard();
      await page.mouse.move(x, y);
      guard();
      await page.mouse.wheel(0, container.clientHeight);
      return true;
    },
    async settle(ms: number) {
      await sleep(ms);
      await checked();
    },
    async close() {
      await client.detach();
    },
  };
}

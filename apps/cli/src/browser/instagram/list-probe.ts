import { setTimeout as sleep } from 'node:timers/promises';
import type { Page } from 'playwright-core';
import type { NavigationSnapshot } from './list-navigation.ts';
import { rowTextDiagnostic } from './list-diagnostic.ts';
import { normalize } from './plan.ts';
import { checkPage, relativeAgeMs, outsideProfilePaths } from './selectors.ts';
import { ContextStop } from './report.ts';

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
    ageClass: rowAgeClass(date, raw, at, now),
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
  if (snapshot.documents.length !== 1) return result;
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
      let date: string | null = null;
      for (let child = index + 1; child < names.length; child++) {
        let ancestor = nodes.parentIndex[child]!;
        while (ancestor > index) ancestor = nodes.parentIndex[ancestor]!;
        if (
          ancestor === index &&
          names[child] === 'TIME' &&
          attrs[child]!.has('datetime')
        ) {
          date = attrs[child]!.get('datetime')!;
          break;
        }
      }
      const row = {
        ...value,
        ageClass: rowAgeClass(date, texts[index]!, at, now),
      };
      result.rows.push(row);
      result.targetMatched ||= row.targetMatched;
    }
  }
  result.capped = result.ownRows > 30;
  result.observed = true;
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
export const probeView = ({ container, ...value }: Projection) => ({
  ...value,
  scrollContainerObserved: container !== null,
  scrollHeightGreaterThanClient: container?.scrollable ?? null,
});
export async function boundedProbe(
  read: () => Promise<Projection>,
  scroll: () => Promise<boolean>,
  settle: () => Promise<void>,
) {
  let current = await read();
  const initial = probeView(current),
    scrolls: {
      rowsBefore: number;
      rowsAfter: number;
      targetMatched: boolean;
      observed: boolean;
      rows: Projection['rows'];
    }[] = [];
  for (let index = 0; index < 3; index++) {
    if (
      !current.observed ||
      !current.container?.scrollable ||
      !(await scroll())
    )
      break;
    const before = current.ownRows;
    await settle();
    current = await read();
    scrolls.push({
      rowsBefore: before,
      rowsAfter: current.ownRows,
      targetMatched: current.targetMatched,
      observed: current.observed,
      rows: current.rows,
    });
    if (!current.observed || current.ownRows <= before) break;
  }
  return { initial, scrolls };
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
        container = result.container;
        return result;
      } catch {
        await checked();
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
      const x = Math.max(
        1,
        Math.min(
          viewport.cssLayoutViewport.clientWidth - 1,
          (quad[0]! + quad[2]!) / 2,
        ),
      );
      const y = Math.max(
        1,
        Math.min(
          viewport.cssLayoutViewport.clientHeight - 1,
          (quad[1]! + quad[5]!) / 2,
        ),
      );
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

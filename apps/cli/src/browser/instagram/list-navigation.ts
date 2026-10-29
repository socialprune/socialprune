import type { Page } from 'playwright-core';
import { normalize } from './plan.ts';
import { utcWindow } from './selectors.ts';
import { ListNavigationSchema } from './report.ts';

// Diagnostic vocabulary exercised by generated pages, not absence proof.
export const LIST_EMPTY_TEXTS = [
  'No results',
  'No results found',
  'No comments yet',
  'Keine Ergebnisse',
  'Keine Ergebnisse gefunden',
  'Noch keine Kommentare',
] as const;
export function linkPathClass(href: string | null, origin: string) {
  if (!href) return 'other' as const;
  try {
    const url = new URL(href, origin);
    if (url.origin !== origin) return 'other' as const;
    if (/^\/(?:p|reel|tv)\//u.test(url.pathname)) return 'post' as const;
    if (/^\/your_activity(?:\/|$)/u.test(url.pathname))
      return 'your-activity' as const;
    if (/^\/[A-Za-z0-9_.]{1,30}\/?$/u.test(url.pathname))
      return 'profile' as const;
  } catch {
    /* Unknown addresses stay in the closed other class. */
  }
  return 'other' as const;
}

export interface NavigationSnapshot {
  strings: string[];
  documents: {
    nodes: {
      parentIndex?: number[];
      nodeType?: number[];
      nodeName?: number[];
      nodeValue?: number[];
      attributes?: number[][];
    };
    layout: {
      nodeIndex: number[];
      styles: number[][];
      scrollRects?: number[][];
      clientRects?: number[][];
    };
  }[];
}
const container = () => ({
  links: { post: 0, profile: 0, yourActivity: 0, other: 0 },
  timeElements: 0,
  timesWithinWindow: 0,
  handleElements: 0,
  images: 0,
  checkboxes: 0,
  scrollContainers: 0,
});
export function emptyNavigation() {
  return {
    observed: false,
    observationFailed: true,
    knownEmptyStatePresent: false,
    containers: {
      main: container(),
      dialog: container(),
      navAside: container(),
      elsewhere: container(),
    },
  };
}

/** Only aggregate counts leave this projection; snapshot strings never do. */
export function navigationCounts(
  snapshot: NavigationSnapshot,
  origin: string,
  at: string,
  handle: string,
) {
  const result = emptyNavigation();
  if (!snapshot.documents.length) return result;
  const window = utcWindow(at);
  for (const { nodes, layout } of snapshot.documents) {
    if (
      !nodes.nodeName ||
      !nodes.parentIndex ||
      !nodes.nodeType ||
      !nodes.nodeValue
    )
      return emptyNavigation();
    if (!layout.scrollRects || !layout.clientRects) return emptyNavigation();
    if (nodes.nodeName.length > 50000) return emptyNavigation();
    const attrs = nodes.nodeName.map((_, index) => {
      const values = nodes.attributes?.[index] ?? [];
      const map = new Map<string, string>();
      for (let i = 0; i < values.length; i += 2)
        map.set(
          snapshot.strings[values[i]!] ?? '',
          snapshot.strings[values[i + 1]!] ?? '',
        );
      return map;
    });
    const names = nodes.nodeName.map((index) => snapshot.strings[index] ?? '');
    const regions: (keyof typeof result.containers)[] = [];
    const flags: {
      main: boolean;
      dialog: boolean;
      nav: boolean;
      hidden: boolean;
    }[] = [];
    const bounded = (text: string) =>
      text.length > 256 ? text.slice(0, 256) + '\0' : text;
    const texts = names.map((_, index) =>
      nodes.nodeType![index] === 3
        ? bounded(snapshot.strings[nodes.nodeValue![index]!] ?? '')
        : '',
    );
    const layoutPositions = new Map(
      layout.nodeIndex.map((index, position) => [index, position]),
    );
    for (let index = names.length - 1; index >= 0; index--) {
      const parent = nodes.parentIndex[index]!;
      if (parent >= 0) texts[parent] = bounded(texts[index]! + texts[parent]!);
    }
    for (const [index, name] of names.entries()) {
      const parent = flags[nodes.parentIndex[index]!] ?? {
        main: false,
        dialog: false,
        nav: false,
        hidden: false,
      };
      const role = attrs[index]!.get('role');
      const own = {
        main: parent.main || name === 'MAIN',
        dialog: parent.dialog || role === 'dialog' || role === 'alertdialog',
        nav:
          parent.nav ||
          name === 'NAV' ||
          name === 'ASIDE' ||
          role === 'navigation',
        hidden:
          parent.hidden ||
          attrs[index]!.has('hidden') ||
          attrs[index]!.get('aria-hidden') === 'true',
      };
      flags.push(own);
      const region = own.dialog
        ? 'dialog'
        : own.nav
          ? 'navAside'
          : own.main
            ? 'main'
            : 'elsewhere';
      regions.push(region);
      if (nodes.nodeType[index] !== 1) continue;
      const count = result.containers[region];
      if (name === 'A' && attrs[index]!.has('href')) {
        const path = linkPathClass(attrs[index]!.get('href')!, origin);
        count.links[path === 'your-activity' ? 'yourActivity' : path]++;
      }
      if (name === 'TIME') {
        count.timeElements++;
        const datetime = attrs[index]!.get('datetime');
        if (datetime && Number.isFinite(Date.parse(datetime))) {
          const day = new Date(datetime).toISOString().slice(0, 10);
          if (day >= window[0] && day <= window[1]) count.timesWithinWindow++;
        }
      }
      if (name === 'IMG') count.images++;
      if (role === 'checkbox') count.checkboxes++;
      const text = ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(name)
        ? ''
        : normalize(texts[index]!);
      if (text.toLowerCase() === handle.toLowerCase()) count.handleElements++;
      const position = layoutPositions.get(index);
      const visibility =
        snapshot.strings[layout.styles[position ?? -1]?.[1] ?? -1];
      if (
        !own.hidden &&
        position !== undefined &&
        visibility !== 'hidden' &&
        visibility !== 'collapse' &&
        LIST_EMPTY_TEXTS.some(
          (value) => value.toLowerCase() === text.toLowerCase(),
        )
      )
        result.knownEmptyStatePresent = true;
    }
    for (const [position, index] of layout.nodeIndex.entries()) {
      const overflow = snapshot.strings[layout.styles[position]?.[2] ?? -1];
      const scroll = layout.scrollRects?.[position]?.[3];
      const client = layout.clientRects?.[position]?.[3];
      if (
        ['auto', 'scroll', 'overlay'].includes(overflow ?? '') &&
        scroll !== undefined &&
        client !== undefined &&
        client > 0 &&
        scroll > client
      )
        result.containers[regions[index]!].scrollContainers++;
    }
  }
  result.observed = true;
  result.observationFailed = false;
  return ListNavigationSchema.parse(result);
}

/** Passive CDP snapshot only: no evaluation, DOM mutation, scroll or click. */
export async function listNavigation(page: Page, at: string, handle: string) {
  let client:
    | Awaited<ReturnType<ReturnType<Page['context']>['newCDPSession']>>
    | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let expired = false;
  try {
    return await Promise.race([
      (async () => {
        client = await page.context().newCDPSession(page);
        if (expired) {
          await client.detach();
          return emptyNavigation();
        }
        const snapshot = await client.send('DOMSnapshot.captureSnapshot', {
          computedStyles: ['display', 'visibility', 'overflow-y'],
          includeDOMRects: true,
        });
        if (expired) return emptyNavigation();
        const origin = new URL(page.url()).origin;
        return navigationCounts(
          snapshot,
          origin === 'null' ? 'https://www.instagram.com' : origin,
          at,
          handle,
        );
      })(),
      new Promise<ReturnType<typeof emptyNavigation>>((resolve) => {
        timer = setTimeout(() => {
          expired = true;
          resolve(emptyNavigation());
        }, 1000);
      }),
    ]);
  } catch {
    return emptyNavigation();
  } finally {
    expired = true;
    clearTimeout(timer);
    if (client) {
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          client.detach(),
          new Promise<void>((resolve) => {
            cleanupTimer = setTimeout(resolve, 150);
          }),
        ]);
      } catch {
        /* Failed reads stay explicit. */
      } finally {
        clearTimeout(cleanupTimer);
      }
    }
  }
}

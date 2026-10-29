import { expect, test, vi } from 'vitest';
import {
  linkPathClass,
  navigationCounts,
  listNavigation,
} from './list-navigation.ts';
import type { Page } from 'playwright-core';
import { ListNavigationSchema } from './report.ts';

test('IG-list readiness failure never creates a CDP session or attempts a page projection', async () => {
  const newCDPSession = vi.fn();
  const page = {
    on: () => {},
    off: () => {},
    waitForLoadState: () =>
      Promise.reject(new Error('Generated detached frame')),
    context: () => ({ newCDPSession }),
  } as unknown as Page;
  expect(
    await listNavigation(page, '2025-01-02T12:00:00Z', 'generated_handle'),
  ).toMatchObject({
    observed: false,
    observationFailed: true,
    waitedForReadiness: false,
  });
  expect(newCDPSession).not.toHaveBeenCalled();
});

test('IG-list pending main navigation is refused before a CDP snapshot is sent', async () => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const frame = {};
  const newCDPSession = vi.fn();
  const page = {
    on: (event: string, handler: (...args: unknown[]) => void) =>
      handlers.set(event, handler),
    off: (event: string) => handlers.delete(event),
    waitForLoadState: () => {
      handlers.get('request')!({
        isNavigationRequest: () => true,
        frame: () => frame,
      });
      return Promise.resolve();
    },
    mainFrame: () => frame,
    isClosed: () => false,
    context: () => ({ newCDPSession }),
  } as unknown as Page;
  expect(
    await listNavigation(page, '2025-01-02T12:00:00Z', 'generated_handle'),
  ).toMatchObject({
    observed: false,
    observationFailed: true,
    waitedForReadiness: true,
  });
  expect(newCDPSession).not.toHaveBeenCalled();
  expect(handlers.size).toBe(0);
});
import type { NavigationSnapshot } from './list-navigation.ts';

test.each([
  ['/p/Generated/', 'post'],
  ['/reel/Generated/', 'post'],
  ['/tv/Generated/', 'post'],
  ['/generated_person/', 'profile'],
  ['/your_activity/interactions/comments', 'your-activity'],
  ['/explore/tags/generated/', 'other'],
  ['https://foreign.invalid/p/Generated/', 'other'],
  ['mailto:generated@example.invalid', 'other'],
] as const)('IG-list page path %s projects only %s', (path, expected) => {
  expect(linkPathClass(path, 'https://www.instagram.com')).toBe(expected);
});

test('IG-list page projection fails closed and detaches when CDP cannot read', async () => {
  const detach = vi.fn(async () => {});
  const page = {
    on: () => {},
    off: () => {},
    waitForLoadState: () => Promise.resolve(),
    isClosed: () => false,
    context: () => ({
      newCDPSession: () =>
        Promise.resolve({
          send: () => Promise.reject(new Error('Generated private decoy')),
          detach,
        }),
    }),
  } as unknown as Page;
  const result = await listNavigation(
    page,
    '2025-01-02T12:00:00Z',
    'generated_handle',
  );
  expect(result).toMatchObject({ observed: false, observationFailed: true });
  expect(detach).toHaveBeenCalledOnce();
  expect(JSON.stringify(result)).not.toContain('Generated private decoy');
  expect(
    ListNavigationSchema.safeParse({
      ...result,
      text: 'Generated private decoy',
    }).success,
  ).toBe(false);
});

test('IG-list snapshot projection counts containers, dates and real overflow without retaining values', () => {
  const strings: string[] = [];
  const string = (value: string) => {
    strings.push(value);
    return strings.length - 1;
  };
  const doc: NavigationSnapshot['documents'][number] = {
    nodes: {
      parentIndex: [],
      nodeType: [],
      nodeName: [],
      nodeValue: [],
      attributes: [],
    },
    layout: { nodeIndex: [], styles: [], scrollRects: [], clientRects: [] },
  };
  const node = (
    name: string,
    parent: number,
    attributes: string[] = [],
    text = '',
    height = 20,
    client = 20,
  ) => {
    const index = doc.nodes.nodeName!.length;
    doc.nodes.parentIndex!.push(parent);
    doc.nodes.nodeType!.push(name === '#text' ? 3 : 1);
    doc.nodes.nodeName!.push(string(name));
    doc.nodes.nodeValue!.push(string(text));
    doc.nodes.attributes!.push(attributes.map(string));
    doc.layout.nodeIndex.push(index);
    doc.layout.styles.push(['block', 'visible', 'auto'].map(string));
    doc.layout.scrollRects!.push([0, 0, 20, height]);
    doc.layout.clientRects!.push([0, 0, 20, client]);
    return index;
  };
  const main = node('MAIN', -1);
  const nav = node('NAV', main);
  node('A', nav, ['href', '/your_activity/interactions/comments']);
  node('A', main, ['href', '/p/Generated/']);
  const dialog = node('DIV', main, ['role', 'dialog']);
  node('IMG', dialog);
  node('TIME', dialog, ['datetime', '2025-01-02T12:00:00Z']);
  node('TIME', dialog, ['datetime', 'invalid']);
  node('TIME', main, ['datetime', '2024-01-02T12:00:00Z']);
  node('DIV', main, ['role', 'checkbox']);
  node('DIV', main, [], '', 200, 20);
  const own = node('SPAN', main);
  node('#text', own, [], 'GENERATED_HANDLE');
  const empty = node('P', main);
  node('#text', empty, [], 'No results');
  const result = navigationCounts(
    { strings, documents: [doc] },
    'https://www.instagram.com',
    '2025-01-02T12:00:00Z',
    'generated_handle',
  );
  expect(result).toMatchObject({
    observed: true,
    observationFailed: false,
    knownEmptyStatePresent: true,
    containers: {
      main: {
        links: { post: 1 },
        timeElements: 1,
        timesWithinWindow: 0,
        handleElements: 1,
        checkboxes: 1,
        scrollContainers: 1,
      },
      dialog: { images: 1, timeElements: 2, timesWithinWindow: 1 },
      navAside: { links: { yourActivity: 1 } },
    },
  });
  for (const value of [
    'generated_handle',
    '/p/Generated/',
    '2025',
    'No results',
  ])
    expect(JSON.stringify(result)).not.toContain(value);
  expect(
    navigationCounts(
      { strings, documents: [] },
      'https://www.instagram.com',
      '2025-01-02T12:00:00Z',
      'generated_handle',
    ),
  ).toMatchObject({ observed: false, observationFailed: true });
});

import { expect, test } from 'vitest';
import {
  boundedProbe,
  probeProjection,
  rowAgeClass,
  probeView,
  probeWait,
  ProbeTimeout,
  rowTimeRange,
  newestRowOrder,
} from './list-probe.ts';
import {
  ListProbeViewSchema,
  ContextStop,
  PROBE_WAITS,
  NewestProbeSchema,
} from './report.ts';
import type { NavigationSnapshot } from './list-navigation.ts';

const target = 'Generated target words only',
  handle = 'generated_handle',
  at = '2026-10-06T12:00:00Z',
  now = Date.parse('2026-10-30T12:00:00Z');
test('REPCTL row-order proof requires first three known newest-first rows and a real decrease', () => {
  const exact = (day: number) =>
    rowTimeRange(`2026-10-${day}T12:00:00Z`, '', now);
  expect(newestRowOrder([exact(29), exact(28), exact(27)]).proved).toBe(true);
  expect(newestRowOrder([exact(27), exact(28), exact(29)]).proved).toBe(false);
  expect(newestRowOrder([exact(29), exact(29), exact(29)]).proved).toBe(false);
  expect(newestRowOrder([exact(29), null, exact(27)]).proved).toBe(false);
  expect(newestRowOrder([exact(29), exact(28)]).proved).toBe(false);
  expect(
    newestRowOrder(
      ['1d', '2d', '3d'].map((age) => rowTimeRange(null, age, now)),
    ).proved,
  ).toBe(true);
  expect(
    newestRowOrder(
      ['1w', '1w', '2w'].map((age) => rowTimeRange(null, age, now)),
    ).proved,
  ).toBe(false);
});
function snapshot(texts: readonly string[]): NavigationSnapshot {
  const strings: string[] = [],
    string = (value: string) => {
      strings.push(value);
      return strings.length - 1;
    };
  const nodes = {
    parentIndex: [-1, 0, 1],
    nodeType: [9, 1, 1],
    nodeName: [string('#document'), string('MAIN'), string('DIV')],
    nodeValue: [string(''), string(''), string('')],
    attributes: [[], [], []] as number[][],
  };
  const layout = {
    nodeIndex: [1, 2],
    styles: [
      [string('block'), string('visible'), string('visible')],
      [string('block'), string('visible'), string('auto')],
    ],
    scrollRects: [
      [0, 0, 500, 900],
      [0, 0, 500, 900],
    ],
    clientRects: [
      [0, 0, 500, 300],
      [0, 0, 500, 300],
    ],
  };
  for (const [ordinal, text] of texts.entries()) {
    const row = nodes.nodeName.length;
    for (const [name, parent, attrs, value] of [
      [
        'DIV',
        2,
        [
          string('role'),
          string('button'),
          string('aria-label'),
          string('Generated row'),
        ],
        '',
      ],
      ['IMG', row, [], ''],
      ['#text', row, [], `${handle} ${text}\n24d`],
    ] as const) {
      nodes.nodeName.push(string(name));
      nodes.nodeType.push(name === '#text' ? 3 : 1);
      nodes.parentIndex.push(parent);
      nodes.nodeValue.push(string(value));
      nodes.attributes.push([...attrs]);
    }
    layout.nodeIndex.push(row);
    layout.styles.push([string('block'), string('visible'), string('visible')]);
    layout.scrollRects.push([0, 0, 500, 100]);
    layout.clientRects.push([0, ordinal * 100, 500, 100]);
  }
  return { strings, documents: [{ nodes, layout }] };
}
test('listprobe counts own rendered rows, compares both ways, ages and walks to the actual overflow ancestor without leaking text', () => {
  const result = probeProjection(
    snapshot(['Other generated words', target]),
    target,
    at,
    handle,
    now,
  );
  expect(result).toMatchObject({
    observed: true,
    ownRows: 2,
    targetMatched: true,
    container: { scrollable: true, clientHeight: 300 },
    rows: [
      { ageClass: 'same-day', matcherExportStartsWithRow: false },
      {
        ageClass: 'same-day',
        matcherExportStartsWithRow: true,
        matcherRowStartsWithExport: true,
        broadExportStartsWithRow: true,
        broadRowStartsWithExport: true,
      },
    ],
  });
  for (const privateValue of [target, handle, at, 'Other generated words'])
    expect(JSON.stringify(result)).not.toContain(privateValue);
});
test('listprobe scrolls only while own rendered count grows, at most three times', async () => {
  const views = [
    snapshot(['Other generated words']),
    snapshot(['Other generated words', target]),
    snapshot(['Other generated words', target]),
  ];
  let reads = 0,
    scrolls = 0;
  const result = await boundedProbe(
    () =>
      Promise.resolve(
        probeProjection(views[Math.min(reads++, 2)]!, target, at, handle, now),
      ),
    () => {
      scrolls++;
      return Promise.resolve(true);
    },
    () => Promise.resolve(),
  );
  expect(result.initial.targetMatched).toBe(false);
  expect(result.scrolls).toMatchObject([
    { rowsBefore: 1, rowsAfter: 2, targetMatched: true },
    { rowsBefore: 2, rowsAfter: 2, targetMatched: true },
  ]);
  expect(scrolls).toBe(2);
});
test('listprobe ages are closed and unavailable observations are never an empty proof', () => {
  expect(rowAgeClass('2026-10-08T12:00:00Z', '', at, now)).toBe(
    'within-3-days',
  );
  expect(rowAgeClass('2026-10-01T12:00:00Z', '', at, now)).toBe('older');
  expect(rowAgeClass(null, 'unknown age', at, now)).toBe('unknown');
  expect(rowAgeClass(null, 'Generated row October 6, 2026', at, now)).toBe(
    'same-day',
  );
  expect(
    ListProbeViewSchema.safeParse(
      probeView(
        probeProjection(
          { strings: [], documents: [] },
          target,
          at,
          handle,
          now,
        ),
      ),
    ).success,
  ).toBe(true);
  expect(
    ListProbeViewSchema.safeParse({
      ...probeView(
        probeProjection(snapshot([target]), target, at, handle, now),
      ),
      text: target,
    }).success,
  ).toBe(false);
});
test('listprobe enforces three-scroll maximum even when rows keep growing', async () => {
  let count = 0,
    scrolls = 0;
  const result = await boundedProbe(
    () =>
      Promise.resolve(
        probeProjection(
          snapshot(Array.from({ length: ++count }, () => target)),
          target,
          at,
          handle,
          now,
        ),
      ),
    () => {
      scrolls++;
      return Promise.resolve(true);
    },
    () => Promise.resolve(),
  );
  expect(scrolls).toBe(3);
  expect(result.scrolls).toHaveLength(3);
});

test.each(PROBE_WAITS)(
  'replyempty timeout has only its closed wait token: %s',
  async (wait) => {
    const error = Object.assign(new Error('Generated private timeout detail'), {
      name: 'TimeoutError',
    });
    const caught = await probeWait(
      wait,
      () => Promise.reject(error),
      async () => {},
    ).catch((error: unknown) => error);
    expect(caught).toBeInstanceOf(ProbeTimeout);
    expect(caught).toMatchObject({ wait, message: wait });
  },
);
test('replyempty diagnostic timeout never suppresses account, platform, cancellation or non-timeout failures', async () => {
  for (const error of [
    new ContextStop('ACCOUNT_MISMATCH', 'account-changed'),
    new ContextStop('PLATFORM_CHECK', 'http-429'),
    new ContextStop('CANCELLED', 'stopped'),
    new Error('Generated non-timeout failure'),
  ]) {
    await expect(
      probeWait(
        'newest-read',
        () => Promise.reject(error),
        async () => {},
      ),
    ).rejects.toBe(error);
    const timeout = Object.assign(new Error('Generated timeout'), {
      name: 'TimeoutError',
    });
    await expect(
      probeWait(
        'newest-read',
        () => Promise.reject(timeout),
        () => Promise.reject(error),
      ),
    ).rejects.toBe(error);
  }
});
test('replyempty partial filtered observation survives a scroll wait timeout and is never an empty proof', async () => {
  const projection = probeProjection(
    snapshot([target]),
    target,
    at,
    handle,
    now,
  );
  const result = await boundedProbe(
    () => Promise.resolve(projection),
    () => Promise.resolve(true),
    () =>
      Promise.reject(
        Object.assign(new Error('Generated timeout'), { name: 'TimeoutError' }),
      ),
  );
  expect(result).toMatchObject({
    observationFailed: true,
    timeoutWait: 'filtered-settle',
    initial: { targetMatched: true },
    scrolls: [],
  });
  expect(
    NewestProbeSchema.safeParse({
      observationFailed: true,
      timeoutWait: 'private-content',
      sortReadback: false,
      settledReload: false,
      view: probeView(projection),
    }).success,
  ).toBe(false);
});

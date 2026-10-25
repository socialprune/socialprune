import { afterEach, expect, test, vi } from 'vitest';
import {
  installScaleActivity,
  installScrollObserver,
  scrollFrameTargets,
  type ScrollOutlier,
} from '../e2e/scroll-observer.ts';
import { readFile } from 'node:fs/promises';

afterEach(() => vi.unstubAllGlobals());

test('FRAME-1 B uses nearest-rank p99.9 with inclusive 50 ms and 200 ms bounds', () => {
  const frames = [...Array<number>(999).fill(50), 200];
  const unchanged = [...frames];
  expect(scrollFrameTargets(frames)).toEqual({
    frameP999Ms: 50,
    maxFrameMs: 200,
    framesOver50Ms: 1,
    targets: {
      scrollFramesP999Under50: true,
      noScrollFrameOver200: true,
    },
  });
  expect(frames).toEqual(unchanged);
  expect(scrollFrameTargets([200, ...Array<number>(999).fill(50)])).toEqual(
    scrollFrameTargets(frames),
  );
  expect(
    scrollFrameTargets([...Array<number>(998).fill(50), 50.01, 200]),
  ).toMatchObject({
    frameP999Ms: 50.01,
    targets: { scrollFramesP999Under50: false, noScrollFrameOver200: true },
  });
  expect(
    scrollFrameTargets([...Array<number>(999).fill(50), 200.01]),
  ).toMatchObject({
    frameP999Ms: 50,
    targets: { scrollFramesP999Under50: true, noScrollFrameOver200: false },
  });
  // One outlier is more than 0.1 percent of 999 frames, but not of 1,001.
  expect(
    scrollFrameTargets([...Array<number>(998).fill(50), 51]).targets
      .scrollFramesP999Under50,
  ).toBe(false);
  expect(
    scrollFrameTargets([...Array<number>(1000).fill(50), 51]).targets
      .scrollFramesP999Under50,
  ).toBe(true);
  expect(scrollFrameTargets([50]).targets.scrollFramesP999Under50).toBe(true);
});

test.each([
  { frames: [] },
  { frames: [NaN] },
  { frames: [Infinity] },
  { frames: [-1] },
])(
  'FRAME-1 B refuses missing or invalid frame samples: $frames',
  ({ frames }) => expect(() => scrollFrameTargets(frames)).toThrow(),
);

test('full and frame-only scale reports consume FRAME-1 B without changing other targets', async () => {
  const source = await readFile(
    new URL('../e2e/scale.measurement.ts', import.meta.url),
    'utf8',
  );
  expect(source).not.toMatch(/noScrollFrameOver50|noFrameOver50/);
  expect(source.match(/\.\.\.scrollFrameResult\.targets/g)).toHaveLength(2);
  for (const line of [
    'scrollFrameTargets(scroll.frames)',
    'scrollFrameP999Ms: 50',
    'maximumScrollFrameMs: 200',
    'countsP95Ms: 500',
    'firstCardAfterTabMs: 1000',
    'maximumResponseCards: 50',
    'maximumUiCards: 300',
    'countsP95Under500: distribution(counts.cold).p95 < 500',
    'firstCardAfterEveryTabUnder1000: tabMs.every((value) => value < 1000)',
    'scroll.maxDomCards <= 300',
    'scroll.uniqueVisible === 6000 && focusedCards === 6000',
    'event.cards! <= 50',
  ])
    expect(source).toContain(line);
});

test('outliers retain exact positions, interval overlaps and neighboring durations without contents', () => {
  let callback: (at: number) => void = () => {};
  let focusedIndex = 0;
  let loading = false;
  let pending = false;
  const readActivity = () => ({
    feedWindowInFlight: pending,
    workerMessageInFlight: pending,
    feedWindowOverlappedInterval: pending,
    workerMessageOverlappedInterval: pending,
  });
  const card = {
    dataset: { cardId: 'synthetic-do-not-report-this-id' },
    getAttribute: () => String(focusedIndex + 1),
    getBoundingClientRect: () => ({ top: 1, bottom: 99 }),
  };
  const feed = {
    getAttribute: () => String(loading),
    querySelectorAll: () => [card],
  };
  const panel = {
    scrollTop: 20,
    getBoundingClientRect: () => ({ top: 0, bottom: 100 }),
  };
  const page: Record<string, unknown> = { __scaleActivity: readActivity };
  vi.stubGlobal('window', page);
  vi.stubGlobal('document', {
    activeElement: { closest: () => card },
    querySelector: (selector: string) =>
      selector === '[role="tabpanel"]' ? panel : feed,
  });
  vi.stubGlobal('innerHeight', 100);
  vi.stubGlobal('performance', { now: () => 0 });
  vi.stubGlobal('requestAnimationFrame', (next: typeof callback) => {
    callback = next;
  });
  installScrollObserver();
  callback(0);
  callback(16);
  focusedIndex = 49;
  loading = pending = true;
  callback(80);
  focusedIndex = 50;
  loading = pending = false;
  callback(150);
  callback(166);
  const finish = page['__scaleFinishScroll'] as () => {
    frames: number[];
    outliersOver50Ms: ScrollOutlier[];
    framesOver50Ms: number;
  };
  const report = finish();
  expect(report.frames).toEqual([16, 64, 70, 16]);
  expect(report.framesOver50Ms).toBe(2);
  expect(report.outliersOver50Ms).toEqual([
    {
      frameIndex: 1,
      durationMs: 64,
      sinceScrollStartMs: 80,
      focusedCardIndex: 49,
      focusedCardIndexBefore: 0,
      loadingFrame: true,
      loadingFrameBefore: false,
      feedWindowInFlight: true,
      workerMessageInFlight: true,
      feedWindowOverlappedInterval: true,
      workerMessageOverlappedInterval: true,
      precedingFrameMs: 16,
      followingFrameMs: 70,
    },
    {
      frameIndex: 2,
      durationMs: 70,
      sinceScrollStartMs: 150,
      focusedCardIndex: 50,
      focusedCardIndexBefore: 49,
      loadingFrame: false,
      loadingFrameBefore: true,
      feedWindowInFlight: false,
      workerMessageInFlight: false,
      feedWindowOverlappedInterval: false,
      workerMessageOverlappedInterval: false,
      precedingFrameMs: 64,
      followingFrameMs: 16,
    },
  ]);
  expect(JSON.stringify(report.outliersOver50Ms)).not.toContain(
    card.dataset.cardId,
  );
});

test('request and real worker message lifetimes are distinct; a reply before rAF still leaves overlap evidence', async () => {
  const events = new Map<string, (event: { data: unknown }) => void>();
  const send = vi.fn();
  let settle: (value: unknown) => void = () => {};
  const worker = {
    postMessage: send,
    addEventListener: (
      type: string,
      callback: (event: { data: unknown }) => void,
    ) => events.set(type, callback),
  };
  const workspace = {
    worker,
    request: (input: unknown) => {
      worker.postMessage(input);
      return new Promise((resolve) => {
        settle = resolve;
      });
    },
  };
  const page = { workspace } as unknown as typeof window;
  vi.stubGlobal('window', page);
  installScaleActivity();
  const read = Reflect.get(page, '__scaleActivity') as () => object;
  expect(read()).toMatchObject({
    feedWindowInFlight: false,
    workerMessageInFlight: false,
  });
  const request = workspace.request({
    type: 'feedWindow',
    requestId: 'generated',
    offset: 50,
  });
  expect(read()).toMatchObject({
    feedWindowInFlight: true,
    workerMessageInFlight: true,
  });
  events.get('message')!({
    data: { type: 'progress', requestId: 'generated' },
  });
  expect(read()).toMatchObject({ workerMessageInFlight: true });
  events.get('message')!({
    data: { type: 'feedCards', requestId: 'generated' },
  });
  settle({ type: 'feedCards', cards: [] });
  await request;
  expect(read()).toEqual({
    feedWindowInFlight: false,
    workerMessageInFlight: false,
    feedWindowOverlappedInterval: true,
    workerMessageOverlappedInterval: true,
  });
  expect(read()).toEqual({
    feedWindowInFlight: false,
    workerMessageInFlight: false,
    feedWindowOverlappedInterval: false,
    workerMessageOverlappedInterval: false,
  });
  expect(send).toHaveBeenCalledOnce();
});

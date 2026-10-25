import { afterEach, expect, test, vi } from 'vitest';
import {
  installScaleActivity,
  installScrollObserver,
  type ScrollOutlier,
} from '../e2e/scroll-observer.ts';

afterEach(() => vi.unstubAllGlobals());

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

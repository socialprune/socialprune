// These functions are serialized into the test page by Playwright, never imported
// by a shipped entrypoint. Only request metadata and DOM positions are retained.
export function installScaleActivity() {
  const requests: {
    type: string;
    ms: number;
    offset: number | null;
    cards: number | null;
  }[] = [];
  const pendingWindows = new Set<string>();
  const pendingWorker = new Set<string>();
  let windowOverlap = false;
  let workerOverlap = false;
  const worker = window.workspace.worker;
  const send = worker.postMessage.bind(worker) as (
    input: unknown,
    transfer?: Transferable[] | StructuredSerializeOptions,
  ) => void;
  worker.postMessage = (input, ...rest) => {
    const request = input as { requestId?: unknown } | null;
    const requestId =
      typeof request?.requestId === 'string' ? request.requestId : null;
    if (requestId) {
      pendingWorker.add(requestId);
      workerOverlap = true;
    }
    try {
      return send(input, ...rest);
    } catch (error) {
      if (requestId) pendingWorker.delete(requestId);
      throw error;
    }
  };
  worker.addEventListener('message', (event: MessageEvent<unknown>) => {
    const reply = event.data as { requestId?: string; type?: string } | null;
    if (
      reply?.requestId &&
      reply.type !== 'progress' &&
      reply.type !== 'clickListExportChunk'
    )
      pendingWorker.delete(reply.requestId);
  });
  worker.addEventListener('error', () => pendingWorker.clear());
  const original = window.workspace.request.bind(window.workspace);
  window.workspace.request = async (input, ...rest) => {
    const start = performance.now();
    if (input.type === 'feedWindow') {
      pendingWindows.add(input.requestId);
      windowOverlap = true;
    }
    try {
      const reply = await original(input, ...rest);
      if (['planCounts', 'feedWindow', 'previewPlan'].includes(input.type))
        requests.push({
          type: input.type,
          ms: performance.now() - start,
          offset: input.type === 'feedWindow' ? (input.offset ?? null) : null,
          cards: reply.type === 'feedCards' ? reply.cards.length : null,
        });
      return reply;
    } finally {
      pendingWindows.delete(input.requestId);
    }
  };
  Reflect.set(window, '__scaleRequests', requests);
  Reflect.set(window, '__scaleActivity', () => {
    const snapshot = {
      feedWindowInFlight: pendingWindows.size > 0,
      workerMessageInFlight: pendingWorker.size > 0,
      feedWindowOverlappedInterval: windowOverlap || pendingWindows.size > 0,
      workerMessageOverlappedInterval: workerOverlap || pendingWorker.size > 0,
    };
    windowOverlap = pendingWindows.size > 0;
    workerOverlap = pendingWorker.size > 0;
    return snapshot;
  });
}

export type ScrollOutlier = {
  frameIndex: number;
  durationMs: number;
  sinceScrollStartMs: number;
  focusedCardIndex: number | null;
  focusedCardIndexBefore: number | null;
  loadingFrame: boolean;
  loadingFrameBefore: boolean;
  feedWindowInFlight: boolean;
  workerMessageInFlight: boolean;
  feedWindowOverlappedInterval: boolean;
  workerMessageOverlappedInterval: boolean;
  precedingFrameMs: number | null;
  followingFrameMs: number | null;
};

// FRAME-1 B: nearest-rank p99.9 of every measured interval. Both time
// limits are inclusive; up to 0.1 percent may exceed 50 ms, none may exceed 200 ms.
export function scrollFrameTargets(frames: readonly number[]) {
  if (
    !frames.length ||
    frames.some((value) => !Number.isFinite(value) || value < 0)
  )
    throw new Error('Missing or invalid scroll frame samples.');
  const sorted = [...frames].sort((a, b) => a - b);
  const frameP999Ms = sorted[Math.ceil(sorted.length * 0.999) - 1]!;
  const maxFrameMs = sorted.at(-1)!;
  return {
    frameP999Ms,
    maxFrameMs,
    framesOver50Ms: frames.filter((value) => value > 50).length,
    targets: {
      scrollFramesP999Under50: frameP999Ms <= 50,
      noScrollFrameOver200: maxFrameMs <= 200,
    },
  };
}

export function installScrollObserver() {
  const panel = document.querySelector<HTMLElement>('[role="tabpanel"]');
  if (!panel) throw new Error('Connected scroll panel missing.');
  panel.scrollTop = 0;
  const frames: number[] = [];
  const outliersOver50Ms: ScrollOutlier[] = [];
  const visited = new Set<string>();
  const visible = new Set<string>();
  const readActivity = Reflect.get(window, '__scaleActivity') as () => {
    feedWindowInFlight: boolean;
    workerMessageInFlight: boolean;
    feedWindowOverlappedInterval: boolean;
    workerMessageOverlappedInterval: boolean;
  };
  let maxDomCards = 0;
  let previous: number | null = null;
  let previousFocus: number | null = null;
  let previousLoading = false;
  let loadingFrames = 0;
  const begin = performance.now();
  let active = true;
  function step(now: number) {
    if (!active) return;
    const feed = document.querySelector<HTMLElement>('[role="feed"]');
    const loading = feed?.getAttribute('aria-busy') === 'true';
    const focused = document.activeElement?.closest('article[data-card-id]');
    const position = Number(focused?.getAttribute('aria-posinset'));
    const focusedCardIndex =
      Number.isInteger(position) && position > 0 ? position - 1 : null;
    const activity = readActivity();
    if (previous !== null) {
      const durationMs = now - previous;
      const last = outliersOver50Ms.at(-1);
      if (last?.frameIndex === frames.length - 1)
        last.followingFrameMs = durationMs;
      if (durationMs > 50)
        outliersOver50Ms.push({
          frameIndex: frames.length,
          durationMs,
          sinceScrollStartMs: now - begin,
          focusedCardIndex,
          focusedCardIndexBefore: previousFocus,
          loadingFrame: loading,
          loadingFrameBefore: previousLoading,
          ...activity,
          precedingFrameMs: frames.at(-1) ?? null,
          followingFrameMs: null,
        });
      frames.push(durationMs);
    }
    previous = now;
    previousFocus = focusedCardIndex;
    previousLoading = loading;
    const cards = [
      ...(feed?.querySelectorAll<HTMLElement>('article[data-card-id]') ?? []),
    ];
    maxDomCards = Math.max(maxDomCards, cards.length);
    const bounds = panel!.getBoundingClientRect();
    for (const card of cards) {
      const id = card.dataset['cardId']!;
      visited.add(id);
      const box = card.getBoundingClientRect();
      if (
        box.bottom > Math.max(0, bounds.top) &&
        box.top < Math.min(innerHeight, bounds.bottom)
      )
        visible.add(id);
    }
    if (loading) loadingFrames++;
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
  Reflect.set(window, '__scaleFinishScroll', () => {
    active = false;
    const sorted = [...frames].sort((a, b) => a - b);
    return {
      method:
        'Sequential Playwright ArrowDown; await each expected focused visible card and two paint opportunities before the next key',
      outlierContextMethod:
        'Zero-based frame/card indexes; rAF endpoint DOM snapshots, request/worker pending flags and any lifetime overlap since preceding rAF; not CPU or GC attribution. Neighbor null at capture boundary.',
      durationMs: performance.now() - begin,
      frames,
      outliersOver50Ms,
      frameCount: frames.length,
      frameP95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
      maxFrameMs: sorted.at(-1),
      framesOver50Ms: outliersOver50Ms.length,
      maxDomCards,
      uniqueRendered: visited.size,
      uniqueVisible: visible.size,
      loadingFrames,
      lastVisible: [...visible].at(-1),
    };
  });
}

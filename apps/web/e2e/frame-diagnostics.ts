import type { Page } from '@playwright/test';

/** Test-only opt-in attribution. Request lifetimes are not synchronous CPU time. */
export async function observeFeedFrames(page: Page) {
  await page.addInitScript(() => {
    const events: {
      kind: string;
      start: number;
      end: number;
      detail: string;
    }[] = [];
    const frames: { start: number; end: number; overlapping: typeof events }[] =
      [];
    let active = false;
    const record = (kind: string, start: number, detail: string) => {
      events.push({ kind, start, end: performance.now(), detail });
      if (events.length > 500) events.shift();
    };
    const mark = (kind: string, detail: string) => {
      const start = performance.now();
      performance.mark(`feed-diagnostic:${kind}`);
      record(kind, start, detail);
      performance.clearMarks(`feed-diagnostic:${kind}`);
    };
    const hook = {
      supportsFiber: true,
      inject: () => 1,
      onCommitFiberRoot: (_renderer: unknown, root: unknown) => {
        const fiber = root as {
          current?: { actualDuration?: number; treeBaseDuration?: number };
        };
        const end = performance.now();
        const duration = fiber.current?.actualDuration;
        if (active) mark('react-commit-mark', 'production commit boundary');
        events.push({
          kind: 'react-commit',
          start: end - (duration ?? 0),
          end,
          detail:
            duration === undefined
              ? 'commit timestamp only; production duration unavailable'
              : `actualDuration=${duration}`,
        });
        if (events.length > 500) events.shift();
      },
      onCommitFiberUnmount: () => {},
    };
    Reflect.set(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', hook);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Invoked below with the original receiver through call(this).
    const measure = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      const start = performance.now();
      const result = measure.call(this);
      const duration = performance.now() - start;
      if (duration >= 1)
        record(
          'layout-read',
          start,
          this.tagName === 'ARTICLE'
            ? `article:${this.getAttribute('aria-posinset')}`
            : (this.getAttribute('role') ?? this.tagName),
        );
      return result;
    };
    const observer = new MutationObserver(() => {
      const start = performance.now();
      const feed = document.querySelector('[role="feed"]');
      record(
        'feed-dom-commit',
        start,
        `mounted=${feed?.querySelectorAll('article').length ?? 0}`,
      );
    });
    observer.observe(document, { childList: true, subtree: true });
    if (PerformanceObserver.supportedEntryTypes.includes('longtask'))
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          events.push({
            kind: 'longtask',
            start: entry.startTime,
            end: entry.startTime + entry.duration,
            detail: entry.name,
          });
      }).observe({ type: 'longtask', buffered: true });
    let previous: number | undefined;
    function tick(now: number) {
      if (active && previous !== undefined && now - previous > 50) {
        const start = previous;
        frames.push({
          start,
          end: now,
          overlapping: events
            .filter((event) => event.end >= start && event.start <= now)
            .slice(-100),
        });
        if (frames.length > 100) frames.shift();
      }
      previous = now;
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    Reflect.set(window, '__feedFrameDiagnostics', {
      start() {
        active = true;
        previous = undefined;
        events.length = 0;
        frames.length = 0;
      },
      read() {
        active = false;
        return {
          frames,
          trailingEvents: events,
          boundary:
            'React production commit timestamps, DOM mutations and timed layout reads; overlapping asynchronous window waits do not prove CPU cause',
        };
      },
      record,
      mark,
    });
  });
  return {
    async start() {
      await page.evaluate(() => {
        const diagnostics = Reflect.get(window, '__feedFrameDiagnostics') as {
          start: () => void;
          record: (kind: string, start: number, detail: string) => void;
          mark: (kind: string, detail: string) => void;
        };
        const original = window.workspace.feedWindow.bind(window.workspace);
        window.workspace.feedWindow = async (input) => {
          const start = performance.now();
          diagnostics.mark(
            'window-start',
            `offset=${input.offset ?? 'anchor'}`,
          );
          try {
            return await original(input);
          } finally {
            diagnostics.mark(
              'window-end',
              `offset=${input.offset ?? 'anchor'}`,
            );
            diagnostics.record(
              'window-lifetime',
              start,
              `offset=${input.offset ?? 'anchor'}`,
            );
          }
        };
        diagnostics.start();
      });
    },
    read: () =>
      page.evaluate(() =>
        (
          Reflect.get(window, '__feedFrameDiagnostics') as {
            read: () => unknown;
          }
        ).read(),
      ),
  };
}

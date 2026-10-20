import type { Page, TestInfo } from '@playwright/test';

/** Metadata-only trace, installed by this generated-fixture E2E entrypoint. */
export async function traceReviewNavigation(page: Page, chromium: boolean) {
  if (chromium) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  await page.addInitScript(() => {
    const events: unknown[] = [];
    const windows = new Map<string, { offset: number; limit: number }>();
    const record = (kind: string, detail: unknown) => {
      events.push({ at: performance.now(), kind, detail });
      if (events.length > 200) events.shift();
    };
    Reflect.set(globalThis, '__reviewNavigationTrace', { events });
    const WorkerClass = Worker;
    globalThis.Worker = class extends WorkerClass {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', (event: MessageEvent<unknown>) => {
          const value = event.data as {
            type?: string;
            requestId?: string;
            rows?: { id: string }[];
          };
          if (value.type !== 'rows' || !value.requestId) return;
          record('rows', {
            requestId: value.requestId,
            window: windows.get(value.requestId),
            count: value.rows?.length,
            firstId: value.rows?.[0]?.id,
            lastId: value.rows?.at(-1)?.id,
          });
        });
      }
      override postMessage(
        message: unknown,
        options?: Transferable[] | StructuredSerializeOptions,
      ) {
        const value = message as {
          type?: string;
          requestId?: string;
          offset?: number;
          limit?: number;
        };
        if (value.type === 'window' && value.requestId) {
          const window = {
            offset: value.offset ?? 0,
            limit: value.limit ?? 0,
          };
          windows.set(value.requestId, window);
          record('window', { requestId: value.requestId, ...window });
        }
        super.postMessage(
          message,
          Array.isArray(options) ? options : (options?.transfer ?? []),
        );
      }
    };
    document.addEventListener(
      'keydown',
      (event) => {
        const grid = event.target as HTMLElement | null;
        if (grid?.getAttribute('role') !== 'grid') return;
        record('key', {
          key: event.key,
          shift: event.shiftKey,
          active: grid.getAttribute('aria-activedescendant'),
        });
      },
      true,
    );
    document.addEventListener(
      'scroll',
      (event) => {
        const grid = event.target as HTMLElement | null;
        if (grid?.getAttribute?.('role') === 'grid')
          record('scroll', { scrollTop: grid.scrollTop });
      },
      true,
    );
  });
}

export async function captureReviewNavigation(page: Page, info: TestInfo) {
  const trace = await page.evaluate(() => {
    const grid = document.querySelector<HTMLElement>('[role="grid"]');
    const active = grid?.getAttribute('aria-activedescendant') ?? null;
    const target = active ? document.getElementById(active) : null;
    const events =
      (
        Reflect.get(globalThis, '__reviewNavigationTrace') as
          { events?: unknown[] } | undefined
      )?.events ?? [];
    return {
      current: {
        active,
        targetExists: !!target,
        targetIndex: target?.parentElement?.getAttribute('data-index'),
        targetSelected: target?.parentElement?.getAttribute('aria-selected'),
        scrollTop: grid?.scrollTop ?? null,
        scrollHeight: grid?.scrollHeight ?? null,
        clientHeight: grid?.clientHeight ?? null,
        rows: [...(grid?.querySelectorAll('[role="row"]') ?? [])].map(
          (row) => ({
            index: row.getAttribute('data-index'),
            ariaIndex: row.getAttribute('aria-rowindex'),
            selected: row.getAttribute('aria-selected'),
            cellId: row.querySelector('[role="gridcell"]')?.id,
            top: row.getBoundingClientRect().top,
          }),
        ),
      },
      loadedIds: window.workspace.rows.map((row) => row.id),
      events,
    };
  });
  console.log('W2A_CURRENT', JSON.stringify(trace.current));
  await info.attach('review-navigation.json', {
    body: JSON.stringify(trace, null, 2),
    contentType: 'application/json',
  });
}

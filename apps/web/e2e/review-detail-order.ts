import type { Page, TestInfo } from '@playwright/test';

/** Holds a real worker reply to make the view-change/keyboard ordering observable. */
export async function traceDetailOrder(page: Page, throttle = false) {
  if (throttle) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  await page.addInitScript(() => {
    const events: unknown[] = [];
    let armed = false;
    let queryId = '';
    let generation = 0;
    let held: (() => void) | null = null;
    const record = (kind: string, data: unknown) => {
      events.push({ at: performance.now(), kind, data });
      if (events.length > 400) events.shift();
    };
    Reflect.set(globalThis, '__detailOrder', {
      events,
      arm: () => {
        armed = true;
      },
      release: () => {
        const reply = held;
        held = null;
        reply?.();
      },
      isHeld: () => !!held,
    });
    const RealWorker = Worker;
    globalThis.Worker = class extends RealWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', (event: MessageEvent<unknown>) => {
          const reply = event.data as {
            type?: string;
            generation?: number;
            requestId?: string;
            rows?: unknown[];
          };
          record('reply', {
            type: reply.type,
            generation: reply.generation,
            requestId: reply.requestId,
            rows: reply.rows?.length,
          });
          if (
            armed &&
            reply.type === 'rows' &&
            reply.generation === generation
          ) {
            armed = false;
            event.stopImmediatePropagation();
            held = () =>
              this.dispatchEvent(
                new MessageEvent('message', { data: event.data }),
              );
            record('held', { generation });
          }
        });
      }
      override postMessage(
        message: unknown,
        options?: Transferable[] | StructuredSerializeOptions,
      ) {
        const request = message as {
          type?: string;
          queryId?: string;
          generation?: number;
          search?: string;
          requestId?: string;
          offset?: number;
        };
        if (armed && request.type === 'query' && request.search === '') {
          queryId = request.queryId ?? '';
          generation = request.generation ?? 0;
        }
        record('request', {
          type: request.type,
          queryId: request.queryId,
          generation: request.generation,
          requestId: request.requestId,
          offset: request.offset,
          emptySearch: request.search === '',
          targetQuery: request.queryId === queryId,
        });
        super.postMessage(
          message,
          Array.isArray(options) ? options : (options?.transfer ?? []),
        );
      }
    };
    for (const type of ['keydown', 'focusin', 'focusout'])
      document.addEventListener(
        type,
        (event) => {
          const target = event.target as HTMLElement;
          record(type, {
            key: (event as KeyboardEvent).key,
            target: {
              tag: target.tagName,
              role: target.getAttribute?.('role'),
              type: target.getAttribute?.('type'),
            },
            activeRole: document.activeElement?.getAttribute('role'),
            activeCell: document
              .querySelector('[role="grid"]')
              ?.getAttribute('aria-activedescendant'),
            rows: document.querySelectorAll('[role="row"]').length,
          });
        },
        true,
      );
  });
}

export async function captureDetailOrder(page: Page, info: TestInfo) {
  const trace = await page.evaluate(() => ({
    events: (
      Reflect.get(globalThis, '__detailOrder') as
        { events: unknown[] } | undefined
    )?.events,
    final: {
      activeRole: document.activeElement?.getAttribute('role'),
      activeTag: document.activeElement?.tagName,
      rows: document.querySelectorAll('[role="row"]').length,
      detailOpen: document
        .querySelector('[data-testid="review"]')
        ?.getAttribute('data-detail-open'),
    },
  }));
  console.log('DETAIL_ORDER', JSON.stringify(trace));
  await info.attach('detail-order.json', {
    body: JSON.stringify(trace, null, 2),
    contentType: 'application/json',
  });
}

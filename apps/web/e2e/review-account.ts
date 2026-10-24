import type { Page, TestInfo } from '@playwright/test';

const traces = new WeakMap<Page, unknown[]>();

/** Synthetic-demo trace and a test-only route-task delay; never imported by the app. */
export async function traceReviewAccount(page: Page) {
  if (!traces.has(page)) {
    const events: unknown[] = [];
    traces.set(page, events);
    page.on('console', (message) => {
      if (!message.text().startsWith('REVIEW_ACCOUNT_TRACE ')) return;
      events.push(
        JSON.parse(
          message.text().slice('REVIEW_ACCOUNT_TRACE '.length),
        ) as unknown,
      );
      if (events.length > 100) events.shift();
    });
  }
  await page.evaluate(() => {
    const events: unknown[] = [];
    Reflect.set(globalThis, '__reviewAccountTrace', events);
    const nodes = new WeakMap<Element, number>();
    let count = 0;
    const nodeId = (element: Element | null) => {
      if (!element) return null;
      if (!nodes.has(element)) nodes.set(element, ++count);
      return nodes.get(element);
    };
    const snapshot = () => {
      const grid = document.querySelector<HTMLElement>('[role="grid"]');
      const select = document.querySelector<HTMLSelectElement>(
        '[data-testid="review"] select',
      );
      const active = grid?.getAttribute('aria-activedescendant');
      return {
        hash: location.hash,
        grid: nodeId(grid),
        select: nodeId(select),
        account: select?.value,
        active,
        targetExists: !!(active && document.getElementById(active)),
        scrollTop: grid?.scrollTop,
        generation: document
          .querySelector('[data-testid="review"]')
          ?.getAttribute('data-generation'),
        rows: window.workspace.rows
          .slice(0, 2)
          .map((row) => ({ id: row.id, decision: row.decision })),
      };
    };
    const record = (kind: string, detail: unknown) => {
      const event = { at: performance.now(), kind, detail };
      events.push(event);
      if (events.length > 100) events.shift();
      console.debug('REVIEW_ACCOUNT_TRACE ' + JSON.stringify(event));
    };
    const request = window.workspace.request.bind(window.workspace);
    window.workspace.request = (message, transfer) => {
      if (
        ['query', 'window', 'setReviewView', 'decide', 'open'].includes(
          message.type,
        )
      )
        record('request', message);
      const reply = request(message, transfer);
      void reply.then((value) => {
        if (
          [
            'opened',
            'queryResult',
            'rows',
            'committed',
            'reviewViewChanged',
          ].includes(value.type)
        ) {
          if (value.type === 'rows')
            record('reply', {
              type: value.type,
              requestId: value.requestId,
              generation: value.generation,
              first: value.rows[0]?.id,
            });
          else if (value.type === 'opened')
            record('reply', {
              type: value.type,
              requestId: value.requestId,
              review: value.summary.review,
            });
          else record('reply', value);
        }
      });
      return reply;
    };
    window.addEventListener('hashchange', () =>
      record('hashchange', snapshot()),
    );
    document.addEventListener(
      'change',
      (event) => {
        const target = event.target as HTMLElement | null;
        if (target?.tagName === 'SELECT')
          record('change', {
            targetView: target
              .closest('[data-testid]')
              ?.getAttribute('data-testid'),
            value: (target as HTMLSelectElement).value,
            ...snapshot(),
          });
      },
      true,
    );
    document.addEventListener(
      'keydown',
      (event) => {
        if (
          (event.target as HTMLElement | null)?.getAttribute('role') === 'grid'
        )
          record('key', { key: event.key, ...snapshot() });
      },
      true,
    );
    Reflect.set(globalThis, '__reviewAccountSnapshot', snapshot);
    // Deliver the real route notification later, as a separate browser task.
    // The old card view remains actionable until the list has actually mounted.
    const replayed = new WeakSet<Event>();
    window.addEventListener(
      'hashchange',
      (event) => {
        if (replayed.has(event) || !event.newURL.endsWith('#/review/list'))
          return;
        event.stopImmediatePropagation();
        const delayed = new HashChangeEvent('hashchange', {
          oldURL: event.oldURL,
          newURL: event.newURL,
        });
        replayed.add(delayed);
        record('hold-list-route', snapshot());
        setTimeout(() => {
          record('release-list-route', snapshot());
          window.dispatchEvent(delayed);
        }, 500);
      },
      true,
    );
  });
}

export async function captureReviewAccount(page: Page, info: TestInfo) {
  // A diagnostic must not wait on the page whose first failure it records.
  const trace = { events: traces.get(page) ?? [], capturedFrom: 'node-events' };
  console.log('ACCOUNT_TRACE', JSON.stringify(trace));
  try {
    await info.attach('review-account.json', {
      body: JSON.stringify(trace, null, 2),
      contentType: 'application/json',
    });
  } catch (error) {
    console.error('ACCOUNT_TRACE_CAPTURE_ERROR', String(error));
  }
}

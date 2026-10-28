import { test, expect } from '@playwright/test';
import { waitForApp } from './helpers.ts';

test('late first-control notification cannot revoke the verified import gate', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const service = navigator.serviceWorker;
    const add = service.addEventListener.bind(service);
    service.addEventListener = (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (type !== 'controllerchange' || typeof listener !== 'function')
        return add(type, listener, options);
      add(
        type,
        (event) => {
          // Keep the real first-control event. Only deliver the gate's listener
          // once its worker handshake has overtaken that notification.
          if (!listener.toString().includes('preparing'))
            return listener.call(service, event);
          const observer = new MutationObserver(() => {
            if (!document.querySelector('main[data-gate="ready"]')) return;
            observer.disconnect();
            listener.call(service, event);
            Reflect.set(window, '__lateControlDelivered', true);
          });
          observer.observe(document, {
            subtree: true,
            attributes: true,
            childList: true,
          });
        },
        options,
      );
    };
  });
  await waitForApp(page);
  await expect
    .poll(() =>
      page.evaluate(
        () => Reflect.get(window, '__lateControlDelivered') === true,
      ),
    )
    .toBe(true);
  await expect(page.locator('main[data-gate]')).toHaveAttribute(
    'data-gate',
    'ready',
  );
  await expect(page.getByTestId('import-state')).toHaveAttribute(
    'data-phase',
    'idle',
  );
});

test('a different controlling worker still closes the import gate', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const service = navigator.serviceWorker;
    const add = service.addEventListener.bind(service);
    service.addEventListener = (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) => {
      if (
        type !== 'controllerchange' ||
        typeof listener !== 'function' ||
        !listener.toString().includes('reload')
      )
        return add(type, listener, options);
      // A synthetic revocation has no new shell to reload. Observe the gate
      // independently of the separate coordinated-update page reload.
      add(
        type,
        (event) => {
          if (event.isTrusted) listener.call(service, event);
        },
        options,
      );
    };
  });
  await waitForApp(page);
  await page.evaluate(() => {
    Object.defineProperty(navigator.serviceWorker, 'controller', {
      get: () => null,
    });
    navigator.serviceWorker.dispatchEvent(new Event('controllerchange'));
  });
  await expect(page.locator('main[data-gate]')).toHaveAttribute(
    'data-gate',
    'preparing',
  );
  await expect(page.getByTestId('archives')).toHaveCount(0);
  await expect(page.getByTestId('import-state')).toHaveCount(0);
});

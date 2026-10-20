import { appendFileSync } from 'node:fs';
import { vi } from 'vitest';
import type { BrowserContext } from 'playwright-core';
import * as driver from '../src/browser/instagram/driver.ts';
import * as confirmation from '../src/browser/confirmation.ts';
import * as capture from '../src/browser/instagram/capture.ts';
import type { ConfirmationView } from '../src/browser/confirmation.ts';

/** Opt-in evidence from generated tests only; never imported by a CLI entry. */
export function contextDiagnostics(variant: string) {
  // eslint-disable-next-line no-restricted-properties -- Test-only timing output.
  const file = process.env['SP_CONTEXT_DIAGNOSTICS'];
  const start = performance.now();
  const event = (kind: string, value: Record<string, unknown> = {}) => {
    if (file)
      appendFileSync(
        file,
        JSON.stringify({
          variant,
          ms: performance.now() - start,
          kind,
          ...value,
        }) + '\n',
      );
  };
  const restore: (() => void)[] = [];
  let phase: ConfirmationView['phase'] | undefined;
  let pending: string | undefined;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const originalConfirmation = confirmation.startConfirmation;
  const confirmationSpy = vi
    .spyOn(confirmation, 'startConfirmation')
    .mockImplementation(async (...args) => {
      const server = await originalConfirmation(...args);
      phase = args[0].phase;
      const wait = server.wait.bind(server);
      server.wait = (action) => {
        pending = action;
        notify();
        return wait(action).then((result) => {
          pending = undefined;
          notify();
          return result;
        });
      };
      const update = server.update.bind(server);
      server.update = (value) => {
        event('server:view', {
          phase: value.phase,
          completed: value.completed,
        });
        update(value);
        phase = value.phase ?? phase;
        notify();
      };
      return server;
    });
  restore.push(() => confirmationSpy.mockRestore());
  if (file) {
    const originalCapture = capture.capturePost;
    const captureSpy = vi
      .spyOn(capture, 'capturePost')
      .mockImplementation(async (...args) => {
        event('capture:start');
        try {
          return await originalCapture(...args);
        } finally {
          event('capture:end');
        }
      });
    restore.push(() => captureSpy.mockRestore());
    const timed = async <T>(
      name: string,
      read: () => Promise<T>,
    ): Promise<T> => {
      event(name + ':start');
      try {
        return await read();
      } finally {
        event(name + ':end');
      }
    };
    const loadList = driver.loadList,
      openCandidate = driver.openCandidate,
      confirmOnPost = driver.confirmOnPost;
    const listSpy = vi
      .spyOn(driver, 'loadList')
      .mockImplementation((...args) =>
        timed('loadList', () => loadList(...args)),
      );
    const openSpy = vi
      .spyOn(driver, 'openCandidate')
      .mockImplementation((...args) =>
        timed('openCandidate', () => openCandidate(...args)),
      );
    const confirmSpy = vi
      .spyOn(driver, 'confirmOnPost')
      .mockImplementation((...args) =>
        timed('confirmOnPost', () => confirmOnPost(...args)),
      );
    restore.push(
      () => listSpy.mockRestore(),
      () => openSpy.mockRestore(),
      () => confirmSpy.mockRestore(),
    );
  }
  return {
    event,
    waitForAction(name: string) {
      const action = (
        {
          Start: 'start',
          Continue: 'continue',
          Weiter: 'continue',
          Matches: 'matches',
          Passt: 'matches',
          'Does not match': 'matches',
          'Passt nicht': 'matches',
        } as Record<string, string>
      )[name];
      if (!action) return Promise.resolve();
      const expected =
        action === 'start'
          ? 'start'
          : action === 'continue'
            ? 'canary'
            : 'match';
      return new Promise<void>((resolve, reject) => {
        const check = () => {
          if (phase === 'ended') {
            listeners.delete(check);
            reject(new Error(`Run ended before ${name}`));
          } else if (pending === action && phase === expected) {
            listeners.delete(check);
            event('action:ready', { name });
            resolve();
          }
        };
        listeners.add(check);
        check();
      });
    },
    observe(context: BrowserContext) {
      if (!file) return;
      const observePage = (page: import('playwright-core').Page) => {
        page.on('framenavigated', (frame) => {
          if (frame === page.mainFrame())
            event('navigation', { path: new URL(page.url()).pathname });
        });
      };
      for (const page of context.pages()) observePage(page);
      context.on('page', observePage);
      context.on('response', (response) => {
        const path = new URL(response.url()).pathname;
        if (!['/api/action', '/api/view'].includes(path)) return;
        void response
          .json()
          .then((body: unknown) => {
            const view = body as { phase?: string; version?: number };
            event('http:' + path, {
              status: response.status(),
              phase: view.phase,
              version: view.version,
              action:
                path === '/api/action'
                  ? response.request().postDataJSON()
                  : undefined,
            });
          })
          .catch(() => {});
      });
    },
    close() {
      for (const reset of restore) reset();
    },
  };
}

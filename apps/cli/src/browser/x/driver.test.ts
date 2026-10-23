import { EventEmitter } from 'node:events';
import { expect, test, vi } from 'vitest';
import type { BrowserContext, Page, Locator, Response } from 'playwright-core';
import { pageDriver } from './driver.ts';
import { xSelectors } from './selectors.ts';
import { CliError } from '../../cli/errors.ts';

test.each([
  'missing-confirmation',
  'page-check',
  'invalid-json',
  'http-error',
] as const)(
  'D2 after final click %s retains ambiguity instead of permitting another send',
  async (mode) => {
    const finalClick = vi.fn(() => Promise.resolve());
    const control = { click: () => Promise.resolve() } as unknown as Locator;
    const final = { click: finalClick } as unknown as Locator;
    const spies = [
      vi.spyOn(xSelectors, 'state').mockResolvedValue('present'),
      vi.spyOn(xSelectors, 'more').mockResolvedValue(control),
      vi.spyOn(xSelectors, 'deleteMenu').mockResolvedValue(control),
      vi.spyOn(xSelectors, 'confirm').mockResolvedValue(final),
      vi.spyOn(xSelectors, 'confirmation').mockImplementation(() => {
        if (mode === 'page-check')
          throw new CliError(
            'PLATFORM_CHECK',
            undefined,
            undefined,
            'marker-rate-limit',
          );
        return Promise.resolve(false);
      }),
    ];
    const response = {
      request: () => ({ method: () => 'POST' }),
      url: () => 'http://127.0.0.1/i/api/graphql/generated/DeleteTweet',
      status: () => (mode === 'http-error' ? 500 : 200),
      json: () =>
        mode === 'invalid-json'
          ? Promise.reject(new SyntaxError('Generated private body'))
          : Promise.resolve({ data: {} }),
    } as unknown as Response;
    const page = {
      isClosed: () => false,
      url: () => 'http://127.0.0.1/i/web/status/1001',
      waitForResponse: () => Promise.resolve(response),
      getByTestId: () => ({ waitFor: () => Promise.resolve() }),
    } as unknown as Page;
    const context = Object.assign(new EventEmitter(), {
      pages: () => [page],
      newPage: () => Promise.resolve(page),
      route: () => Promise.resolve(),
      routeWebSocket: () => Promise.resolve(),
    }) as unknown as BrowserContext;
    try {
      const driver = await pageDriver({
        context,
        origin: 'http://127.0.0.1',
        allowedOrigins: ['http://127.0.0.1'],
        responseTimeoutMs: 10,
        record: () => Promise.resolve(),
      });
      const result = await driver.delete('1001', 'delete-post');
      expect(finalClick).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        state: 'ambiguous',
        code:
          mode === 'page-check'
            ? 'PLATFORM_CHECK'
            : mode === 'invalid-json'
              ? 'INVALID_RESPONSE'
              : mode === 'http-error'
                ? 'PLATFORM_RESPONSE'
                : 'CONFIRMATION_MISSING',
      });
      expect(JSON.stringify(result)).not.toContain('Generated private body');
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  },
);

test('D2 an original-only repost timestamp fails closed with focal-count before any click', async () => {
  const state = vi
    .spyOn(xSelectors, 'state')
    .mockRejectedValue(
      new CliError('PLATFORM_CHECK', undefined, undefined, 'render-timeout'),
    );
  const page = {
    isClosed: () => false,
    url: () => 'http://127.0.0.1/i/web/status/1004',
    goto: () => Promise.resolve(),
    locator: () => ({ count: () => Promise.resolve(1) }),
  } as unknown as Page;
  const context = Object.assign(new EventEmitter(), {
    pages: () => [page],
    newPage: () => Promise.resolve(page),
    route: () => Promise.resolve(),
    routeWebSocket: () => Promise.resolve(),
  }) as unknown as BrowserContext;
  try {
    const driver = await pageDriver({
      context,
      origin: 'http://127.0.0.1',
      allowedOrigins: ['http://127.0.0.1'],
      responseTimeoutMs: 10,
      record: () => Promise.resolve(),
    });
    await expect(driver.inspect('1004')).rejects.toMatchObject({
      code: 'PLATFORM_CHECK',
      reason: 'focal-count',
    });
  } finally {
    state.mockRestore();
  }
});

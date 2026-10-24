import { EventEmitter } from 'node:events';
import type { Page, TestInfo } from '@playwright/test';
import { afterEach, expect, test, vi } from 'vitest';
import {
  captureReviewAccount,
  traceReviewAccount,
} from '../e2e/review-account.ts';

afterEach(() => vi.restoreAllMocks());

test('failure capture does not evaluate the failed page', async () => {
  const evaluate = vi.fn().mockRejectedValue(new Error('Page is stalled.'));
  const page = { evaluate } as unknown as Page;
  const attach = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(console, 'log').mockImplementation(() => {});

  await captureReviewAccount(page, { attach } as unknown as TestInfo);

  expect(evaluate).not.toHaveBeenCalled();
  expect(attach).toHaveBeenCalledWith('review-account.json', {
    body: JSON.stringify({ events: [], capturedFrom: 'node-events' }, null, 2),
    contentType: 'application/json',
  });
});

test('failure capture retains the last hundred observed events across a lost page', async () => {
  const events = new EventEmitter();
  const evaluate = vi.fn().mockResolvedValue(undefined);
  const page = Object.assign(events, { evaluate }) as unknown as Page;
  const attach = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  await traceReviewAccount(page);
  events.emit('console', { text: () => 'Other output' });
  for (let index = 0; index < 105; index++)
    events.emit('console', {
      text: () => `REVIEW_ACCOUNT_TRACE ${JSON.stringify({ index })}`,
    });
  evaluate.mockClear().mockRejectedValue(new Error('Page is gone.'));

  await captureReviewAccount(page, { attach } as unknown as TestInfo);

  expect(evaluate).not.toHaveBeenCalled();
  expect(attach).toHaveBeenCalledWith('review-account.json', {
    body: JSON.stringify(
      {
        events: Array.from({ length: 100 }, (_, index) => ({
          index: index + 5,
        })),
        capturedFrom: 'node-events',
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
});

test('an attachment failure cannot replace the original test failure', async () => {
  const attach = vi.fn().mockRejectedValue(new Error('Attachment failed.'));
  const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const original = new Error('Original assertion.');
  const failedTest = async () => {
    try {
      throw original;
    } catch (error) {
      await captureReviewAccount({} as Page, { attach } as unknown as TestInfo);
      throw error;
    }
  };

  await expect(failedTest()).rejects.toBe(original);
  expect(diagnostic).toHaveBeenCalledWith(
    'ACCOUNT_TRACE_CAPTURE_ERROR',
    'Error: Attachment failed.',
  );
});

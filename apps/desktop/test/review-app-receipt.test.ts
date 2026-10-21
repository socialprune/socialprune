import { expect, test, vi } from 'vitest';
import { readReviewAppReceipt } from '../packaging/review-app-launch.ts';

test('receipt replacement retries ENOENT and EBUSY under the existing bound and counts both', async () => {
  vi.useFakeTimers();
  const read = vi
    .fn()
    .mockRejectedValueOnce(
      Object.assign(new Error('replacement'), { code: 'ENOENT' }),
    )
    .mockRejectedValueOnce(
      Object.assign(new Error('sharing'), { code: 'EBUSY' }),
    )
    .mockResolvedValue('{"state":"running","pid":1}');
  let retries = 0;
  try {
    const result = readReviewAppReceipt(
      'owned.json',
      () => retries++,
      read,
    ).then(
      (value) => value,
      (error: unknown) => {
        throw error;
      },
    );
    void result.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(50);
    expect(await result).toMatchObject({ state: 'running', pid: 1 });
    expect(retries).toBe(2);
    expect(read).toHaveBeenCalledTimes(3);
  } finally {
    vi.useRealTimers();
  }
});

test('a permanently missing receipt fails after the same 20 retries, while malformed JSON and other errors fail immediately', async () => {
  vi.useFakeTimers();
  try {
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
    const read = vi.fn().mockRejectedValue(missing);
    const result = readReviewAppReceipt(
      'owned.json',
      () => undefined,
      read,
    ).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(500);
    expect(await result).toBe(missing);
    expect(read).toHaveBeenCalledTimes(21);
    const malformed = vi.fn().mockResolvedValue('{"state":');
    await expect(
      readReviewAppReceipt('owned.json', () => undefined, malformed),
    ).rejects.toBeInstanceOf(SyntaxError);
    expect(malformed).toHaveBeenCalledOnce();
    for (const failure of [
      new SyntaxError('broken JSON'),
      Object.assign(new Error('denied'), { code: 'EACCES' }),
    ]) {
      const reader = vi.fn().mockRejectedValue(failure);
      await expect(
        readReviewAppReceipt('owned.json', () => undefined, reader),
      ).rejects.toBe(failure);
      expect(reader).toHaveBeenCalledOnce();
    }
  } finally {
    vi.useRealTimers();
  }
});

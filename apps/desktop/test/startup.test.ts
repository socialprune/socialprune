import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WebContents } from 'electron';
import { afterEach, expect, test, vi } from 'vitest';
import { APP_URL } from '../src/main/policy.ts';
import {
  appendStartupFailure,
  loadReview,
  STARTUP_BOUND_MS,
  STARTUP_LOG_BYTES,
  STARTUP_LOG_RECORDS,
  startupMessage,
} from '../src/main/startup.ts';

afterEach(() => vi.useRealTimers());
async function fixture(locale = 'en') {
  const data = await mkdtemp(join(tmpdir(), 'socialprune-startup-unit-'));
  const contents = Object.assign(new EventEmitter(), {
    getURL: () => APP_URL,
    isDestroyed: () => false,
  });

  const message = vi.fn(() => Promise.resolve({ response: 0 }));
  const quit = vi.fn();
  return {
    data,
    contents,
    message,
    quit,
    options: {
      contents: contents as unknown as WebContents,
      dataDirectory: data,
      locale: () => locale,
      message,
      quit,
    },
  };
}

test('the load-call deadline fires once at 20 seconds without renderer events or resets', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const f = await fixture('de-AT');
  try {
    const loaded = loadReview({
      ...f.options,
      load: () => new Promise<void>(() => undefined),
    });
    await vi.advanceTimersByTimeAsync(19_999);
    expect(f.message).not.toHaveBeenCalled();
    f.contents.emit('did-start-loading');
    await vi.advanceTimersByTimeAsync(1);
    expect(await loaded).toBe(false);
    expect(f.message).toHaveBeenCalledExactlyOnceWith(startupMessage('de-AT'));
    expect(f.quit).toHaveBeenCalledOnce();
    expect(
      JSON.parse(
        (await readFile(join(f.data, 'logs/startup.ndjson'), 'utf8')).trim(),
      ),
    ).toEqual({
      boundMs: 20_000,
      elapsedMs: 20_000,
      trigger: 'TIMEOUT',
      events: ['LOAD_CALLED', 'DID_START'],
      exit: 'QUIT',
    });
    f.contents.emit('render-process-gone');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(f.message).toHaveBeenCalledOnce();
    expect(f.contents.eventNames()).toEqual([]);
  } finally {
    await rm(f.data, { recursive: true, force: true });
  }
});

for (const earlyElapsed of [19_999, 19_999.75])
  test(`an early timer at ${earlyElapsed} ms waits for the monotonic remainder before timing out`, async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const f = await fixture();
    let measured = 1234.5;
    const clock = vi
      .spyOn(performance, 'now')
      .mockImplementation(() => measured);
    const loaded = loadReview({
      ...f.options,
      load: () => new Promise<void>(() => undefined),
    });
    try {
      measured += earlyElapsed;
      await vi.advanceTimersByTimeAsync(STARTUP_BOUND_MS);
      expect(f.message).not.toHaveBeenCalled();
      expect(f.quit).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(1);
      // Repeated early delivery still waits; it cannot round its way across
      // the bound or enter a synchronous retry loop.
      measured = 1234.5 + 19_999.875;
      await vi.advanceTimersByTimeAsync(1);
      expect(f.message).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(1);
      measured = 1234.5 + 20_000.125;
      await vi.advanceTimersByTimeAsync(1);
      expect(await loaded).toBe(false);
      expect(f.message).toHaveBeenCalledOnce();
      expect(f.quit).toHaveBeenCalledOnce();
      const row = JSON.parse(
        (await readFile(join(f.data, 'logs/startup.ndjson'), 'utf8')).trim(),
      ) as { elapsedMs: number; trigger: string };
      expect(row).toMatchObject({ elapsedMs: 20_001, trigger: 'TIMEOUT' });
      expect(vi.getTimerCount()).toBe(0);
      console.log('STARTUP_EARLY_TIMER', JSON.stringify({ earlyElapsed, row }));
    } finally {
      measured = 1234.5 + STARTUP_BOUND_MS;
      await vi.runOnlyPendingTimersAsync();
      await loaded;
      clock.mockRestore();
      await rm(f.data, { recursive: true, force: true });
    }
  });

test('a load settling during the early-fire remainder cancels the replacement timer', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const f = await fixture();
  let now = 0;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  let finish!: () => void;
  try {
    const loaded = loadReview({
      ...f.options,
      load: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    });
    now = 19_999;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(vi.getTimerCount()).toBe(1);
    finish();
    expect(await loaded).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    now = 20_001;
    await vi.advanceTimersByTimeAsync(2);
    expect(f.message).not.toHaveBeenCalled();
    expect(f.quit).not.toHaveBeenCalled();
  } finally {
    clock.mockRestore();
    await rm(f.data, { recursive: true, force: true });
  }
});

test('successful initial load cancels the guard and ignores later failure or second-instance focus', async () => {
  vi.useFakeTimers();
  const f = await fixture();
  try {
    expect(
      await loadReview({
        ...f.options,
        load: () => {
          f.contents.emit('did-start-loading');
          f.contents.emit('did-finish-load');
          return Promise.resolve();
        },
      }),
    ).toBe(true);
    f.contents.emit('render-process-gone');
    f.contents.emit('second-instance');
    await vi.advanceTimersByTimeAsync(STARTUP_BOUND_MS + 1);
    expect(f.message).not.toHaveBeenCalled();
    expect(f.quit).not.toHaveBeenCalled();
    await expect(
      readFile(join(f.data, 'logs/startup.ndjson')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(f.data, { recursive: true, force: true });
  }
});

for (const trigger of [
  'LOAD_FAILED',
  'LOAD_REJECTED',
  'RENDERER_GONE',
] as const)
  test(`${trigger} before the bound shows the message immediately, even when the URL is pending`, async () => {
    const f = await fixture();
    try {
      const loaded = loadReview({
        ...f.options,
        load: () => {
          if (trigger === 'LOAD_REJECTED')
            return Promise.reject(
              new Error('private path and content are never logged'),
            );
          queueMicrotask(() =>
            trigger === 'LOAD_FAILED'
              ? f.contents.emit(
                  'did-fail-load',
                  {},
                  -2,
                  'private value',
                  APP_URL,
                  true,
                )
              : f.contents.emit(
                  'render-process-gone',
                  {},
                  { reason: 'private value' },
                ),
          );
          return new Promise<void>(() => undefined);
        },
      });
      expect(await loaded).toBe(false);
      expect(f.message).toHaveBeenCalledOnce();
      expect(f.quit).toHaveBeenCalledOnce();
      const row = JSON.parse(
        (await readFile(join(f.data, 'logs/startup.ndjson'), 'utf8')).trim(),
      ) as { trigger: string; elapsedMs: number };
      expect(row.trigger).toBe(trigger);
      expect(row.elapsedMs).toBeLessThan(20_000);
    } finally {
      await rm(f.data, { recursive: true, force: true });
    }
  });

test('a subframe failure is ignored and a failed native message still requests the ordinary quit path', async () => {
  const f = await fixture();
  try {
    const loaded = loadReview({
      ...f.options,
      message: () => Promise.reject(new Error('not logged')),
      load: () => {
        f.contents.emit('did-fail-load', {}, -2, 'generated', APP_URL, false);
        return Promise.reject(new Error('generated'));
      },
    });
    expect(await loaded).toBe(false);
    expect(f.quit).toHaveBeenCalledOnce();
    expect(
      JSON.parse(
        (await readFile(join(f.data, 'logs/startup.ndjson'), 'utf8')).trim(),
      ),
    ).toMatchObject({ trigger: 'LOAD_REJECTED' });
  } finally {
    await rm(f.data, { recursive: true, force: true });
  }
});

test('the local startup file retains recent closed records only, including on a second failure', async () => {
  const f = await fixture();
  try {
    const record = {
      boundMs: STARTUP_BOUND_MS,
      elapsedMs: 20_000,
      trigger: 'TIMEOUT',
      events: ['LOAD_CALLED'],
      exit: 'QUIT',
    } as const;
    await mkdir(join(f.data, 'logs'));
    await writeFile(
      join(f.data, 'logs/startup.ndjson'),
      JSON.stringify({ ...record, privateText: 'must disappear' }) + '\n',
    );
    for (let index = 0; index < 20; index++)
      await appendStartupFailure(f.data, {
        ...record,
        elapsedMs: 20_000 + index,
        events: [...record.events],
      });
    const text = await readFile(join(f.data, 'logs/startup.ndjson'), 'utf8');
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(STARTUP_LOG_BYTES);
    expect(text.trim().split('\n')).toHaveLength(STARTUP_LOG_RECORDS);
    expect(text).not.toContain('private');
    expect(text).not.toContain(f.data);
    await writeFile(
      join(f.data, 'logs/startup.ndjson'),
      'foreign'.repeat(10_000),
    );
    await appendStartupFailure(f.data, {
      ...record,
      events: [...record.events],
    });
    expect(
      (await readFile(join(f.data, 'logs/startup.ndjson'), 'utf8'))
        .trim()
        .split('\n'),
    ).toHaveLength(1);
  } finally {
    await rm(f.data, { recursive: true, force: true });
  }
});

test('native startup text has exactly the accepted one-button wording', () => {
  expect(startupMessage('de-DE')).toMatchObject({
    message: 'SocialPrune konnte nicht starten',
    buttons: ['Beenden'],
    defaultId: 0,
    cancelId: 0,
  });
  expect(startupMessage('en-US')).toMatchObject({
    message: 'SocialPrune could not start',
    buttons: ['Quit'],
    defaultId: 0,
    cancelId: 0,
  });
});

test('an unwritable startup log cannot suppress the native message or ordinary quit', async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.data, 'logs'), 'generated obstruction');
    expect(
      await loadReview({
        ...f.options,
        load: () => {
          throw new Error('not logged');
        },
      }),
    ).toBe(false);
    expect(f.message).toHaveBeenCalledOnce();
    expect(f.quit).toHaveBeenCalledOnce();
  } finally {
    await rm(f.data, { recursive: true, force: true });
  }
});

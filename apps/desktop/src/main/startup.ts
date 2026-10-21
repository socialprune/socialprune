import { mkdir, open, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MessageBoxOptions, WebContents } from 'electron';
import { APP_URL } from './policy.ts';

export const STARTUP_BOUND_MS = 20_000;
export const STARTUP_LOG_BYTES = 8_192;
export const STARTUP_LOG_RECORDS = 16;
const events = [
  'LOAD_CALLED',
  'DID_START',
  'DID_FINISH',
  'LOAD_SETTLED',
  'LOAD_REJECTED',
  'DID_FAIL',
  'RENDERER_GONE',
] as const;
type StartupEvent = (typeof events)[number];
type Trigger = 'TIMEOUT' | 'LOAD_FAILED' | 'LOAD_REJECTED' | 'RENDERER_GONE';
export interface StartupRecord {
  boundMs: typeof STARTUP_BOUND_MS;
  elapsedMs: number;
  trigger: Trigger;
  events: StartupEvent[];
  exit: 'QUIT';
}

function closedRecord(value: unknown): StartupRecord | undefined {
  if (typeof value !== 'object' || value === null) return;
  const row = value as Record<string, unknown>;
  if (
    row.boundMs !== STARTUP_BOUND_MS ||
    !Number.isSafeInteger(row.elapsedMs) ||
    Number(row.elapsedMs) < 0 ||
    Number(row.elapsedMs) > 2_147_483_647 ||
    !['TIMEOUT', 'LOAD_FAILED', 'LOAD_REJECTED', 'RENDERER_GONE'].includes(
      String(row.trigger),
    ) ||
    row.exit !== 'QUIT' ||
    !Array.isArray(row.events) ||
    row.events.length > events.length ||
    row.events.some((event) => !events.includes(event as StartupEvent))
  )
    return;
  // Rebuild known fields rather than retaining any extra data in an old file.
  return {
    boundMs: STARTUP_BOUND_MS,
    elapsedMs: Number(row.elapsedMs),
    trigger: row.trigger as Trigger,
    events: [...new Set(row.events as StartupEvent[])],
    exit: 'QUIT',
  };
}

export async function appendStartupFailure(
  dataDirectory: string,
  record: StartupRecord,
): Promise<void> {
  const logs = join(dataDirectory, 'logs');
  await mkdir(logs, { recursive: true });
  const path = join(logs, 'startup.ndjson');
  const retained: StartupRecord[] = [];
  try {
    const file = await open(path, 'r');
    try {
      const bytes = Buffer.alloc(STARTUP_LOG_BYTES + 1);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      if (bytesRead <= STARTUP_LOG_BYTES)
        for (const line of bytes
          .subarray(0, bytesRead)
          .toString('utf8')
          .split('\n')) {
          try {
            const row = closedRecord(JSON.parse(line));
            if (row) retained.push(row);
          } catch {
            /* Discard an incomplete or foreign record. */
          }
        }
    } finally {
      await file.close();
    }
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    )
      throw error;
  }
  const current = closedRecord(record);
  if (!current) throw new Error('STARTUP_LOG_RECORD_INVALID');
  retained.push(current);
  const text = () => retained.map((row) => JSON.stringify(row) + '\n').join('');
  while (
    retained.length > STARTUP_LOG_RECORDS ||
    Buffer.byteLength(text()) > STARTUP_LOG_BYTES
  )
    retained.shift();
  await writeFile(path, text(), { mode: 0o600 });
}

export function startupMessage(locale: string): MessageBoxOptions {
  const german = locale.toLowerCase().startsWith('de');
  return {
    type: 'error',
    title: 'SocialPrune',
    message: german
      ? 'SocialPrune konnte nicht starten'
      : 'SocialPrune could not start',
    buttons: [german ? 'Beenden' : 'Quit'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
}

export function loadReview(options: {
  contents: WebContents;
  load(): Promise<void>;
  dataDirectory: string;
  locale(): string;
  message(box: MessageBoxOptions): Promise<unknown>;
  quit(): void;
}): Promise<boolean> {
  const started = performance.now();
  const observed = new Set<StartupEvent>(['LOAD_CALLED']);
  let settled = false;
  let resolve!: (loaded: boolean) => void;
  const result = new Promise<boolean>((finish) => {
    resolve = finish;
  });
  const cleanup = () => {
    clearTimeout(timer);
    options.contents.removeListener('did-start-loading', didStart);
    options.contents.removeListener('did-finish-load', didFinish);
    options.contents.removeListener('did-fail-load', didFail);
    options.contents.removeListener('render-process-gone', rendererGone);
  };
  const fail = (trigger: Trigger) => {
    if (settled) return;
    settled = true;
    cleanup();
    const record: StartupRecord = {
      boundMs: STARTUP_BOUND_MS,
      elapsedMs: Math.min(
        2_147_483_647,
        Math.max(0, Math.round(performance.now() - started)),
      ),
      trigger,
      events: [...observed],
      exit: 'QUIT',
    };
    void (async () => {
      const writing = appendStartupFailure(options.dataDirectory, record).catch(
        () => {
          console.error('STARTUP_LOG_WRITE_FAILED');
        },
      );
      try {
        await options.message(startupMessage(options.locale()));
      } catch {
        console.error('STARTUP_DIALOG_FAILED');
      } finally {
        await writing;
        options.quit();
        resolve(false);
      }
    })();
  };
  const didStart = () => observed.add('DID_START');
  const didFinish = () => {
    if (options.contents.getURL() === APP_URL) observed.add('DID_FINISH');
  };
  const didFail = (
    _event: unknown,
    _code: number,
    _description: string,
    url: string,
    mainFrame: boolean,
  ) => {
    if (mainFrame && url === APP_URL) {
      observed.add('DID_FAIL');
      fail('LOAD_FAILED');
    }
  };
  const rendererGone = () => {
    observed.add('RENDERER_GONE');
    fail('RENDERER_GONE');
  };
  options.contents.on('did-start-loading', didStart);
  options.contents.on('did-finish-load', didFinish);
  options.contents.on('did-fail-load', didFail);
  options.contents.on('render-process-gone', rendererGone);
  // Start at the initial loadURL call, including a renderer that never emits
  // did-start-loading. Later subresource events cannot restart this deadline.
  const timer = setTimeout(() => fail('TIMEOUT'), STARTUP_BOUND_MS);
  try {
    void options.load().then(
      () => {
        if (settled) return;
        if (
          options.contents.isDestroyed() ||
          options.contents.getURL() !== APP_URL
        ) {
          fail('LOAD_FAILED');
          return;
        }
        observed.add('LOAD_SETTLED');
        settled = true;
        cleanup();
        resolve(true);
      },
      () => {
        observed.add('LOAD_REJECTED');
        fail('LOAD_REJECTED');
      },
    );
  } catch {
    observed.add('LOAD_REJECTED');
    fail('LOAD_REJECTED');
  }
  return result;
}

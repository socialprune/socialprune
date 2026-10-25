import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prepareWindowsQuery } from '../packaging/windows-query.ts';
import { runNativeQuery } from '../packaging/windows-powershell.ts';
import { dist } from '../packaging/paths.ts';

const Ready = z.strictObject({
  version: z.literal(1),
  state: z.literal('ready'),
  handle: z.string().regex(/^[1-9]\d*$/),
  sampleIntervalMs: z.literal(5),
  maximumWatchMs: z.literal(10000),
});
const Result = z.strictObject({
  handle: z.string().regex(/^[1-9]\d*$/),
  changed: z.boolean(),
  samples: z.number().int().nonnegative(),
  final: z.string().regex(/^\d+$/),
  elapsedMs: z.number().int().nonnegative(),
});
export async function waitForegroundReady(input: {
  read: () => Promise<string | null>;
  completed: Promise<unknown>;
  timeoutMs: number;
  intervalMs: number;
}) {
  let terminal: { failure?: unknown } | undefined;
  void input.completed.then(
    () => {
      terminal = {};
    },
    (failure: unknown) => {
      terminal = { failure };
    },
  );
  const started = performance.now();
  for (;;) {
    const text = await input.read();
    if (terminal)
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- Preserve the native query's exact causal rejection.
      throw terminal.failure ?? new Error('FOREGROUND_EXITED_BEFORE_READY');
    if (text) {
      try {
        return Ready.parse(JSON.parse(text));
      } catch {
        throw new Error('FOREGROUND_READY_INVALID');
      }
    }
    if (performance.now() - started >= input.timeoutMs)
      throw new Error('FOREGROUND_READY_TIMEOUT');
    await new Promise((resolve) => setTimeout(resolve, input.intervalMs));
  }
}

export async function startForegroundWatch(folder: string) {
  const executable = await prepareWindowsQuery();
  const id = randomUUID();
  const ready = join(folder, `foreground-${id}.ready`),
    stop = join(folder, `foreground-${id}.stop`);
  const started = performance.now();
  const completed = runNativeQuery(
    executable,
    ['foreground-watch', ready, stop],
    {
      timeout: 20000,
      windowsHide: true,
      queryClass: 'native-foreground-watch',
    },
  );
  void completed.catch(() => {});
  let signal;
  try {
    signal = await waitForegroundReady({
      read: () =>
        readFile(ready, 'utf8').catch((error: unknown) => {
          if (
            error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'ENOENT'
          )
            return null;
          throw error;
        }),
      completed,
      timeoutMs: 10000,
      intervalMs: 10,
    });
  } catch (error) {
    await writeFile(stop, 'stop');
    await completed.catch(() => {});
    throw error;
  }
  const readyMs = Math.ceil(performance.now() - started);
  console.log('FOREGROUND_READY_RECEIPT', JSON.stringify({ readyMs, signal }));
  return {
    readyMs,
    signal,
    async stop() {
      await writeFile(stop, 'stop');
      const result = Result.parse(JSON.parse((await completed).stdout));
      const receipt = { version: 1, readyMs, signal, result };
      await writeFile(
        join(dist, `release-foreground-watch-${id}.json`),
        JSON.stringify(receipt),
      );
      console.log('FOREGROUND_WATCH_RECEIPT', JSON.stringify(receipt));
      return result;
    },
  };
}

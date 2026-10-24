import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as wait } from 'node:timers/promises';
import { z } from 'zod';
import { directory } from './paths.ts';
import {
  runPowerShell,
  WINDOWS_QUERY_TIMEOUT_MS,
} from './windows-powershell.ts';

// 2026-10-24, runner diagnostic 40080646830: suspend -> user completion was
// 961960, 961966 and 962179 ms in idle/restricted/installed. Highest * 1.2,
// rounded up to a minute = 1200000 ms. This bounds preparation, not a product
// timeout. A new runner image or longer measured readiness invalidates calibration.
export const APP_READINESS_DEADLINE_MS = 1_200_000;
const observationSchema = z
  .strictObject({
    version: z.literal(1),
    state: z.enum(['completed', 'pending', 'unreadable']),
    userHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    eventId: z.number().int().positive().nullable(),
    recordId: z.number().int().positive().nullable(),
    eventAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .superRefine((row, context) => {
    if (
      row.state === 'completed' &&
      (row.eventId !== 211 || !row.userHash || !row.recordId || !row.eventAt)
    )
      context.addIssue({
        code: 'custom',
        message: 'APP_READINESS_COMPLETION_INVALID',
      });
    if (row.state === 'pending' && row.eventId === 211)
      context.addIssue({
        code: 'custom',
        message: 'APP_READINESS_PENDING_INVALID',
      });
    if (row.state === 'pending' && !row.userHash)
      context.addIssue({
        code: 'custom',
        message: 'APP_READINESS_USER_MISSING',
      });
  });

async function readReadiness(remainingMs: number): Promise<unknown> {
  const { stdout } = await runPowerShell(
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      join(directory, 'packaging/app-readiness.ps1'),
    ],
    {
      timeout: Math.min(WINDOWS_QUERY_TIMEOUT_MS, remainingMs),
      windowsHide: true,
    },
  );
  return JSON.parse(stdout) as unknown;
}

// Test seams are functions, never runtime flags or alternate provider paths.
export async function waitForAppReadiness(
  output: string,
  dependencies = {
    read: readReadiness,
    now: () => performance.now(),
    wait: async (ms: number) => {
      await wait(ms);
    },
  },
) {
  const started = dependencies.now();
  let checks = 0;
  let observation: z.infer<typeof observationSchema> | null = null;
  const receipt = (state: 'waiting' | 'ready' | 'timeout' | 'unreadable') => ({
    version: 1,
    state,
    signal: 'AppReadiness/Admin:211:current-user',
    deadlineMs: APP_READINESS_DEADLINE_MS,
    waitedMs: Math.ceil(dependencies.now() - started),
    checks,
    observation,
  });
  const record = async (state: Parameters<typeof receipt>[0]) => {
    const result = receipt(state);
    await writeFile(output, JSON.stringify(result, null, 2));
    return result;
  };
  await record('waiting');
  for (;;) {
    const remaining =
      APP_READINESS_DEADLINE_MS - (dependencies.now() - started);
    if (remaining <= 0) {
      await record('timeout');
      throw new Error('APP_READINESS_TIMEOUT');
    }
    checks++;
    try {
      observation = observationSchema.parse(await dependencies.read(remaining));
      if (observation.state === 'unreadable') throw new Error('UNREADABLE');
    } catch {
      observation = null;
      await record('unreadable');
      throw new Error('APP_READINESS_UNREADABLE');
    }
    if (dependencies.now() - started >= APP_READINESS_DEADLINE_MS) {
      await record('timeout');
      throw new Error('APP_READINESS_TIMEOUT');
    }
    if (observation.state === 'completed') return record('ready');
    await record('waiting');
    await dependencies.wait(
      Math.min(
        2000,
        APP_READINESS_DEADLINE_MS - (dependencies.now() - started),
      ),
    );
  }
}

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dist } from '../packaging/paths.ts';
import { PROCESS_POLL_INTERVAL_MS } from '../packaging/query-poll.ts';
import {
  observeProcessQueries,
  type ProcessQueryReceipt,
} from '../packaging/windows-query.ts';

export async function recordCleanup(
  kind: 'browser' | 'electron',
  options: {
    close: () => Promise<void>;
    wait: () => Promise<void>;
    timeoutMs: number;
    directory?: string;
  },
): Promise<void> {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  let closedAt: number | undefined;
  let failure: unknown;
  let failed = false;
  const queries: ProcessQueryReceipt[] = [];
  const unobserve = observeProcessQueries((receipt) => queries.push(receipt));
  try {
    await options.close();
    closedAt = performance.now();
    await options.wait();
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    unobserve();
  }
  const ended = performance.now();
  const receipt = {
    version: 1,
    kind,
    state: failed ? 'failed' : 'exited',
    startedAt,
    closeMs: closedAt === undefined ? null : Math.ceil(closedAt - started),
    waitMs: closedAt === undefined ? null : Math.ceil(ended - closedAt),
    observedExitUpperBoundMs: failed ? null : Math.ceil(ended - started),
    elapsedMs: Math.ceil(ended - started),
    timeoutMs: options.timeoutMs,
    pollIntervalMs: PROCESS_POLL_INTERVAL_MS,
    failurePhase: failed ? (closedAt === undefined ? 'close' : 'wait') : null,
    processQueries: queries,
    exitedDuringImageRead: queries.reduce(
      (count, query) => count + query.exitedDuringImageRead,
      0,
    ),
    // Polling observes absence, not the kernel's exact process exit timestamp.
    measurement: 'close-request-to-observed-absence',
  };
  const directory = options.directory ?? dist;
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `release-process-cleanup-${kind}-${randomUUID()}.json`),
    JSON.stringify(receipt),
  );
  console.log('PROCESS_CLEANUP_RECEIPT', JSON.stringify(receipt));
  if (failed) throw failure;
}

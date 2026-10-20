import assert from 'node:assert/strict';
import {
  windowsQuery,
  prepareWindowsQuery,
} from '../packaging/windows-query.ts';
import {
  pollQuery,
  PROCESS_POLL_TIMEOUT_MS,
  PROCESS_POLL_INTERVAL_MS,
} from '../packaging/query-poll.ts';

export interface ProcessRow {
  ProcessId: number;
  ParentProcessId: number;
  ExecutablePath: string;
  born: string;
}

export interface ProcessIdentity {
  pid: number;
  born: string;
}

export async function processIdentities(
  pids: number[],
  signal?: AbortSignal,
): Promise<ProcessIdentity[]> {
  if (pids.some((pid) => !Number.isSafeInteger(pid) || pid <= 0))
    throw new Error('INVALID_PID');
  if (!pids.length) return [];
  const stdout = await windowsQuery('identities', pids.join(','), signal);
  return JSON.parse(stdout || '[]') as ProcessIdentity[];
}

export function matchingProcessIdentities(
  expected: ProcessIdentity[],
  observed: ProcessIdentity[],
): ProcessIdentity[] {
  return expected.filter((entry) =>
    observed.some((row) => row.pid === entry.pid && row.born === entry.born),
  );
}

export async function appProcesses(executable: string): Promise<ProcessRow[]> {
  const stdout = await windowsQuery('processes', executable);
  return JSON.parse(stdout || '[]') as ProcessRow[];
}

export async function remainingProcesses(
  pids: number[],
  signal?: AbortSignal,
): Promise<number[]> {
  if (pids.some((pid) => !Number.isSafeInteger(pid) || pid <= 0))
    throw new Error('INVALID_PID');
  if (!pids.length) return [];
  return (await processIdentities(pids, signal)).map((row) => row.pid);
}

export async function assertNoRemainingProcesses(
  processes: number[] | ProcessIdentity[],
): Promise<void> {
  if (!processes.length) return;
  await prepareWindowsQuery();
  const remaining = await pollQuery(
    async () => {
      if (typeof processes[0] === 'object') {
        const identities = processes as ProcessIdentity[];
        return matchingProcessIdentities(
          identities,
          await processIdentities(identities.map((entry) => entry.pid)),
        );
      }
      return remainingProcesses(processes as number[]);
    },
    (value) => value.length === 0,
    {
      timeoutMs: PROCESS_POLL_TIMEOUT_MS,
      intervalMs: PROCESS_POLL_INTERVAL_MS,
      message: 'BROWSER_PROCESS_REMAINS',
    },
  );
  assert.deepEqual(remaining, [], 'BROWSER_PROCESS_REMAINS');
}

export async function assertNoListeners(pids: number[]): Promise<void> {
  if (
    !pids.length ||
    pids.some((pid) => !Number.isSafeInteger(pid) || pid <= 0)
  )
    throw new Error('INVALID_PID');
  const stdout = await windowsQuery('listeners', pids.join(','));
  const counts = JSON.parse(stdout) as { tcp: number; udp: number };
  assert.deepEqual(counts, { tcp: 0, udp: 0 }, 'APP_LISTENER');
}

export async function assertNoConnections(pids: number[]): Promise<void> {
  if (
    !pids.length ||
    pids.some((pid) => !Number.isSafeInteger(pid) || pid <= 0)
  )
    throw new Error('INVALID_PID');
  const stdout = await windowsQuery('connections', pids.join(','));
  assert.deepEqual(JSON.parse(stdout) as unknown, [], 'APP_CONNECTION');
}

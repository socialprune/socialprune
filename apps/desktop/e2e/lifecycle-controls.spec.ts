import { expect, test } from '@playwright/test';
import { WINDOWS_QUERY_TIMEOUT_MS } from '../packaging/windows-powershell.ts';
import { PROCESS_POLL_TIMEOUT_MS } from '../packaging/query-poll.ts';
import {
  plantedListener,
  plantedProcess,
  plantedConnection,
  processExitControl,
} from './lifecycle-controls.ts';

// Compiler setup, complete 3x runner query poll, last query settlement.
test.setTimeout(WINDOWS_QUERY_TIMEOUT_MS * 2 + PROCESS_POLL_TIMEOUT_MS);

test('positive control catches a live listener owned by the test', async () => {
  await expect(plantedListener(4668)).rejects.toThrow('APP_LISTENER');
});
test('positive control catches a live decoy PID without stopping it', async () => {
  await expect(plantedProcess()).rejects.toThrow('BROWSER_PROCESS_REMAINS');
});

test('a process that exits after three seconds passes bounded cleanup', async () => {
  const started = performance.now();
  await processExitControl(true);
  expect(performance.now() - started).toBeGreaterThanOrEqual(3000);
});

test('a planted process that stays alive fails after the cleanup wait', async () => {
  const started = performance.now();
  await expect(processExitControl(false)).rejects.toThrow(
    'BROWSER_PROCESS_REMAINS',
  );
  expect(performance.now() - started).toBeGreaterThanOrEqual(15_000);
});

test('positive control catches an outbound connection to an owned local decoy', async () => {
  await expect(plantedConnection(4668)).rejects.toThrow('APP_CONNECTION');
});

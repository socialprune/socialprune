import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import { recordCleanup } from '../e2e/cleanup-receipt.ts';
import { directory } from '../packaging/paths.ts';
import {
  windowsQuery,
  setWindowsQueryDiagnosticDirectory,
} from '../packaging/windows-query.ts';
import * as powershell from '../packaging/windows-powershell.ts';
import { dist } from '../packaging/paths.ts';

test('each close retains observed exit timing or its failed phase without replacing the failure', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'socialprune-receipt-'));
  try {
    const phases: string[] = [];
    await recordCleanup('browser', {
      directory: scratch,
      timeoutMs: 60100,
      close: () => {
        phases.push('close');
        return Promise.resolve();
      },
      wait: () => {
        phases.push('wait');
        return Promise.resolve();
      },
    });
    const failure = new Error('GENERATED_CLEANUP_FAILURE');
    await expect(
      recordCleanup('electron', {
        directory: scratch,
        timeoutMs: 60100,
        close: () => Promise.resolve(),
        wait: () => Promise.reject(failure),
      }),
    ).rejects.toBe(failure);
    await expect(
      recordCleanup('browser', {
        directory: scratch,
        timeoutMs: 60100,
        close: () => Promise.reject(failure),
        wait: () => Promise.reject(new Error('WAIT_MUST_NOT_RUN')),
      }),
    ).rejects.toBe(failure);
    expect(phases).toEqual(['close', 'wait']);
    const files = await readdir(scratch);
    expect(files).toHaveLength(3);
    const records = await Promise.all(
      files.map(async (file) => {
        expect(file).toMatch(
          /^release-process-cleanup-(browser|electron)-[a-f0-9-]+\.json$/,
        );
        return JSON.parse(await readFile(join(scratch, file), 'utf8')) as {
          state: string;
          failurePhase: string | null;
          observedExitUpperBoundMs: number | null;
          closeMs: number | null;
          waitMs: number | null;
          timeoutMs: number;
          measurement: string;
        };
      }),
    );
    expect(records.find((row) => row.state === 'exited')).toMatchObject({
      failurePhase: null,
      timeoutMs: 60100,
      measurement: 'close-request-to-observed-absence',
    });
    expect(
      records.find((row) => row.state === 'exited')!.observedExitUpperBoundMs,
    ).toBeGreaterThanOrEqual(0);
    expect(records.find((row) => row.failurePhase === 'wait')).toMatchObject({
      observedExitUpperBoundMs: null,
    });
    expect(records.find((row) => row.failurePhase === 'close')).toMatchObject({
      observedExitUpperBoundMs: null,
      closeMs: null,
      waitMs: null,
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('packaged browser and Electron closes write receipts retained by the existing artifact glob', async () => {
  for (const path of ['e2e/helpers.ts', 'e2e/runs.spec.ts']) {
    expect(await readFile(join(directory, path), 'utf8')).toContain(
      'recordCleanup(',
    );
  }
  const workflow = await readFile(
    join(directory, '../../.github/workflows/ci.yml'),
    'utf8',
  );
  expect(workflow).toContain('apps/desktop/dist/release-*.json');
});

test('cleanup retains counted native race evidence and a live read failure without adding process queries', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'socialprune-query-receipt-'));
  const diagnostic = {
    pid: 123,
    code: 'PROCESS_EXITED_DURING_IMAGE_READ',
    call: 'QueryFullProcessImageNameW',
    win32Error: 5,
    processState: 'exited',
    stateCall: 'GetProcessTimes',
    stateWin32Error: 0,
  };
  const query = vi.spyOn(powershell, 'runNativeQuery');
  setWindowsQueryDiagnosticDirectory(scratch);
  try {
    query.mockResolvedValueOnce({
      stdout: '[]',
      stderr: 'PROCESS_QUERY_FILTER ' + JSON.stringify(diagnostic) + '\n',
    });
    await recordCleanup('electron', {
      directory: scratch,
      timeoutMs: 60100,
      close: () => Promise.resolve(),
      wait: async () => {
        await windowsQuery('processes', 'generated');
      },
    });
    const failure = Object.assign(new Error('PROCESS_IMAGE_FAILED'), {
      stderr:
        'PROCESS_QUERY_FILTER ' +
        JSON.stringify({
          ...diagnostic,
          code: 'PROCESS_IMAGE_FAILED',
          win32Error: 122,
          processState: 'live',
        }) +
        '\n',
    });
    query.mockRejectedValueOnce(failure);
    await expect(
      recordCleanup('electron', {
        directory: scratch,
        timeoutMs: 60100,
        close: () => Promise.resolve(),
        wait: async () => {
          await windowsQuery('processes', 'generated');
        },
      }),
    ).rejects.toBe(failure);
    expect(query).toHaveBeenCalledTimes(2);
    const files = (await readdir(scratch)).filter((file) =>
      file.startsWith('release-process-cleanup-'),
    );
    const receipts: unknown[] = await Promise.all(
      files.map(
        async (file) =>
          JSON.parse(await readFile(join(scratch, file), 'utf8')) as unknown,
      ),
    );
    expect(receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          state: 'exited',
          exitedDuringImageRead: 1,
          processQueries: [
            expect.objectContaining({
              state: 'returned',
              candidates: [diagnostic],
            }),
          ],
        }),
        expect.objectContaining({
          state: 'failed',
          exitedDuringImageRead: 0,
          processQueries: [
            expect.objectContaining({
              state: 'failed',
              candidates: [
                expect.objectContaining({
                  processState: 'live',
                  win32Error: 122,
                }),
              ],
            }),
          ],
        }),
      ]),
    );
  } finally {
    query.mockRestore();
    setWindowsQueryDiagnosticDirectory(dist);
    await rm(scratch, { recursive: true, force: true });
  }
});

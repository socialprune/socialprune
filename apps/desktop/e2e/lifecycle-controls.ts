import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import {
  assertNoListeners,
  assertNoRemainingProcesses,
  assertNoConnections,
  processIdentities,
  BROWSER_CLEANUP_TIMEOUT_MS,
} from '../test/windows.ts';

export async function plantedListener(port: number): Promise<void> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  try {
    await assertNoListeners([process.pid]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

export async function plantedProcess(): Promise<void> {
  // A decoy known live PID proves the detector; it never kills a process.
  await assertNoRemainingProcesses(await processIdentities([process.pid]));
}

export async function processExitControl(exits: boolean): Promise<void> {
  const child = spawn(
    process.execPath,
    [
      '-e',
      `process.stdout.write('ready\\n'); ${exits ? 'setTimeout(() => process.exit(0), 3000)' : 'setInterval(() => {}, 1000)'}`,
    ],
    {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true,
    },
  );
  const ended = new Promise<void>((resolve, reject) => {
    child.once('exit', () => resolve());
    child.once('error', reject);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      child.stdout.once('data', () => resolve());
      child.once('error', reject);
    });
    if (!child.pid) throw new Error('DECOY_PID_MISSING');
    const identities = await processIdentities([child.pid]);
    assert.equal(identities.length, 1, 'DECOY_IDENTITY_MISSING');
    const started = performance.now();
    try {
      await assertNoRemainingProcesses(identities);
    } catch (error) {
      if (
        !exits &&
        error instanceof Error &&
        error.message.includes('BROWSER_PROCESS_REMAINS:QUERY_POLL_TIMEOUT')
      ) {
        const waitedMs = performance.now() - started;
        const surviving = await processIdentities([child.pid]);
        assert.equal(child.exitCode, null, 'DECOY_EXITED_BEFORE_TIMEOUT');
        assert.deepEqual(surviving, identities, 'DECOY_IDENTITY_CHANGED');
        assert.ok(
          waitedMs >= BROWSER_CLEANUP_TIMEOUT_MS,
          'BROWSER_CLEANUP_REJECTED_EARLY',
        );
        console.log(
          'PROCESS_CLEANUP_WAIT_PROOF',
          JSON.stringify({
            timeoutMs: BROWSER_CLEANUP_TIMEOUT_MS,
            waitedMs,
            surviving: surviving.length,
            aliveBeforeOwnedCleanup: true,
          }),
        );
      }
      throw error;
    }
  } finally {
    if (child.exitCode === null) child.kill();
    await ended;
  }
}

export async function plantedConnection(port: number): Promise<void> {
  const sockets = new Set<import('node:net').Socket>();
  const server = createServer();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const client = createConnection({ host: '127.0.0.1', port });
  try {
    await new Promise<void>((resolve, reject) => {
      client.once('connect', resolve);
      client.once('error', reject);
    });
    await assertNoConnections([process.pid]);
  } finally {
    client.destroy();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

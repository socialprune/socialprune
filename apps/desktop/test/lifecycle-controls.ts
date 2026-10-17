import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import {
  assertNoListeners,
  assertNoRemainingProcesses,
  assertNoConnections,
} from './windows.ts';

export async function plantedListener(): Promise<void> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    await assertNoListeners([process.pid]);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

export async function plantedProcess(): Promise<void> {
  // A decoy known live PID proves the detector; it never kills a process.
  await assertNoRemainingProcesses([process.pid]);
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

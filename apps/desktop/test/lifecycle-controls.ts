import { createServer } from 'node:http';
import { assertNoListeners, assertNoRemainingProcesses } from './windows.ts';

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

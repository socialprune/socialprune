import { networkRecorder } from '../../cli/test/network-recorder.ts';
import { parentPort } from 'node:worker_threads';

// Installed only through the test-selected worker entrypoint.
const recorder = networkRecorder();
await import('../database-worker.ts');
parentPort?.on('message', (message: { type: string }) => {
  if (message.type === 'close')
    parentPort?.postMessage({ type: 'networkRecord', calls: recorder.calls });
});
parentPort?.once('close', () => recorder.restore());

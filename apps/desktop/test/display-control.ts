import type { EventEmitter } from 'node:events';

export type DisplayCommand =
  | { type: 'displayClose' }
  | {
      type: 'displayPosition';
      bounds: { x: number; y: number; width: number; height: number };
    };
type Child = Pick<EventEmitter, 'on' | 'removeListener'> & {
  postMessage(value: unknown): void;
};

/** Test-only control lane; production commands use the separate validated port. */
export function displayControl(child: Child, command: DisplayCommand) {
  return new Promise<unknown>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      child.removeListener('message', receive);
      child.removeListener('exit', exited);
    };
    const exited = () => {
      cleanup();
      reject(new Error('DISPLAY_CONTROL_CHILD_EXITED'));
    };
    const receive = (reply: { type?: string }) => {
      if (reply.type === 'displayControl') {
        cleanup();
        if ('failed' in reply) reject(new Error('DISPLAY_CONTROL_FAILED'));
        else resolve(reply);
      }
    };
    // Existing main-side request budget, replacing an unbounded test wait.
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('DISPLAY_CONTROL_TIMEOUT'));
    }, 30_000);
    child.on('message', receive);
    child.on('exit', exited);
    try {
      child.postMessage(command);
    } catch (error) {
      cleanup();
      reject(
        error instanceof Error
          ? error
          : new Error('DISPLAY_CONTROL_SEND_FAILED'),
      );
    }
  });
}

import { MessageChannelMain, utilityProcess } from 'electron';
import { DesktopReplySchema } from '../protocol.ts';
import type { DesktopReply, DesktopRequest } from '../protocol.ts';

export function launchEngine(
  entry: string,
  workspace: string,
  record: (code: string) => void,
) {
  const child = utilityProcess.fork(entry, [workspace], {
    serviceName: 'SocialPrune Engine',
    stdio: 'pipe',
    // A utility process is not started through ELECTRON_RUN_AS_NODE.
    execArgv: [],
  });
  // Consume, but never log paths or unexpected dependency error text.
  child.stdout?.resume();
  child.stderr?.resume();
  const { port1: port, port2 } = new MessageChannelMain();
  const pending = new Map<
    string,
    {
      request: DesktopRequest;
      finish: (reply: DesktopReply) => void;
      timer: NodeJS.Timeout;
    }
  >();
  let ready = false;
  let exited = false;
  let closing = false;
  const exit = new Promise<void>((resolve) => {
    child.once('exit', () => {
      exited = true;
      if (!closing) record('ENGINE_EXITED');
      for (const [requestId, task] of pending) {
        clearTimeout(task.timer);
        task.finish({
          requestId,
          type: 'rejected',
          code: 'ENGINE_UNAVAILABLE',
        });
      }
      pending.clear();
      resolve();
    });
  });
  port.on('message', (event) => {
    if (event.data === 'ready') {
      ready = true;
      for (const task of pending.values()) port.postMessage(task.request);
      return;
    }
    const parsed = DesktopReplySchema.safeParse(event.data);
    if (!parsed.success) return;
    const task = pending.get(parsed.data.requestId);
    if (!task) return;
    clearTimeout(task.timer);
    pending.delete(parsed.data.requestId);
    task.finish(parsed.data);
  });
  port.start();
  child.postMessage('connect', [port2]);
  return {
    child,
    async request(request: DesktopRequest): Promise<DesktopReply> {
      if (exited || pending.has(request.requestId) || pending.size >= 64)
        return {
          requestId: request.requestId,
          type: 'rejected',
          code: 'ENGINE_UNAVAILABLE',
        };
      return new Promise<DesktopReply>((finish) => {
        const timer = setTimeout(() => {
          pending.delete(request.requestId);
          record('ENGINE_TIMEOUT');
          finish({
            requestId: request.requestId,
            type: 'rejected',
            code: 'ENGINE_UNAVAILABLE',
          });
        }, 10_000);
        pending.set(request.requestId, { request, finish, timer });
        if (ready) port.postMessage(request);
      });
    },
    async close(): Promise<void> {
      closing = true;
      if (!exited) port.postMessage('shutdown');
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        exit,
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            record('ENGINE_FORCED_STOP');
            child.kill();
            resolve();
          }, 5_000);
        }),
      ]);
      clearTimeout(timer);
      await exit;
      port.close();
    },
  };
}

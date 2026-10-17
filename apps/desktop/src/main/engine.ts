import { MessageChannelMain, utilityProcess } from 'electron';
import { parseDesktopReply } from '../protocol.ts';
import type { DesktopReply, RunView } from '../protocol.ts';
import {
  EngineHostMessageSchema,
  EngineOptionsSchema,
} from 'socialprune/engine';
import type { EngineHostMessage, EngineOptions } from 'socialprune/engine';
import { HostCommandSchema, HostEventSchema } from '../host-protocol.ts';

export function launchEngine(
  entry: string,
  options: EngineOptions,
  record: (code: string) => void,
) {
  const child = utilityProcess.fork(entry, [], {
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
      message: EngineHostMessage;
      finish: (reply: DesktopReply) => void;
      timer: NodeJS.Timeout;
    }
  >();
  let ready = false;
  let exited = false;
  let closing = false;
  let unavailable = false;
  const listeners = new Set<(view: RunView) => void>();
  const send = (value: unknown) =>
    port.postMessage(HostCommandSchema.parse(value));
  const fail = (requestId: string): DesktopReply => ({
    requestId,
    type: 'desktopFailed',
    code: 'ENGINE_UNAVAILABLE',
  });
  const exit = new Promise<void>((resolve) => {
    child.once('exit', () => {
      exited = true;
      if (!closing) record('ENGINE_EXITED');
      for (const [requestId, task] of pending) {
        clearTimeout(task.timer);
        task.finish(fail(requestId));
      }
      pending.clear();
      resolve();
    });
  });
  port.on('message', (event) => {
    const parsed = HostEventSchema.safeParse(event.data);
    if (!parsed.success) {
      record('ENGINE_MESSAGE_REJECTED');
      return;
    }
    if (parsed.data.type === 'ready') {
      ready = true;
      for (const task of pending.values())
        send({ type: 'request', message: task.message });
      return;
    }
    if (parsed.data.type === 'view') {
      for (const listener of listeners) listener(parsed.data.view);
      return;
    }
    if (parsed.data.type === 'failed') {
      record('ENGINE_FAILED');
      unavailable = true;
      for (const [id, task] of pending) {
        clearTimeout(task.timer);
        task.finish(fail(id));
      }
      pending.clear();
      return;
    }
    if (parsed.data.type !== 'reply') return;
    const reply = parsed.data.reply;
    const task = pending.get(reply.requestId);
    if (!task) return;
    clearTimeout(task.timer);
    pending.delete(reply.requestId);
    try {
      task.finish(parseDesktopReply(task.message.request, reply));
    } catch {
      record('ENGINE_MESSAGE_REJECTED');
      task.finish(fail(reply.requestId));
    }
  });
  port.start();
  child.postMessage('connect', [port2]);
  send({ type: 'initialize', options: EngineOptionsSchema.parse(options) });
  return {
    child,
    onRunView(listener: (view: RunView) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async request(raw: EngineHostMessage): Promise<DesktopReply> {
      const message = EngineHostMessageSchema.parse(raw);
      const request = message.request;
      if (
        exited ||
        closing ||
        unavailable ||
        pending.has(request.requestId) ||
        pending.size >= 64
      )
        return fail(request.requestId);
      return new Promise<DesktopReply>((finish) => {
        const timer = setTimeout(
          () => {
            pending.delete(request.requestId);
            record('ENGINE_TIMEOUT');
            finish(fail(request.requestId));
          },
          request.type === 'profileSetup' ? 3_600_000 : 120_000,
        );
        pending.set(request.requestId, { message, finish, timer });
        if (ready) send({ type: 'request', message });
      });
    },
    async close(): Promise<void> {
      closing = true;
      if (!exited) send({ type: 'shutdown' });
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        exit,
        new Promise<void>((resolve) => {
          timer = setTimeout(() => {
            record('ENGINE_FORCED_STOP');
            child.kill();
            resolve();
          }, 30_000);
        }),
      ]);
      clearTimeout(timer);
      await exit;
      port.close();
      listeners.clear();
    },
  };
}

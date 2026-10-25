import type { DesktopEngine, EngineOptions } from 'socialprune/engine';
import { parseDesktopReply, RunViewSchema } from '../protocol.ts';
import { HostCommandSchema, HostEventSchema } from '../host-protocol.ts';

export function startEngine(
  open: (options: EngineOptions) => Promise<DesktopEngine>,
): void {
  process.parentPort.once('message', (event: Electron.MessageEvent) => {
    const port = event.ports[0];
    if (!port) {
      process.exitCode = 1;
      return;
    }
    let engine: DesktopEngine | undefined;
    let opening: Promise<void> | undefined;
    let closing = false;
    const send = (value: unknown) =>
      port.postMessage(HostEventSchema.parse(value));
    port.on('message', (message: Electron.MessageEvent) => {
      const parsed = HostCommandSchema.safeParse(message.data);
      if (!parsed.success) return;
      const command = parsed.data;
      if (command.type === 'initialize') {
        if (opening || closing) return;
        opening = open(command.options)
          .then((value) => {
            engine = value;
            value.onRunView((view) =>
              send({ type: 'view', view: RunViewSchema.parse(view) }),
            );
            send({ type: 'ready' });
          })
          .catch(() => send({ type: 'failed' }));
        return;
      }
      if (command.type === 'shutdown') {
        if (closing) return;
        closing = true;
        void (async () => {
          await opening;
          await engine?.close();
          send({ type: 'closed' });
          port.close();
          process.exit(0);
        })().catch(() => {
          send({ type: 'failed' });
          process.exit(1);
        });
        return;
      }
      if (command.type === 'window') {
        if (!engine || closing) {
          send({
            type: 'window',
            id: command.id,
            reply: { type: 'unavailable' },
          });
          return;
        }
        void engine
          .window(command.message)
          .then((reply) => send({ type: 'window', id: command.id, reply }))
          .catch(() =>
            send({
              type: 'window',
              id: command.id,
              reply: { type: 'unavailable' },
            }),
          );
        return;
      }
      if (!engine || closing) return;
      if (command.type === 'media') {
        void engine
          .media(command.message)
          .then((reply) => send({ type: 'media', id: command.id, reply }))
          .catch(() =>
            send({ type: 'media', id: command.id, reply: { type: 'failed' } }),
          );
        return;
      }
      const { request } = command.message;
      void engine
        .handleHost(command.message)
        .then((reply) => {
          send({ type: 'reply', reply: parseDesktopReply(request, reply) });
        })
        .catch(() =>
          send({
            type: 'reply',
            reply: {
              type: 'desktopFailed',
              requestId: request.requestId,
              code: 'ENGINE_UNAVAILABLE',
            },
          }),
        );
    });
    port.start();
  });
}

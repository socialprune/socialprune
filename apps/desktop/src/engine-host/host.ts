import { DesktopReplySchema, DesktopRequestSchema } from '../protocol.ts';
import { openFoundationWorkspace } from './workspace.ts';

export function startEngine(path: string): void {
  const workspace = openFoundationWorkspace(path);
  process.parentPort.once('message', (event: Electron.MessageEvent) => {
    const port = event.ports[0];
    if (!port) {
      workspace.close();
      process.exitCode = 1;
      return;
    }
    port.on('message', (message: Electron.MessageEvent) => {
      if (message.data === 'shutdown') {
        workspace.close();
        port.postMessage('closed');
        port.close();
        process.exit(0);
      }
      const request = DesktopRequestSchema.safeParse(message.data);
      if (!request.success) return;
      port.postMessage(DesktopReplySchema.parse(workspace.read(request.data)));
    });
    port.start();
    port.postMessage('ready');
  });
}

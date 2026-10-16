import { contextBridge, ipcRenderer } from 'electron';
import {
  DesktopReplySchema,
  DesktopRequestSchema,
  REQUEST_CHANNEL,
  RUN_VIEW_CHANNEL,
  RunViewSchema,
} from '../protocol.ts';
import type { DesktopBridge, DesktopRequest, RunView } from '../protocol.ts';

const bridge: DesktopBridge = Object.freeze({
  async request(message: DesktopRequest) {
    const request = DesktopRequestSchema.parse(message);
    return DesktopReplySchema.parse(
      await ipcRenderer.invoke(REQUEST_CHANNEL, request),
    );
  },
  onRunView(listener: (view: RunView) => void) {
    if (typeof listener !== 'function') throw new TypeError('INVALID_LISTENER');
    const receive = (_event: unknown, message: unknown) => {
      const view = RunViewSchema.safeParse(message);
      if (view.success) listener(view.data);
    };
    ipcRenderer.on(RUN_VIEW_CHANNEL, receive);
    return () => {
      ipcRenderer.removeListener(RUN_VIEW_CHANNEL, receive);
    };
  },
});
contextBridge.exposeInMainWorld('socialprune', bridge);

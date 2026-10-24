import { contextBridge, ipcRenderer, webUtils } from 'electron';
import {
  parseDesktopReply,
  DesktopRequestSchema,
  REQUEST_CHANNEL,
  RUN_VIEW_CHANNEL,
  RunViewSchema,
  DROP_CHANNEL,
  LOCALE_CHANNEL,
} from '../protocol.ts';
import type { DesktopBridge, DesktopRequest, RunView } from '../protocol.ts';
import {
  DATA_REMOVAL_CHANNEL,
  DATA_REMOVAL_REQUEST_EVENT,
  DATA_REMOVAL_REPLY_EVENT,
  DataRemovalRequestSchema,
  DataRemovalReplySchema,
} from '../data-removal-protocol.ts';

const bridge: DesktopBridge = Object.freeze({
  async request(message: DesktopRequest) {
    const request = DesktopRequestSchema.parse(message);
    return parseDesktopReply(
      request,
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
// A separate closed data-removal channel changes neither the core bridge nor
// its path-free request surface. Main owns all file selection and deletion.
window.addEventListener(DATA_REMOVAL_REQUEST_EVENT, (event) => {
  if (
    !(event instanceof CustomEvent) ||
    typeof event.detail !== 'string' ||
    event.detail.length > 2048
  )
    return;
  let value: unknown;
  try {
    value = JSON.parse(event.detail);
  } catch {
    return;
  }
  const parsed = DataRemovalRequestSchema.safeParse(value);
  if (!parsed.success) return;
  void ipcRenderer
    .invoke(DATA_REMOVAL_CHANNEL, parsed.data)
    .then((raw) => {
      const reply = DataRemovalReplySchema.parse(raw);
      window.dispatchEvent(
        new CustomEvent(DATA_REMOVAL_REPLY_EVENT, {
          detail: JSON.stringify(reply),
        }),
      );
    })
    .catch(() => {
      window.dispatchEvent(
        new CustomEvent(DATA_REMOVAL_REPLY_EVENT, {
          detail: JSON.stringify({
            type: 'failed',
            id: parsed.data.id,
            code: 'io',
          }),
        }),
      );
    });
});
const shareLanguage = () => {
  const locale = document.documentElement?.lang;
  if (locale === 'en' || locale === 'de')
    ipcRenderer.send(LOCALE_CHANNEL, locale);
};
window.addEventListener('DOMContentLoaded', () => {
  // Do not overwrite the saved startup preference with the HTML template's
  // default. React writes lang when it has resolved the person's preference.
  new MutationObserver(shareLanguage).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['lang'],
  });
});

// This isolated world sees native File objects, not renderer-supplied paths.
// Constructed Files have no native path and cannot arm the private handoff.
let dropping = false;
window.addEventListener('dragover', (event) => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('drop', (event) => {
  event.preventDefault();
  if (dropping || !event.isTrusted) return;
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (!files.length || files.length > 32) return;
  const paths = files.map((file) => webUtils.getPathForFile(file));
  if (paths.some((path) => !path)) return;
  dropping = true;
  const request = {
    type: 'importExport' as const,
    requestId: crypto.randomUUID(),
  };
  void ipcRenderer
    .invoke(DROP_CHANNEL, { request, paths })
    .then((raw) => {
      const reply = parseDesktopReply(request, raw);
      window.dispatchEvent(
        new CustomEvent('socialprune:import-dropped', {
          detail: JSON.stringify(reply),
        }),
      );
    })
    .catch(() => {
      window.dispatchEvent(
        new CustomEvent('socialprune:import-dropped', {
          detail: JSON.stringify({
            type: 'desktopFailed',
            requestId: request.requestId,
            code: 'NOT_AVAILABLE',
          }),
        }),
      );
    })
    .finally(() => {
      dropping = false;
    });
});

import type { DesktopBridge } from '../protocol.ts';

const bridge: DesktopBridge = window.socialprune;
const status = document.querySelector('#status');
bridge.onRunView(() => undefined);
void bridge
  .request({ type: 'foundationRead', requestId: crypto.randomUUID() })
  .then((reply) => {
    if (status) {
      status.textContent =
        reply.type === 'foundationSummary' ? String(reply.items) : reply.code;
      status.setAttribute('data-ready', 'true');
    }
  });

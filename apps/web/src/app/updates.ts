import { buildId } from 'virtual:sp-build-info';

interface UpdateMessage {
  type: 'flush' | 'flushed';
  id: string;
  buildId?: string;
}
export class AppUpdates {
  private readonly channel = new BroadcastChannel('sp-app');
  private waiting: ServiceWorker | null = null;
  private readonly listeners = new Set<(ready: boolean) => void>();
  private flush: () => Promise<void>;
  private hadController = Boolean(navigator.serviceWorker?.controller);
  private disposed = false;

  constructor(flush: () => Promise<void>) {
    this.flush = flush;
    this.channel.onmessage = (event: MessageEvent<UpdateMessage>) => {
      if (event.data.type === 'flush') {
        void this.flush().then(() =>
          this.channel.postMessage({
            type: 'flushed',
            id: event.data.id,
            buildId,
          }),
        );
      }
    };
    navigator.serviceWorker?.addEventListener(
      'controllerchange',
      this.controllerChanged,
    );
  }

  private controllerChanged = () => {
    if (this.hadController && !this.disposed) location.reload();
    this.hadController = true;
  };

  watch(registration: ServiceWorkerRegistration): void {
    const changed = () => {
      if (registration.waiting) this.setWaiting(registration.waiting);
    };
    changed();
    registration.addEventListener('updatefound', () => {
      const installing = registration.installing;
      installing?.addEventListener('statechange', changed);
    });
  }

  private setWaiting(worker: ServiceWorker) {
    this.waiting = worker;
    for (const listener of this.listeners) listener(true);
  }

  subscribe(listener: (ready: boolean) => void) {
    this.listeners.add(listener);
    listener(Boolean(this.waiting));
    return () => {
      this.listeners.delete(listener);
    };
  }

  async reloadNow(): Promise<void> {
    if (!this.waiting) return;
    await this.flush();
    const id = crypto.randomUUID();
    this.channel.postMessage({ type: 'flush', id });
    // The service worker asks every actual window to flush and returns a
    // receipt for the whole client set, not a guessed BroadcastChannel count.
    const controller = navigator.serviceWorker.controller;
    if (!controller) throw new Error('Missing controlling worker.');
    await new Promise<void>((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => {
        channel.port1.close();
        reject(new Error('Update flush timed out.'));
      }, 10_000);
      channel.port1.onmessage = (event: MessageEvent<{ type: string }>) => {
        clearTimeout(timer);
        channel.port1.close();
        if (event.data.type === 'all-flushed') resolve();
        else reject(new Error('A tab did not flush.'));
      };
      controller.postMessage({ type: 'prepare-update', id }, [channel.port2]);
    });
    this.waiting.postMessage({ type: 'SKIP_WAITING' });
  }

  handleServiceWorkerMessages = (
    event: MessageEvent<{ type: string; id: string }>,
  ) => {
    if (event.data.type === 'flush-tab') {
      void this.flush().then(() =>
        navigator.serviceWorker.controller?.postMessage({
          type: 'tab-flushed',
          id: event.data.id,
        }),
      );
    }
  };

  dispose() {
    this.disposed = true;
    this.channel.close();
    this.listeners.clear();
    navigator.serviceWorker?.removeEventListener(
      'controllerchange',
      this.controllerChanged,
    );
  }
}

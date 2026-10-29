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
  private controller = navigator.serviceWorker?.controller ?? null;
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
    const controller = navigator.serviceWorker.controller;
    if (this.controller && controller !== this.controller && !this.disposed)
      location.reload();
    this.controller = controller;
  };

  watch(registration: ServiceWorkerRegistration): void {
    // The gate can verify first control before its queued notification reaches
    // this listener. Seed the actual identity, not an initial boolean snapshot.
    this.controller ??= navigator.serviceWorker.controller;
    const observe = () => {
      const worker = registration.installing ?? registration.waiting;
      if (!worker) return;
      const changed = () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller)
          this.setWaiting(worker);
      };
      worker.addEventListener('statechange', changed);
      // updatefound delivery can lag the install, and watch can start while an
      // install is already in progress. Neither path gets another state event.
      changed();
    };
    if (registration.waiting) this.setWaiting(registration.waiting);
    observe();
    registration.addEventListener('updatefound', observe);
  }

  private setWaiting(worker: ServiceWorker) {
    if (this.disposed || this.waiting === worker) return;
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

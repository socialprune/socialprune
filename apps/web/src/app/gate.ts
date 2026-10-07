import { base, buildId } from 'virtual:sp-build-info';
import gateWorkerURL from './gate-worker.ts?worker&url';
import demoWorkerURL from './demo-worker.ts?worker&url';
import { scriptURL } from './trusted-urls.ts';

export type GateState = 'preparing' | 'ready' | 'unavailable' | 'framed';
export type GateReason =
  | 'missing-api'
  | 'registration-failed'
  | 'control-timeout'
  | 'handshake-mismatch'
  | 'worker-failed';

export class WorkerGate {
  state: GateState = window.top === window.self ? 'preparing' : 'framed';
  readonly diagnostics: { code: GateReason; at: string }[] = [];
  private readonly beforeControl = new Set<Worker>();
  private readonly listeners = new Set<(state: GateState) => void>();
  private pending: Promise<void> | null = null;
  private registration: ServiceWorkerRegistration | null = null;
  private disposed = false;
  private readonly controlChanged = () => {
    if (this.state === 'ready') this.update('preparing');
  };

  subscribe(listener: (state: GateState) => void) {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private update(state: GateState, code?: GateReason) {
    if (this.disposed) return;
    this.state = state;
    if (code) this.diagnostics.push({ code, at: new Date().toISOString() });
    for (const listener of this.listeners) listener(state);
  }

  startDemo(): Worker | null {
    if (this.state === 'framed') return null;
    const worker = new Worker(scriptURL(demoWorkerURL), { type: 'module' });
    if (this.state !== 'ready') this.beforeControl.add(worker);
    worker.postMessage({ type: 'demo-ready' });
    return worker;
  }

  assertReady(): void {
    if (
      this.state !== 'ready' ||
      window.top !== window.self ||
      !navigator.serviceWorker.controller
    )
      throw new Error('The real-data worker gate has not passed.');
  }

  ensure(): Promise<void> {
    this.pending ??= this.initialize();
    return this.pending;
  }

  get serviceWorkerRegistration() {
    return this.registration;
  }

  private async initialize() {
    if (this.state === 'framed') return;
    if (import.meta.env.DEV) {
      this.update('unavailable', 'registration-failed');
      return;
    }
    if (!('serviceWorker' in navigator)) {
      this.update('unavailable', 'missing-api');
      return;
    }
    navigator.serviceWorker.addEventListener(
      'controllerchange',
      this.controlChanged,
    );
    try {
      this.registration = await navigator.serviceWorker.register(
        scriptURL(`${base}sw.js`),
        {
          scope: base,
          updateViaCache: 'none',
        },
      );
    } catch {
      this.update('unavailable', 'registration-failed');
      return;
    }
    try {
      const control = await this.waitForControl();
      const hello = await this.hello(control);
      if (
        hello.buildId !== buildId ||
        hello.scope !== new URL(base, location.href).href
      ) {
        this.update('unavailable', 'handshake-mismatch');
        return;
      }
      // No File can reach a pre-control instance. Terminate all demo-only
      // workers before constructing the first verified worker or enabling UI.
      for (const worker of this.beforeControl) worker.terminate();
      this.beforeControl.clear();
      const worker = new Worker(scriptURL(gateWorkerURL), { type: 'module' });
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Worker handshake timed out.')),
            10_000,
          );
          worker.onmessage = (event: MessageEvent<{ type: string }>) => {
            clearTimeout(timer);
            if (event.data.type === 'gate-worker-ready') resolve();
            else reject(new Error('Worker handshake differed.'));
          };
          worker.onerror = () => {
            clearTimeout(timer);
            reject(new Error('Worker entry failed.'));
          };
        });
      } finally {
        worker.terminate();
      }
      this.update('ready');
    } catch {
      this.update(
        'unavailable',
        navigator.serviceWorker.controller
          ? 'worker-failed'
          : 'control-timeout',
      );
    }
  }

  private waitForControl(): Promise<ServiceWorker> {
    if (navigator.serviceWorker.controller)
      return Promise.resolve(navigator.serviceWorker.controller);
    return new Promise((resolve, reject) => {
      const changed = () => {
        const controller = navigator.serviceWorker.controller;
        if (controller) {
          clearTimeout(timer);
          navigator.serviceWorker.removeEventListener(
            'controllerchange',
            changed,
          );
          resolve(controller);
        }
      };
      const timer = setTimeout(() => {
        navigator.serviceWorker.removeEventListener(
          'controllerchange',
          changed,
        );
        reject(new Error('Control timed out.'));
      }, 10_000);
      navigator.serviceWorker.addEventListener('controllerchange', changed);
    });
  }

  private hello(
    controller: ServiceWorker,
  ): Promise<{ buildId: string; scope: string }> {
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const finish = () => {
        channel.port1.close();
        channel.port2.close();
        clearTimeout(timer);
      };
      const timer = setTimeout(() => {
        finish();
        reject(new Error('No service-worker handshake.'));
      }, 10_000);
      channel.port1.onmessage = (
        event: MessageEvent<{ type: string; buildId: string; scope: string }>,
      ) => {
        finish();
        if (event.data.type !== 'hello')
          reject(new Error('Invalid handshake.'));
        else resolve(event.data);
      };
      controller.postMessage({ type: 'hello', buildId }, [channel.port2]);
    });
  }

  dispose() {
    this.disposed = true;
    for (const worker of this.beforeControl) worker.terminate();
    this.beforeControl.clear();
    this.listeners.clear();
    navigator.serviceWorker?.removeEventListener(
      'controllerchange',
      this.controlChanged,
    );
  }
}

import { afterEach, expect, test, vi } from 'vitest';
import { AppUpdates } from './updates.ts';

vi.mock('virtual:sp-build-info', () => ({ buildId: 'generated-build' }));

afterEach(() => vi.unstubAllGlobals());

test('the first installation does not announce an update before control', () => {
  vi.stubGlobal('navigator', {
    serviceWorker: Object.assign(new EventTarget(), { controller: null }),
  });
  const updater = new AppUpdates(async () => {});
  const worker = Object.assign(new EventTarget(), { state: 'installing' });
  const registration = Object.assign(new EventTarget(), {
    waiting: null,
    installing: worker,
  });
  const notices: boolean[] = [];
  updater.subscribe((value) => notices.push(value));
  updater.watch(registration as unknown as ServiceWorkerRegistration);
  worker.state = 'installed';
  worker.dispatchEvent(new Event('statechange'));
  expect(notices).toEqual([false]);
  updater.dispose();
});

test('an installed update is observed even when waiting becomes visible after statechange', () => {
  vi.stubGlobal('navigator', {
    serviceWorker: Object.assign(new EventTarget(), { controller: {} }),
  });
  const updater = new AppUpdates(async () => {});
  const registration = Object.assign(new EventTarget(), {
    waiting: null as ServiceWorker | null,
    installing: null as ServiceWorker | null,
  });
  const worker = Object.assign(new EventTarget(), { state: 'installing' });
  const notices: boolean[] = [];
  updater.subscribe((value) => notices.push(value));
  updater.watch(registration as unknown as ServiceWorkerRegistration);
  registration.installing = worker as unknown as ServiceWorker;
  registration.dispatchEvent(new Event('updatefound'));
  worker.state = 'installed';
  worker.dispatchEvent(new Event('statechange'));
  // The worker state event is queued independently of registration.waiting.
  registration.waiting = worker as unknown as ServiceWorker;
  expect(notices).toEqual([false, true]);
  updater.dispose();
});

test('watch attaches to an installation already in progress and ignores a redundant worker', () => {
  vi.stubGlobal('navigator', {
    serviceWorker: Object.assign(new EventTarget(), { controller: {} }),
  });
  const updater = new AppUpdates(async () => {});
  const worker = Object.assign(new EventTarget(), { state: 'installing' });
  const registration = Object.assign(new EventTarget(), {
    waiting: null,
    installing: worker,
  });
  const notices: boolean[] = [];
  updater.subscribe((value) => notices.push(value));
  updater.watch(registration as unknown as ServiceWorkerRegistration);
  worker.state = 'redundant';
  worker.dispatchEvent(new Event('statechange'));
  expect(notices).toEqual([false]);
  worker.state = 'installed';
  worker.dispatchEvent(new Event('statechange'));
  expect(notices).toEqual([false, true]);
  updater.dispose();
});

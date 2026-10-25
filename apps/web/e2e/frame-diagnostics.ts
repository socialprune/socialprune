import type { Page } from '@playwright/test';
import { summarizeFrame } from './frame-attribution-model.ts';
import type { FrameWork } from './frame-attribution-model.ts';

/** Paired with the explicit e2e-frame build, never a shipped runtime switch. */
export async function observeFeedFrames(page: Page) {
  await page.addInitScript(() => {
    Reflect.set(window, '__spNativeRAF', requestAnimationFrame);
    Reflect.set(window, '__REACT_DEVTOOLS_GLOBAL_HOOK__', {
      supportsFiber: true,
      inject: () => 1,
      onCommitFiberRoot: () => {
        const current = probe();
        const now = performance.now();
        current?.record(
          'react-commit',
          now,
          now,
          'production commit timestamp',
        );
      },
      onCommitFiberUnmount: () => {},
    });
    type Probe = {
      measure: <T>(kind: string, callback: () => T, detail?: string) => T;
      record: (
        kind: string,
        start: number,
        end: number,
        detail: string,
        scope?: 'marker' | 'async-lifetime',
      ) => void;
    };
    const probe = () =>
      Reflect.get(window, '__spFrameAttribution') as Probe | undefined;
    const timed = <T>(kind: string, callback: () => T, detail = '') => {
      const current = probe();
      return current ? current.measure(kind, callback, detail) : callback();
    };
    // The synchronous listener body, not the asynchronous request lifetime.
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Called with original Worker receiver below.
    const workerAdd = Worker.prototype.addEventListener;
    const listeners = new WeakMap<
      EventListenerOrEventListenerObject,
      EventListener
    >();
    Worker.prototype.addEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type !== 'message')
        return workerAdd.call(this, type, listener, options);
      const wrapped: EventListener = (event) =>
        timed(
          'worker-message-handler',
          () =>
            typeof listener === 'function'
              ? listener.call(this, event)
              : listener.handleEvent(event),
          (event as MessageEvent<{ type?: string }>).data?.type ?? 'unknown',
        );
      listeners.set(listener, wrapped);
      return workerAdd.call(this, type, wrapped, options);
    };
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Called with original Worker receiver below.
    const workerRemove = Worker.prototype.removeEventListener;
    Worker.prototype.removeEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ) {
      return workerRemove.call(
        this,
        type,
        listeners.get(listener) ?? listener,
        options,
      );
    };
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Called with original Element receiver below.
    const originalRect = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      return timed(
        'style-layout-read',
        () => originalRect.call(this),
        this.tagName,
      );
    };
    for (const key of ['offsetHeight', 'offsetWidth'] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLElement.prototype,
        key,
      );
      if (!descriptor?.get) continue;
      Object.defineProperty(HTMLElement.prototype, key, {
        ...descriptor,
        get() {
          return timed(
            'style-layout-read',
            () => descriptor.get!.call(this) as number,
            key,
          );
        },
      });
    }
    const originalComputed = getComputedStyle;
    window.getComputedStyle = (element, pseudo) =>
      timed('computed-style', () => originalComputed(element, pseudo));
    const OriginalResize = ResizeObserver;
    window.ResizeObserver = class extends OriginalResize {
      constructor(callback: ResizeObserverCallback) {
        super((entries, observer) =>
          timed(
            'resize-observer',
            () => callback(entries, observer),
            `entries=${entries.length}`,
          ),
        );
      }
    };
    const originalFrame = requestAnimationFrame;
    window.requestAnimationFrame = (callback) =>
      originalFrame((time) => timed('raf-callback', () => callback(time)));
    const portMessage = Object.getOwnPropertyDescriptor(
      MessagePort.prototype,
      'onmessage',
    );
    if (portMessage?.get && portMessage.set) {
      Object.defineProperty(MessagePort.prototype, 'onmessage', {
        ...portMessage,
        set(callback: ((event: MessageEvent) => unknown) | null) {
          const receiver = this as MessagePort;
          portMessage.set!.call(
            receiver,
            callback
              ? (event: MessageEvent) =>
                  timed('scheduler-messageport-callback', () =>
                    callback.call(receiver, event),
                  )
              : null,
          );
        },
      });
    }
    for (const name of [
      'appendChild',
      'insertBefore',
      'removeChild',
    ] as const) {
      // eslint-disable-next-line @typescript-eslint/unbound-method -- Reflect.apply restores the original Node receiver.
      const original = Node.prototype[name] as (...args: unknown[]) => unknown;
      Reflect.set(
        Node.prototype,
        name,
        function (this: Node, ...args: unknown[]) {
          return timed(
            'react-dom-mutation',
            () => Reflect.apply(original, this, args),
            name,
          );
        },
      );
    }
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Original Element receiver restored by call(this).
    const attribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name: string, value: string) {
      return timed(
        'dom-attribute-write',
        () => attribute.call(this, name, value),
        name,
      );
    };
  });
  return {
    async start() {
      await page.evaluate(() => {
        const probe = Reflect.get(window, '__spFrameAttribution') as
          | {
              start: () => void;
              record: (
                kind: string,
                start: number,
                end: number,
                detail: string,
                scope: 'async-lifetime',
              ) => void;
            }
          | undefined;
        if (!probe)
          throw Error(
            'Frame attribution requires the explicit e2e-frame build.',
          );
        const original = window.workspace.request.bind(window.workspace);
        window.workspace.request = async (input, ...rest) => {
          const start = performance.now();
          try {
            return await original(input, ...rest);
          } finally {
            if (['planCounts', 'feedWindow'].includes(input.type))
              probe.record(
                `request-${input.type}`,
                start,
                performance.now(),
                input.type,
                'async-lifetime',
              );
          }
        };
        probe.start();
      });
    },
    async read() {
      const result = await page.evaluate(() =>
        (
          Reflect.get(window, '__spFrameAttribution') as {
            read: () => {
              format: string;
              frames: {
                start: number;
                end: number;
                work: FrameWork[];
                dropped: number;
              }[];
              dropped: number;
              profiledReact: boolean;
              coverage: Record<
                string,
                { calls: number; wallMs: number; selfMs: number }
              >;
              boundary: string;
            };
          }
        ).read(),
      );
      return {
        ...result,
        frames: result.frames.map((frame) => ({
          ...frame,
          ...summarizeFrame(frame.start, frame.end, frame.work),
        })),
      };
    },
  };
}

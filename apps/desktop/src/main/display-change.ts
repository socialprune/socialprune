import type { Bounds } from './methods.ts';

/** Runner-owned exact window capability. There is deliberately no browser
 * enumeration or title/process lookup fallback in the desktop app. */
export interface PlatformWindowOwner {
  current(): Promise<{ id: string; bounds: Bounds } | null>;
  move(
    id: string,
    bounds: Bounds,
    options: { activate: false; expected?: Bounds },
  ): Promise<void>;
}
const valid = (b: Bounds) =>
  [b.x, b.y, b.width, b.height].every(Number.isFinite) &&
  b.width > 0 &&
  b.height > 0;
const intersects = (a: Bounds, b: Bounds) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;
const distance = (a: Bounds, b: Bounds) =>
  Math.max(b.x - a.x - a.width, a.x - b.x - b.width, 0) ** 2 +
  Math.max(b.y - a.y - a.height, a.y - b.y - b.height, 0) ** 2;

export function attachDisplayRecovery(options: {
  events: {
    on(
      event: 'display-removed' | 'display-metrics-changed',
      listener: () => void,
    ): unknown;
    removeListener(
      event: 'display-removed' | 'display-metrics-changed',
      listener: () => void,
    ): unknown;
  };
  areas(): Bounds[];
  appBounds(): Bounds;
  owner?: PlatformWindowOwner;
  record(code: 'DISPLAY_WINDOW_MOVED' | 'DISPLAY_RECOVERY_FAILED'): void;
}) {
  let closed = false;
  let queued = Promise.resolve();
  const recover = async () => {
    if (closed || !options.owner) return;
    const target = await options.owner.current();
    const areas = options.areas().filter(valid);
    if (
      !target ||
      !target.id ||
      !valid(target.bounds) ||
      !areas.length ||
      areas.some((area) => intersects(target.bounds, area))
    )
      return;
    const area = areas.reduce((best, area) =>
      distance(target.bounds, area) < distance(target.bounds, best)
        ? area
        : best,
    );
    const app = options.appBounds();
    const width = Math.min(target.bounds.width, area.width);
    const height = Math.min(target.bounds.height, area.height);
    const beside =
      valid(app) && intersects(app, area)
        ? app.x + app.width
        : area.x + area.width / 2;
    const bounds = {
      x: Math.round(
        Math.max(area.x, Math.min(beside, area.x + area.width - width)),
      ),
      y: Math.round(
        Math.max(area.y, Math.min(app.y, area.y + area.height - height)),
      ),
      width,
      height,
    };
    // Recheck the same capability after asynchronous reads. A close/new run or
    // a visible move by the person invalidates the old target.
    const current = await options.owner.current();
    if (
      closed ||
      current?.id !== target.id ||
      !valid(current.bounds) ||
      JSON.stringify(current.bounds) !== JSON.stringify(target.bounds) ||
      JSON.stringify(options.areas().filter(valid)) !== JSON.stringify(areas) ||
      options
        .areas()
        .some((area) => valid(area) && intersects(current.bounds, area))
    )
      return;
    await options.owner.move(target.id, bounds, {
      activate: false,
      expected: target.bounds,
    });
    options.record('DISPLAY_WINDOW_MOVED');
  };
  const changed = () => {
    queued = queued
      .then(recover)
      .catch(() => options.record('DISPLAY_RECOVERY_FAILED'));
  };
  options.events.on('display-removed', changed);
  options.events.on('display-metrics-changed', changed);
  return {
    settled: () => queued,
    close() {
      closed = true;
      options.events.removeListener('display-removed', changed);
      options.events.removeListener('display-metrics-changed', changed);
    },
  };
}

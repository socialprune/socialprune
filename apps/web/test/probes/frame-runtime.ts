import type { FrameWork } from '../../e2e/frame-attribution-model.ts';

interface Pending {
  kind: string;
  start: number;
  child: number;
  detail: string;
}
interface DiagnosticFrame {
  start: number;
  end: number;
  work: FrameWork[];
  dropped: number;
}
const events: FrameWork[] = [],
  frames: DiagnosticFrame[] = [];
const stack: Pending[] = [];
const coverage: Record<
  string,
  { calls: number; wallMs: number; selfMs: number }
> = {};
let active = false,
  dropped = 0,
  previous: number | undefined;
export function record(
  kind: string,
  start: number,
  end: number,
  detail: string,
  scope: FrameWork['scope'] = 'marker',
  selfMs = 0,
) {
  if (!active) return;
  const total = coverage[kind] ?? { calls: 0, wallMs: 0, selfMs: 0 };
  total.calls++;
  total.wallMs += Math.max(0, end - start);
  total.selfMs += selfMs;
  coverage[kind] = total;
  // Count cheap calls in aggregate; do not allocate an event for a zero-length
  // read in engines with coarse performance clocks.
  if (scope === 'sync-wall' && end - start < 0.1) return;
  events.push({ kind, start, end, detail, scope, selfMs });
  if (events.length > 20000) {
    events.shift();
    dropped++;
  }
}
export function measure<T>(kind: string, callback: () => T, detail = ''): T {
  if (!active) return callback();
  const pending = { kind, start: performance.now(), child: 0, detail };
  stack.push(pending);
  try {
    return callback();
  } finally {
    const end = performance.now();
    stack.pop();
    const duration = end - pending.start;
    if (stack.length) stack.at(-1)!.child += duration;
    record(
      kind,
      pending.start,
      end,
      detail,
      'sync-wall',
      Math.max(0, duration - pending.child),
    );
    if (duration >= 1) {
      performance.measure(`sp-frame:${kind}`, { start: pending.start, end });
      performance.clearMeasures(`sp-frame:${kind}`);
    }
  }
}
const nativeFrame =
  (Reflect.get(window, '__spNativeRAF') as
    typeof requestAnimationFrame | undefined) ?? requestAnimationFrame;
function tick(now: number) {
  if (active && previous !== undefined) {
    if (now - previous > 50) {
      frames.push({
        start: previous,
        end: now,
        work: events.filter(
          (event) => event.end >= previous! && event.start <= now,
        ),
        dropped,
      });
    }
    // Nothing older can belong to the next frame. Keep asynchronous intervals
    // only when they resolve, never as inferred synchronous work.
    while (events.length && events[0]!.end < previous) events.shift();
  }
  previous = now;
  nativeFrame(tick);
}
nativeFrame(tick);
const api = {
  measure,
  record,
  start() {
    active = true;
    previous = undefined;
    events.length = 0;
    frames.length = 0;
    dropped = 0;
    for (const key of Object.keys(coverage)) delete coverage[key];
  },
  read() {
    active = false;
    return {
      format: 'socialprune-frame-attribution-v2',
      frames,
      coverage,
      dropped,
      profiledReact: false,
      reactBuild:
        'Production renderer with synchronous scheduler/DOM/virtualizer wrappers and commit markers. Optional profiling entry unavailable; actual render duration may be absent.',
      boundary:
        'Synchronous wrapper wall spans include OS preemption. React actualDuration is separately reported. Unobserved intervals are not assigned a CPU cause.',
    };
  },
};
Reflect.set(window, '__spFrameAttribution', api);

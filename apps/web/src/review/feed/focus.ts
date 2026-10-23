/** Keep one keyboard destination pending until the DOM confirms it owns focus. */
export function focusWhenReady({
  find,
  scroll,
  active,
  frame,
  cancelFrame,
  complete,
}: {
  find: () => HTMLElement | undefined;
  scroll: () => void;
  active: () => Element | null;
  frame: (callback: () => void) => number;
  cancelFrame: (id: number) => void;
  complete: () => void;
}) {
  let cancelled = false;
  let scheduled: number | undefined;
  let attempted: HTMLElement | undefined;
  const attempt = () => {
    if (cancelled) return;
    const target = find();
    if (target?.isConnected && target === attempted && active() === target) {
      complete();
      return;
    }
    if (target?.isConnected) {
      target.focus({ preventScroll: true });
      attempted = target;
    } else {
      attempted = undefined;
      scroll();
    }
    scheduled = frame(attempt);
  };
  scroll();
  attempt();
  return () => {
    cancelled = true;
    if (scheduled !== undefined) cancelFrame(scheduled);
  };
}

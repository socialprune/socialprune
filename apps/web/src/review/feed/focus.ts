/** Keep one keyboard destination pending until the DOM confirms it owns focus. */
export function focusWhenReady({
  find,
  scroll,
  active,
  frame,
  cancelFrame,
  complete,
  panel,
}: {
  find: () => HTMLElement | undefined;
  scroll: () => void;
  active: () => Element | null;
  frame: (callback: () => void) => number;
  cancelFrame: (id: number) => void;
  complete: () => void;
  panel?: () => HTMLElement | null;
}) {
  let cancelled = false;
  let scheduled: number | undefined;
  let attempted: HTMLElement | undefined;
  const attempt = () => {
    if (cancelled) return;
    const target = find();
    const bounds = panel?.()?.getBoundingClientRect();
    const box = bounds ? target?.getBoundingClientRect() : undefined;
    const visible =
      !bounds || (!!box && box.bottom > bounds.top && box.top < bounds.bottom);
    if (
      target?.isConnected &&
      target === attempted &&
      active() === target &&
      visible
    ) {
      complete();
      return;
    }
    if (target?.isConnected) {
      if (!visible) scroll();
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

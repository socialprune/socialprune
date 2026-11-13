import { expect } from 'vitest';
import { IG_FIXTURE } from './fixture.ts';

export interface RecordedEvents {
  inputs: string[];
  choices: { type: string; side: string; unit: string; label: string }[];
  clicks: string[];
  added: string[];
  wheels: { area: string; x: number; y: number }[];
  /** HUMAN-1: pointer moves before each press, hold and relative position. */
  presses?: {
    moves: number;
    holdMs: number;
    fx: number | null;
    fy: number | null;
  }[];
}
export function assertRecordedEvents(
  events: readonly RecordedEvents[],
  listWheelDelta: number | readonly number[] = IG_FIXTURE.scroll.delta,
  humanInput = false,
): void {
  for (const event of events) {
    expect(event.inputs).toEqual([]);
    expect(event.added).toEqual([]);
    for (const wheel of event.wheels) {
      expect(['list', 'post-comments']).toContain(wheel.area);
      expect(wheel.x).toBe(0);
      const allowed =
        wheel.area === 'list'
          ? typeof listWheelDelta === 'number'
            ? [listWheelDelta]
            : listWheelDelta
          : [IG_FIXTURE.scroll.delta];
      // HUMAN-1: post-column bursts use 60 to 180 px per event.
      if (humanInput && wheel.area === 'post-comments') {
        expect(wheel.y).toBeGreaterThanOrEqual(60);
        expect(wheel.y).toBeLessThanOrEqual(180);
      } else expect(allowed).toContain(wheel.y);
    }
    for (const click of event.clicks)
      expect(IG_FIXTURE.allowedClicks as readonly string[]).toContain(click);
    for (const choice of event.choices) {
      expect(['input', 'change']).toContain(choice.type);
      expect(['start', 'end']).toContain(choice.side);
      expect(['year', 'month', 'day']).toContain(choice.unit);
    }
  }
}

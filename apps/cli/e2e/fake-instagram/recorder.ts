import { expect } from 'vitest';
import { IG_FIXTURE } from './fixture.ts';

export interface RecordedEvents {
  inputs: string[];
  choices: { type: string; side: string; unit: string; label: string }[];
  clicks: string[];
  added: string[];
  wheels: { area: string; x: number; y: number }[];
}
export function assertRecordedEvents(events: readonly RecordedEvents[]): void {
  for (const event of events) {
    expect(event.inputs).toEqual([]);
    expect(event.added).toEqual([]);
    for (const wheel of event.wheels) {
      expect(['list', 'post-comments']).toContain(wheel.area);
      expect(wheel.x).toBe(0);
      expect(wheel.y).toBe(IG_FIXTURE.scroll.delta);
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

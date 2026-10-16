import { expect } from 'vitest';
import { IG_FIXTURE } from './fixture.ts';

export interface RecordedEvents {
  inputs: string[];
  choices: { type: string; side: string; unit: string; label: string }[];
  clicks: string[];
  added: string[];
}
export function assertRecordedEvents(events: readonly RecordedEvents[]): void {
  for (const event of events) {
    expect(event.inputs).toEqual([]);
    expect(event.added).toEqual([]);
    for (const click of event.clicks)
      expect(IG_FIXTURE.allowedClicks as readonly string[]).toContain(click);
    for (const choice of event.choices) {
      expect(['input', 'change']).toContain(choice.type);
      expect(['start', 'end']).toContain(choice.side);
      expect(['year', 'month', 'day']).toContain(choice.unit);
    }
  }
}

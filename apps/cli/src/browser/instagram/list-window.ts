import { dateInZone } from '../pace.ts';
import { utcWindow } from './selectors.ts';
import { ListWindowSchema } from './report.ts';

/** Compare calendar labels used by the existing date filter; no date is emitted. */
export function windowFacts(
  at: string,
  timeZone: string,
  dates = utcWindow(at),
) {
  try {
    const [start, end] = dates;
    const utc = new Date(at).toISOString().slice(0, 10);
    const local = dateInZone(at, timeZone);
    const exportYear = Number(utc.slice(0, 4));
    const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
    return ListWindowSchema.parse({
      observed: true,
      observationFailed: false,
      windowLengthDays: days,
      exportInsideWorkspaceWindow: local >= start && local <= end,
      exportInsideUtcWindow: utc >= start && utc <= end,
      startEndSameDay: start === end,
      startYearOffset: Number(start.slice(0, 4)) - exportYear,
      endYearOffset: Number(end.slice(0, 4)) - exportYear,
    });
  } catch {
    return ListWindowSchema.parse({
      observed: false,
      observationFailed: true,
      windowLengthDays: null,
      exportInsideWorkspaceWindow: null,
      exportInsideUtcWindow: null,
      startEndSameDay: null,
      startYearOffset: null,
      endYearOffset: null,
    });
  }
}

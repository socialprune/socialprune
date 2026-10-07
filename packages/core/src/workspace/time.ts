import { WorkspaceError } from './errors.ts';

const formatters = new Map<string, Intl.DateTimeFormat>();
export function dayKey(utc: string, timeZone: string): string {
  const instant = new Date(utc);
  if (!Number.isFinite(instant.getTime()))
    throw new WorkspaceError('INVALID_QUERY');
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat('en', {
        timeZone,
        calendar: 'iso8601',
        numberingSystem: 'latn',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    } catch {
      throw new WorkspaceError('INVALID_QUERY');
    }
    formatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(instant);
  return ['year', 'month', 'day']
    .map((kind) => parts.find((part) => part.type === kind)!.value)
    .join('-');
}
export function resolveTimeZone(
  flag: string | null | undefined,
  setting: string | null | undefined,
  system = Intl.DateTimeFormat().resolvedOptions().timeZone,
): { timeZone: string; source: 'flag' | 'workspace' | 'system' } {
  const timeZone = flag ?? setting ?? system;
  dayKey('2026-01-01T00:00:00Z', timeZone);
  return {
    timeZone,
    source: flag != null ? 'flag' : setting != null ? 'workspace' : 'system',
  };
}

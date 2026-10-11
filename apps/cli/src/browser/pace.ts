import { CliError } from '../cli/errors.ts';
export interface Pace {
  intervalMs: number;
  batchSize: number;
  pauseMs: number;
  perDay: number;
}
export const DELETE_PACE: Readonly<Pace> = Object.freeze({
  intervalMs: 30_000,
  batchSize: 20,
  pauseMs: 900_000,
  perDay: 200,
});
export const VERIFY_PACE: Readonly<Pace> = Object.freeze({
  intervalMs: 10_000,
  batchSize: 100,
  pauseMs: 0,
  perDay: 100,
});
export function productionPace(
  mode: 'delete' | 'verify',
  options: Partial<Pace> = {},
): Pace {
  const floor = mode === 'delete' ? DELETE_PACE : VERIFY_PACE;
  const pace = { ...floor, ...options };
  if (
    Object.values(pace).some((v) => !Number.isSafeInteger(v) || v < 0) ||
    pace.intervalMs < floor.intervalMs ||
    pace.batchSize < 1 ||
    pace.batchSize > floor.batchSize ||
    pace.pauseMs < floor.pauseMs ||
    pace.perDay < 1 ||
    pace.perDay > floor.perDay
  )
    throw new CliError('INVALID_ARGUMENTS');
  return pace;
}
export function dateInZone(time: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(time));
}
export function estimate(count: number): number {
  return (
    Math.max(0, count - 1) * DELETE_PACE.intervalMs +
    Math.floor(Math.max(0, count - 1) / DELETE_PACE.batchSize) *
      DELETE_PACE.pauseMs
  );
}

export interface ImportLimits {
  maxEntries: number;
  maxTextBytes: number;
  maxStreamBytes: number;
  maxElementBytes: number;
}
export const DEFAULT_IMPORT_LIMITS: Readonly<ImportLimits> = Object.freeze({
  maxEntries: 2_000_000,
  maxTextBytes: 256 * 1024 * 1024,
  maxStreamBytes: 4 * 1024 * 1024 * 1024,
  maxElementBytes: 16 * 1024 * 1024,
});
export class ArchiveLimitError extends Error {
  override readonly name = 'ArchiveLimitError';
  readonly limit: keyof ImportLimits;
  readonly maximum: number;
  constructor(limit: keyof ImportLimits, maximum: number) {
    super(`Archive limit exceeded: ${limit}.`);
    this.limit = limit;
    this.maximum = maximum;
  }
}
export function resolveImportLimits(
  overrides: Partial<ImportLimits> = {},
): ImportLimits {
  const limits = { ...DEFAULT_IMPORT_LIMITS, ...overrides };
  for (const value of Object.values(limits)) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new RangeError('Invalid import limit.');
  }
  return limits;
}
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new DOMException('Operation aborted.', 'AbortError');
}
export function combineSignals(
  ...signals: (AbortSignal | undefined)[]
): AbortSignal {
  return AbortSignal.any(
    signals.filter((signal): signal is AbortSignal => signal !== undefined),
  );
}
export async function abortable<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return promise;
  let abort: () => void = () => {};
  const canceled = new Promise<never>((_, reject) => {
    abort = () => reject(new DOMException('Operation aborted.', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([promise, canceled]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

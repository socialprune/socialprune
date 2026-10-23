interface XWindow {
  operation: string;
  limit: number;
  lowestRemaining: number;
  responses: number;
  longestResetSeconds: number;
  latestRemaining: number;
  latestReset: number;
}
/** Only header numbers and bounded operation identities leave this monitor. */
export class XResponseWindows {
  private readonly windows = new Map<string, XWindow>();
  private readonly testOrigin?: string;
  constructor(testOrigin?: string) {
    this.testOrigin = testOrigin;
  }
  accepts(url: string): boolean {
    try {
      const parsed = new URL(url);
      return this.testOrigin === undefined
        ? parsed.protocol === 'https:' &&
            ['x.com', 'api.x.com'].includes(parsed.hostname) &&
            !parsed.port &&
            !parsed.username &&
            !parsed.password
        : parsed.origin === this.testOrigin;
    } catch {
      return false;
    }
  }
  observe(url: string, headers: Record<string, string>, now: number): void {
    if (!this.accepts(url)) return;
    const names = [
      'x-rate-limit-limit',
      'x-rate-limit-remaining',
      'x-rate-limit-reset',
    ] as const;
    if (names.some((name) => !/^\d+$/.test(headers[name] ?? ''))) return;
    const limit = Number(headers[names[0]]),
      remaining = Number(headers[names[1]]),
      reset = Number(headers[names[2]]);
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      !Number.isSafeInteger(remaining) ||
      remaining < 0 ||
      !Number.isSafeInteger(reset) ||
      reset < 0 ||
      !Number.isSafeInteger(reset * 1000)
    )
      return;
    const path = new URL(url).pathname;
    const operation =
      path.match(/^\/i\/api\/graphql\/[^/]+\/([A-Za-z0-9_]{1,64})\/?$/)?.[1] ??
      (path.includes('/graphql/')
        ? 'graphql-other'
        : path.startsWith('/i/api/')
          ? 'api-other'
          : 'other');
    const prior = this.windows.get(operation);
    const longest = Math.max(0, Math.ceil((reset * 1000 - now) / 1000));
    this.windows.set(operation, {
      operation,
      limit,
      latestRemaining: remaining,
      latestReset: reset * 1000,
      lowestRemaining: Math.min(prior?.lowestRemaining ?? remaining, remaining),
      responses: (prior?.responses ?? 0) + 1,
      longestResetSeconds: Math.max(prior?.longestResetSeconds ?? 0, longest),
    });
  }
  beforePage(now: number) {
    return this.before(now, 0);
  }
  /** Reserve the next request, so deletion never crosses a known half window. */
  beforeDeletion(now: number) {
    return this.before(now, 1);
  }
  private before(
    now: number,
    reserve: number,
  ):
    | { kind: 'ready' }
    | { kind: 'long' }
    | { kind: 'wait'; ms: number; minutes: number } {
    const low = [...this.windows.values()].filter(
      (window) =>
        window.latestRemaining - reserve < window.limit / 2 &&
        window.latestReset > now,
    );
    if (low.some((window) => window.latestReset - now > 16 * 60000))
      return { kind: 'long' };
    if (!low.length) return { kind: 'ready' };
    const ms =
      Math.max(...low.map((window) => window.latestReset - now)) + 5000;
    return { kind: 'wait', ms, minutes: Math.ceil(ms / 60000) };
  }
  /** The projected 8-second starts must fit above half of DeleteTweet's window. */
  permitsFastDeletion(now: number): boolean {
    const window = this.windows.get('DeleteTweet');
    return Boolean(
      window &&
      window.latestRemaining <= window.limit &&
      window.latestReset > now &&
      window.latestRemaining - Math.ceil(window.limit / 2) >=
        Math.ceil((window.latestReset - now) / 8000),
    );
  }
  summary(): {
    operation: string;
    limit: number;
    lowestRemaining: number;
    responses: number;
    longestResetSeconds: number;
  }[] {
    return [...this.windows.values()]
      .sort((a, b) => a.operation.localeCompare(b.operation))
      .map(
        ({
          operation,
          limit,
          lowestRemaining,
          responses,
          longestResetSeconds,
        }) => ({
          operation,
          limit,
          lowestRemaining,
          responses,
          longestResetSeconds,
        }),
      );
  }
}

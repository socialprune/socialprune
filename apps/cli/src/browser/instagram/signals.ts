export const RATE_SIGNALS = [
  'feedback_required',
  'please_wait',
  'checkpoint_required',
  'spam',
] as const;
export const HOST_CLASSES = [
  'instagram',
  'cdninstagram',
  'fbcdn',
  'other',
] as const;
export const PATH_CLASSES = [
  'list-page',
  'post-page',
  'wbloks-fetch',
  'graphql',
  'api-v1-read',
  'media',
  'other',
] as const;
export type HostClass = (typeof HOST_CLASSES)[number];
export type PathClass = (typeof PATH_CLASSES)[number];
export const POST_PATH_CLASSES = [
  'list-page',
  'post-page',
  'wbloks-fetch',
  'graphql',
  'api-v1-media-comments',
  'api-v1-media-info',
  'api-v1-other',
  'media',
  'other',
] as const;
export type PostPathClass = (typeof POST_PATH_CLASSES)[number];
export type ReadyKind = 'list' | 'post';
export function hostClass(input: string): HostClass {
  const host = new URL(input).hostname.toLowerCase();
  if (host === 'instagram.com' || host.endsWith('.instagram.com'))
    return 'instagram';
  if (host.endsWith('.cdninstagram.com')) return 'cdninstagram';
  if (host.endsWith('.fbcdn.net')) return 'fbcdn';
  return 'other';
}
export function pathClass(input: string, media = false): PathClass {
  const path = new URL(input).pathname;
  if (media) return 'media';
  if (path.replace(/\/$/, '') === '/your_activity/interactions/comments')
    return 'list-page';
  if (/^\/(?:p|reel)\/[A-Za-z0-9_-]{1,64}\/?$/.test(path)) return 'post-page';
  if (path === '/async/wbloks/fetch/' || path === '/async/wbloks/fetch')
    return 'wbloks-fetch';
  if (path === '/graphql/query' || path.startsWith('/graphql/'))
    return 'graphql';
  if (path.startsWith('/api/v1/')) return 'api-v1-read';
  return 'other';
}
export function postPathClass(input: string, media = false): PostPathClass {
  const generic = pathClass(input, media);
  if (generic !== 'api-v1-read') return generic;
  const path = new URL(input).pathname;
  // Numeric media PKs and PK_owner IDs occur in instagrapi's media and comment
  // readers (2026-10-21); Instaloader also uses these API paths in structures.py.
  // Only the category leaves this function, never an ID.
  if (/^\/api\/v1\/media\/\d+(?:_\d+)?\/comments(?:\/|$)/.test(path))
    return 'api-v1-media-comments';
  if (/^\/api\/v1\/media\/\d+(?:_\d+)?\/info(?:\/|$)/.test(path))
    return 'api-v1-media-info';
  return 'api-v1-other';
}
export function rateSignal(body: unknown): boolean {
  let visits = 0;
  function walk(input: unknown, depth: number): boolean {
    if (++visits > 100000 || depth > 40) return false;
    if (Array.isArray(input))
      return input.some((value) => walk(value, depth + 1));
    if (!input || typeof input !== 'object') return false;
    return Object.entries(input).some(
      ([key, value]) =>
        ((key === 'status' || key === 'message') &&
          RATE_SIGNALS.some((signal) => value === signal)) ||
        (value !== null && typeof value === 'object' && walk(value, depth + 1)),
    );
  }
  return walk(body, 0);
}
export function restrictionSignal(body: unknown): boolean {
  let visits = 0;
  function walk(input: unknown, depth: number): boolean {
    if (++visits > 100000 || depth > 40) return false;
    if (Array.isArray(input))
      return input.some((value) => walk(value, depth + 1));
    if (!input || typeof input !== 'object') return false;
    return Object.entries(input).some(
      ([key, value]) =>
        ((key === 'status' || key === 'message') &&
          ['feedback_required', 'please_wait', 'spam'].some(
            (signal) => value === signal,
          )) ||
        (value !== null && typeof value === 'object' && walk(value, depth + 1)),
    );
  }
  return walk(body, 0);
}
export class LimitSignals {
  private readonly responses = new Map<
    string,
    {
      host: HostClass;
      path: PathClass;
      count: number;
      status4xx: Record<string, number>;
      status5xx: number;
    }
  >();
  private readonly headerNames = new Set<string>();
  private readonly ready: Record<ReadyKind, number[]> = { list: [], post: [] };
  response(
    host: HostClass,
    path: PathClass,
    status: number,
    headers: Readonly<Record<string, string>>,
  ): void {
    const key = `${host}|${path}`;
    const group = this.responses.get(key) ?? {
      host,
      path,
      count: 0,
      status4xx: {},
      status5xx: 0,
    };
    group.count++;
    if (status >= 400 && status <= 499)
      group.status4xx[String(status)] =
        (group.status4xx[String(status)] ?? 0) + 1;
    if (status >= 500 && status <= 599) group.status5xx++;
    this.responses.set(key, group);
    for (const raw of Object.keys(headers)) {
      const name = raw.toLowerCase();
      if (
        name === 'retry-after' ||
        /^x-rate-?limit(?:-[a-z0-9-]{1,48})?$/.test(name) ||
        /^ratelimit(?:-(?:limit|remaining|reset|policy))?$/.test(name)
      )
        this.headerNames.add(name);
    }
  }
  navigated(kind: ReadyKind, elapsedMs: number): void {
    if (Number.isFinite(elapsedMs) && elapsedMs >= 0)
      this.ready[kind].push(Math.round(elapsedMs));
  }
  summary() {
    const durations = (values: readonly number[]) => {
      const sorted = [...values].sort((a, b) => a - b),
        middle = Math.floor(sorted.length / 2);
      return {
        count: sorted.length,
        medianMs: sorted.length
          ? sorted.length % 2
            ? sorted[middle]!
            : (sorted[middle - 1]! + sorted[middle]!) / 2
          : null,
        maxMs: sorted.at(-1) ?? null,
      };
    };
    return {
      responses: [...this.responses.values()]
        .sort(
          (a, b) =>
            a.host.localeCompare(b.host) || a.path.localeCompare(b.path),
        )
        .map((group) => ({ ...group, status4xx: { ...group.status4xx } })),
      ready: {
        list: durations(this.ready.list),
        post: durations(this.ready.post),
      },
      headerNames: [...this.headerNames].sort(),
    };
  }
}

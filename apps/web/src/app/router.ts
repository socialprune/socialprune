export const ROUTES = [
  '/',
  '/guide',
  '/guide/x',
  '/guide/instagram',
  '/demo',
  '/import',
  '/review',
  '/clicklist/x',
  '/clicklist/instagram',
  '/backup',
  '/settings',
  '/privacy',
] as const;
export type Route = (typeof ROUTES)[number];
export const REVIEW_ROUTES = [
  '/',
  '/review',
  '/clicklist/x',
  '/clicklist/instagram',
  '/settings',
  '/privacy',
  '/guide',
  '/demo',
  '/import',
  '/backup',
] as const satisfies readonly Route[];
export function parseReviewRoute(hash: string): Route | 'not-found' {
  const value = hash === '' ? '/' : hash.slice(1);
  return (REVIEW_ROUTES as readonly string[]).includes(value)
    ? (value as Route)
    : 'not-found';
}

export function parseRoute(hash: string): Route | 'not-found' {
  const value = hash === '' ? '/' : hash.slice(1);
  return (ROUTES as readonly string[]).includes(value)
    ? (value as Route)
    : 'not-found';
}

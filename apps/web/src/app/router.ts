export const ROUTES = [
  '/',
  '/guide',
  '/guide/x',
  '/guide/instagram',
  '/demo',
  '/import',
  '/review',
  '/review/list',
  '/archive',
  '/clicklist/x',
  '/clicklist/x/go',
  '/clicklist/instagram',
  '/clicklist/instagram/go',
  '/backup',
  '/settings',
  '/privacy',
] as const;
export type Route = (typeof ROUTES)[number];
export const REVIEW_ROUTES = [
  '/',
  '/review',
  '/review/list',
  '/archive',
  '/clicklist/x',
  '/clicklist/x/go',
  '/clicklist/instagram',
  '/clicklist/instagram/go',
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

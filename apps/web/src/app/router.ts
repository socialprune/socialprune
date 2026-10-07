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
export function parseRoute(hash: string): Route | 'not-found' {
  const value = hash === '' ? '/' : hash.slice(1);
  return (ROUTES as readonly string[]).includes(value)
    ? (value as Route)
    : 'not-found';
}

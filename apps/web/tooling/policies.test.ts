import { expect, test } from 'vitest';
import { developmentPolicy } from './development-policy.ts';
import { PAGE_POLICY, DATA_WORKER_POLICY } from '../src/sw/policies.ts';
import { parseRoute, ROUTES } from '../src/app/router.ts';

test('pins the ADR page and data-worker policy without evaluation or blob permission', () => {
  expect(PAGE_POLICY).toBe(
    "default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'none'; style-src 'self'; img-src 'self'; font-src 'none'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; require-trusted-types-for 'script'; trusted-types socialprune",
  );
  expect(DATA_WORKER_POLICY).toBe(
    "default-src 'none'; script-src 'self'; connect-src 'none'; worker-src 'none'",
  );
  expect(developmentPolicy().apply).toBe('serve');
});

test('only fixed routes are accepted, never item state or arbitrary query values', () => {
  expect(ROUTES).toEqual([
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
  ]);
  for (const route of ROUTES) expect(parseRoute(`#${route}`)).toBe(route);
  expect(parseRoute('#/review?text=invented')).toBe('not-found');
  expect(parseRoute('#/review/invented-id')).toBe('not-found');
});

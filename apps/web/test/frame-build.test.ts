import { expect, test } from 'vitest';
import { frameAttributionBuild } from '../tooling/frame-attribution-build.ts';

test('normal and release build entrypoints never substitute the frame probes', () => {
  for (const mode of ['pages', 'release', 'review', 'desktop', 'e2e-probe']) {
    const plugin = frameAttributionBuild(mode);
    const html = '<script type="module" src="/src/main.tsx"></script>';
    const transform = plugin.transformIndexHtml as (html: string) => string;
    expect(transform(html)).toBe(html);
    const resolve = plugin.resolveId as (
      source: string,
      importer: string,
    ) => unknown;
    expect(
      resolve('@tanstack/react-virtual', '/src/review/feed/ReviewFeed.tsx'),
    ).toBeUndefined();
    expect(
      resolve('./session.ts', '/src/review/feed/FeedWorkspace.tsx'),
    ).toBeUndefined();
  }
});
test('attribution substitutions are exact module boundaries, not all consumers', () => {
  const plugin = frameAttributionBuild('e2e-frame');
  const resolve = plugin.resolveId as (
    source: string,
    importer: string,
  ) => unknown;
  expect(
    resolve('@tanstack/react-virtual', '/src/review/feed/ReviewFeed.tsx'),
  ).toContain('frame-virtualizer');
  expect(
    resolve('./session.ts', '/src/review/feed/FeedWorkspace.tsx'),
  ).toContain('frame-session');
  expect(
    resolve('@tanstack/react-virtual', '/src/review/Review.tsx'),
  ).toBeUndefined();
});

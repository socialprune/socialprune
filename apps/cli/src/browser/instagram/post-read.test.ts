import { expect, test } from 'vitest';
import type { Page } from 'playwright-core';
import { postReadShape } from './post-open.ts';
import { PostOpenRetries } from './retry.ts';
import { readPost } from './selectors.ts';
import {
  ContextStop,
  POST_READ_SITES,
  PostReadDiagnosticSchema,
  PostReadShape,
  stopDetails,
  stopDetailText,
} from './report.ts';

const origin = 'https://www.instagram.com';
const planted = 'generated_secret_handle';

function generatedPage(
  url: string,
  attached: { post: number; comment: number },
) {
  const locator = (selector: string) => ({
    count: () =>
      Promise.resolve(
        selector.includes('/c/') ? attached.comment : attached.post,
      ),
    first: () => locator(selector),
    filter: () => locator(selector),
    locator: (inner: string) => locator(inner),
    nth: () => locator(selector),
    all: () => Promise.resolve([]),
    evaluateAll: () => Promise.resolve([]),
    getAttribute: () => Promise.resolve(null),
  });
  return { url: () => url, locator } as unknown as Page;
}
test('POST-READ-1 every site is a closed token and keeps the old stop', () => {
  for (const site of POST_READ_SITES) {
    const stop = new PostReadShape(site);
    expect(stop).toBeInstanceOf(ContextStop);
    expect(stop).toMatchObject({
      code: 'INSTAGRAM_SHAPE_CHANGED',
      token: 'post-structure',
      site,
    });
    expect(stopDetails(stop)).toEqual({
      code: 'INSTAGRAM_SHAPE_CHANGED',
      token: 'post-structure',
      postRead: {
        site,
        pagePathClass: 'unknown',
        focalPostAttached: null,
        focalCommentAttached: null,
      },
    });
    expect(stopDetailText(stop)).toBe(
      `post-structure; postReadSite=${site}; postReadPagePath=unknown; postReadFocalPost=unknown; postReadFocalComment=unknown`,
    );
  }
  expect(
    stopDetails(new ContextStop('INSTAGRAM_SHAPE_CHANGED', 'post-structure')),
  ).toEqual({
    code: 'INSTAGRAM_SHAPE_CHANGED',
    token: 'post-structure',
  });
  expect(() =>
    PostReadDiagnosticSchema.parse({
      site: planted,
      pagePathClass: 'post',
      focalPostAttached: true,
      focalCommentAttached: null,
    }),
  ).toThrow();
  expect(() =>
    PostReadDiagnosticSchema.parse({
      site: 'read-element',
      pagePathClass: 'post',
      focalPostAttached: true,
      focalCommentAttached: null,
      url: planted,
    }),
  ).toThrow();
});
test('POST-READ-1 readPost throws its own site for a page that is not a post', async () => {
  await expect(
    readPost(
      generatedPage(`${origin}/${planted}/`, { post: 0, comment: 0 }),
      origin,
    ),
  ).rejects.toMatchObject({ token: 'post-structure', site: 'read-address' });
});
test('POST-READ-1 the builder records path class and attachment without addresses', async () => {
  const stop = await postReadShape(
    generatedPage(`${origin}/p/GeneratedCode/`, { post: 0, comment: 1 }),
    origin,
    'reply-page-address',
    { commentId: '1234567890' },
  );
  expect(stop.postRead).toEqual({
    site: 'reply-page-address',
    pagePathClass: 'post',
    focalPostAttached: false,
    focalCommentAttached: true,
  });
  const settled = await postReadShape(
    generatedPage(`${origin}/${planted}/`, { post: 0, comment: 0 }),
    origin,
    'settled-deadline',
    { settledLast: 'unstable', commentId: planted },
  );
  expect(settled.postRead).toEqual({
    site: 'settled-deadline',
    settledLast: 'unstable',
    pagePathClass: 'other-instagram',
    focalPostAttached: false,
    focalCommentAttached: null,
  });
  expect(JSON.stringify([stop.postRead, settled.postRead])).not.toContain(
    planted,
  );
});
test('POST-READ-1 a post-read stop reopens once only in main runs inside the shared budget', () => {
  const stop = new PostReadShape('settled-deadline');
  const retries = new PostOpenRetries();
  expect(retries.beginPostRead(stop, ['a'], 1, true, true)).toBeNull();
  expect(retries.beginPostRead(stop, ['a'], 1, false, false)).toBeNull();
  expect(retries.beginPostRead(stop, ['a'], 1, false, true, true)).toBeNull();
  expect(
    retries.beginPostRead(
      new ContextStop('INSTAGRAM_SHAPE_CHANGED', 'post-structure'),
      ['a'],
      1,
      false,
      true,
    ),
  ).toBeNull();
  expect(retries.beginPostRead(stop, ['a'], 1, false, true)).toEqual({
    step: 1,
    retryStep: null,
    stage: 'post-read-shape',
    waitedMs: 0,
    outcome: null,
  });
  expect(retries.beginPostRead(stop, ['a'], 2, false, true)).toBeNull();
  expect(retries.beginPostRead(stop, ['b'], 3, false, true)).not.toBeNull();
  expect(retries.beginPostRead(stop, ['c'], 5, false, true)).not.toBeNull();
  expect(retries.beginPostRead(stop, ['d'], 7, false, true)).toBeNull();
  expect(retries.summary().used).toBe(3);
});

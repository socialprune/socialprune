import { expect, test } from 'vitest';
import {
  allowedInstagramURL,
  allowedInstagramHost,
  mutation,
  imageHost,
  INSTAGRAM_ORIGIN,
  COMMENTS_PATH,
} from './network.ts';
import { keyPaths, stopDetails, ContextStop } from './report.ts';
import { IG_FIXTURE } from '../../../e2e/fake-instagram/fixture.ts';

test('parsed host and protocol rules admit only Instagram and its media suffixes', () => {
  expect(INSTAGRAM_ORIGIN + COMMENTS_PATH).toBe(
    'https://www.instagram.com/your_activity/interactions/comments',
  );
  for (const url of [
    'https://instagram.com/',
    'https://www.instagram.com/p/x/',
    'https://a.b.instagram.com/',
    'https://a.cdninstagram.com/',
    'https://a.fbcdn.net/',
  ])
    expect(allowedInstagramURL(url), url).toBe(true);
  for (const url of [
    'http://www.instagram.com/',
    'https://instagram.com.foreign.invalid/',
    'https://evilinstagram.com/',
    'https://cdninstagram.com/',
    'https://fbcdn.net/',
    'https://instagram.com@foreign.invalid/',
    'https://foreign.invalid/instagram.com',
    'https://instagram.com:444/',
    'https://x.com/',
  ])
    expect(allowedInstagramURL(url), url).toBe(false);
  expect(allowedInstagramHost('INSTAGRAM.COM')).toBe(true);
  expect(imageHost('https://a.cdninstagram.com/image')).toBe(true);
  expect(imageHost('https://www.instagram.com/image')).toBe(false);
});
test('a Mutation without a click and every named API write segment fail closed', () => {
  expect(
    mutation('POST', INSTAGRAM_ORIGIN + '/graphql/query', 'CommentsQuery'),
  ).toBe(false);
  expect(
    mutation('GET', INSTAGRAM_ORIGIN + '/graphql/query', 'BackgroundMutation'),
  ).toBe(true);
  for (const segment of [
    'like',
    'unlike',
    'follow',
    'unfollow',
    'delete',
    'add',
    'create',
    'save',
    'unsave',
    'block',
    'mute',
    'report',
  ]) {
    expect(
      mutation('POST', INSTAGRAM_ORIGIN + '/api/v1/media/' + segment + '/'),
    ).toBe(true);
    expect(
      mutation('GET', INSTAGRAM_ORIGIN + '/api/v1/media/' + segment + '/'),
    ).toBe(false);
  }
  expect(mutation('POST', INSTAGRAM_ORIGIN + '/api/v1/media/liked_by/')).toBe(
    false,
  );
});
test('reports strip dynamic key values and errors to closed classes, never arbitrary messages', () => {
  const planted = {
    [IG_FIXTURE.other.username]: {
      [IG_FIXTURE.other.code]: IG_FIXTURE.other.text,
    },
    data: [{ taken_at: IG_FIXTURE.other.time }],
  };
  const report = JSON.stringify({
    paths: keyPaths(planted),
    stop: stopDetails(new Error(IG_FIXTURE.other.text)),
  });
  for (const value of Object.values(IG_FIXTURE.other))
    expect(report).not.toContain(value);
  expect(stopDetails(new ContextStop('PLATFORM_CHECK', 'challenge'))).toEqual({
    code: 'PLATFORM_CHECK',
    token: 'challenge',
  });
  expect(stopDetails({ code: 'EACCES', path: IG_FIXTURE.other.text })).toEqual({
    code: 'fs-EACCES',
    token: 'fs-EACCES',
  });
});

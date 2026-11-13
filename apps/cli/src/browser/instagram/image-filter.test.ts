import { expect, test } from 'vitest';
import { answerAddresses, focalCode, imageClassifier } from './image-filter.ts';

const origin = 'https://www.instagram.com';
const cdn = 'https://generated.cdninstagram.com';
const focalImage = `${cdn}/generated-focal.jpg?sig=a`;
const focalSmall = `${cdn}/generated-focal-small.jpg?sig=b`;
const cover = `${cdn}/generated-cover.jpg?sig=c`;
const ownerPicture = `${cdn}/generated-owner.jpg?sig=d`;
const commenter = `${cdn}/generated-commenter.jpg?sig=e`;
const suggested = `${cdn}/generated-suggested.jpg?sig=f`;
const answer = {
  data: {
    items: [
      {
        code: 'GeneratedFocal',
        user: { username: 'generated_owner', profile_pic_url: ownerPicture },
        image_versions2: {
          candidates: [{ url: focalImage }, { url: focalSmall }],
        },
        video_versions: [{ url: `${cdn}/generated.mp4` }],
        carousel_media: [{ image_versions2: { candidates: [{ url: cover }] } }],
      },
    ],
  },
  comments: [
    { user: { username: 'generated_commenter', profile_pic_url: commenter } },
  ],
  related: [
    {
      code: 'GeneratedOther',
      image_versions2: { candidates: [{ url: suggested }] },
    },
  ],
};

test('REQ-1 focal code comes only from a post, reel or comment permalink', () => {
  expect(focalCode(`${origin}/p/GeneratedFocal/`)).toBe('GeneratedFocal');
  expect(focalCode(`${origin}/reel/GeneratedFocal`)).toBe('GeneratedFocal');
  expect(focalCode(`${origin}/p/GeneratedFocal/c/123/`)).toBe('GeneratedFocal');
  for (const url of [
    `${origin}/your_activity/interactions/comments`,
    `${origin}/generated_owner/`,
    'not a url',
  ])
    expect(focalCode(url)).toBeNull();
});
test('REQ-1 the focal post keeps every own media address, profile pictures and other posts are classed', () => {
  const sets = answerAddresses([answer], 'GeneratedFocal');
  expect(sets.complete).toBe(true);
  for (const url of [focalImage, focalSmall, cover])
    expect(sets.focal.has(url)).toBe(true);
  expect(sets.focal.has(ownerPicture)).toBe(false);
  expect(sets.avatar.has(ownerPicture)).toBe(true);
  expect(sets.avatar.has(commenter)).toBe(true);
  expect(sets.other.has(suggested)).toBe(true);
  expect(answerAddresses([answer], 'GeneratedMissing').complete).toBe(false);
});
test('REQ-1 list images abort, post images abort only when the answer classes them', () => {
  let bodies: unknown[] = [];
  const decide = imageClassifier(() => bodies);
  const post = `${origin}/p/GeneratedFocal/`;
  expect(
    decide(`${origin}/your_activity/interactions/comments`, focalImage),
  ).toBe('list');
  expect(
    decide(`${origin}/your_activity/interactions/comments?x=1`, commenter),
  ).toBe('list');
  // Fail open before the focal answer arrived.
  for (const url of [ownerPicture, commenter, suggested, focalImage])
    expect(decide(post, url)).toBe('load');
  bodies = [answer];
  expect(decide(post, focalImage)).toBe('load');
  expect(decide(post, focalSmall)).toBe('load');
  expect(decide(post, cover)).toBe('load');
  expect(decide(post, ownerPicture)).toBe('avatar');
  expect(decide(post, commenter)).toBe('avatar');
  expect(decide(post, suggested)).toBe('other');
  // Unlisted images and other pages load as today.
  expect(decide(post, `${cdn}/generated-unlisted.jpg`)).toBe('load');
  expect(decide(`${origin}/generated_owner/`, commenter)).toBe('load');
  expect(decide('not a url', commenter)).toBe('load');
  // A focal address that is also a profile picture is never aborted.
  bodies = [
    answer,
    { generated: { profile_pic_url: focalImage, code: 'GeneratedFocal' } },
  ];
  expect(decide(post, focalImage)).toBe('load');
});

import { expect, test } from 'vitest';
import { IG_FIXTURE } from '../../../e2e/fake-instagram/fixture.ts';
import { answerMedia, automaticCanaryCheck } from './canary.ts';
import type { CanaryCheck, FieldCheck } from './canary.ts';
import { chooseMediaSource } from './media-source.ts';

const cover = 'https://generated.cdninstagram.com/generated-cover.jpg?sig=a';
const post = (extra: Record<string, unknown> = {}) => ({
  data: {
    items: [
      {
        code: IG_FIXTURE.code,
        pk: 'generated-focal',
        image_versions2: { candidates: [{ url: cover }] },
        ...extra,
      },
    ],
  },
});

test('IMAGE-4 the answer declares a video by media_type 2 or video_versions', () => {
  expect(answerMedia(IG_FIXTURE.code, [post({ media_type: 2 })])).toEqual({
    firstMedia: [cover],
    declaresVideo: true,
  });
  expect(
    answerMedia(IG_FIXTURE.code, [post({ video_versions: [{ url: 'x' }] })])
      .declaresVideo,
  ).toBe(true);
  expect(
    answerMedia(IG_FIXTURE.code, [post({ media_type: 1, video_versions: [] })])
      .declaresVideo,
  ).toBe(false);
  // Several qualifying objects or a carousel: not known.
  expect(
    answerMedia(IG_FIXTURE.code, [
      post({ media_type: 2 }),
      { media: post().data.items[0] },
    ]),
  ).toEqual({ firstMedia: null, declaresVideo: null });
  expect(
    answerMedia(IG_FIXTURE.code, [
      post({ media_type: 8, carousel_media: [{ media_type: 2 }] }),
    ]).declaresVideo,
  ).toBeNull();
});

test('IMAGE-4 an answer cover is used only for a video without poster or media image', () => {
  const video = { mediaKind: 'video' as const, poster: null, image: null };
  expect(chooseMediaSource(video, () => false, cover)).toEqual({
    mediaKind: 'video',
    source: cover,
    element: 'answer-cover',
    reason: null,
  });
  expect(chooseMediaSource(video, () => false, null)).toMatchObject({
    element: 'none',
    reason: 'video-without-poster',
  });
  expect(
    chooseMediaSource(
      { mediaKind: 'unknown', poster: null, image: null },
      () => false,
      cover,
    ),
  ).toMatchObject({ element: 'none', reason: 'no-media-image' });
});

const field = (agrees: boolean): FieldCheck => ({
  found: true,
  agrees,
  paths: [],
  equalPaths: [],
});
const check = (image: FieldCheck, stored = false): CanaryCheck => ({
  confirmed: true,
  fields: {
    owner: field(true),
    time: field(true),
    caption: field(true),
    image,
  },
  ownerShown: true,
  timeShown: true,
  imageStored: stored,
  screenshotStored: true,
});
test('IMAGE-4 a not-applicable image passes only without an image and with owner, time and caption agreeing', () => {
  const missing: FieldCheck = {
    found: false,
    agrees: false,
    paths: [],
    equalPaths: [],
  };
  expect(() =>
    automaticCanaryCheck(
      check({ ...missing, notApplicable: 'video-without-image' }),
    ),
  ).not.toThrow();
  expect(() =>
    automaticCanaryCheck(check({ ...missing, notApplicable: null })),
  ).toThrowError(expect.objectContaining({ code: 'CANARY_CHECK_FAILED' }));
  // A stored image always takes the image check.
  expect(() =>
    automaticCanaryCheck(
      check({ ...field(false), notApplicable: 'video-without-image' }, true),
    ),
  ).toThrowError(expect.objectContaining({ code: 'CANARY_MISMATCH' }));
  const off = check({ ...missing, notApplicable: 'video-without-image' });
  off.fields.caption = field(false);
  expect(() => automaticCanaryCheck(off)).toThrowError(
    expect.objectContaining({ code: 'CANARY_MISMATCH' }),
  );
});

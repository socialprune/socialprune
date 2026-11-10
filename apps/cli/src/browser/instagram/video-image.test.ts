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
    alsoAvailable: ['answer-cover'],
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

test('IMAGE-5 a video takes the answer-cover first, then a received poster, then the media img', () => {
  const poster =
    'https://generated.cdninstagram.com/generated-poster.jpg?sig=p';
  const player =
    'https://generated.cdninstagram.com/generated-player.jpg?sig=m';
  const area = {
    mediaKind: 'video' as const,
    poster,
    image: { element: 'media-img' as const, source: player },
  };
  expect(chooseMediaSource(area, () => true, cover)).toEqual({
    mediaKind: 'video',
    source: cover,
    element: 'answer-cover',
    reason: null,
    alsoAvailable: ['answer-cover', 'video-poster', 'media-img'],
  });
  expect(chooseMediaSource(area, () => true, null)).toEqual({
    mediaKind: 'video',
    source: poster,
    element: 'video-poster',
    reason: null,
    alsoAvailable: ['video-poster', 'media-img'],
  });
  // An unreceived poster is no candidate.
  expect(chooseMediaSource(area, () => false, null)).toEqual({
    mediaKind: 'video',
    source: player,
    element: 'media-img',
    reason: null,
    alsoAvailable: ['media-img'],
  });
  expect(
    chooseMediaSource({ ...area, poster: null }, () => false, cover),
  ).toMatchObject({
    source: cover,
    element: 'answer-cover',
    alsoAvailable: ['answer-cover', 'media-img'],
  });
  expect(
    chooseMediaSource(
      { mediaKind: 'video', poster: null, image: null },
      () => false,
      null,
    ),
  ).toEqual({
    mediaKind: 'video',
    source: null,
    element: 'none',
    reason: 'video-without-poster',
    alsoAvailable: [],
  });
  // Images and carousels never use the answer-cover and carry no list.
  for (const mediaKind of ['image', 'carousel'] as const) {
    const choice = chooseMediaSource(
      {
        mediaKind,
        poster: null,
        image: {
          element: mediaKind === 'image' ? 'media-img' : 'carousel-slide',
          source: player,
        },
      },
      () => true,
      cover,
    );
    expect(choice.source).toBe(player);
    expect(choice).not.toHaveProperty('alsoAvailable');
  }
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

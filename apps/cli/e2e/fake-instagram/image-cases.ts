import type { Item } from '@socialprune/core';
import { deflateSync } from 'node:zlib';
import { IG_FIXTURE } from './fixture.ts';

// Generated response and page shapes only. No application entrypoint imports this module.
export const IMAGE_CASES = [
  { name: 'single-image', agrees: true, captured: true, paths: 1 },
  { name: 'reordered-renditions', agrees: true, captured: true, paths: 2 },
  {
    name: 'responsive-selected-rendition',
    agrees: true,
    captured: true,
    paths: 1,
  },
  { name: 'unrelated-image-paths', agrees: true, captured: true, paths: 3 },
  {
    name: 'extra-rendition-common-url',
    agrees: false,
    captured: true,
    paths: 2,
  },
  { name: 'three-identical-lists', agrees: true, captured: true, paths: 3 },
  { name: 'disjoint-resolutions', agrees: false, captured: true, paths: 2 },
  { name: 'changed-signed-query', agrees: false, captured: true, paths: 2 },
  { name: 'carousel-first', agrees: true, captured: true, paths: 2 },
  {
    name: 'carousel-second-displayed',
    agrees: false,
    captured: true,
    paths: 2,
  },
  { name: 'carousel-root-fallback', agrees: true, captured: true, paths: 2 },
  { name: 'reel-img-poster', agrees: true, captured: true, paths: 1 },
  { name: 'reel-video-poster-only', agrees: false, captured: false, paths: 1 },
  { name: 'video-thumbnail-candidate', agrees: true, captured: true, paths: 1 },
  {
    name: 'video-first-frame-alternative',
    agrees: false,
    captured: true,
    paths: 1,
  },
  { name: 'thumbnail-field-only', agrees: false, captured: true, paths: 0 },
  { name: 'wrong-media-url', agrees: false, captured: true, paths: 1 },
  { name: 'partial-matching-post', agrees: false, captured: true, paths: 1 },
] as const;
export type ImageCaseName = (typeof IMAGE_CASES)[number]['name'];

export function imageCase(
  name: ImageCaseName,
  item: Item,
  origin: string,
  code: string = IG_FIXTURE.code,
) {
  const first = `${origin}/media/${code}/first.png?size=1080&signature=generated-a`;
  const low = `${origin}/media/${code}/first.png?size=320&signature=generated-a`;
  const resigned = `${origin}/media/${code}/first.png?size=1080&signature=generated-b`;
  const second = `${origin}/media/${code}/second.png?size=1080&signature=generated-c`;
  const versions = (...urls: string[]) => ({
    candidates: urls.map((url) => ({ url })),
  });
  const post = (urls = [first]): Record<string, unknown> => ({
    code,
    pk: 'generated-focal-media',
    media_type: 1,
    user: {
      username: item.reference.ownerHandle ?? IG_FIXTURE.ownerWithoutExport,
    },
    taken_at: Date.parse(IG_FIXTURE.postAt) / 1000,
    caption: { text: IG_FIXTURE.caption },
    image_versions2: versions(...urls),
  });
  const posts = [post()];
  let displayed = first;
  if (name === 'reordered-renditions') {
    posts[0] = post([first, low]);
    posts.push(post([low, first]));
  }
  if (name === 'extra-rendition-common-url') {
    posts[0] = post([first, low]);
    posts.push(post());
  }
  if (name === 'three-identical-lists') posts.push(post(), post());
  if (name === 'disjoint-resolutions') posts.push(post([low]));
  if (name === 'changed-signed-query') posts.push(post([resigned]));
  if (name === 'responsive-selected-rendition') {
    posts[0] = post([first, low]);
    displayed = low;
  }
  if (name.startsWith('carousel-')) {
    posts[0]!.media_type = 8;
    posts[0]!.carousel_media = [
      {
        pk: 'generated-carousel-first',
        media_type: 1,
        image_versions2: versions(first),
      },
      {
        pk: 'generated-carousel-second',
        media_type: 1,
        image_versions2: versions(second),
      },
    ];
    posts[0]!.image_versions2 = versions(second);
    if (name === 'carousel-second-displayed') displayed = second;
    if (name === 'carousel-root-fallback') {
      (posts[0]!.carousel_media as Record<string, unknown>[])[0] = {
        pk: 'generated-carousel-first',
      };
      posts[0]!.image_versions2 = versions(first);
    }
  }
  if (name.startsWith('reel-') || name.startsWith('video-')) {
    posts[0]!.media_type = 2;
    posts[0]!.video_versions = [
      { id: 'generated-video', url: `${origin}/media/${code}/clip.mp4` },
    ];
  }
  if (name === 'video-first-frame-alternative') {
    posts[0]!.image_versions2 = {
      ...versions(low),
      additional_candidates: { first_frame_image: { url: first } },
    };
  }
  if (name === 'thumbnail-field-only') {
    delete posts[0]!.image_versions2;
    posts[0]!.thumbnail_src = first;
  }
  if (name === 'wrong-media-url') displayed = second;
  if (name === 'partial-matching-post') {
    const partial = post();
    delete partial.image_versions2;
    posts.push(partial);
  }
  const body = {
    data: { items: [posts[0]] },
    ...(posts[1] ? { media: posts[1] } : {}),
    ...(posts[2] ? { node: posts[2] } : {}),
    ...(name === 'unrelated-image-paths'
      ? {
          media: { ...post([second]), code: IG_FIXTURE.other.code },
          node: { ...post([second]), code: IG_FIXTURE.other.code },
        }
      : {}),
  };
  const image = `<img src="${displayed.replaceAll('&', '&amp;')}" ${name === 'responsive-selected-rendition' ? `srcset="${low.replaceAll('&', '&amp;')} 1x, ${first.replaceAll('&', '&amp;')} 2x"` : ''} alt="generated focal media">`;
  const video = `<video poster="${first.replaceAll('&', '&amp;')}"></video>`;
  return {
    body,
    first,
    low,
    second,
    displayed,
    mediaMarkup:
      name === 'reel-video-poster-only'
        ? video
        : name === 'reel-img-poster' || name === 'video-thumbnail-candidate'
          ? image + video
          : image,
    expectation: IMAGE_CASES.find((entry) => entry.name === name)!,
  };
}

export function imageCasePage(
  html: string,
  name: ImageCaseName,
  item: Item,
  origin: string,
  code: string,
): string {
  const anchor = `<img src="/media/${code}.png?signature=generated-secret" alt="generated media">`;
  if (!html.includes(anchor))
    throw new Error('Generated focal image anchor missing');
  return html.replace(anchor, imageCase(name, item, origin, code).mediaMarkup);
}

/** Distinct one-pixel red/green PNGs, built entirely from generated RGB bytes. */
export function imageCasePng(second: boolean): Buffer {
  const crc = (input: Buffer) => {
    let value = 0xffffffff;
    for (const byte of input) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit++)
        value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, bytes: Buffer) => {
    const name = Buffer.from(type),
      length = Buffer.alloc(4),
      sum = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    sum.writeUInt32BE(crc(Buffer.concat([name, bytes])));
    return Buffer.concat([length, name, bytes, sum]);
  };
  const header = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk(
      'IDAT',
      deflateSync(Buffer.from(second ? [0, 0, 255, 0] : [0, 255, 0, 0])),
    ),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

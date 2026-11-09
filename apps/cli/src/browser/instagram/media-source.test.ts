import { expect, test } from 'vitest';
import { chooseMediaSource, mediaAreaFromSnapshot } from './media-source.ts';
import type { MediaArea, SnapshotDocument } from './media-source.ts';

const poster = 'https://generated.cdninstagram.com/generated-poster.jpg?sig=a';
const cover = 'https://generated.cdninstagram.com/generated-cover.jpg?sig=b';

test('IMAGE-3 a video poster wins only when its response body arrived', () => {
  const video: MediaArea = { mediaKind: 'video', poster, image: null };
  expect(chooseMediaSource(video, () => true)).toEqual({
    mediaKind: 'video',
    source: poster,
    element: 'video-poster',
    reason: null,
  });
  expect(chooseMediaSource(video, () => false)).toEqual({
    mediaKind: 'video',
    source: null,
    element: 'none',
    reason: 'video-without-poster',
  });
  expect(
    chooseMediaSource(
      { ...video, image: { element: 'media-img', source: cover } },
      () => false,
    ),
  ).toMatchObject({ source: cover, element: 'media-img', reason: null });
  expect(
    chooseMediaSource(
      { mediaKind: 'unknown', poster: null, image: null },
      () => true,
    ),
  ).toMatchObject({ source: null, element: 'none', reason: 'no-media-image' });
  expect(
    chooseMediaSource(
      {
        mediaKind: 'carousel',
        poster: null,
        image: { element: 'carousel-slide', source: cover },
      },
      () => true,
    ),
  ).toMatchObject({ source: cover, element: 'carousel-slide' });
});

/** A tiny generated DOM snapshot: nodes, parents, attributes and boxes. */
function snapshot(
  nodes: {
    name: string;
    parent: number;
    attrs?: Record<string, string>;
    box?: [number, number, number, number];
    src?: string;
  }[],
) {
  const strings: string[] = [];
  const s = (value: string) => {
    const at = strings.indexOf(value);
    if (at >= 0) return at;
    strings.push(value);
    return strings.length - 1;
  };
  const document: SnapshotDocument = {
    nodes: {
      parentIndex: nodes.map((node) => node.parent),
      nodeName: nodes.map((node) => s(node.name)),
      attributes: nodes.map((node) =>
        Object.entries(node.attrs ?? {}).flatMap(([key, value]) => [
          s(key),
          s(value),
        ]),
      ),
      currentSourceURL: { index: [], value: [] },
    },
    layout: { nodeIndex: [], bounds: [] },
  };
  nodes.forEach((node, index) => {
    if (node.box) {
      document.layout.nodeIndex.push(index);
      document.layout.bounds.push(node.box);
    }
    if (node.src) {
      document.nodes.currentSourceURL!.index.push(index);
      document.nodes.currentSourceURL!.value.push(s(node.src));
    }
  });
  return { document, strings };
}
const view = { x: 0, y: 0, width: 1000, height: 1000 };

test('IMAGE-3 an unlinked header avatar beside the owner link is never the media image', () => {
  const { document, strings } = snapshot([
    { name: 'HTML', parent: -1 },
    { name: 'MAIN', parent: 0 },
    { name: 'DIV', parent: 1 },
    // Avatar at avatar size, beside a profile link, outside any link.
    {
      name: 'IMG',
      parent: 2,
      box: [0, 0, 32, 32],
      src: 'https://generated.cdninstagram.com/generated-avatar.jpg',
    },
    { name: 'A', parent: 2, attrs: { href: '/generated_owner/' } },
    { name: 'VIDEO', parent: 1, attrs: { poster }, box: [0, 40, 468, 832] },
  ]);
  expect(
    mediaAreaFromSnapshot(
      document,
      strings,
      'https://www.instagram.com/p/x/',
      view,
    ),
  ).toEqual({ mediaKind: 'video', poster, image: null });
});
test('IMAGE-3 an avatar-sized image alone is not media, and a header image is excluded', () => {
  const { document, strings } = snapshot([
    { name: 'HTML', parent: -1 },
    { name: 'MAIN', parent: 0 },
    { name: 'HEADER', parent: 1 },
    { name: 'IMG', parent: 2, box: [0, 0, 600, 600], src: cover },
    { name: 'IMG', parent: 1, box: [0, 0, 150, 150], src: cover },
  ]);
  expect(
    mediaAreaFromSnapshot(
      document,
      strings,
      'https://www.instagram.com/p/x/',
      view,
    ),
  ).toEqual({ mediaKind: 'unknown', poster: null, image: null });
});
test('IMAGE-3 the address comes from the chosen node, not an index into another list', () => {
  const { document, strings } = snapshot([
    { name: 'HTML', parent: -1 },
    { name: 'MAIN', parent: 0 },
    {
      name: 'IMG',
      parent: 1,
      box: [0, 0, 24, 24],
      src: 'https://generated/decoy.png',
    },
    { name: 'SECTION', parent: 1 },
    { name: 'IMG', parent: 3, box: [0, 30, 600, 600], src: cover },
  ]);
  expect(
    mediaAreaFromSnapshot(
      document,
      strings,
      'https://www.instagram.com/p/x/',
      view,
    ),
  ).toEqual({
    mediaKind: 'image',
    poster: null,
    image: { element: 'media-img', source: cover },
  });
});
test('IMAGE-3 a carousel takes the slide most visible in the viewport', () => {
  const { document, strings } = snapshot([
    { name: 'HTML', parent: -1 },
    { name: 'MAIN', parent: 0 },
    { name: 'UL', parent: 1 },
    { name: 'LI', parent: 2 },
    { name: 'IMG', parent: 3, box: [-600, 0, 600, 600], src: poster },
    { name: 'LI', parent: 2 },
    { name: 'IMG', parent: 5, box: [0, 0, 600, 600], src: cover },
  ]);
  expect(
    mediaAreaFromSnapshot(
      document,
      strings,
      'https://www.instagram.com/p/x/',
      view,
    ),
  ).toEqual({
    mediaKind: 'carousel',
    poster: null,
    image: { element: 'carousel-slide', source: cover },
  });
});

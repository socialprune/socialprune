/**
 * IMAGE-3: the focal post's image comes only from its media area. Read from
 * one DOM snapshot of the page, so the address belongs to the chosen node
 * itself and no page JavaScript runs.
 *
 * A media candidate is an `img` or `video` inside `main` that is
 * - not inside a link (profile pictures in the header are linked),
 * - not inside a `header` element,
 * - not inside a comment row (an ancestor holding a comment permalink),
 * - not beside a profile link (its parent has a direct child link to a
 *   profile path), and
 * - not avatar-sized: its rendered box is larger than AVATAR_MAX_CSS_PX in at
 *   least one dimension (header and comment avatars render at or below it).
 */
export const AVATAR_MAX_CSS_PX = 150;
export const MEDIA_KINDS = ['image', 'video', 'carousel', 'unknown'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export const MEDIA_ELEMENTS = [
  'media-img',
  'carousel-slide',
  'video-poster',
  // IMAGE-4: a received image whose exact address is in the answer's
  // first-media list, for a video that gave no DOM image.
  'answer-cover',
  'none',
] as const;
export type MediaElement = (typeof MEDIA_ELEMENTS)[number];
export const MEDIA_MISSING_REASONS = [
  'video-without-poster',
  'no-media-image',
] as const;
export type MediaMissingReason = (typeof MEDIA_MISSING_REASONS)[number];

/** What the media area offers; the source is chosen once responses are known. */
export interface MediaArea {
  mediaKind: MediaKind;
  /** Absolute poster address of the first media `video`, if it has one. */
  poster: string | null;
  /** The shown media image and its current source, if any. */
  image: {
    element: 'media-img' | 'carousel-slide';
    source: string | null;
  } | null;
}
/** IMAGE-5: the video candidates, in their choice order. */
export const VIDEO_CANDIDATES = [
  'answer-cover',
  'video-poster',
  'media-img',
] as const;
export type VideoCandidate = (typeof VIDEO_CANDIDATES)[number];
export interface MediaChoice {
  source: string | null;
  mediaKind: MediaKind;
  element: MediaElement;
  reason: MediaMissingReason | null;
  /** IMAGE-5, videos only: which video candidates existed, tokens only. */
  alsoAvailable?: VideoCandidate[];
}
const PROFILE_PATH = /^\/[A-Za-z0-9_.]{1,30}\/$/u;

/**
 * Pure. IMAGE-5: for a video the answer-cover (IMAGE-4 rule 1) wins, then a
 * poster whose response body was received, then the media area's own img.
 */
export function chooseMediaSource(
  area: MediaArea,
  received: (address: string) => boolean,
  /** IMAGE-4: the single received first-media address, or null. */
  answerCover: string | null = null,
): MediaChoice {
  const base = { mediaKind: area.mediaKind };
  if (area.mediaKind === 'video') {
    const sources: Record<VideoCandidate, string | null> = {
      'answer-cover': answerCover,
      'video-poster': area.poster && received(area.poster) ? area.poster : null,
      'media-img': area.image?.source ?? null,
    };
    const alsoAvailable = VIDEO_CANDIDATES.filter(
      (candidate) => sources[candidate] !== null,
    );
    const chosen = alsoAvailable[0];
    return chosen
      ? {
          ...base,
          source: sources[chosen],
          element: chosen,
          reason: null,
          alsoAvailable,
        }
      : {
          ...base,
          source: null,
          element: 'none',
          reason: 'video-without-poster',
          alsoAvailable,
        };
  }
  if (area.image?.source)
    return {
      ...base,
      source: area.image.source,
      element: area.image.element,
      reason: null,
    };
  return { ...base, source: null, element: 'none', reason: 'no-media-image' };
}

interface SnapshotNodes {
  parentIndex?: number[];
  nodeName?: number[];
  attributes?: number[][];
  currentSourceURL?: { index: number[]; value: number[] };
}
export interface SnapshotDocument {
  nodes: SnapshotNodes;
  layout: { nodeIndex: number[]; bounds: number[][] };
}

/** Classifies the media area of one DOM snapshot; exported for unit tests. */
export function mediaAreaFromSnapshot(
  document: SnapshotDocument,
  strings: readonly string[],
  pageUrl: string,
  viewport: { x: number; y: number; width: number; height: number },
): MediaArea {
  const nodes = document.nodes;
  const parents = nodes.parentIndex ?? [];
  const names = (nodes.nodeName ?? []).map((index) => strings[index] ?? '');
  const attrs = (index: number) => {
    const list = nodes.attributes?.[index] ?? [];
    const map = new Map<string, string>();
    for (let at = 0; at + 1 < list.length; at += 2)
      map.set(strings[list[at]!] ?? '', strings[list[at + 1]!] ?? '');
    return map;
  };
  const children = new Map<number, number[]>();
  parents.forEach((parent, index) => {
    if (parent < 0) return;
    const list = children.get(parent) ?? [];
    list.push(index);
    children.set(parent, list);
  });
  const kids = (index: number) => children.get(index) ?? [];
  const ancestors = (index: number) => {
    const list: number[] = [];
    for (let at = parents[index] ?? -1; at >= 0; at = parents[at] ?? -1)
      list.push(at);
    return list;
  };
  const boxes = new Map<number, number[]>();
  document.layout.nodeIndex.forEach((node, at) =>
    boxes.set(node, document.layout.bounds[at] ?? []),
  );
  const currentSource = new Map<number, string>();
  nodes.currentSourceURL?.index.forEach((node, at) =>
    currentSource.set(node, strings[nodes.currentSourceURL!.value[at]!] ?? ''),
  );
  const href = (index: number) => attrs(index).get('href') ?? '';
  const commentLink = (index: number) =>
    names[index] === 'A' && href(index).includes('/c/');
  const mains = names.flatMap((name, index) =>
    name === 'MAIN' ? [index] : [],
  );
  const none: MediaArea = { mediaKind: 'unknown', poster: null, image: null };
  if (mains.length !== 1) return none;
  const main = mains[0]!;
  const candidates: number[] = [];
  names.forEach((name, index) => {
    if (name !== 'IMG' && name !== 'VIDEO') return;
    const up = ancestors(index);
    if (!up.includes(main)) return;
    const inside = up.slice(0, up.indexOf(main));
    if (inside.some((at) => names[at] === 'A' || names[at] === 'HEADER'))
      return;
    // The existing comment-row rule: an ancestor with a comment permalink as
    // a grandchild (X/*/a) or under X/div/span/a.
    if (
      [...inside, main].some((at) =>
        kids(at).some(
          (child) =>
            kids(child).some(commentLink) ||
            (names[child] === 'DIV' &&
              kids(child).some(
                (span) =>
                  names[span] === 'SPAN' && kids(span).some(commentLink),
              )),
        ),
      )
    )
      return;
    const parent = parents[index] ?? -1;
    if (
      kids(parent).some(
        (child) => names[child] === 'A' && PROFILE_PATH.test(href(child)),
      )
    )
      return;
    const box = boxes.get(index);
    if (!box || box.length < 4) return;
    if (box[2]! <= AVATAR_MAX_CSS_PX && box[3]! <= AVATAR_MAX_CSS_PX) return;
    candidates.push(index);
  });
  const video = candidates.find((index) => names[index] === 'VIDEO');
  const images = candidates.filter((index) => names[index] === 'IMG');
  // Carousel: media images in at least two list items of one list.
  const listOf = (index: number) => {
    const item = ancestors(index).find((at) => names[at] === 'LI');
    return item === undefined ? undefined : { item, list: parents[item] ?? -1 };
  };
  const slides = images
    .map((index) => ({ index, ...listOf(index) }))
    .filter((entry) => entry.item !== undefined);
  const lists = new Map<number, Set<number>>();
  for (const slide of slides)
    lists.set(
      slide.list!,
      (lists.get(slide.list!) ?? new Set()).add(slide.item!),
    );
  const carouselList = [...lists].find(([, items]) => items.size >= 2)?.[0];
  const visible = (index: number) => {
    const box = boxes.get(index)!;
    const width = Math.max(
      0,
      Math.min(box[0]! + box[2]!, viewport.x + viewport.width) -
        Math.max(box[0]!, viewport.x),
    );
    const height = Math.max(
      0,
      Math.min(box[1]! + box[3]!, viewport.y + viewport.height) -
        Math.max(box[1]!, viewport.y),
    );
    return width * height;
  };
  let image: MediaArea['image'] = null;
  if (carouselList !== undefined) {
    const shown = slides
      .filter((slide) => slide.list === carouselList)
      .map((slide) => slide.index)
      .sort((a, b) => visible(b) - visible(a))[0];
    if (shown !== undefined && visible(shown) > 0)
      image = {
        element: 'carousel-slide',
        source: currentSource.get(shown) ?? null,
      };
  } else if (images[0] !== undefined)
    image = {
      element: 'media-img',
      source: currentSource.get(images[0]) ?? null,
    };
  let poster: string | null = null;
  if (video !== undefined) {
    const raw = attrs(video).get('poster');
    if (raw)
      try {
        poster = new URL(raw, pageUrl).href;
      } catch {
        poster = null;
      }
  }
  return {
    mediaKind:
      video !== undefined
        ? 'video'
        : carouselList !== undefined
          ? 'carousel'
          : images.length
            ? 'image'
            : 'unknown',
    poster,
    image,
  };
}

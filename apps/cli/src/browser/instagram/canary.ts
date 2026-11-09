import type { InstagramContext } from '@socialprune/core';
import { normalize, ownerName } from './plan.ts';
import { ContextStop, keyPaths, ImageDiagnosticSchema } from './report.ts';
import type { ImageDiagnostic } from './report.ts';
import { postObjects } from './answers.ts';

type Field = 'owner' | 'time' | 'caption' | 'image';
export interface FieldCheck {
  found: boolean;
  agrees: boolean;
  paths: string[];
  equalPaths: string[];
  /** IMAGE-4: the image field only; never counts as agreement. */
  notApplicable?: 'video-without-image' | null;
  /** CHECK-SKIP-1: qualifying objects that carried the field (count only). */
  carriers?: number;
}
export const CANARY_UNCHECKED_REASONS = [
  'several-objects',
  'field-not-found',
] as const;
export interface CanaryUnchecked {
  reason: (typeof CANARY_UNCHECKED_REASONS)[number];
  fields: Field[];
}
export type SourceChecks = Record<Field, FieldCheck>;
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function urls(value: Record<string, unknown>): string[] | null {
  const list = object(value.image_versions2).candidates;
  return Array.isArray(list)
    ? list
        .map((candidate) => object(candidate).url)
        .filter((url): url is string => typeof url === 'string')
    : null;
}
/**
 * IMAGE-2: the 1-based carousel position whose own candidate list holds the
 * exact captured address, when there is exactly one qualifying focal-post
 * object, it carries carousel_media, and exactly one of its items lists the
 * address. Every other shape returns null and keeps the IG-IMAGE A rule.
 */
export function carouselSlide(
  objects: readonly Record<string, unknown>[],
  address: string | null,
): number | null {
  if (address === null || objects.length !== 1) return null;
  const media = objects[0]!.carousel_media;
  if (!Array.isArray(media)) return null;
  const hits = media
    .map((item, index) => (urls(object(item))?.includes(address) ? index : -1))
    .filter((index) => index >= 0);
  return hits.length === 1 ? hits[0]! + 1 : null;
}
/**
 * IMAGE-4: what the page's own answer says about the single qualifying
 * focal-post object: its first-media candidate list (the list the exact-address
 * rule reads) and whether it declares a video (media_type 2 or a non-empty
 * video_versions). With several or no qualifying objects both are null; on a
 * carousel the shown item is not known here, so the declaration is null too.
 */
export function answerMedia(
  code: string | null,
  bodies: readonly unknown[],
): { firstMedia: string[] | null; declaresVideo: boolean | null } {
  const objects = postObjects(bodies, code).objects;
  if (objects.length !== 1) return { firstMedia: null, declaresVideo: null };
  const value = objects[0]!.value;
  const carousel =
    Array.isArray(value.carousel_media) && value.carousel_media.length > 0;
  const first = carousel
    ? object((value.carousel_media as unknown[])[0])
    : value;
  const firstMedia = urls(first) ?? urls(value);
  return {
    firstMedia,
    declaresVideo: carousel
      ? null
      : value.media_type === 2 ||
        (Array.isArray(value.video_versions) &&
          value.video_versions.length > 0),
  };
}
export function imageDiagnostic(
  code: string | null,
  source: string | null,
  bodies: readonly unknown[],
): ImageDiagnostic {
  const candidates = postObjects(bodies, code).objects;
  const lists: string[][] = [];
  for (const { value } of candidates) {
    const first = Array.isArray(value.carousel_media)
      ? object(value.carousel_media[0])
      : value;
    const candidateList =
      object(first.image_versions2).candidates ??
      object(value.image_versions2).candidates;
    if (Array.isArray(candidateList))
      lists.push(
        candidateList
          .map((candidate) => object(candidate).url)
          .filter((url): url is string => typeof url === 'string'),
      );
  }
  const slide = carouselSlide(
    candidates.map((entry) => entry.value),
    source,
  );
  return ImageDiagnosticSchema.parse({
    carouselPosition: slide,
    carouselFirstSlide: slide === null ? null : slide === 1,
    qualifyingObjects: candidates.length,
    matchingLists:
      source === null
        ? 0
        : lists.filter((list) => list.includes(source)).length,
    distinctListLengths: [...new Set(lists.map((list) => list.length))].sort(
      (a, b) => a - b,
    ),
    source: source === null ? 'none' : 'img-current-src',
  });
}
export function compareSources(
  record: InstagramContext,
  imageAddress: string | null,
  bodies: readonly unknown[],
): SourceChecks {
  const candidates = postObjects(bodies, record.post.code).objects.map(
    (entry) => entry.value,
  );
  const expected = {
    owner: ownerName(record.post.owner),
    time: record.post.createdAt
      ? Math.floor(Date.parse(record.post.createdAt) / 1000)
      : null,
    caption: record.post.caption,
    image: imageAddress,
  };
  const found: Record<Field, unknown[]> = {
    owner: [],
    time: [],
    caption: [],
    image: [],
  };
  for (const value of candidates) {
    const user = object(value.user),
      caption = object(value.caption),
      images = object(value.image_versions2);
    if (typeof user.username === 'string')
      found.owner.push(ownerName(user.username));
    if (typeof value.taken_at === 'number') found.time.push(value.taken_at);
    if (
      Object.hasOwn(value, 'caption') &&
      (value.caption === null || typeof caption.text === 'string')
    )
      found.caption.push(
        value.caption === null ? null : normalize(caption.text as string),
      );
    const first = Array.isArray(value.carousel_media)
      ? object(value.carousel_media[0])
      : value;
    const imageCandidates =
      object(first.image_versions2).candidates ?? images.candidates;
    if (Array.isArray(imageCandidates))
      found.image.push(
        imageCandidates
          .map((candidate) => object(candidate).url)
          .filter((url) => typeof url === 'string'),
      );
  }
  return Object.fromEntries(
    (['owner', 'time', 'caption', 'image'] as const).map((field) => {
      const values = found[field];
      const signatures = new Set(
        values.map((value) =>
          JSON.stringify(
            Array.isArray(value)
              ? (value as unknown[]).map(String).sort()
              : value,
          ),
        ),
      );
      const agrees =
        values.length > 0 &&
        values.length === candidates.length &&
        (field === 'image' || signatures.size === 1) &&
        // IMAGE-2: a carousel's shown slide agrees when exactly one item of
        // the single qualifying object lists the exact address.
        ((field === 'image' &&
          carouselSlide(candidates, expected.image) !== null) ||
          values.every((value) =>
            field === 'image'
              ? Array.isArray(value) &&
                expected.image !== null &&
                value.includes(expected.image)
              : field === 'caption' &&
                  typeof value === 'string' &&
                  typeof expected.caption === 'string'
                ? record.post.captionComplete
                  ? value === normalize(expected.caption)
                  : value.startsWith(
                      normalize(expected.caption)
                        .replace(/(?:\u2026|\.\.\.)$/, '')
                        .trimEnd(),
                    )
                : value === expected[field],
          ));
      const suffix =
        field === 'owner'
          ? 'user.username'
          : field === 'time'
            ? 'taken_at'
            : field === 'caption'
              ? 'caption.text'
              : 'image_versions.candidates[].url';
      const paths = values.length
        ? [
            ...new Set(
              bodies
                .flatMap((body) => keyPaths(body))
                .filter(
                  (path) =>
                    path.endsWith(suffix) ||
                    (field === 'caption' && path.endsWith('caption')),
                ),
            ),
          ].sort()
        : [];
      return [
        field,
        {
          found: values.length > 0 && values.length === candidates.length,
          agrees,
          // CHECK-SKIP-1: how many qualifying objects carried this field.
          carriers: values.length,
          paths,
          equalPaths: values.length
            ? []
            : [
                ...new Set(
                  bodies.flatMap((body) => keyPaths(body, expected[field])),
                ),
              ].sort(),
        },
      ];
    }),
  ) as SourceChecks;
}
export interface CanaryCheck {
  confirmed: boolean;
  fields: SourceChecks;
  ownerShown: boolean;
  timeShown: boolean;
  imageStored: boolean;
  screenshotStored: boolean;
}
/**
 * CHECK-SKIP-1: a canary step whose second source cannot check it. Several
 * qualifying objects make it unchecked whatever the fields say. With one
 * object, a found field that disagrees, or a missing owner, time or
 * screenshot on the page, is no unchecked step: automaticCanaryCheck stops as
 * before. Otherwise a field the answer does not carry makes it unchecked; an
 * image that is not applicable under IMAGE-4 is not "not found".
 */
export function canaryUnchecked(
  check: CanaryCheck,
  qualifyingObjects: number,
): CanaryUnchecked | null {
  const na = imageNotApplicable(check);
  const relevant = (Object.keys(check.fields) as Field[]).filter(
    (field) => !(field === 'image' && na),
  );
  const notFound = relevant.filter((field) => !check.fields[field].found);
  // Several objects in which every field is found and agrees were checked
  // before (IG-IMAGE A: every object lists the exact address) and stay so;
  // any other several-object step cannot tell which object is the post.
  if (
    qualifyingObjects > 1 &&
    !relevant.every(
      (field) => check.fields[field].found && check.fields[field].agrees,
    )
  )
    return { reason: 'several-objects', fields: notFound };
  if (
    relevant.some(
      (field) => check.fields[field].found && !check.fields[field].agrees,
    ) ||
    !check.ownerShown ||
    !check.timeShown ||
    !check.screenshotStored ||
    // A stored-image requirement with the image field present stays a stop.
    (!check.imageStored && !na && check.fields.image.found)
  )
    return null;
  return notFound.length
    ? { reason: 'field-not-found', fields: notFound }
    : null;
}
/** IMAGE-4: no image stored and the image field marked video-without-image. */
export function imageNotApplicable(check: CanaryCheck): boolean {
  return (
    check.fields.image.notApplicable === 'video-without-image' &&
    !check.imageStored
  );
}
export function automaticCanaryCheck(check: CanaryCheck): void {
  if (!check.confirmed)
    throw new ContextStop('CANARY_CHECK_FAILED', 'canary-check');
  // IMAGE-4: a declared video without any image leaves the image field out;
  // owner, time and caption must still be found and agree.
  const notApplicable = imageNotApplicable(check);
  if (
    !check.ownerShown ||
    !check.timeShown ||
    (!check.imageStored && !notApplicable) ||
    !check.screenshotStored
  )
    throw new ContextStop('CANARY_CHECK_FAILED', 'canary-check');
  const compared = Object.entries(check.fields)
    .filter(([field]) => !(field === 'image' && notApplicable))
    .map(([, value]) => value);
  if (compared.some((field) => !field.found))
    throw new ContextStop('CANARY_NO_SECOND_SOURCE', 'second-source');
  if (compared.some((field) => !field.agrees))
    throw new ContextStop('CANARY_MISMATCH', 'field-mismatch');
}
export function automaticReadbackCheck(
  before: string | null,
  after: string | null,
  added: number,
  removed: number,
  unexpected: number,
): void {
  if (
    !before ||
    before.toLowerCase() !== after?.toLowerCase() ||
    added ||
    removed ||
    unexpected
  )
    throw new ContextStop('CANARY_CHECK_FAILED', 'canary-check');
}
export function canaryAudit(
  checks: readonly CanaryCheck[],
  added: number,
  removed: number,
  unexpected: number,
) {
  // IMAGE-4: a not-applicable image step leaves the image counts; it is
  // counted on its own and never as image agreement.
  const notApplicable = (check: CanaryCheck) => imageNotApplicable(check);
  return {
    commentsConfirmed: checks.filter((check) => check.confirmed).length,
    fields: Object.fromEntries(
      (['owner', 'time', 'caption', 'image'] as const).map((field) => {
        const counted = checks.filter(
          (check) => field !== 'image' || !notApplicable(check),
        );
        return [
          field,
          {
            compared: counted.filter((check) => check.fields[field].found)
              .length,
            agreed: counted.filter((check) => check.fields[field].agrees)
              .length,
          },
        ];
      }),
    ),
    imagesMatched: checks.filter(
      (check) => check.imageStored && check.fields.image.agrees,
    ).length,
    imagesNotApplicable: checks.filter(notApplicable).length,
    screenshotsStored: checks.filter((check) => check.screenshotStored).length,
    unexpectedActions: unexpected,
    extensionIdsAdded: added,
    extensionIdsRemoved: removed,
  };
}

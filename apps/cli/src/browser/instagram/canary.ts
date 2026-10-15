import type { InstagramContext } from '@socialprune/core';
import { normalize, ownerName } from './plan.ts';
import { ContextStop, keyPaths } from './report.ts';
import { SECOND_SOURCE_KEYS } from './selectors.ts';

type Field = 'owner' | 'time' | 'caption' | 'image';
export interface FieldCheck {
  found: boolean;
  agrees: boolean;
  paths: string[];
  equalPaths: string[];
}
export type SourceChecks = Record<Field, FieldCheck>;
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function compareSources(
  record: InstagramContext,
  imageAddress: string | null,
  bodies: readonly unknown[],
): SourceChecks {
  const candidates: Record<string, unknown>[] = [];
  let visits = 0;
  function walk(input: unknown, depth: number): void {
    if (++visits > 100000 || depth > 40) return;
    if (Array.isArray(input)) {
      input.forEach((entry) => walk(entry, depth + 1));
      return;
    }
    const value = object(input);
    if (
      value[SECOND_SOURCE_KEYS.code] === record.post.code ||
      value.shortcode === record.post.code
    )
      candidates.push(value);
    Object.values(value).forEach((entry) => {
      if (entry && typeof entry === 'object') walk(entry, depth + 1);
    });
  }
  bodies.forEach((body) => walk(body, 0));
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
        signatures.size === 1 &&
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
        );
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
          found: values.length > 0,
          agrees,
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
export function automaticCanaryCheck(check: CanaryCheck): void {
  if (!check.confirmed)
    throw new ContextStop('CANARY_CHECK_FAILED', 'canary-check');
  if (
    !check.ownerShown ||
    !check.timeShown ||
    !check.imageStored ||
    !check.screenshotStored
  )
    throw new ContextStop('CANARY_CHECK_FAILED', 'canary-check');
  if (Object.values(check.fields).some((field) => !field.found))
    throw new ContextStop('CANARY_NO_SECOND_SOURCE', 'second-source');
  if (Object.values(check.fields).some((field) => !field.agrees))
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
  return {
    commentsConfirmed: checks.filter((check) => check.confirmed).length,
    fields: Object.fromEntries(
      (['owner', 'time', 'caption', 'image'] as const).map((field) => [
        field,
        {
          compared: checks.filter((check) => check.fields[field].found).length,
          agreed: checks.filter((check) => check.fields[field].agrees).length,
        },
      ]),
    ),
    imagesMatched: checks.filter(
      (check) => check.imageStored && check.fields.image.agrees,
    ).length,
    screenshotsStored: checks.filter((check) => check.screenshotStored).length,
    unexpectedActions: unexpected,
    extensionIdsAdded: added,
    extensionIdsRemoved: removed,
  };
}

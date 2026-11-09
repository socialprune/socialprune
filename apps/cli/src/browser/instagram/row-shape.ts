import type { Locator } from 'playwright-core';
import { linkPathClass } from './list-navigation.ts';
import { normalize } from './plan.ts';
import type { RowTrailingClass } from './report.ts';

export const ROW_AGE_CLASSES = [
  'en-s',
  'en-m',
  'en-h',
  'en-d',
  'en-w',
  'en-y',
  'de-s',
  'de-m',
  'de-h',
  'de-d',
  'de-w',
  'de-y',
  'none',
] as const;
type AgeClass = (typeof ROW_AGE_CLASSES)[number];
const english =
  /^(\d+)\s*(s|m|h|d|w|y|seconds?|minutes?|hours?|days?|weeks?|years?)$/u;
export function rowAgeToken(value: string): AgeClass {
  const text = normalize(value),
    en = english.exec(text);
  if (en) return `en-${en[2]![0]!}` as AgeClass;
  const de = /^\d+\s*(Sek\.|Min\.|Std\.|T\.|W\.|J\.)$/u.exec(text);
  const unit =
    de &&
    (
      {
        'Sek.': 's',
        'Min.': 'm',
        'Std.': 'h',
        'T.': 'd',
        'W.': 'w',
        'J.': 'y',
      } as const
    )[de[1] as 'Sek.' | 'Min.' | 'Std.' | 'T.' | 'W.' | 'J.'];
  return unit ? `de-${unit}` : 'none';
}
/**
 * ROW-TRAIL-1: the closed English row labels Instagram may show on the line
 * after a list row's age. Compared trimmed and case-sensitively.
 */
export const ROW_TRAILING_LABELS = {
  Edited: 'edited',
  'See translation': 'see-translation',
  Pinned: 'pinned',
} as const;
export function rowLines(raw: string): string[] {
  return raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}
/** The allow-listed label class of one line, or null. Never the line itself. */
export function rowTrailingLabel(
  line: string,
): Exclude<RowTrailingClass, 'other' | 'none'> | null {
  return Object.hasOwn(ROW_TRAILING_LABELS, line)
    ? ROW_TRAILING_LABELS[line as keyof typeof ROW_TRAILING_LABELS]
    : null;
}
/**
 * Closed class of a refused row's last line when an age stands before it;
 * `none` when no line follows an age.
 */
export function rowTrailingClass(raw: string): RowTrailingClass {
  const lines = rowLines(raw);
  if (!lines.slice(0, -1).some((line) => rowAgeToken(line) !== 'none'))
    return 'none';
  return rowTrailingLabel(lines.at(-1)!) ?? 'other';
}
const bucket = (length: number) =>
  length === 0
    ? ('0' as const)
    : length <= 20
      ? ('1-20' as const)
      : length <= 60
        ? ('21-60' as const)
        : length <= 120
          ? ('61-120' as const)
          : ('>120' as const);
/** Explanation only. This never decides whether the production row is accepted. */
export function rowShape(raw: string, handle: string, accepted: boolean) {
  const lines = raw
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean),
    text = normalize(raw);
  const ageClasses = [
    ...new Set(lines.map(rowAgeToken).filter((value) => value !== 'none')),
  ];
  const lastEnglish = english.test(lines.at(-1) ?? '');
  const earlierAge = lines
    .slice(0, -1)
    .some((line) => rowAgeToken(line) !== 'none');
  const username = /^[A-Za-z0-9_.]{1,30}(?:\s|$)/u.exec(text);
  const remainder = username ? text.slice(username[0].length).trim() : '';
  const acceptedAgeSuffix =
    /\s*\d+\s*(?:s|m|h|d|w|y|seconds?|minutes?|hours?|days?|weeks?|years?)$/u.exec(
      remainder,
    );
  const missingText = Boolean(
    acceptedAgeSuffix && !remainder.slice(0, acceptedAgeSuffix.index).trim(),
  );
  let failurePart:
    'none' | 'username' | 'text' | 'age' | 'extra-trailing-line' = 'none';
  if (!accepted)
    failurePart = !username
      ? 'username'
      : missingText
        ? 'text'
        : earlierAge
          ? 'extra-trailing-line'
          : !lastEnglish
            ? 'age'
            : lines.length < 3 &&
                !/^\S+\s+.+\s+\d+\s*(?:s|m|h|d|w|y|seconds?|minutes?|hours?|days?|weeks?|years?)$/u.test(
                  text,
                )
              ? 'text'
              : 'age';
  return {
    lineCount: lines.length,
    linesCapped: lines.length > 64,
    lineLengths: lines.slice(0, 64).map((line) => bucket(line.length)),
    handleLinePresent: lines.some(
      (line) => line.toLowerCase() === handle.toLowerCase(),
    ),
    lines: lines.slice(0, 64).map((line) => ({
      lengthBucket: bucket(line.length),
      equalsHandle: line.toLowerCase() === handle.toLowerCase(),
      ageClass: rowAgeToken(line),
      countedLabel:
        /^\d[\d.,\s]*\s*(?:likes?|repl(?:y|ies)|Gefällt mir(?:-Angaben)?|Antworten?)$/iu.test(
          line,
        ),
    })),
    ageClasses: ageClasses.length ? ageClasses : ['none' as const],
    countedLabelPresent: lines.some((line) =>
      /^\d[\d.,\s]*\s*(?:likes?|repl(?:y|ies)|Gefällt mir(?:-Angaben)?|Antworten?)$/iu.test(
        line,
      ),
    ),
    failurePart,
    ...(accepted ? {} : { trailingClass: rowTrailingClass(raw) }),
  };
}
export async function readRowShapes(
  entries: Locator,
  texts: readonly string[],
  handle: string,
  origin: string,
  accepted: (raw: string) => boolean,
) {
  const result: {
    observed: boolean;
    total: number;
    capped: boolean;
    rows: (ReturnType<typeof rowShape> & {
      anchors: number;
      linkClasses: {
        post: number;
        profile: number;
        yourActivity: number;
        other: number;
      };
      imagePresent: boolean;
    })[];
  } = {
    observed: false,
    total: texts.filter((text) => normalize(text)).length,
    capped: false,
    rows: [],
  };
  result.capped = result.total > 30;
  try {
    for (const [index, text] of texts.entries()) {
      if (!normalize(text)) continue;
      if (result.rows.length === 30) break;
      const row = entries.nth(index),
        links = { post: 0, profile: 0, yourActivity: 0, other: 0 };
      const anchors = await row.locator('a[href]').all();
      for (const anchor of anchors) {
        const kind = linkPathClass(
          (await anchor.getAttribute('href')) ?? '',
          origin,
        );
        links[kind === 'your-activity' ? 'yourActivity' : kind]++;
      }
      result.rows.push({
        ...rowShape(text, handle, accepted(text)),
        anchors: anchors.length,
        linkClasses: links,
        imagePresent: (await row.locator('img').count()) > 0,
      });
    }
    result.observed = true;
  } catch {
    result.observed = false;
  }
  return result;
}

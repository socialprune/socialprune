import { AssessmentSchema } from '@socialprune/core';
import type {
  CheckRequest,
  CheckAnswer,
  FailureCode,
  RawLabel,
} from './source.ts';

export const HARMLESS_REASON =
  'None of the checked criteria applies to this entry';
export const INVALID_REASON =
  "The model's answer for this entry could not be read";
export const QUOTE_REASON =
  'The model gave no exact quote from the text for this suggestion';
export const harmless = (): RawLabel[] => [
  { category: 'harmless', risk: 0, quote: null, reason: HARMLESS_REASON },
];
export const fallback = (code: FailureCode): RawLabel[] => [
  {
    category: 'unclear',
    risk: 1,
    quote: null,
    reason: code === 'MISSING_QUOTE' ? QUOTE_REASON : INVALID_REASON,
  },
];
export function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
export function completeResults(raw: string): unknown[] {
  const start = raw.match(/^\s*\{\s*"results"\s*:\s*\[/);
  if (!start) return [];
  const results: unknown[] = [];
  let begin = -1,
    depth = 0,
    quoted = false,
    escaped = false;
  for (let index = start[0].length; index < raw.length; index++) {
    const c = raw[index]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
      continue;
    }
    if (c === '"') {
      quoted = true;
      continue;
    }
    if (c === '{') {
      if (depth === 0) begin = index;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && begin >= 0) {
        try {
          results.push(JSON.parse(raw.slice(begin, index + 1)) as unknown);
        } catch {
          return results;
        }
        begin = -1;
      }
    } else if (depth === 0 && c === ']') return results;
    else if (depth === 0 && !/[\s,]/.test(c)) return results;
  }
  return results;
}
export function normalize(request: CheckRequest, answer: CheckAnswer) {
  const valid = new Map<string, RawLabel[]>();
  const invalid = new Map<string, FailureCode>();
  const details = new Map<string, FailureDetail>();
  const expected = new Map(request.entries.map((entry) => [entry.id, entry]));
  const groups = new Map<string, Record<string, unknown>[]>();
  let unknownIds = 0;
  for (const raw of answer.entries) {
    const value = object(raw);
    if (!value || typeof value.id !== 'string' || !expected.has(value.id)) {
      unknownIds++;
      continue;
    }
    const group = groups.get(value.id) ?? [];
    group.push(value);
    groups.set(value.id, group);
  }
  for (const entry of request.entries) {
    const group = groups.get(entry.id);
    if (!group?.length) {
      invalid.set(entry.id, 'MISSING_ID');
      details.set(entry.id, 'MISSING_ID');
      continue;
    }
    if (group.length !== 1) {
      invalid.set(entry.id, 'DUPLICATE_ID');
      details.set(entry.id, 'DUPLICATE_ID');
      continue;
    }
    const raw = group[0]!.labels;
    if (!Array.isArray(raw)) {
      invalid.set(entry.id, 'INVALID_LABEL');
      details.set(entry.id, 'LABELS_NOT_ARRAY');
      continue;
    }
    if (!raw.length) {
      valid.set(entry.id, harmless());
      continue;
    }
    const labels: RawLabel[] = [];
    const seen = new Set<string>();
    let failure: FailureCode | null = null;
    for (const input of raw as unknown[]) {
      const label = object(input);
      const detail: FailureDetail | null = !label
        ? 'LABEL_SHAPE'
        : typeof label.category !== 'string' ||
            ![
              ...request.criteria.map((c) => c.id),
              'harmless',
              'unclear',
            ].includes(label.category)
          ? 'CATEGORY_INVALID'
          : seen.has(label.category)
            ? 'CATEGORY_DUPLICATE'
            : (label.category === 'harmless' || label.category === 'unclear') &&
                raw.length !== 1
              ? 'EXCLUSIVE_LABEL_MIXED'
              : !AssessmentSchema.shape.risk.safeParse(label.risk).success
                ? 'RISK_INVALID'
                : typeof label.reason === 'string' && label.reason.length > 300
                  ? 'REASON_TOO_LONG'
                  : !AssessmentSchema.shape.reason.safeParse(label.reason)
                        .success
                    ? 'REASON_FORMAT'
                    : !(label.quote === null || typeof label.quote === 'string')
                      ? 'QUOTE_TYPE'
                      : null;
      if (detail) {
        failure = 'INVALID_LABEL';
        details.set(entry.id, detail);
        break;
      }
      seen.add(label!.category as string);
      const risk = label!.risk as number;
      const quote = label!.quote as string | null;
      if (
        risk >= 2 &&
        (quote === null ||
          quote.length < Math.min(8, entry.text.length) ||
          !entry.text.includes(quote) ||
          (entry.text.length < 8 && quote !== entry.text))
      ) {
        failure = 'MISSING_QUOTE';
        details.set(
          entry.id,
          quote === null
            ? 'QUOTE_MISSING'
            : quote.length < Math.min(8, entry.text.length)
              ? 'QUOTE_TOO_SHORT'
              : !entry.text.includes(quote)
                ? 'QUOTE_NOT_EXACT'
                : 'QUOTE_NOT_WHOLE',
        );
        break;
      }
      labels.push({
        category: label!.category as string,
        risk,
        quote: quote !== null && entry.text.includes(quote) ? quote : null,
        reason: label!.reason as string,
      });
    }
    if (failure) invalid.set(entry.id, failure);
    else valid.set(entry.id, labels);
  }
  return { valid, invalid, unknownIds, details };
}

export const FAILURE_DETAILS = [
  'MISSING_ID',
  'DUPLICATE_ID',
  'LABELS_NOT_ARRAY',
  'LABEL_SHAPE',
  'CATEGORY_INVALID',
  'CATEGORY_DUPLICATE',
  'EXCLUSIVE_LABEL_MIXED',
  'RISK_INVALID',
  'REASON_TOO_LONG',
  'REASON_FORMAT',
  'QUOTE_TYPE',
  'QUOTE_MISSING',
  'QUOTE_TOO_SHORT',
  'QUOTE_NOT_EXACT',
  'QUOTE_NOT_WHOLE',
] as const;
export type FailureDetail = (typeof FAILURE_DETAILS)[number];

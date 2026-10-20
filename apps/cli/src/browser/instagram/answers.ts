import { reportKey } from './report.ts';
import type { SecondSourceReport } from './report.ts';

export interface ParsedAnswer {
  mode: 'single' | 'sequence' | 'failed';
  values: unknown[];
}
const FAILED: ParsedAnswer = { mode: 'failed', values: [] };

/** Reads data only. A malformed tail invalidates the entire response. */
export function parseAnswer(input: string): ParsedAnswer {
  const text = input.replace(/^\s*for\s*\(\s*;\s*;\s*\)\s*;/u, '').trim();
  try {
    return { mode: 'single', values: [JSON.parse(text) as unknown] };
  } catch {
    // Streamed answers are sequences of complete top-level JSON values.
  }
  const values: unknown[] = [];
  const primitive =
    /(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/uy;
  let offset = 0;
  while (offset < text.length) {
    if (values.length === 4096) return FAILED;
    while (/\s/u.test(text[offset] ?? '') && offset < text.length) offset++;
    if (offset === text.length) break;
    const start = offset;
    const first = text[offset];
    if (first === '{' || first === '[' || first === '"') {
      const stack: string[] = [];
      let string = false,
        escaped = false,
        complete = false;
      for (; offset < text.length; offset++) {
        const char = text[offset]!;
        if (string) {
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === '"') {
            string = false;
            if (stack.length === 0) {
              offset++;
              complete = true;
              break;
            }
          }
        } else if (char === '"') string = true;
        else if (char === '{' || char === '[') {
          stack.push(char);
          if (stack.length > 128) return FAILED;
        } else if (char === '}' || char === ']') {
          if (stack.pop() !== (char === '}' ? '{' : '[')) return FAILED;
          if (stack.length === 0) {
            offset++;
            complete = true;
            break;
          }
        }
      }
      if (!complete) return FAILED;
    } else {
      primitive.lastIndex = offset;
      const token = primitive.exec(text);
      if (!token) return FAILED;
      offset += token[0].length;
    }
    try {
      values.push(JSON.parse(text.slice(start, offset)) as unknown);
    } catch {
      return FAILED;
    }
  }
  return values.length > 1 ? { mode: 'sequence', values } : FAILED;
}

export interface CollectedAnswer {
  type: 'json' | 'javascript';
  bytes: Uint8Array;
  parsed: ParsedAnswer;
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function answerSummary(
  entries: readonly CollectedAnswer[],
  code: string | null,
): SecondSourceReport {
  const counts = () => ({
    responses: 0,
    bodies: 0,
    single: 0,
    sequence: 0,
    failed: 0,
    responsesWithCode: 0,
    bodiesWithCode: 0,
  });
  const result: SecondSourceReport = {
    contentTypes: { json: counts(), javascript: counts() },
    objects: [],
    objectsCapped: false,
  };
  const codeBytes = code ? Buffer.from(code) : null;
  let visits = 0;
  function walk(input: unknown, path: string, depth: number): void {
    if (++visits > 100000 || depth > 40) {
      result.objectsCapped = true;
      return;
    }
    if (Array.isArray(input)) {
      for (const entry of input) {
        if (visits >= 100000) {
          result.objectsCapped = true;
          break;
        }
        walk(entry, path + '[]', depth + 1);
      }
      return;
    }
    const value = object(input);
    if (code && (value.code === code || value.shortcode === code)) {
      if (result.objects.length === 64) result.objectsCapped = true;
      else {
        const keys = [...new Set(Object.keys(value).map(reportKey))].sort();
        const user = object(value.user),
          caption = object(value.caption),
          images = object(value.image_versions2);
        const first = Array.isArray(value.carousel_media)
          ? object(value.carousel_media[0])
          : value;
        result.objects.push({
          path: path || '*',
          keys: keys.slice(0, 64),
          keysCapped: keys.length > 64,
          fields: {
            owner: typeof user.username === 'string',
            time: typeof value.taken_at === 'number',
            caption:
              Object.hasOwn(value, 'caption') &&
              (value.caption === null || typeof caption.text === 'string'),
            image: Array.isArray(
              object(first.image_versions2).candidates ?? images.candidates,
            ),
          },
        });
      }
    }
    for (const [key, entry] of Object.entries(value)) {
      if (visits >= 100000) {
        result.objectsCapped = true;
        break;
      }
      if (entry && typeof entry === 'object')
        walk(entry, (path ? path + '.' : '') + reportKey(key), depth + 1);
    }
  }
  for (const entry of entries) {
    const count = result.contentTypes[entry.type];
    count.responses++;
    count.bodies += entry.parsed.values.length;
    count[entry.parsed.mode]++;
    if (
      codeBytes &&
      Buffer.from(
        entry.bytes.buffer,
        entry.bytes.byteOffset,
        entry.bytes.byteLength,
      ).includes(codeBytes)
    )
      count.responsesWithCode++;
    for (const body of entry.parsed.values) {
      if (code && containsCode(body, code)) count.bodiesWithCode++;
      walk(body, '', 0);
    }
  }
  return result;
}
function containsCode(input: unknown, code: string): boolean {
  const pending: [unknown, number][] = [[input, 0]];
  let visits = 0;
  while (pending.length && ++visits <= 100000) {
    const [value, depth] = pending.pop()!;
    if (typeof value === 'string' && value.includes(code)) return true;
    if (depth >= 40 || !value || typeof value !== 'object') continue;
    for (const [key, entry] of Object.entries(value)) {
      if (key.includes(code)) return true;
      if (pending.length + visits < 100000) pending.push([entry, depth + 1]);
    }
  }
  return false;
}

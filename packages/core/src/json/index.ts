import { ArchiveLimitError, DEFAULT_IMPORT_LIMITS } from '../archive/limits.ts';
import {
  JsonCursor,
  JsonFormatError,
  readArrayPrefix,
  readArrayTail,
} from './cursor.ts';
export { JsonFormatError } from './cursor.ts';
export interface JsonArrayStream extends AsyncIterable<unknown> {
  readonly target: Promise<string | null>;
}
export interface JsonArrayOptions {
  assignment: 'none' | 'allowed';
  maxElementBytes?: number;
  signal?: AbortSignal;
}

export function parseJsonArrayStream(
  chunks: AsyncIterable<string>,
  opts: JsonArrayOptions,
): JsonArrayStream {
  const maximum = opts.maxElementBytes ?? DEFAULT_IMPORT_LIMITS.maxElementBytes;
  if (!Number.isSafeInteger(maximum) || maximum < 1)
    throw new RangeError('Invalid JSON element limit.');
  let resolveTarget: (target: string | null) => void = () => {};
  let rejectTarget: (error: unknown) => void = () => {};
  const target = new Promise<string | null>((resolve, reject) => {
    resolveTarget = resolve;
    rejectTarget = reject;
  });
  void target.catch(() => undefined);
  let consumed = false;
  return {
    target,
    async *[Symbol.asyncIterator]() {
      if (consumed)
        throw new TypeError('A JSON stream can only be consumed once.');
      consumed = true;
      const cursor = new JsonCursor(chunks, opts.signal);
      try {
        resolveTarget(await readArrayPrefix(cursor, opts.assignment, maximum));
        let character = await cursor.nonWhitespace();
        if (character === ']') {
          await readArrayTail(cursor);
          return;
        }
        for (;;) {
          if (character === null || character === ',' || character === ']')
            throw new JsonFormatError();
          const pieces: string[] = [];
          let piece = '';
          let bytes = 0;
          let highSurrogate = false;
          let depth = 0;
          let string = false;
          let escape = false;
          while (character !== null) {
            if (
              !string &&
              depth === 0 &&
              (character === ',' || character === ']')
            )
              break;
            const code = character.charCodeAt(0);
            bytes +=
              code <= 0x7f
                ? 1
                : code <= 0x7ff
                  ? 2
                  : code >= 0xdc00 && code <= 0xdfff && highSurrogate
                    ? 1
                    : 3;
            highSurrogate = code >= 0xd800 && code <= 0xdbff;
            if (bytes > maximum)
              throw new ArchiveLimitError('maxElementBytes', maximum);
            piece += character;
            if (piece.length >= 8192) {
              pieces.push(piece);
              piece = '';
            }
            if (string) {
              if (escape) escape = false;
              else if (character === '\\') escape = true;
              else if (character === '"') string = false;
            } else if (character === '"') string = true;
            else if (character === '{' || character === '[') depth++;
            else if (character === '}' || character === ']') {
              if (--depth < 0) throw new JsonFormatError();
            }
            character = await cursor.next();
          }
          if (character === null || string || depth !== 0)
            throw new JsonFormatError();
          pieces.push(piece);
          let value: unknown;
          try {
            value = JSON.parse(pieces.join(''));
          } catch {
            throw new JsonFormatError();
          }
          yield value;
          if (character === ']') {
            await readArrayTail(cursor);
            return;
          }
          character = await cursor.nonWhitespace();
        }
      } catch (error) {
        rejectTarget(error);
        throw error;
      } finally {
        await cursor.close();
      }
    },
  };
}

import { ArchiveLimitError, DEFAULT_IMPORT_LIMITS } from '../archive/limits.ts';
import { throwIfAborted } from '../archive/limits.ts';
import { JsonCursor, JsonFormatError, readArrayPrefix } from './cursor.ts';
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
        let state: 'first' | 'next' | 'element' | 'tail' = 'first';
        let pieces: string[] = [];
        let bytes = 0;
        let highSurrogate = false;
        let depth = 0;
        let string = false;
        let escape = false;
        let semicolon = false;
        let closed = false;
        let chunk: string | null;
        while ((chunk = await cursor.nextChunk()) !== null) {
          throwIfAborted(opts.signal);
          let sliceStart = state === 'element' ? 0 : -1;
          for (let i = 0; i < chunk.length; i++) {
            const code = chunk.charCodeAt(i);
            if (state !== 'element') {
              if (code === 32 || code === 9 || code === 10 || code === 13)
                continue;
              if (state === 'tail') {
                if (code !== 59 || semicolon) throw new JsonFormatError();
                semicolon = true;
                continue;
              }
              if (state === 'first' && code === 93) {
                state = 'tail';
                closed = true;
                continue;
              }
              if (code === 44 || code === 93) throw new JsonFormatError();
              state = 'element';
              sliceStart = i;
            }
            if (!string && depth === 0 && (code === 44 || code === 93)) {
              if (i > sliceStart) pieces.push(chunk.slice(sliceStart, i));
              let value: unknown;
              try {
                value = JSON.parse(pieces.join(''));
              } catch {
                throw new JsonFormatError();
              }
              pieces = [];
              bytes = 0;
              highSurrogate = false;
              sliceStart = -1;
              state = code === 93 ? 'tail' : 'next';
              closed = code === 93;
              yield value;
              throwIfAborted(opts.signal);
              continue;
            }
            // UTF-8 bytes of the actual element text, including trailing
            // whitespace. A surrogate pair is 4 bytes, even across chunks;
            // an unmatched UTF-16 surrogate retains the prior 3-byte count.
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
            if (string) {
              if (escape) escape = false;
              else if (code === 92) escape = true;
              else if (code === 34) string = false;
            } else if (code === 34) string = true;
            else if (code === 123 || code === 91) depth++;
            else if (code === 125 || code === 93) {
              if (--depth < 0) throw new JsonFormatError();
            }
          }
          if (state === 'element') pieces.push(chunk.slice(sliceStart));
        }
        if (!closed) throw new JsonFormatError();
      } catch (error) {
        rejectTarget(error);
        throw error;
      } finally {
        await cursor.close();
      }
    },
  };
}

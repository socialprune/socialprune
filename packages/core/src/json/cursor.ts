import { abortable, throwIfAborted } from '../archive/limits.ts';

export class JsonFormatError extends Error {
  override readonly name = 'JsonFormatError';
  constructor() {
    super('Invalid JSON array or assignment format.');
  }
}
export class JsonCursor {
  private readonly iterator: AsyncIterator<string>;
  private chunk = '';
  private offset = 0;
  private first = true;
  private pending: string | null | undefined;
  readonly signal?: AbortSignal;
  constructor(chunks: AsyncIterable<string>, signal?: AbortSignal) {
    this.iterator = chunks[Symbol.asyncIterator]();
    this.signal = signal;
  }
  async next(): Promise<string | null> {
    throwIfAborted(this.signal);
    if (this.pending !== undefined) {
      const value = this.pending;
      this.pending = undefined;
      return value;
    }
    while (this.offset === this.chunk.length) {
      const part = await abortable(this.iterator.next(), this.signal);
      if (part.done) return null;
      this.chunk = part.value;
      this.offset = 0;
    }
    const character = this.chunk[this.offset++] ?? null;
    if (this.first) {
      this.first = false;
      if (character === '\uFEFF') return this.next();
    }
    return character;
  }
  async nextChunk(): Promise<string | null> {
    throwIfAborted(this.signal);
    if (this.pending !== undefined) {
      const value = this.pending;
      this.pending = undefined;
      return value;
    }
    let remaining = this.chunk.slice(this.offset);
    this.offset = this.chunk.length;
    while (remaining.length === 0) {
      const part = await abortable(this.iterator.next(), this.signal);
      throwIfAborted(this.signal);
      if (part.done) return null;
      this.chunk = part.value;
      this.offset = this.chunk.length;
      remaining = this.chunk;
    }
    if (this.first) {
      this.first = false;
      if (remaining[0] === '\uFEFF') {
        remaining = remaining.slice(1);
        if (remaining.length === 0) return this.nextChunk();
      }
    }
    return remaining;
  }
  unread(value: string | null): void {
    this.pending = value;
  }
  /** Return an unconsumed suffix after a chunk-level parser reaches a value. */
  unreadChunk(value: string): void {
    if (this.pending !== undefined)
      throw new TypeError('Cursor already has a pending character.');
    this.chunk = value;
    this.offset = 0;
  }
  async nonWhitespace(): Promise<string | null> {
    let character;
    do {
      character = await this.next();
    } while (character !== null && /[\t\n\r ]/.test(character));
    return character;
  }
  async close(): Promise<void> {
    const cleanup = this.iterator.return?.();
    // An unrelated producer can be stuck in next(). Cancellation must still
    // return promptly; ask it to close and retain rejection handling.
    if (this.signal?.aborted) {
      void cleanup?.catch(() => undefined);
    } else await cleanup;
  }
}
export async function readArrayPrefix(
  cursor: JsonCursor,
  assignment: 'none' | 'allowed',
  maximum: number,
): Promise<string | null> {
  let character = await cursor.nonWhitespace();
  if (character === '[') return null;
  if (assignment === 'none') throw new JsonFormatError();
  let prefix = '';
  while (character !== null && character !== '[') {
    prefix += character;
    if (prefix.length > Math.min(maximum, 4096)) throw new JsonFormatError();
    character = await cursor.next();
  }
  if (character !== '[') throw new JsonFormatError();
  const match = /^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*=\s*$/.exec(
    prefix,
  );
  if (!match?.[1]) throw new JsonFormatError();
  return match[1];
}
export async function readArrayTail(cursor: JsonCursor): Promise<void> {
  const next = await cursor.nonWhitespace();
  if (next === ';') {
    if ((await cursor.nonWhitespace()) !== null) throw new JsonFormatError();
  } else if (next !== null) throw new JsonFormatError();
}

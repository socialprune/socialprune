import type { ArchiveReader, ImportLimits } from '../archive/index.ts';
import {
  ArchiveLimitError,
  resolveImportLimits,
  throwIfAborted,
} from '../archive/limits.ts';
import { JsonCursor, JsonFormatError } from '../json/cursor.ts';
import { parseJsonArrayStream } from '../json/index.ts';

// Never-read export categories from .kilo/rules/protected-surface-boundary.md.
// There is no option to disable this boundary.
export const PRIVATE_PATH_PATTERNS: readonly RegExp[] = Object.freeze([
  /(?:^|\/)messages(?:\/|$)/i,
  /(?:^|\/)(?:direct[-_]messages?|chats?)(?:[^/]*)(?:\/|$)/i,
  /security_and_login_information/i,
  /(?:login[-_]activity|ip[-_]audit|account[-_]creation[-_]ip)/i,
  /(?:^|\/)(?:ip(?:[._-]|$)|[^/]*[-_]ip(?:[._-]|$))/i,
  /(?:^|\/)[^/]*(?:device|contact|phone[-_]number|email[-_]address[-_]change|security|login)[^/]*(?:\/|$)/i,
]);
export type JsonType =
  'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';
export interface StructureFile {
  pattern: string;
  count: number;
  assignments: string[];
  parsed: number;
  unparsed: number;
  errors: string[];
  paths: { path: string; types: JsonType[] }[];
}
export interface StructureReport {
  files: StructureFile[];
  otherFiles: { directory: string; extension: string; count: number }[];
  skippedPrivate: number;
  rejectedEntries: number;
}
export interface StructureOptions {
  signal?: AbortSignal;
  limits?: Partial<ImportLimits>;
}
function redactKey(key: string): string {
  return /^\d+$/.test(key) ||
    /\d{5,}/.test(key) ||
    key.includes('@') ||
    /^http/i.test(key) ||
    key.length > 64
    ? '<key>'
    : key;
}
function normalizeDigits(value: string): string {
  return value.replace(/\d+/g, 'N');
}
class Shape {
  readonly types = new Set<JsonType>();
  readonly keys = new Map<string, Shape>();
  array?: Shape;
  map = false;
  merge(other: Shape): void {
    for (const type of other.types) this.types.add(type);
    if (other.array) {
      this.array ??= new Shape();
      this.array.merge(other.array);
    }
    if (other.map) this.collapse();
    for (const [key, child] of other.keys) this.child(key).merge(child);
  }
  private collapse(): void {
    if (this.map) return;
    const combined = new Shape();
    for (const child of this.keys.values()) combined.merge(child);
    this.keys.clear();
    this.keys.set('<key>', combined);
    this.map = true;
  }
  child(raw: string): Shape {
    const key = this.map ? '<key>' : redactKey(raw);
    let child = this.keys.get(key);
    if (!child) {
      child = new Shape();
      this.keys.set(key, child);
    }
    if (this.keys.size > 50) {
      this.collapse();
      return this.keys.get('<key>')!;
    }
    return child;
  }
  paths(path = '$'): { path: string; types: JsonType[] }[] {
    const result = [{ path, types: [...this.types].sort() }];
    if (this.array) result.push(...this.array.paths(`${path}[]`));
    for (const [key, child] of [...this.keys].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )) {
      result.push(...child.paths(`${path}.${key}`));
    }
    return result;
  }
}
async function readString(
  cursor: JsonCursor,
  maximum: number,
  capture: boolean,
): Promise<string> {
  let captured = '"';
  let tooLong = false;
  let bytes = 1;
  for (;;) {
    const character = await cursor.next();
    if (character === null) throw new JsonFormatError();
    bytes += new TextEncoder().encode(character).length;
    if (bytes > maximum)
      throw new ArchiveLimitError('maxElementBytes', maximum);
    if (character.charCodeAt(0) < 32) throw new JsonFormatError();
    if (capture && !tooLong) {
      captured += character;
      if (captured.length > 512) {
        captured = '';
        tooLong = true;
      }
    }
    if (character === '"') break;
    if (character === '\\') {
      const escaped = await cursor.next();
      if (escaped === null || !'"\\/bfnrtu'.includes(escaped))
        throw new JsonFormatError();
      bytes++;
      if (capture && !tooLong) captured += escaped;
      if (escaped === 'u') {
        for (let i = 0; i < 4; i++) {
          const hex = await cursor.next();
          if (hex === null || !/[\da-f]/i.test(hex))
            throw new JsonFormatError();
          bytes++;
          if (capture && !tooLong) captured += hex;
        }
      }
    }
  }
  if (!capture || tooLong) return '<key>';
  const decoded: unknown = JSON.parse(captured);
  return typeof decoded === 'string' ? redactKey(decoded) : '<key>';
}
async function value(
  cursor: JsonCursor,
  shape: Shape,
  maximum: number,
  depth = 0,
  first?: string | null,
): Promise<void> {
  if (depth > 256) throw new JsonFormatError();
  const character = first ?? (await cursor.nonWhitespace());
  if (character === '"') {
    shape.types.add('string');
    await readString(cursor, maximum, false);
    return;
  }
  if (character === '{') {
    shape.types.add('object');
    let next = await cursor.nonWhitespace();
    if (next === '}') return;
    for (;;) {
      if (next !== '"') throw new JsonFormatError();
      const key = await readString(cursor, maximum, true);
      if ((await cursor.nonWhitespace()) !== ':') throw new JsonFormatError();
      await value(cursor, shape.child(key), maximum, depth + 1);
      next = await cursor.nonWhitespace();
      if (next === '}') return;
      if (next !== ',') throw new JsonFormatError();
      next = await cursor.nonWhitespace();
    }
  }
  if (character === '[') {
    shape.types.add('array');
    shape.array ??= new Shape();
    let next = await cursor.nonWhitespace();
    if (next === ']') return;
    for (;;) {
      await value(cursor, shape.array, maximum, depth + 1, next);
      next = await cursor.nonWhitespace();
      if (next === ']') return;
      if (next !== ',') throw new JsonFormatError();
      next = await cursor.nonWhitespace();
    }
  }
  if (character === 't' || character === 'f' || character === 'n') {
    const literal =
      character === 't' ? 'true' : character === 'f' ? 'false' : 'null';
    for (const expected of literal.slice(1))
      if ((await cursor.next()) !== expected) throw new JsonFormatError();
    shape.types.add(character === 'n' ? 'null' : 'boolean');
    return;
  }
  if (character !== null && /[-\d]/.test(character)) {
    let number = character;
    for (;;) {
      const next = await cursor.next();
      if (next === null || !/[\d.eE+\-]/.test(next)) {
        cursor.unread(next);
        break;
      }
      if (number.length > 1024) throw new JsonFormatError();
      number += next;
    }
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(number))
      throw new JsonFormatError();
    shape.types.add('number');
    return;
  }
  throw new JsonFormatError();
}
function observe(input: unknown, shape: Shape, depth = 0): void {
  if (depth > 256) throw new JsonFormatError();
  if (input === null) shape.types.add('null');
  else if (Array.isArray(input)) {
    shape.types.add('array');
    shape.array ??= new Shape();
    for (const element of input) observe(element, shape.array, depth + 1);
  } else if (typeof input === 'object') {
    shape.types.add('object');
    for (const [key, child] of Object.entries(input))
      observe(child, shape.child(key), depth + 1);
  } else if (typeof input === 'string') shape.types.add('string');
  else if (typeof input === 'number') shape.types.add('number');
  else if (typeof input === 'boolean') shape.types.add('boolean');
}
export async function describeStructure(
  archive: ArchiveReader,
  opts: StructureOptions = {},
): Promise<StructureReport> {
  const limits = resolveImportLimits(opts.limits);
  const files = new Map<string, { report: StructureFile; shape: Shape }>();
  const other = new Map<
    string,
    { directory: string; extension: string; count: number }
  >();
  let skippedPrivate = 0;
  for (const entry of archive.list()) {
    throwIfAborted(opts.signal);
    if (PRIVATE_PATH_PATTERNS.some((pattern) => pattern.test(entry.path))) {
      skippedPrivate++;
      continue;
    }
    const extension = /\.([^./]+)$/.exec(entry.path)?.[1]?.toLowerCase() ?? '';
    if (extension !== 'json' && extension !== 'js') {
      const directory = entry.path.includes('/')
        ? normalizeDigits(redactKey(entry.path.split('/')[0] ?? ''))
        : '(root)';
      const key = JSON.stringify([directory, extension]);
      const current = other.get(key) ?? { directory, extension, count: 0 };
      current.count++;
      other.set(key, current);
      continue;
    }
    const pattern = entry.path
      .split('/')
      .map((segment) => redactKey(normalizeDigits(segment)))
      .join('/');
    const group = files.get(pattern) ?? {
      report: {
        pattern,
        count: 0,
        assignments: [],
        parsed: 0,
        unparsed: 0,
        errors: [],
        paths: [],
      },
      shape: new Shape(),
    };
    files.set(pattern, group);
    group.report.count++;
    const cursor =
      extension === 'json'
        ? new JsonCursor(
            archive.streamText(entry, { signal: opts.signal }),
            opts.signal,
          )
        : undefined;
    const shape = new Shape();
    try {
      if (extension === 'js') {
        shape.types.add('array');
        shape.array = new Shape();
        const parsed = parseJsonArrayStream(
          archive.streamText(entry, { signal: opts.signal }),
          {
            assignment: 'allowed',
            maxElementBytes: limits.maxElementBytes,
            signal: opts.signal,
          },
        );
        for await (const element of parsed) observe(element, shape.array);
        const target = await parsed.target;
        if (target)
          group.report.assignments.push(
            target
              .split('.')
              .map((part) => normalizeDigits(redactKey(part)))
              .join('.'),
          );
      } else if (cursor) {
        await value(cursor, shape, limits.maxElementBytes);
        if ((await cursor.nonWhitespace()) !== null)
          throw new JsonFormatError();
      }
      group.shape.merge(shape);
      group.report.parsed++;
    } catch (error) {
      throwIfAborted(opts.signal);
      group.report.unparsed++;
      group.report.errors.push(
        error instanceof ArchiveLimitError
          ? 'ArchiveLimitError'
          : error instanceof JsonFormatError
            ? 'JsonFormatError'
            : 'ArchiveReadError',
      );
    } finally {
      await cursor?.close();
    }
  }
  return {
    files: [...files.values()]
      .map(({ report, shape }) => ({
        ...report,
        assignments: [...new Set(report.assignments)].sort(),
        errors: [...new Set(report.errors)].sort(),
        paths: report.parsed
          ? shape
              .paths()
              .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
          : [],
      }))
      .sort((a, b) =>
        a.pattern < b.pattern ? -1 : a.pattern > b.pattern ? 1 : 0,
      ),
    otherFiles: [...other.values()].sort((a, b) =>
      JSON.stringify(a) < JSON.stringify(b) ? -1 : 1,
    ),
    skippedPrivate,
    rejectedEntries: archive.rejectedEntries,
  };
}

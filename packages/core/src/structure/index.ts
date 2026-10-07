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
  // Instagram connection maps use other people's handles as JSON keys. Match
  // their category names, not unrelated filenames such as followers-notes.
  /(?:^|\/)connections(?:\/|$)/i,
  /(?:^|\/)(?:connections|followers(?:_and_following)?|following|close[_ -]friends|blocked(?:[_ -](?:accounts|users))?|restricted(?:[_ -](?:accounts|users))?|(?:pending[_ -]|recent[_ -]|sent[_ -]|received[_ -])?follow[_ -]requests|hide[_ -]story[_ -]from)(?:_\d+)?(?:\.[^/]+)?(?:\/|$)/i,
]);
// These are export data directories, not personal wrapper-folder names. Keep
// their structural names when collapsing segments above an export.
export const KNOWN_EXPORT_DATA_DIRECTORIES: readonly string[] = Object.freeze([
  'data',
  'assets',
  'your_instagram_activity',
  'personal_information',
  'account_information',
  'comments',
  'activity',
  'media',
  'connections',
  'logged_information',
  'security_and_login_information',
  'preferences',
  'ads_information',
  'apps_and_websites_off_of_instagram',
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
// Browser and Windows duplicate names keep the export identity, including a
// suffix after an Instagram part number. Node ZIP readers keep the extension;
// directory readers carry only the basename, so both forms are recognised.
const INSTAGRAM_EXPORT_NAME =
  /^instagram-(.+)-\d{4}-\d{2}-\d{2}-[A-Za-z0-9]+(?:_\d+)?(?: ?\(\d+\))?(?:\.zip)?$/i;
const X_EXPORT_NAME =
  /^twitter-\d{4}-\d{2}-\d{2}-[A-Za-z0-9]+(?: ?\(\d+\))?(?:\.zip)?$/i;
function containsHandle(value: string, handles: readonly string[]): boolean {
  const lowercase = value.toLowerCase();
  return handles.some((handle) => lowercase.includes(handle));
}
function redactKey(key: string, handles: readonly string[]): string {
  return /^\d+$/.test(key) ||
    /\d{5,}/.test(key) ||
    key.includes('@') ||
    /^http/i.test(key) ||
    key.length > 64 ||
    containsHandle(key, handles)
    ? '<key>'
    : normalizeDigits(key);
}
function normalizeDigits(value: string): string {
  return value.replace(/\d+/g, 'N');
}
function redactPathSegment(
  segment: string,
  handles: readonly string[],
): string {
  if (
    INSTAGRAM_EXPORT_NAME.test(segment) ||
    X_EXPORT_NAME.test(segment) ||
    containsHandle(segment, handles)
  )
    return '<root>';
  if (segment.includes('@') || /^http/i.test(segment) || segment.length > 64)
    return '<segment>';
  // Normalize before reporting, including all-digit names and long ID runs.
  return normalizeDigits(segment);
}
function reportPath(path: string, handles: readonly string[]): string[] {
  const segments = path.split('/');
  const firstDataDirectory = segments.findIndex(
    (segment, index) =>
      index < segments.length - 1 &&
      KNOWN_EXPORT_DATA_DIRECTORIES.includes(segment.toLowerCase()),
  );
  if (firstDataDirectory > 0)
    return [
      '<root>',
      ...segments
        .slice(firstDataDirectory)
        .map((segment) => redactPathSegment(segment, handles)),
    ];
  return segments.map((segment, index) =>
    index === 0 && segments.length > 1 && firstDataDirectory < 0
      ? '<root>'
      : redactPathSegment(segment, handles),
  );
}
class Shape {
  readonly types = new Set<JsonType>();
  readonly keys = new Map<string, Shape>();
  private readonly rawKeys = new Set<string>();
  array?: Shape;
  map = false;
  private readonly handles: readonly string[];
  constructor(handles: readonly string[] = []) {
    this.handles = handles;
  }
  merge(other: Shape): void {
    for (const type of other.types) this.types.add(type);
    if (other.array) {
      this.array ??= new Shape(this.handles);
      this.array.merge(other.array);
    }
    if (other.map) this.collapse();
    if (!this.map) {
      for (const key of other.rawKeys) this.rawKeys.add(key);
      if (this.rawKeys.size > 50) this.collapse();
    }
    for (const [key, child] of other.keys) this.mergedChild(key).merge(child);
  }
  private collapse(): void {
    if (this.map) return;
    const combined = new Shape(this.handles);
    for (const child of this.keys.values()) combined.merge(child);
    this.keys.clear();
    this.rawKeys.clear();
    this.keys.set('<key>', combined);
    this.map = true;
  }
  child(raw: string): Shape {
    if (!this.map) {
      this.rawKeys.add(raw);
      if (this.rawKeys.size > 50) this.collapse();
    }
    const key = this.map ? '<key>' : redactKey(raw, this.handles);
    return this.mergedChild(key);
  }
  private mergedChild(raw: string): Shape {
    const key = this.map ? '<key>' : raw;
    let child = this.keys.get(key);
    if (!child) {
      child = new Shape(this.handles);
      this.keys.set(key, child);
    }
    return child;
  }
  arrayChild(): Shape {
    this.array ??= new Shape(this.handles);
    return this.array;
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
  return typeof decoded === 'string' ? decoded : '<key>';
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
    const elementShape = shape.arrayChild();
    let next = await cursor.nonWhitespace();
    if (next === ']') return;
    for (;;) {
      await value(cursor, elementShape, maximum, depth + 1, next);
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
    const elementShape = shape.arrayChild();
    for (const element of input) observe(element, elementShape, depth + 1);
  } else if (typeof input === 'object') {
    shape.types.add('object');
    for (const [key, child] of Object.entries(input))
      observe(child, shape.child(key), depth + 1);
  } else if (typeof input === 'string') shape.types.add('string');
  else if (typeof input === 'number') shape.types.add('number');
  else if (typeof input === 'boolean') shape.types.add('boolean');
}
function parseObjectAssignment(text: string): {
  target: string;
  object: Record<string, unknown>;
} {
  // Same dotted-identifier grammar as parseJsonArrayStream. JSON.parse rejects
  // executable expressions and anything after the one optional semicolon.
  const prefix = /^\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*=\s*/.exec(
    text,
  );
  if (!prefix?.[1]) throw new JsonFormatError();
  let payload = text.slice(prefix[0].length).trim();
  if (payload.endsWith(';')) payload = payload.slice(0, -1).trimEnd();
  if (!payload.startsWith('{')) throw new JsonFormatError();
  let object: unknown;
  try {
    object = JSON.parse(payload);
  } catch {
    throw new JsonFormatError();
  }
  if (!object || typeof object !== 'object' || Array.isArray(object))
    throw new JsonFormatError();
  return { target: prefix[1], object: object as Record<string, unknown> };
}
export async function describeStructure(
  archive: ArchiveReader,
  opts: StructureOptions = {},
): Promise<StructureReport> {
  const limits = resolveImportLimits(opts.limits);
  const entries = archive.list();
  const handles = [
    ...new Set(
      [
        ...archive.archives.map((name) => name.replace(/\.zip$/i, '')),
        ...entries.flatMap((entry) => entry.path.split('/')),
      ].flatMap((name) => {
        const handle = INSTAGRAM_EXPORT_NAME.exec(name)?.[1];
        return handle && handle.length >= 3 ? [handle.toLowerCase()] : [];
      }),
    ),
  ];
  const files = new Map<string, { report: StructureFile; shape: Shape }>();
  const other = new Map<
    string,
    { directory: string; extension: string; count: number }
  >();
  let skippedPrivate = 0;
  for (const entry of entries) {
    throwIfAborted(opts.signal);
    if (PRIVATE_PATH_PATTERNS.some((pattern) => pattern.test(entry.path))) {
      skippedPrivate++;
      continue;
    }
    const extension = /\.([^./]+)$/.exec(entry.path)?.[1]?.toLowerCase() ?? '';
    if (extension !== 'json' && extension !== 'js') {
      const directory = entry.path.includes('/')
        ? (reportPath(entry.path, handles)[0] ?? '<root>')
        : '(root)';
      const key = JSON.stringify([directory, extension]);
      const current = other.get(key) ?? { directory, extension, count: 0 };
      current.count++;
      other.set(key, current);
      continue;
    }
    const pattern = reportPath(entry.path, handles).join('/');
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
      shape: new Shape(handles),
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
    const shape = new Shape(handles);
    try {
      if (extension === 'js') {
        let target: string | null;
        try {
          const array = new Shape(handles);
          array.types.add('array');
          const elementShape = array.arrayChild();
          const parsed = parseJsonArrayStream(
            archive.streamText(entry, { signal: opts.signal }),
            {
              assignment: 'allowed',
              maxElementBytes: limits.maxElementBytes,
              signal: opts.signal,
            },
          );
          for await (const element of parsed) observe(element, elementShape);
          target = await parsed.target;
          shape.merge(array);
        } catch (error) {
          if (!(error instanceof JsonFormatError)) throw error;
          const text = await archive.readText(entry, {
            maxBytes: limits.maxElementBytes,
            signal: opts.signal,
          });
          const parsed = parseObjectAssignment(text);
          target = parsed.target;
          observe(parsed.object, shape);
        }
        if (target)
          group.report.assignments.push(
            target
              .split('.')
              .map((part) => redactKey(part, handles))
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

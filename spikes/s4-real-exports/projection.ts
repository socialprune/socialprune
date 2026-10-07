import { DIRECTORIES, EXTENSIONS, KEYS, KEY_ALIASES } from './schema.ts';
import type { Difference, ShapeFile, ShapePath, SizeClass, ValueType } from './schema.ts';
import type { StructureReport } from '../../packages/core/src/index.ts';

export function sizeClass(bytes: number): SizeClass {
  return bytes < 10_000_000 ? 'under-10-mb' : bytes < 100_000_000 ? 'under-100-mb'
    : bytes < 1_000_000_000 ? 'under-1-gb' : bytes < 4_000_000_000 ? 'under-4-gb' : 'larger';
}
export function pattern(path: string): string {
  const segments = path.replaceAll('\\', '/').split('/');
  const name = segments.pop() ?? '';
  const dot = name.lastIndexOf('.');
  const base = dot < 0 ? name : name.slice(0, dot);
  const extension = dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
  const part = /^(tweets?)-part(?:\d+|N)$/.exec(base);
  const token = /^(?:tweet|tweets|account|manifest|user_details|note-tweet|deleted-tweets|community-tweet|post_comments|reels_comments|comments|personal_information)$/.test(base)
    ? `<${base}>` : part ? `<${part[1]}-partN>` : /^(?:\d{4}_\d{2}|N_N)$/.test(base) ? '<tweets_N_N>'
    : /^post_comments_(?:\d+|N)$/.test(base) ? '<post_comments_N>' : '<file>';
  const firstKnown = segments.findIndex((part) => DIRECTORIES.includes(part as (typeof DIRECTORIES)[number]));
  const directories = firstKnown >= 0 ? segments.slice(firstKnown) : segments;
  const normalized = directories.map((part) => DIRECTORIES.includes(part as (typeof DIRECTORIES)[number]) ? part : '<segment>');
  if (firstKnown > 0 || firstKnown < 0 && segments.length) normalized.unshift('<root>');
  const suffix = extension ? `.${EXTENSIONS.includes(extension as (typeof EXTENSIONS)[number]) ? extension : '<extension>'}` : '';
  return [...normalized, token + suffix].join('/');
}
export function keyPath(path: string): string {
  if (!path.startsWith('$')) throw new Error('S4_STRUCTURE_INVALID');
  return '$' + path.slice(1).split('.').map((part, index) => {
    if (index === 0) return /^(?:\[\])*$/.test(part) ? part : '';
    const match = /^(.*?)(\[\])*$/s.exec(part);
    const suffix = part.match(/(?:\[\])*$/)?.[0] ?? '';
    const key = match?.[1] ?? '';
    const normalized = KEYS.includes(key as (typeof KEYS)[number]) ? KEY_ALIASES[key] ?? key : '<key>';
    return `.${normalized === '<key>' ? normalized : `<${normalized}>`}${suffix}`;
  }).join('');
}
export function rowShape(value: unknown): ShapePath[] {
  const paths = new Map<string, Set<ValueType>>();
  function visit(value: unknown, raw: string, depth: number): void {
    if (depth > 128 || paths.size >= 200_000) throw new Error('S4_SHAPE_LIMIT');
    const type: ValueType = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value as ValueType;
    const path = keyPath(raw);
    const types = paths.get(path) ?? new Set<ValueType>();
    types.add(type);
    paths.set(path, types);
    if (Array.isArray(value)) for (const element of value as unknown[]) visit(element, raw + '[]', depth + 1);
    else if (type === 'object') for (const [key, element] of Object.entries(value as Record<string, unknown>)) visit(element, `${raw}.${key}`, depth + 1);
  }
  visit(value, '$', 0);
  return [...paths].sort(([a], [b]) => a < b ? -1 : 1).map(([path, types]) => ({ path, types: [...types].sort() }));
}
function mergePaths(paths: readonly ShapePath[]): ShapePath[] {
  const merged = new Map<string, Set<ValueType>>();
  for (const { path, types } of paths) {
    const known = merged.get(path) ?? new Set<ValueType>();
    for (const type of types) known.add(type);
    merged.set(path, known);
  }
  return [...merged].sort(([a], [b]) => a < b ? -1 : 1).map(([path, types]) => ({ path, types: [...types].sort() }));
}
export function projectStructure(report: StructureReport): ShapeFile[] {
  return mergeFiles(report.files.map((file) => ({
    pattern: pattern(file.pattern), count: file.count,
    paths: file.paths.map(({ path, types }) => ({ path: keyPath(path), types })),
  })));
}
export function mergeFiles(files: readonly ShapeFile[]): ShapeFile[] {
  const merged = new Map<string, ShapeFile>();
  for (const file of files) {
    const prior = merged.get(file.pattern) ?? { pattern: file.pattern, count: 0, paths: [] };
    prior.count += file.count;
    prior.paths = mergePaths([...prior.paths, ...file.paths]);
    merged.set(file.pattern, prior);
  }
  return [...merged.values()].sort((a, b) => a.pattern < b.pattern ? -1 : 1);
}
export function difference(left: readonly ShapeFile[], right: readonly ShapeFile[]): Difference[] {
  const lookup = new Map(right.flatMap((file) => file.paths.map((path) => [JSON.stringify([file.pattern, path.path]), path.types] as const)));
  return left.flatMap((file) => file.paths.flatMap((path) => {
    const other = lookup.get(JSON.stringify([file.pattern, path.path]));
    const types = path.types.filter((type) => !other?.includes(type));
    return !other || types.length ? [{ pattern: file.pattern, path: path.path, types }] : [];
  }));
}

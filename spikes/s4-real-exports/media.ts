import { MEDIA_DIRECTORIES, EXTENSIONS, ROW_CLASSES } from './schema.ts';
import type { MediaStats, RowClass } from './schema.ts';

const MEDIA_KEY = ['media', 'list', 'data'].join('_');
const MAP_KEY = ['string', 'map', 'data'].join('_');
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function createMediaStats(): MediaStats {
  return {
    lengths: {
      text: { absent: 0, '0': 0, '1': 0, '2': 0, '3+': 0 },
      mediaOnly: { absent: 0, '0': 0, '1': 0, '2': 0, '3+': 0 },
      rejected: { absent: 0, '0': 0, '1': 0, '2': 0, '3+': 0 },
    },
    uriForms: {
      text: { 'relative-path': { count: 0, patterns: [] }, 'http-url': 0, 'data-url': 0, other: 0 },
      mediaOnly: { 'relative-path': { count: 0, patterns: [] }, 'http-url': 0, 'data-url': 0, other: 0 },
      rejected: { 'relative-path': { count: 0, patterns: [] }, 'http-url': 0, 'data-url': 0, other: 0 },
    },
    creationTimestamp: {
      text: { present: 0, comparable: 0, equal: 0, earlier: 0, later: 0 },
      mediaOnly: { present: 0, comparable: 0, equal: 0, earlier: 0, later: 0 },
      rejected: { present: 0, comparable: 0, equal: 0, earlier: 0, later: 0 },
    },
  };
}
export function mediaPattern(uri: string): string {
  const segments = uri.replaceAll('\\', '/').split('/');
  const filename = segments.pop() ?? '';
  const dot = filename.lastIndexOf('.');
  const extension = dot < 0 ? '' : filename.slice(dot + 1).toLowerCase();
  const suffix = dot < 0 ? '' : `.${EXTENSIONS.includes(extension as (typeof EXTENSIONS)[number]) ? extension : '<extension>'}`;
  return [...segments.map((part) => MEDIA_DIRECTORIES.includes(part as (typeof MEDIA_DIRECTORIES)[number]) ? part : '<segment>'), `<file>${suffix}`].join('/');
}
function uriForm(value: string): 'relative-path' | 'http-url' | 'data-url' | 'other' {
  if (/^https?:\/\//i.test(value)) return 'http-url';
  if (/^data:/i.test(value)) return 'data-url';
  if (!value || /^[/\\]/.test(value) || /[:?#\s\u0000-\u001f]/.test(value)) return 'other';
  return /[/\\]/.test(value) || /\.[a-zA-Z0-9]+$/.test(value) ? 'relative-path' : 'other';
}
function seconds(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 253_402_300_799;
}
export function countMedia(stats: MediaStats, rowClass: RowClass, value: unknown): void {
  const row = object(value);
  const media = row?.[MEDIA_KEY];
  const bucket = !Array.isArray(media) ? 'absent' : media.length >= 3 ? '3+' : String(media.length) as '0' | '1' | '2';
  stats.lengths[rowClass][bucket]++;
  if (!Array.isArray(media)) return;
  const relations = new Set<'equal' | 'earlier' | 'later'>();
  let timestampPresent = false;
  const time = object(object(row?.[MAP_KEY])?.Time)?.timestamp;
  for (const value of media as unknown[]) {
    const entry = object(value);
    const uri = entry?.uri;
    if (typeof uri === 'string') {
      const form = uriForm(uri);
      const forms = stats.uriForms[rowClass];
      if (form === 'relative-path') {
        const relative = forms[form];
        relative.count++;
        const pattern = mediaPattern(uri);
        const known = relative.patterns.find((entry) => entry.pattern === pattern);
        if (known) known.count++;
        else if (relative.patterns.length < 10) relative.patterns.push({ pattern, count: 1 });
      } else forms[form]++;
    }
    if (entry && Object.hasOwn(entry, 'creation_timestamp')) timestampPresent = true;
    const timestamp = entry?.creation_timestamp;
    if (seconds(timestamp) && seconds(time)) relations.add(timestamp === time ? 'equal' : timestamp < time ? 'earlier' : 'later');
  }
  const timestamp = stats.creationTimestamp[rowClass];
  if (timestampPresent) timestamp.present++;
  if (relations.size) timestamp.comparable++;
  for (const relationship of relations) timestamp[relationship]++;
}
export function sortMediaPatterns(stats: MediaStats): void {
  // Stable output order is lexical; the retained set remains the first ten.
  for (const owner of ROW_CLASSES) stats.uriForms[owner]['relative-path'].patterns.sort((a, b) => a.pattern < b.pattern ? -1 : a.pattern > b.pattern ? 1 : 0);
}

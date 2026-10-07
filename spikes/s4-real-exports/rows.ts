import { parseJsonArrayStream } from '../../packages/core/src/index.ts';
import type { ArchiveEntry, ArchiveReader } from '../../packages/core/src/index.ts';
import { parseComment, parseLegacyComment } from '../../packages/adapter-instagram/src/format.ts';
import { commentFile } from '../../packages/adapter-instagram/src/paths.ts';
import { files as xFiles } from '../../packages/adapter-x/src/archive.ts';
import { tweetItem } from '../../packages/adapter-x/src/tweet.ts';
import { pattern, rowShape } from './projection.ts';
import type { Platform, RowClass, RowFile } from './schema.ts';
import { countMedia, createMediaStats, sortMediaPatterns } from './media.ts';

// Framing only: expose a bare array or one object's sole array property to
// core's streaming JSON parser. Row acceptance belongs to the adapters.
async function* commentArray(chunks: AsyncIterable<string>): AsyncGenerator<string> {
  let header = '';
  let mode: 'header' | 'bare' | 'wrapped' | 'tail' = 'header';
  let depth = 0;
  let quoted = false;
  let escaped = false;
  let closed = false;
  for await (let chunk of chunks) {
    if (mode === 'bare') { yield chunk; continue; }
    if (mode === 'header') {
      header += chunk;
      const leading = header.replace(/^\uFEFF/, '').trimStart();
      if (!leading) { if (header.length > 4096) throw new Error('S4_ARRAY_PREFIX'); continue; }
      if (leading.startsWith('[')) { mode = 'bare'; yield header; header = ''; continue; }
      if (!leading.startsWith('{')) throw new Error('S4_ARRAY_PREFIX');
      const prefix = /^\uFEFF?\s*\{\s*("(?:[^"\\]|\\.)*")\s*:\s*/.exec(header);
      if (!prefix) { if (header.length > 4096) throw new Error('S4_ARRAY_PREFIX'); continue; }
      if (prefix[0].length > 4096) throw new Error('S4_ARRAY_PREFIX');
      JSON.parse(prefix[1]!);
      chunk = header.slice(prefix[0].length);
      if (!chunk) continue;
      if (!chunk.startsWith('[')) throw new Error('S4_ARRAY_PREFIX');
      header = '';
      mode = 'wrapped';
    }
    if (mode === 'wrapped') {
      let boundary = -1;
      for (let index = 0; index < chunk.length; index++) {
        const char = chunk[index]!;
        if (quoted) {
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === '"') quoted = false;
        } else if (char === '"') quoted = true;
        else if (char === '[' || char === '{') depth++;
        else if (char === ']' || char === '}') {
          depth--;
          if (depth === 0) { boundary = index; break; }
        }
      }
      if (boundary < 0) { yield chunk; continue; }
      yield chunk.slice(0, boundary + 1);
      chunk = chunk.slice(boundary + 1);
      mode = 'tail';
    }
    if (mode === 'tail') {
      for (const char of chunk) {
        if (/\s/.test(char)) continue;
        if (!closed && char === '}') closed = true;
        else throw new Error('S4_ARRAY_TAIL');
      }
    }
  }
  if (mode === 'header' || mode !== 'bare' && (!closed || depth !== 0)) throw new Error('S4_ARRAY_TRUNCATED');
}

interface Spec { rowParser: RowFile['rowParser']; classify(value: unknown, index: number): RowClass | null }
function spec(reader: ArchiveReader, entry: ArchiveEntry, platform: Platform): Spec | null {
  if (platform === 'instagram') {
    const file = commentFile(entry);
    if (!file || file.format !== 'json') return null;
    const parser = file.layout === 'legacy' ? parseLegacyComment : parseComment;
    return { rowParser: file.layout === 'legacy' ? 'instagram-legacy-comment' : 'instagram-comment', classify(value) {
      const parsed = parser(value);
      return parsed === null ? 'rejected' : parsed.text === '' ? 'mediaOnly' : 'text';
    } };
  }
  const file = xFiles(reader).find((file) => file.entry === entry);
  if (!file || !['tweets', 'deleted-tweets', 'community-tweets', 'note-tweets'].includes(file.category)) return null;
  if (file.category === 'note-tweets') return { rowParser: 'seen-only', classify: () => null };
  return { rowParser: 'x-tweet', classify: (value, index) => tweetItem(value, { key: 'x:s4-row-context', handle: null }, entry, index) === null ? 'rejected' : 'text' };
}

async function auditRows(reader: ArchiveReader, platform: Platform, entries: readonly ArchiveEntry[], withMedia: boolean): Promise<RowFile[]> {
  const reports: RowFile[] = [];
  for (const entry of entries) {
    const row = spec(reader, entry, platform);
    if (!row) continue;
    const report: RowFile = { label: `file-${reports.length + 1}`, pattern: pattern(entry.path), rowParser: row.rowParser,
      rowsSeen: 0, rowsRejected: row.rowParser === 'seen-only' ? null : 0, streamError: false, rejectedShapes: [] };
    if (platform === 'instagram' && withMedia) report.mediaStats = createMediaStats();
    const shapes = new Map<string, RowFile['rejectedShapes'][number]>();
    let parser;
    try {
      const chunks = reader.streamText(entry);
      parser = parseJsonArrayStream(platform === 'instagram' ? commentArray(chunks) : chunks, { assignment: platform === 'x' ? 'allowed' : 'none' });
    } catch { report.streamError = true; }
    if (parser) {
      const iterator = parser[Symbol.asyncIterator]();
      try {
        while (true) {
          let next: IteratorResult<unknown>;
          try { next = await iterator.next(); }
          catch { report.streamError = true; break; }
          if (next.done) break;
          const index = report.rowsSeen++;
          const rowClass = row.classify(next.value, index);
          if (report.mediaStats && rowClass !== null) countMedia(report.mediaStats, rowClass, next.value);
          if (rowClass !== 'rejected') continue;
          report.rowsRejected!++;
          const paths = rowShape(next.value);
          const signature = JSON.stringify(paths);
          const known = shapes.get(signature);
          if (known) known.count++;
          else if (shapes.size < 10) shapes.set(signature, { paths, count: 1 });
        }
        if (!report.streamError) {
          try { await parser.target; } catch { report.streamError = true; }
        }
      } finally { await iterator.return?.(); }
    }
    report.rejectedShapes = [...shapes.values()];
    if (report.mediaStats) sortMediaPatterns(report.mediaStats);
    reports.push(report);
  }
  return reports;
}
// Keep the round-2 row-inspection API stable for its unchanged regression
// tests. The report's enriched API shares the same stream and row decisions.
export function inspectRows(reader: ArchiveReader, platform: Platform, entries: readonly ArchiveEntry[]): Promise<RowFile[]> {
  return auditRows(reader, platform, entries, false);
}
export function inspectRowsWithMedia(reader: ArchiveReader, platform: Platform, entries: readonly ArchiveEntry[]): Promise<RowFile[]> {
  return auditRows(reader, platform, entries, true);
}

import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeStructure, importArchive, PRIVATE_PATH_PATTERNS } from '../../packages/core/src/index.ts';
import type { ArchiveEntry, ArchiveReader, Item, PlatformAdapter } from '../../packages/core/src/index.ts';
import { openArchivePaths } from '../../packages/core/src/node/index.ts';
import { xAdapter } from '../../packages/adapter-x/src/index.ts';
import { instagramAdapter } from '../../packages/adapter-instagram/src/index.ts';
import { difference, mergeFiles, pattern, projectStructure, sizeClass } from './projection.ts';
import { CATEGORIES, PLATFORMS, validateReport } from './schema.ts';
import type { DiagnosticCount, Kinds, Platform, Report, ShapeFile } from './schema.ts';
import { inspectRowsWithMedia } from './rows.ts';

const adapters = [xAdapter, instagramAdapter];
const fixtures = fileURLToPath(new URL('../../fixtures/synthetic/', import.meta.url));
const privateEntry = (entry: ArchiveEntry) => PRIVATE_PATH_PATTERNS.some((rule) => rule.test(entry.path));
function filtered(reader: ArchiveReader, entries: readonly ArchiveEntry[]): ArchiveReader {
  return {
    archives: reader.archives, rejectedEntries: reader.rejectedEntries,
    list: () => entries,
    readText: (entry, options) => reader.readText(entry, options),
    streamText: (entry, options) => reader.streamText(entry, options),
    close: async () => {},
  };
}
interface Trace {
  reads: Record<Platform, Set<ArchiveEntry>>;
  detections: Report['adapters'];
  denied: boolean;
}
function observed(reader: ArchiveReader, owner: Platform, trace: Trace): ArchiveReader {
  function opened(entry: ArchiveEntry): void {
    if (privateEntry(entry)) { trace.denied = true; throw new Error('S4_PRIVATE_READ'); }
    trace.reads[owner].add(entry);
  }
  return {
    archives: reader.archives, rejectedEntries: reader.rejectedEntries,
    get diagnostics() { return reader.diagnostics; },
    list: () => reader.list(),
    readText(entry, options) { opened(entry); return reader.readText(entry, options); },
    streamText(entry, options) { opened(entry); return reader.streamText(entry, options); },
    close: async () => {},
  };
}
function traceAdapters(trace: Trace): PlatformAdapter[] {
  return adapters.map((adapter) => ({
    ...adapter,
    async detect(reader) {
      const platform = adapter.platform as Platform;
      const detection = await adapter.detect(observed(reader, platform, trace));
      trace.detections.push({ platform, result: detection.result, variant: detection.variant });
      return detection;
    },
    parse(reader, context) { return adapter.parse(observed(reader, adapter.platform as Platform, trace), context); },
  }));
}
function newTrace(): Trace { return { reads: { x: new Set(), instagram: new Set() }, detections: [], denied: false }; }
function counters(): { kinds: Kinds; withMedia: number; unknownLikes: number; unknownReposts: number } {
  return { kinds: { post: 0, reply: 0, quote: 0, repost: 0, comment: 0 }, withMedia: 0, unknownLikes: 0, unknownReposts: 0 };
}
async function readShapes(reader: ArchiveReader, trace: Trace): Promise<Record<Platform, ShapeFile[]>> {
  const result: Record<Platform, ShapeFile[]> = { x: [], instagram: [] };
  for (const platform of PLATFORMS) {
    result[platform] = projectStructure(await describeStructure(filtered(reader, [...trace.reads[platform]])));
  }
  return result;
}
let baseline: Promise<Record<Platform, ShapeFile[]>> | undefined;
export function fixtureBaseline(): Promise<Record<Platform, ShapeFile[]>> {
  baseline ??= (async () => {
    const result: Record<Platform, ShapeFile[]> = { x: [], instagram: [] };
    for (const platform of PLATFORMS) {
      const directory = join(fixtures, platform);
      const variants = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory() && !entry.isSymbolicLink()).sort((a, b) => a.name < b.name ? -1 : 1);
      for (const variant of variants) {
        const metadata: unknown = JSON.parse(await readFile(join(directory, variant.name, 'variant.json'), 'utf8'));
        if (!metadata || typeof metadata !== 'object' || !('archives' in metadata) || !Array.isArray(metadata.archives)) throw new Error('S4_FIXTURE_INVALID');
        for (const name of metadata.archives as unknown[]) {
          if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) throw new Error('S4_FIXTURE_INVALID');
          const reader = await openArchivePaths([join(directory, variant.name, name)]);
          try {
            const trace = newTrace();
            await importArchive(reader, traceAdapters(trace), { onItems() {} });
            if (trace.denied) throw new Error('S4_PRIVATE_READ');
            const shapes = await readShapes(reader, trace);
            result[platform].push(...shapes[platform]);
          } finally { await reader.close(); }
        }
      }
      result[platform] = mergeFiles(result[platform]);
    }
    return result;
  })();
  return baseline;
}
export async function checkInputs(paths: string[]): Promise<Report> {
  if (!paths.length) throw new Error('S4_USAGE');
  const reference = await fixtureBaseline();
  const inputs: Report['inputs'] = [];
  for (const [index, path] of paths.entries()) {
    const info = await lstat(path);
    const reader = await openArchivePaths([path]);
    try {
      const entries = reader.list();
      inputs.push({ label: `input-${index + 1}`, kind: info.isDirectory() ? 'folder' : 'zip',
        sizeClass: sizeClass(info.isDirectory() ? entries.reduce((sum, entry) => sum + entry.size, 0) : info.size),
        entryCount: entries.length, rejectedEntries: reader.rejectedEntries,
        privateEntriesSkipped: entries.filter(privateEntry).length,
      });
    } finally { await reader.close(); }
  }
  const reader = await openArchivePaths(paths);
  try {
    const trace = newTrace();
    const counts = { x: counters(), instagram: counters() };
    let peak = process.memoryUsage().rss;
    const sample = () => { peak = Math.max(peak, process.memoryUsage().rss); };
    const timer = setInterval(sample, 20);
    const start = performance.now();
    let summary;
    try {
      summary = await importArchive(reader, traceAdapters(trace), {
        onItems(batch: Item[]) {
          for (const item of batch) {
            const count = counts[item.platform as Platform];
            count.kinds[item.kind]++;
            if (item.mediaCount !== null && item.mediaCount > 0) count.withMedia++;
            if (item.engagement.likes === null) count.unknownLikes++;
            if (item.engagement.reposts === null) count.unknownReposts++;
          }
          sample();
        },
      });
    } finally { sample(); clearInterval(timer); }
    const importMs = Math.round(performance.now() - start);
    if (trace.denied) throw new Error('S4_PRIVATE_READ');
    const shapes = await readShapes(reader, trace);
    const rows = {
      x: await inspectRowsWithMedia(reader, 'x', [...trace.reads.x]),
      instagram: await inspectRowsWithMedia(reader, 'instagram', [...trace.reads.instagram]),
    };
    const read = new Set([...trace.reads.x, ...trace.reads.instagram]);
    const other = new Map<string, number>();
    for (const entry of reader.list()) {
      if (read.has(entry) || privateEntry(entry)) continue;
      const normalized = pattern(entry.path);
      other.set(normalized, (other.get(normalized) ?? 0) + 1);
    }
    const report: Report = {
      inputs, adapters: trace.detections,
      import: { status: summary.status, records: summary.records.map((record) => {
        const owner = record.platform as Platform;
        const diagnostics: DiagnosticCount[] = record.diagnostics.map((diagnostic) => ({
          category: CATEGORIES.includes(diagnostic.category as DiagnosticCount['category']) ? diagnostic.category as DiagnosticCount['category'] : 'other',
          status: diagnostic.status, count: diagnostic.count, fileCount: diagnostic.files.length,
        }));
        return { platform: owner, variant: record.variant, accountCount: record.accounts.length,
          accountsWithHandle: record.accounts.filter(({ handle }) => handle !== null).length,
          accountsWithoutHandle: record.accounts.filter(({ handle }) => handle === null).length,
          itemCount: record.itemCount, ...counts[owner],
          duplicates: record.diagnostics.filter(({ category }) => category === 'duplicate-items').reduce((sum, diagnostic) => sum + diagnostic.count, 0),
          conflicts: record.diagnostics.filter(({ category }) => category === 'conflicting-items').reduce((sum, diagnostic) => sum + diagnostic.count, 0), diagnostics,
        };
      }) },
      structure: { parserRead: PLATFORMS.map((platform) => ({ platform, files: shapes[platform],
        rowFiles: rows[platform],
        onlyInInput: difference(shapes[platform], reference[platform]), onlyInFixtures: difference(reference[platform], shapes[platform]),
      })), otherFiles: [...other].sort(([a], [b]) => a < b ? -1 : 1).map(([pattern, count]) => ({ pattern, count })) },
      performance: { importMs, peakRssBytes: Math.max(peak, process.resourceUsage().maxRSS * 1024) },
    };
    validateReport(report);
    return report;
  } finally { await reader.close(); }
}

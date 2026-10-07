// The report is a closed vocabulary. No field accepts arbitrary archive text.
export const PLATFORMS = ['x', 'instagram'] as const;
export type Platform = (typeof PLATFORMS)[number];
export const TYPES = ['array', 'boolean', 'null', 'number', 'object', 'string'] as const;
export type ValueType = (typeof TYPES)[number];
export const STATUSES = ['ok', 'partial', 'unknown-format', 'html-export'] as const;
export const DETECTIONS = ['match', 'no-match', 'html-export'] as const;
export const DIAGNOSTIC_STATUSES = ['found', 'missing', 'empty', 'unreadable', 'skipped'] as const;
export const CATEGORIES = [
  'account', 'manifest', 'tweets', 'note-tweets', 'deleted-tweets',
  'community-tweets', 'unmatched-note-tweets', 'ambiguous-note-tweets',
  'post-comments', 'reels-comments', 'adapter', 'invalid-items',
  'duplicate-items', 'conflicting-items', 'unsupported-compression',
  'encrypted-entry', 'other',
] as const;
export const SIZE_CLASSES = ['under-10-mb', 'under-100-mb', 'under-1-gb', 'under-4-gb', 'larger'] as const;
export type SizeClass = (typeof SIZE_CLASSES)[number];
export const VARIANTS = {
  x: ['ytd-tweets', 'ytd-tweet', 'ytd-tweet-unwrapped', 'grailbird'],
  instagram: ['json-current', 'json-root-comments', 'json-activity', 'json-legacy', 'json-mixed', 'html'],
} as const;
export const DIRECTORIES = [
  'data', 'js', 'tweets', 'your_instagram_activity', 'comments',
  'activity', 'personal_information', 'account_information', 'assets',
  'media', 'preferences', 'ads_information', 'apps_and_websites_off_of_instagram',
  'logged_information', 'saved', 'likes',
] as const;
export const FILE_TOKENS = [
  '<tweets>', '<tweet>', '<tweets-partN>', '<tweet-partN>', '<tweets_N_N>',
  '<account>', '<manifest>', '<user_details>', '<note-tweet>',
  '<deleted-tweets>', '<community-tweet>', '<post_comments_N>',
  '<post_comments>', '<reels_comments>', '<comments>',
  '<personal_information>', '<file>',
] as const;
export const EXTENSIONS = ['js', 'json', 'html', 'htm', 'txt', 'csv', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov', 'zip', 'css', '<extension>'] as const;
export const KEYS = [
  'tweet', 'id', 'id_str', 'created_at', 'full_text', 'text', 'favorite_count',
  'retweet_count', 'in_reply_to_status_id_str', 'in_reply_to_screen_name',
  'in_reply_to_user_id_str', 'quoted_status_id_str', 'source', 'truncated',
  'favorited', 'retweeted', 'display_text_range', 'lang', 'entities',
  'extended_entities', 'urls', 'url', 'expanded_url', 'display_url', 'indices',
  'hashtags', 'symbols', 'user_mentions', 'media', 'media_url',
  'media_url_https', 'type', 'sizes', 'small', 'medium', 'large', 'thumb',
  'w', 'h', 'resize', 'screen_name', 'user', 'name', 'account', 'accountId',
  'username', 'email', 'phoneNumber', 'createdAt', 'createdVia',
  'accountDisplayName', 'archiveInfo', 'generationDate', 'isArchivePartial',
  'maxPartSizeBytes', 'dataTypes', 'tweets', 'files', 'fileName', 'globalName',
  'count', 'partNumber', 'noteTweet', 'noteTweetId', 'core', 'mentions',
  'full_name', 'bio', 'location', 'profile_user', 'Comment', 'Time',
  'Media Owner', 'Kommentar', 'Zeit', 'Medieninhaber', 'Username',
  'Benutzername', 'Email', 'Phone Number', 'Name', 'Bio',
  'comments_reels_comments', 'media_comments', 'story_comments', 'live_comments',
  'title', 'href', 'timestamp', 'value', '<key>',
  ['string', 'map', 'data'].join('_'), ['string', 'list', 'data'].join('_'),
  ['media', 'owner'].join('_'),
  // Public format snapshot, retrieved 2026-10-07: media-map envelope and
  // media URI/timestamp/metadata sections, names only (no example values).
  // https://github.com/anand-loop/picnic/blob/3dc08d728e339e80336e852d1011956532fd6799/docs/instagram-export-format.md
  'media_map_data', 'uri', 'creation_timestamp', 'media_metadata',
  // Public description of a downloaded Instagram JSON format, 2022-06-23;
  // verified through the Stack Exchange question API on 2026-10-07.
  // https://stackoverflow.com/questions/72731890/how-to-get-a-pandas-dataframe-from-instagram-json-data
  'media_list_data',
  // MIT parser type definition, retrieved 2026-10-07: PartialTweetEditInfo.
  // https://github.com/alkihis/twitter-archive-reader/blob/a23fb890133553efa850b5c886ffbfb9a0892690/ts/types/ClassicTweets.ts
  'edit_info', 'initial', 'editTweetIds', 'editableUntil', 'editsRemaining', 'isEditEligible',
  // Public export-format example (tweets.js), field verified 2026-10-07.
  // https://gist.github.com/bitsgalore/cfdff3ce67f1ffa85f67e87c778a9e75
  'possibly_sensitive',
  // MIT parser manifest type definition, retrieved 2026-10-07.
  // https://github.com/alkihis/twitter-archive-reader/blob/a23fb890133553efa850b5c886ffbfb9a0892690/ts/types/GDPRManifest.ts
  'userInfo', 'userName', 'displayName', 'mediaDirectory', 'sizeBytes',
] as const;
// Literal fixture names can be ordinary words such as "archive". These
// aliases retain the field's meaning without echoing that identity token.
export const KEY_ALIASES: Readonly<Record<string, string>> = {
  archiveInfo: 'exportInfo', isArchivePartial: 'isPartial',
};

export interface ShapePath { path: string; types: ValueType[] }
export interface ShapeFile { pattern: string; count: number; paths: ShapePath[] }
export interface Difference extends ShapePath { pattern: string }
export interface DiagnosticCount {
  category: (typeof CATEGORIES)[number];
  status: (typeof DIAGNOSTIC_STATUSES)[number];
  count: number;
  fileCount: number;
}
export interface Kinds { post: number; reply: number; quote: number; repost: number; comment: number }
export const ROW_PARSERS = ['x-tweet', 'instagram-comment', 'instagram-legacy-comment', 'seen-only'] as const;
export interface RowFile {
  label: string;
  pattern: string;
  rowParser: (typeof ROW_PARSERS)[number];
  rowsSeen: number;
  rowsRejected: number | null;
  streamError: boolean;
  rejectedShapes: { paths: ShapePath[]; count: number }[];
}
export interface Report {
  inputs: { label: string; kind: 'zip' | 'folder'; sizeClass: SizeClass; entryCount: number; rejectedEntries: number; privateEntriesSkipped: number }[];
  adapters: { platform: Platform; result: (typeof DETECTIONS)[number]; variant: string | null }[];
  import: {
    status: (typeof STATUSES)[number];
    records: { platform: Platform; variant: string | null; accountCount: number; accountsWithHandle: number; accountsWithoutHandle: number; itemCount: number; kinds: Kinds; withMedia: number; unknownLikes: number; unknownReposts: number; duplicates: number; conflicts: number; diagnostics: DiagnosticCount[] }[];
  };
  structure: {
    parserRead: { platform: Platform; files: ShapeFile[]; rowFiles: RowFile[]; onlyInInput: Difference[]; onlyInFixtures: Difference[] }[];
    otherFiles: { pattern: string; count: number }[];
  };
  performance: { importMs: number; peakRssBytes: number };
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('S4_REPORT_INVALID');
  const names = Reflect.ownKeys(value);
  if (names.length !== keys.length || names.some((key) => typeof key !== 'string' || !keys.includes(key))) throw new Error('S4_REPORT_INVALID');
  for (const key of keys) if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, 'value')) throw new Error('S4_REPORT_INVALID');
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > 2_000_000) throw new Error('S4_REPORT_INVALID');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.some((key) => key !== 'length' && (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))) throw new Error('S4_REPORT_INVALID');
  for (let index = 0; index < value.length; index++) if (!Object.hasOwn(Object.getOwnPropertyDescriptor(value, String(index))!, 'value')) throw new Error('S4_REPORT_INVALID');
  return value as unknown[];
}
function choice<T extends string>(value: unknown, allowed: readonly T[]): asserts value is T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error('S4_REPORT_INVALID');
}
function number(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('S4_REPORT_INVALID');
}
function platform(value: unknown): Platform { choice(value, PLATFORMS); return value; }
function variant(value: unknown, owner: Platform): void { if (value !== null) choice(value, VARIANTS[owner]); }
export function validPattern(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 2048) return false;
  const parts = value.split('/');
  const file = parts.pop() ?? '';
  for (const directory of parts) if (!['<root>', '<segment>', ...DIRECTORIES].includes(directory)) return false;
  const dot = file.lastIndexOf('.');
  return FILE_TOKENS.includes((dot < 0 ? file : file.slice(0, dot)) as (typeof FILE_TOKENS)[number])
    && (dot < 0 || EXTENSIONS.includes(file.slice(dot + 1) as (typeof EXTENSIONS)[number]));
}
export function validPath(value: unknown): boolean {
  if (typeof value !== 'string' || value.length > 8192 || !value.startsWith('$')) return false;
  const allowed = new Set(KEYS.map((key) => key === '<key>' ? key : `<${KEY_ALIASES[key] ?? key}>`));
  let remaining = value.slice(1);
  while (remaining) {
    if (remaining.startsWith('[]')) { remaining = remaining.slice(2); continue; }
    const match = /^\.(<[^>]*>)/.exec(remaining);
    if (!match || !allowed.has(match[1]!)) return false;
    remaining = remaining.slice(match[0].length);
  }
  return true;
}
function shapePath(value: unknown, diff: boolean): void {
  const row = record(value, diff ? ['pattern', 'path', 'types'] : ['path', 'types']);
  if (diff && !validPattern(row.pattern) || !validPath(row.path)) throw new Error('S4_REPORT_INVALID');
  const types = array(row.types);
  if (types.length > TYPES.length || new Set(types).size !== types.length) throw new Error('S4_REPORT_INVALID');
  for (const type of types) choice(type, TYPES);
}
function rowFiles(value: unknown, owner: Platform): void {
  const rows = array(value);
  for (const [index, value] of rows.entries()) {
    const row = record(value, ['label', 'pattern', 'rowParser', 'rowsSeen', 'rowsRejected', 'streamError', 'rejectedShapes']);
    if (row.label !== `file-${index + 1}` || !validPattern(row.pattern) || typeof row.streamError !== 'boolean') throw new Error('S4_REPORT_INVALID');
    choice(row.rowParser, ROW_PARSERS);
    if (owner === 'x' && row.rowParser !== 'x-tweet' && row.rowParser !== 'seen-only'
      || owner === 'instagram' && row.rowParser !== 'instagram-comment' && row.rowParser !== 'instagram-legacy-comment') throw new Error('S4_REPORT_INVALID');
    number(row.rowsSeen);
    if (row.rowParser === 'seen-only') {
      if (row.rowsRejected !== null) throw new Error('S4_REPORT_INVALID');
    } else {
      number(row.rowsRejected);
      if (row.rowsRejected > row.rowsSeen) throw new Error('S4_REPORT_INVALID');
    }
    const shapes = array(row.rejectedShapes);
    if (shapes.length > 10 || row.rowsRejected === null && shapes.length) throw new Error('S4_REPORT_INVALID');
    const signatures = new Set<string>();
    let total = 0;
    for (const value of shapes) {
      const shape = record(value, ['paths', 'count']);
      number(shape.count);
      if (!shape.count) throw new Error('S4_REPORT_INVALID');
      total += shape.count;
      const paths = array(shape.paths);
      if (!paths.length) throw new Error('S4_REPORT_INVALID');
      let previous = '';
      for (const value of paths) {
        shapePath(value, false);
        const path = value as ShapePath;
        if (path.path <= previous || !path.types.length || path.types.join('\0') !== [...path.types].sort().join('\0')) throw new Error('S4_REPORT_INVALID');
        previous = path.path;
      }
      const signature = JSON.stringify(paths);
      if (signatures.has(signature)) throw new Error('S4_REPORT_INVALID');
      signatures.add(signature);
    }
    if (total > (row.rowsRejected ?? 0)) throw new Error('S4_REPORT_INVALID');
  }
}
export function validateReport(value: unknown): asserts value is Report {
  const root = record(value, ['inputs', 'adapters', 'import', 'structure', 'performance']);
  const inputs = array(root.inputs);
  if (!inputs.length) throw new Error('S4_REPORT_INVALID');
  for (const [index, value] of inputs.entries()) {
    const input = record(value, ['label', 'kind', 'sizeClass', 'entryCount', 'rejectedEntries', 'privateEntriesSkipped']);
    if (input.label !== `input-${index + 1}`) throw new Error('S4_REPORT_INVALID');
    choice(input.kind, ['zip', 'folder']); choice(input.sizeClass, SIZE_CLASSES);
    number(input.entryCount); number(input.rejectedEntries); number(input.privateEntriesSkipped);
    if (input.privateEntriesSkipped > input.entryCount) throw new Error('S4_REPORT_INVALID');
  }
  const adapters = array(root.adapters);
  if (adapters.length !== 2) throw new Error('S4_REPORT_INVALID');
  for (const [index, value] of adapters.entries()) {
    const row = record(value, ['platform', 'result', 'variant']);
    const owner = platform(row.platform);
    if (owner !== PLATFORMS[index]) throw new Error('S4_REPORT_INVALID');
    choice(row.result, DETECTIONS); variant(row.variant, owner);
  }
  const imported = record(root.import, ['status', 'records']);
  choice(imported.status, STATUSES);
  const records = array(imported.records);
  if (records.length > 2) throw new Error('S4_REPORT_INVALID');
  const owners = new Set<Platform>();
  for (const value of records) {
    const row = record(value, ['platform', 'variant', 'accountCount', 'accountsWithHandle', 'accountsWithoutHandle', 'itemCount', 'kinds', 'withMedia', 'unknownLikes', 'unknownReposts', 'duplicates', 'conflicts', 'diagnostics']);
    const owner = platform(row.platform);
    if (owners.has(owner)) throw new Error('S4_REPORT_INVALID');
    owners.add(owner); variant(row.variant, owner);
    for (const field of ['accountCount', 'accountsWithHandle', 'accountsWithoutHandle', 'itemCount', 'withMedia', 'unknownLikes', 'unknownReposts', 'duplicates', 'conflicts']) number(row[field]);
    if (row.accountCount !== (row.accountsWithHandle as number) + (row.accountsWithoutHandle as number)) throw new Error('S4_REPORT_INVALID');
    const kinds = record(row.kinds, ['post', 'reply', 'quote', 'repost', 'comment']);
    for (const value of Object.values(kinds)) number(value);
    if (Object.values(kinds).reduce<number>((sum, value) => sum + (value as number), 0) !== row.itemCount) throw new Error('S4_REPORT_INVALID');
    for (const field of ['withMedia', 'unknownLikes', 'unknownReposts']) if ((row[field] as number) > (row.itemCount as number)) throw new Error('S4_REPORT_INVALID');
    for (const value of array(row.diagnostics)) {
      const diagnostic = record(value, ['category', 'status', 'count', 'fileCount']);
      choice(diagnostic.category, CATEGORIES); choice(diagnostic.status, DIAGNOSTIC_STATUSES);
      number(diagnostic.count); number(diagnostic.fileCount);
    }
  }
  const structure = record(root.structure, ['parserRead', 'otherFiles']);
  const read = array(structure.parserRead);
  if (read.length !== 2) throw new Error('S4_REPORT_INVALID');
  for (const [index, value] of read.entries()) {
    const row = record(value, ['platform', 'files', 'rowFiles', 'onlyInInput', 'onlyInFixtures']);
    const owner = platform(row.platform);
    if (owner !== PLATFORMS[index]) throw new Error('S4_REPORT_INVALID');
    rowFiles(row.rowFiles, owner);
    for (const value of array(row.files)) {
      const file = record(value, ['pattern', 'count', 'paths']);
      if (!validPattern(file.pattern)) throw new Error('S4_REPORT_INVALID');
      number(file.count);
      for (const path of array(file.paths)) shapePath(path, false);
    }
    for (const field of ['onlyInInput', 'onlyInFixtures']) for (const path of array(row[field])) shapePath(path, true);
  }
  for (const value of array(structure.otherFiles)) {
    const file = record(value, ['pattern', 'count']);
    if (!validPattern(file.pattern)) throw new Error('S4_REPORT_INVALID');
    number(file.count);
  }
  const performance = record(root.performance, ['importMs', 'peakRssBytes']);
  number(performance.importMs); number(performance.peakRssBytes);
}

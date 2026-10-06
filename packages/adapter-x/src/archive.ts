import { parseJsonArrayStream } from '@socialprune/core';
import type {
  ArchiveEntry,
  ArchiveReader,
  ParseContext,
} from '@socialprune/core';
import { object } from './tweet.ts';

export type Category =
  | 'tweets'
  | 'note-tweets'
  | 'deleted-tweets'
  | 'community-tweets'
  | 'account'
  | 'manifest';
export interface File extends ArchiveEntry {
  category: Category;
  root: string;
  part: number;
  format: 'ytd-tweets' | 'ytd-tweet' | 'grailbird';
  entry: ArchiveEntry;
}

export function files(archive: ArchiveReader): File[] {
  const output: File[] = [];
  for (const entry of archive.list()) {
    const ytd =
      /^([^/]+\/)?data\/(tweets?|note-tweet|deleted-tweets|community-tweet|account|manifest)(?:-part(\d+))?\.js$/.exec(
        entry.path,
      );
    const classic =
      /^([^/]+\/)?data\/js\/(?:tweets\/(\d{4}_\d{2})|user_details)\.js$/.exec(
        entry.path,
      );
    if (!ytd && !classic) continue;
    const root = ytd?.[1] ?? classic?.[1] ?? '';
    if (
      /^(?:direct-message[^/]*|messages|chats|login[^/]*|ip-audit[^/]*|device[^/]*|contacts?|security[^/]*|private|secrets|credentials)\/$/i.test(
        root,
      )
    )
      continue;
    const name = ytd?.[2];
    const category: Category = classic
      ? classic[2]
        ? 'tweets'
        : 'account'
      : name === 'note-tweet'
        ? 'note-tweets'
        : name === 'deleted-tweets'
          ? 'deleted-tweets'
          : name === 'community-tweet'
            ? 'community-tweets'
            : name === 'account'
              ? 'account'
              : name === 'manifest'
                ? 'manifest'
                : 'tweets';
    if ((category === 'account' || category === 'manifest') && ytd?.[3])
      continue;
    output.push({
      ...entry,
      entry,
      category,
      root,
      part: classic?.[2]
        ? Number(classic[2].replace('_', ''))
        : Number(ytd?.[3] ?? 0),
      format: classic
        ? 'grailbird'
        : name === 'tweet'
          ? 'ytd-tweet'
          : 'ytd-tweets',
    });
  }
  return output.sort(
    (a, b) =>
      archive.archives.indexOf(a.archive) -
        archive.archives.indexOf(b.archive) ||
      (a.root < b.root ? -1 : a.root > b.root ? 1 : 0) ||
      a.part - b.part ||
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );
}

export function expectedTargets(file: File): string[] {
  if (file.format === 'grailbird') {
    const month = /\/(\d{4}_\d{2})\.js$/.exec(file.path)?.[1];
    return [['Grailbird', 'data', `tweets_${month}`].join('.')];
  }
  const names =
    file.category === 'tweets'
      ? ['tweets', 'tweet']
      : [
          file.category === 'note-tweets'
            ? 'note_tweet'
            : file.category === 'deleted-tweets'
              ? 'deleted_tweets'
              : file.category === 'community-tweets'
                ? 'community_tweet'
                : 'account',
        ];
  return names.map((name) =>
    ['window', 'YTD', name, `part${file.part}`].join('.'),
  );
}

async function* checkedChunks(
  chunks: AsyncIterable<string>,
  targets: string[],
): AsyncGenerator<string> {
  let prefix = '';
  let checked = false;
  for await (const chunk of chunks) {
    if (checked) {
      yield chunk;
      continue;
    }
    const bracket = chunk.indexOf('[');
    prefix += bracket === -1 ? chunk : chunk.slice(0, bracket);
    if (prefix.length > 2048) throw new TypeError('Invalid export assignment.');
    if (bracket === -1) continue;
    const match =
      /^\uFEFF?\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*=\s*$/.exec(
        prefix,
      );
    if (!match || !targets.includes(match[1]!))
      throw new TypeError('Invalid export assignment.');
    checked = true;
    yield prefix + chunk.slice(bracket);
    prefix = '';
  }
  if (!checked) throw new TypeError('Invalid export assignment.');
}

export async function* readArray(
  archive: ArchiveReader,
  file: File,
  ctx: ParseContext,
): AsyncGenerator<unknown> {
  const targets = expectedTargets(file);
  const parser = parseJsonArrayStream(
    checkedChunks(
      archive.streamText(file.entry, { signal: ctx.signal }),
      targets,
    ),
    {
      assignment: 'allowed',
      maxElementBytes: ctx.limits.maxElementBytes,
      signal: ctx.signal,
    },
  );
  yield* parser;
  if (!targets.includes((await parser.target) ?? ''))
    throw new TypeError('Invalid export assignment.');
}

export function assignedObject(
  value: string,
  classic = false,
): Record<string, unknown> {
  const prefix = classic
    ? /^\uFEFF?\s*(?:var\s+user_details|Grailbird\.data\.user_details)\s*=\s*/
    : /^\uFEFF?\s*window\.__THAR_CONFIG\s*=\s*/;
  const match = prefix.exec(value);
  if (!match) throw new TypeError('Invalid export metadata.');
  const parsed = object(
    JSON.parse(
      value.slice(match[0].length).trim().replace(/;\s*$/, ''),
    ) as unknown,
  );
  if (!parsed) throw new TypeError('Invalid export metadata.');
  return parsed;
}

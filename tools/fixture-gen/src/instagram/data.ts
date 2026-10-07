import { createHash } from 'node:crypto';
import type { Account, Diagnostic, Item } from '@socialprune/core';
import type { Variant } from '../shared/index.ts';

export const MAP_KEY = ['string', 'map', 'data'].join('_');
export const OWNER_KEY = ['media', 'owner'].join('_');
export const CURRENT = 'your_instagram_activity/comments';
export const PERSONAL =
  'personal_information/personal_information/personal_information.json';
export const BASE_SECONDS = 1_753_920_000;
export const PRIMARY = 'instagram-synth_fern-2026-07-31-a1b2c3';
export const SECONDARY = 'instagram-synth_orbit-2026-07-31-d4e5f6';

export interface Comment {
  text: string;
  owner: string | null;
  seconds: number;
}
export interface Row {
  raw: unknown;
  comment: Comment | null;
}
export interface File {
  path: string;
  content: string;
  category?: 'post-comments' | 'reels-comments';
  rows?: Row[];
  unreadable?: boolean;
}
export interface Archive {
  name: string;
  handle: string | null;
  files: File[];
  accountStatus?: Diagnostic['status'];
  accountFile?: string;
}
export function encoded(text: string): string {
  // Manufacture Meta's byte-to-Latin-1 representation from invented text.
  return [...new TextEncoder().encode(text)]
    .map((byte) => String.fromCharCode(byte))
    .join('');
}
export function row(
  text: string,
  owner: string | null = 'synth_moss',
  seconds = BASE_SECONDS,
  opts: { mangled?: boolean; german?: boolean; sibling?: boolean } = {},
): Row {
  const labels = opts.german
    ? ['Kommentar', 'Zeit', 'Medieninhaber']
    : ['Comment', 'Time', 'Media Owner'];
  const rawText = opts.mangled ? encoded(text) : text;
  const rawOwner = opts.mangled ? encoded(owner ?? '') : (owner ?? '');
  return {
    raw: {
      ...(opts.sibling === false ? {} : { [OWNER_KEY]: rawOwner }),
      [MAP_KEY]: {
        [labels[0]!]: { value: rawText, timestamp: 0 },
        [labels[1]!]: { value: '', timestamp: seconds },
        ...(owner === null
          ? {}
          : { [labels[2]!]: { value: rawOwner, timestamp: 0 } }),
      },
    },
    comment: { text, owner, seconds },
  };
}
export function post(rows: Row[], part = 1, directory = CURRENT): File {
  return {
    path: `${directory}/post_comments_${part}.json`,
    content:
      JSON.stringify(
        rows.map((row) => row.raw),
        null,
        2,
      ) + '\n',
    category: 'post-comments',
    rows,
  };
}
export function reels(rows: Row[], directory = CURRENT, bare = false): File {
  const data = rows.map((row) => row.raw);
  return {
    path: `${directory}/reels_comments.json`,
    content:
      JSON.stringify(bare ? data : { comments_reels_comments: data }, null, 2) +
      '\n',
    category: 'reels-comments',
    rows,
  };
}
export function personal(
  handle: string,
  path = PERSONAL,
  german = false,
): File {
  return {
    path,
    content:
      JSON.stringify(
        {
          profile_user: [
            {
              [MAP_KEY]: {
                Email: { value: 'synth_profile_only@example.com' },
                'Phone Number': { value: '+15555550123' },
                [german ? 'Benutzername' : 'Username']: { value: handle },
                Name: { value: 'Synthetic Profile Only' },
                Bio: { value: 'PROFILE_ONLY_MARKER' },
              },
            },
          ],
        },
        null,
        2,
      ) + '\n',
  };
}
function digest(parts: string[]): string {
  // Independent oracle, no adapter or import pipeline calls.
  return createHash('sha256')
    .update(JSON.stringify(parts), 'utf8')
    .digest('hex');
}
function compare(a: File, b: File): number {
  const category =
    Number(a.category === 'reels-comments') -
    Number(b.category === 'reels-comments');
  const part = (file: File) =>
    Number(/post_comments_(\d+)\./.exec(file.path)?.[1] ?? 0);
  return (
    category ||
    part(a) - part(b) ||
    (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  );
}
export function variant(
  id: string,
  description: string,
  archives: Archive[],
  layout = 'json-current',
  status?: 'html-export' | 'unknown-format',
): Variant {
  const items: Item[] = [];
  const accounts: Account[] = [];
  const accountKeys = new Set<string>();
  const ids = new Set<string>();
  const foundAccounts = new Set<string>();
  const accountStates: Diagnostic['status'][] = [];
  const accountFiles: string[] = [];
  const stats = {
    'post-comments': {
      files: [] as string[],
      count: 0,
      rows: 0,
      unreadable: false,
    },
    'reels-comments': {
      files: [] as string[],
      count: 0,
      rows: 0,
      unreadable: false,
    },
  };
  for (const archive of [...archives].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    const account = {
      key: `instagram:${archive.handle ?? digest([archive.name])}`,
      handle: archive.handle,
    };
    if (!accountKeys.has(account.key)) {
      accounts.push(account);
      accountKeys.add(account.key);
    }
    const accountState =
      archive.accountStatus ?? (archive.handle ? 'found' : 'missing');
    accountStates.push(accountState);
    if (accountState === 'found') foundAccounts.add(account.key);
    if (archive.accountFile) accountFiles.push(archive.accountFile);
    const occurrences = new Map<string, number>();
    for (const file of archive.files
      .filter((file) => file.category)
      .sort(compare)) {
      const state = stats[file.category!];
      state.files.push(file.path);
      state.unreadable ||= file.unreadable ?? false;
      for (const [index, row] of (file.rows ?? []).entries()) {
        state.rows++;
        if (!row.comment) {
          state.unreadable = true;
          continue;
        }
        const { text, owner, seconds } = row.comment;
        const createdAt = new Date(seconds * 1000).toISOString();
        const parts = [account.key, createdAt, owner ?? '', text];
        const fingerprint = JSON.stringify(parts);
        const ordinal = (occurrences.get(fingerprint) ?? 0) + 1;
        occurrences.set(fingerprint, ordinal);
        const id = `instagram:${digest(ordinal === 1 ? parts : [...parts, String(ordinal)])}`;
        if (ids.has(id)) continue;
        ids.add(id);
        state.count++;
        items.push({
          id,
          platform: 'instagram',
          account,
          kind: 'comment',
          text,
          createdAt,
          mediaCount: null,
          engagement: { likes: null, reposts: null },
          reference: {
            replyToId: null,
            replyToHandle: null,
            quotedId: null,
            repostOfHandle: null,
            ownerHandle: owner,
          },
          url: null,
          provenance: { archive: archive.name, file: file.path, index },
        });
      }
    }
  }
  const accountState = accountStates.includes('unreadable')
    ? 'unreadable'
    : accountStates.includes('missing')
      ? 'missing'
      : accountStates.includes('empty')
        ? 'empty'
        : 'found';
  const diagnostics: Diagnostic[] = [
    {
      category: 'account',
      status: accountState,
      files: accountFiles,
      count: foundAccounts.size,
      message:
        accountState === 'found'
          ? null
          : accountState === 'unreadable'
            ? 'Account username metadata could not be read; using an archive-specific key.'
            : 'Account handle unavailable; using an archive-specific key.',
    },
  ];
  for (const category of ['post-comments', 'reels-comments'] as const) {
    const state = stats[category];
    const status = state.unreadable
      ? 'unreadable'
      : !state.files.length
        ? 'missing'
        : !state.rows
          ? 'empty'
          : 'found';
    diagnostics.push({
      category,
      status,
      files: state.files,
      count: state.count,
      message:
        status === 'unreadable'
          ? 'Some comment data could not be read; other readable comments were imported.'
          : status === 'missing'
            ? 'Comment category is not present in this export.'
            : null,
    });
  }
  return {
    id,
    platform: 'instagram',
    description,
    archives: archives.map((archive) => ({
      name: archive.name,
      files: Object.fromEntries(
        archive.files.map((file) => [file.path, file.content]),
      ),
    })),
    expected: {
      status:
        status ??
        (diagnostics.some((diagnostic) => diagnostic.status === 'unreadable')
          ? 'partial'
          : 'ok'),
      records: status
        ? []
        : [
            {
              platform: 'instagram',
              accounts,
              variant: layout,
              exportCreatedAt: null,
              itemCount: items.length,
              diagnostics,
            },
          ],
      items: status ? [] : items,
    },
  };
}

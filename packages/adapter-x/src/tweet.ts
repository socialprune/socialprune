import type { Account, ArchiveEntry, Item } from '@socialprune/core';

export function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function decimalId(value: unknown): string | null {
  return typeof value === 'string' && /^\d+$/.test(value) ? value : null;
}

const months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function timestamp(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  zone: string,
): string | null {
  if (
    year < 1000 ||
    month < 0 ||
    month > 11 ||
    day < 1 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return null;
  const local = new Date(Date.UTC(year, month, day, hour, minute, second));
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month ||
    local.getUTCDate() !== day
  )
    return null;
  const zoneHour = Number(zone.slice(1, 3));
  const zoneMinute = Number(zone.slice(3));
  if (zoneHour > 23 || zoneMinute > 59) return null;
  const offset = (zoneHour * 60 + zoneMinute) * (zone[0] === '+' ? 1 : -1);
  return new Date(local.getTime() - offset * 60_000).toISOString();
}

export function parseTweetDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const modern =
    /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) ([A-Z][a-z]{2}) (\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-]\d{4}) (\d{4})$/.exec(
      value,
    );
  if (modern)
    return timestamp(
      Number(modern[7]),
      months.indexOf(modern[1]!),
      Number(modern[2]),
      Number(modern[3]),
      Number(modern[4]),
      Number(modern[5]),
      modern[6]!,
    );
  const classic =
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})$/.exec(value);
  return classic
    ? timestamp(
        Number(classic[1]),
        Number(classic[2]) - 1,
        Number(classic[3]),
        Number(classic[4]),
        Number(classic[5]),
        Number(classic[6]),
        classic[7]!,
      )
    : null;
}

export function parseIsoDate(value: unknown): string | null {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    )
  )
    return null;
  const date = new Date(value);
  const day = Number(value.slice(8, 10));
  const month = Number(value.slice(5, 7));
  const year = Number(value.slice(0, 4));
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return !Number.isNaN(date.getTime()) &&
    year >= 1000 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= days &&
    Number(value.slice(11, 13)) <= 23 &&
    Number(value.slice(14, 16)) <= 59 &&
    Number(value.slice(17, 19)) <= 59
    ? date.toISOString()
    : null;
}

export function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
  };
  return value.replace(
    /&(?:amp|lt|gt|quot|apos|#\d+|#[xX][0-9a-fA-F]+);/g,
    (entity) => {
      const body = entity.slice(1, -1);
      if (body[0] !== '#') return named[body]!;
      const hexadecimal = body[1]?.toLowerCase() === 'x';
      const code = Number.parseInt(
        body.slice(hexadecimal ? 2 : 1),
        hexadecimal ? 16 : 10,
      );
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : entity;
    },
  );
}

function count(value: unknown): number | null {
  if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value);
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function quotedId(tweet: Record<string, unknown>): string | null {
  const explicit = decimalId(tweet.quoted_status_id_str);
  if (explicit) return explicit;
  const urls = object(tweet.entities)?.urls;
  if (!Array.isArray(urls)) return null;
  for (const entry of urls) {
    const expanded = text(object(entry)?.expanded_url);
    if (!expanded) continue;
    try {
      const url = new URL(expanded);
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        !/^(?:(?:www|mobile)\.)?(?:x|twitter)\.com$/i.test(url.hostname)
      )
        continue;
      const match =
        /^\/(?:[A-Za-z0-9_]{1,15}|i\/web)\/status(?:es)?\/(\d+)(?:\/|$)/.exec(
          url.pathname,
        );
      if (match && match[1] !== tweet.id_str) return match[1]!;
    } catch {
      /* A malformed URL cannot identify a quoted post. */
    }
  }
  return null;
}

export function classifyTweet(
  tweet: Record<string, unknown>,
  value: string,
): Pick<Item, 'kind' | 'reference'> {
  const repost = /^RT @([A-Za-z0-9_]{1,15})(?=:|\s|$)/.exec(value);
  const reply = decimalId(tweet.in_reply_to_status_id_str);
  const quote = quotedId(tweet);
  return {
    kind: repost ? 'repost' : reply ? 'reply' : quote ? 'quote' : 'post',
    reference: {
      replyToId: reply,
      replyToHandle: text(tweet.in_reply_to_screen_name),
      quotedId: quote,
      repostOfHandle: repost?.[1] ?? null,
      ownerHandle: null,
    },
  };
}

export function unwrapTweet(value: unknown): Record<string, unknown> | null {
  const outer = object(value);
  return outer && ('tweet' in outer ? object(outer.tweet) : outer);
}

export function tweetItem(
  value: unknown,
  account: Account,
  entry: ArchiveEntry,
  index: number,
): Item | null {
  const tweet = unwrapTweet(value);
  if (!tweet) return null;
  const id = decimalId(tweet.id_str);
  const raw = text(tweet.full_text) ?? text(tweet.text);
  const createdAt = parseTweetDate(tweet.created_at);
  if (!id || raw === null || createdAt === null) return null;
  const decoded = decodeEntities(raw);
  return {
    id: `x:${id}`,
    platform: 'x',
    account,
    ...classifyTweet(tweet, decoded),
    text: decoded,
    createdAt,
    engagement: {
      likes: count(tweet.favorite_count),
      reposts: count(tweet.retweet_count),
    },
    url: `https://x.com/i/web/status/${id}`,
    provenance: { archive: entry.archive, file: entry.path, index },
  };
}

export interface Note {
  text: string;
  createdAt: string;
  hits: number;
  used: boolean;
  ambiguous: boolean;
}
export function notePrefix(value: string): string {
  return value
    .replace(/\s+https:\/\/t\.co\/\S+\s*$/, '')
    .replace(/(?:\u2026|\.{3})\s*$/, '')
    .trimEnd();
}

export function matchingNotes(
  value: string,
  createdAt: string,
  notes: ReadonlyMap<string, Note[]>,
): Note[] {
  const prefix = notePrefix(value);
  if (!prefix) return [];
  return (notes.get(createdAt.slice(0, 19)) ?? []).filter(
    (note) => note.text.length > prefix.length && note.text.startsWith(prefix),
  );
}

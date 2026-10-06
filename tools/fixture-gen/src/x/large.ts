import { stat } from 'node:fs/promises';
import { createRandom, writeZipFile } from '../shared/index.ts';
import type { LargeOptions, ZipFileEntry } from '../shared/index.ts';

export const exportCreatedAt = '2026-10-01T12:00:00.000Z';
export function assignment(name: string, values: unknown[], part = 0): string {
  return `${['window', 'YTD', name, `part${part}`].join('.')} = ${JSON.stringify(values, null, 2)};\n`;
}
export function accountFile(id = '700001', handle = 'orbit_quokka'): string {
  return assignment('account', [
    {
      account: {
        accountId: id,
        username: handle,
        email: `${handle}@example.org`,
        createdAt: '2013-01-01T00:00:00.000Z',
        createdVia: 'web',
        accountDisplayName: 'Invented Orbit',
      },
    },
  ]);
}
export function manifestFile(date = exportCreatedAt): string {
  return `window.__THAR_CONFIG = ${JSON.stringify(
    {
      archiveInfo: {
        generationDate: date,
        isArchivePartial: false,
        maxPartSizeBytes: '536870912',
      },
      dataTypes: {
        tweets: {
          files: [
            {
              fileName: 'data/tweets.js',
              globalName: ['window', 'YTD', 'tweets', 'part0'].join('.'),
            },
          ],
        },
      },
    },
    null,
    2,
  )};\n`;
}

function tweetDate(date: Date): string {
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][
    date.getUTCDay()
  ];
  const month = [
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
  ][date.getUTCMonth()];
  return `${day} ${month} ${String(date.getUTCDate()).padStart(2, '0')} ${date.toISOString().slice(11, 19)} +0000 ${date.getUTCFullYear()}`;
}

interface GeneratedPost {
  tweet: Record<string, unknown>;
  note: unknown;
}
function* posts(count: number, seed: number): Generator<GeneratedPost> {
  const random = createRandom(seed);
  const words = [
    'orbit',
    'quokka',
    'garden',
    'rain',
    'books',
    'invented',
    'morning',
    'pixel',
    'coffee',
    'cloud',
    'quiet',
    'trail',
    'amber',
    'moss',
    'sketch',
    'lantern',
    'violet',
    'bicycle',
    '星',
    'früh',
  ];
  const start = Date.parse('2020-01-01T00:00:00.000Z');
  for (let index = 0; index < count; index++) {
    const id = String(9007199254740993n + BigInt(index));
    const date = new Date(start + index * 60_000);
    const length = 10 + Math.floor(random() * 271);
    const kind = index % 10;
    let content =
      kind === 0 ? 'RT @moss_badger: ' : kind === 1 ? '@amber_moth ' : '';
    while (content.length < length)
      content += words[Math.floor(random() * words.length)] + ' ';
    content = content.slice(0, length);
    const long = index % 100 === 9;
    const fullNote = long
      ? content +
        ' ' +
        'An invented longer field note about a lantern garden. '.repeat(24)
      : null;
    const urls =
      kind === 2
        ? [
            {
              url: 'https://t.co/qSynthetic',
              expanded_url: `https://x.com/violet_otter/status/${800000 + index}`,
              display_url: `x.com/violet_otter/status/${800000 + index}`,
              indices: [0, 23],
            },
          ]
        : [];
    const tweet: Record<string, unknown> = {
      id: Number(id),
      id_str: id,
      created_at: tweetDate(date),
      full_text: fullNote
        ? `${content.slice(0, 220)}\u2026 https://t.co/nSynthetic`
        : content,
      favorite_count: String(Math.floor(random() * 400)),
      retweet_count: String(Math.floor(random() * 50)),
      in_reply_to_status_id_str: kind === 1 ? String(600000 + index) : null,
      in_reply_to_user_id_str: kind === 1 ? '700002' : null,
      in_reply_to_screen_name: kind === 1 ? 'amber_moth' : null,
      source:
        '<a href="https://example.org/app" rel="nofollow">Synthetic Web App</a>',
      truncated: Boolean(fullNote),
      favorited: false,
      retweeted: false,
      display_text_range: ['0', String(content.length)],
      lang: index % 3 ? 'en' : 'de',
      entities: {
        hashtags: index % 7 ? [] : [{ text: 'invented', indices: [2, 11] }],
        symbols: [],
        urls,
        user_mentions:
          kind <= 1
            ? [
                {
                  screen_name: kind === 0 ? 'moss_badger' : 'amber_moth',
                  name: 'Invented handle',
                  id_str: '700002',
                  indices: [0, 11],
                },
              ]
            : [],
        media:
          index % 8
            ? []
            : [
                {
                  id_str: String(500000 + index),
                  type: 'photo',
                  url: 'https://t.co/mSynthetic',
                  expanded_url: `https://x.com/orbit_quokka/status/${id}/photo/1`,
                  display_url: 'pic.example.org/synthetic',
                  media_url_https: `https://example.org/synthetic/${index}.jpg`,
                  indices: [0, 23],
                  sizes: {
                    small: { w: 640, h: 480, resize: 'fit' },
                    large: { w: 1280, h: 960, resize: 'fit' },
                  },
                },
              ],
      },
    };
    yield {
      tweet,
      note: fullNote
        ? {
            noteTweet: {
              noteTweetId: String(100000 + index),
              createdAt: date.toISOString(),
              core: { text: fullNote, urls: [], mentions: [] },
            },
          }
        : null,
    };
  }
}

interface Bytes {
  tweets: number;
  notes: number;
}
function jsonStream(
  name: string,
  elements: Iterable<unknown>,
  measured: (bytes: number) => void,
): ReadableStream<Uint8Array> {
  const iterator = elements[Symbol.iterator]();
  const encoder = new TextEncoder();
  let first = true;
  let prefix = `${['window', 'YTD', name, 'part0'].join('.')} = [\n`;
  let finished = false;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (finished) {
        controller.close();
        return;
      }
      let chunk = prefix;
      prefix = '';
      while (chunk.length < 64 * 1024) {
        const next = iterator.next();
        if (next.done) {
          chunk += '\n];\n';
          finished = true;
          break;
        }
        chunk += (first ? '' : ',\n') + JSON.stringify(next.value, null, 2);
        first = false;
      }
      const bytes = encoder.encode(chunk);
      measured(bytes.byteLength);
      controller.enqueue(bytes);
    },
    cancel() {
      iterator.return?.();
    },
  });
}

export async function* largeEntries(
  options: Pick<LargeOptions, 'count' | 'seed'>,
  measured?: Bytes,
): AsyncGenerator<ZipFileEntry> {
  await Promise.resolve();
  if (
    !Number.isSafeInteger(options.count) ||
    options.count < 1 ||
    !Number.isSafeInteger(options.seed) ||
    options.seed < 0
  )
    throw new RangeError('Count and seed must be valid integers.');
  yield { path: 'data/account.js', content: accountFile() };
  yield { path: 'data/manifest.js', content: manifestFile() };
  function* tweets() {
    for (const post of posts(options.count, options.seed))
      yield { tweet: post.tweet };
  }
  function* notes() {
    for (const post of posts(options.count, options.seed))
      if (post.note) yield post.note;
  }
  yield {
    path: 'data/tweets.js',
    content: jsonStream('tweets', tweets(), (bytes) => {
      if (measured) measured.tweets += bytes;
    }),
  };
  yield {
    path: 'data/note-tweet.js',
    content: jsonStream('note_tweet', notes(), (bytes) => {
      if (measured) measured.notes += bytes;
    }),
  };
}

export async function generateLarge(options: LargeOptions): Promise<void> {
  const bytes: Bytes = { tweets: 0, notes: 0 };
  const start = performance.now();
  await writeZipFile(options.out, largeEntries(options, bytes), {
    zip64: options.zip64,
  });
  console.log(
    JSON.stringify({
      platform: 'x',
      count: options.count,
      seed: options.seed,
      zip64: options.zip64 ?? false,
      generationMs: Math.round(performance.now() - start),
      zipBytes: (await stat(options.out)).size,
      tweetBytes: bytes.tweets,
      noteBytes: bytes.notes,
      averageBytesPerTweet: Math.round(bytes.tweets / options.count),
    }),
  );
}

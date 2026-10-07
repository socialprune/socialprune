import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { stableId } from '@socialprune/core';
import type { Account, Assessment, Diagnostic, Item } from '@socialprune/core';
import { row, post, reels } from '../instagram/data.ts';
import {
  assignment,
  accountFile,
  manifestFile,
  exportCreatedAt,
} from '../x/large.ts';
import { fixturePath, readTree } from '../tree.ts';
import { postExamples, commentExamples, everyday } from './content.ts';
import type { Sample } from './content.ts';
import type { Row } from '../instagram/data.ts';

export const DEMO_VERSION = '1';
export const DEMO_ARCHIVES = {
  x: 'twitter-2026-10-01-demox',
  instagram: 'instagram-demo_fern-2026-10-01-demoig',
} as const;
const xAccount: Account = { key: 'x:770001', handle: 'demo_quokka' };
const instagramAccount: Account = {
  key: 'instagram:demo_fern',
  handle: 'demo_fern',
};
export interface DemoExport {
  platform: 'x' | 'instagram';
  archive: string;
  files: Record<string, string>;
  expected: {
    status: 'ok';
    records: {
      platform: string;
      accounts: Account[];
      variant: string;
      exportCreatedAt: string | null;
      itemCount: number;
      diagnostics: Diagnostic[];
    }[];
    items: Item[];
  };
}
export interface DemoData {
  exports: DemoExport[];
  assessments: Assessment[];
  manifest: {
    format: 'socialprune-demo';
    version: string;
    kind: 'demo';
    defaultPlatform: 'x';
    createdAt: string;
    sources: Assessment['source'][];
    banner: { de: string; en: string };
    exports: {
      platform: 'x' | 'instagram';
      directory: string;
      archive: string;
      account: Account;
      itemCount: number;
    }[];
    languages: {
      x: { de: number; en: number };
      instagram: { de: number; en: number };
    };
    counts: {
      posts: number;
      comments: number;
      assessments: number;
      unclear: number;
      itemsWithoutAssessment: number;
    };
    twoAssessmentItemId: string;
  };
}
function dateString(iso: string): string {
  const date = new Date(iso);
  return date
    .toUTCString()
    .replace(
      /^(\w+), (\d+) (\w+) (\d+) (\d+:\d+:\d+) GMT$/,
      '$1 $3 $2 $5 +0000 $4',
    );
}
function escaped(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
function suggestion(
  item: Item,
  sample: Sample,
  index: number,
): Assessment | null {
  if (!sample.example) return null;
  return {
    assessmentId: `demo-example-${String(index).padStart(3, '0')}`,
    itemId: item.id,
    submissionId: null,
    source: { kind: 'fixture', name: 'demo-examples', version: DEMO_VERSION },
    ...sample.example,
    confidence: null,
    createdAt: exportCreatedAt,
  };
}
function category(
  category: string,
  file: string | null,
  count: number,
  message: string | null,
): Diagnostic {
  return {
    category,
    status: file ? (count ? 'found' : 'empty') : 'missing',
    files: file ? [file] : [],
    count,
    message,
  };
}
export async function createDemo(): Promise<DemoData> {
  const assessments: Assessment[] = [];
  const xItems: Item[] = [];
  const tweets: unknown[] = [];
  const notes: unknown[] = [];
  const languages = { x: { de: 0, en: 0 }, instagram: { de: 0, en: 0 } };
  const start = Date.parse('2018-10-10T20:19:24.000Z');
  for (let index = 0; index < 300; index++) {
    const sample = postExamples[index] ?? everyday(index, 'x');
    languages.x[sample.language]++;
    const id = String(910000000000000001n + BigInt(index));
    const createdAt = new Date(start + index * 8_640_000).toISOString();
    const style =
      index < postExamples.length
        ? index === 4 || index === 5
          ? 1
          : 0
        : index % 10;
    const kind =
      style === 1
        ? 'reply'
        : style === 2
          ? 'repost'
          : style === 3
            ? 'quote'
            : 'post';
    const referencedId = String(
      910000000000000001n + BigInt(Math.max(0, index - 1)),
    );
    const replyToId = kind === 'reply' ? referencedId : null;
    const quotedId = kind === 'quote' ? referencedId : null;
    const mediaOnly = index === 60 || index === 160 || index === 260;
    const mediaCount = mediaOnly
      ? 2
      : index >= 39 && index % 11 === 0
        ? 1 + (index % 3)
        : 0;
    const long = index === 50 || index === 159 || index === 250;
    let content =
      kind === 'repost' ? `RT @moss_badger: ${sample.text}` : sample.text;
    if (mediaOnly) content = '';
    const full = long
      ? `${content}\n${
          sample.language === 'de'
            ? 'Die längere Notiz erzählt vom Lesen am Fenster, vom Regen im Garten und von einer kleinen Fahrradreparatur. '
            : 'This longer note describes reading by the window, rain in the garden and a small bicycle repair. '
        }`
          .repeat(4)
          .trimEnd()
      : content;
    const likes = index % 13 === 0 ? null : index % 7 === 0 ? 0 : index % 27;
    const reposts = index % 13 === 0 ? null : index % 7 === 0 ? 0 : index % 4;
    const item: Item = {
      id: `x:${id}`,
      platform: 'x',
      account: xAccount,
      kind,
      text: full,
      createdAt,
      mediaCount,
      engagement: { likes, reposts },
      reference: {
        replyToId,
        replyToHandle: replyToId
          ? index === 5
            ? 'cobalt_wren'
            : 'plum_gecko'
          : null,
        quotedId,
        repostOfHandle: kind === 'repost' ? 'moss_badger' : null,
        ownerHandle: null,
      },
      url: `https://x.com/i/web/status/${id}`,
      provenance: { archive: DEMO_ARCHIVES.x, file: 'data/tweets.js', index },
    };
    xItems.push(item);
    const media = Array.from({ length: mediaCount }, (_, attachment) => ({
      id_str: `${id}${attachment}`,
      type: attachment % 2 ? 'video' : 'photo',
      media_url_https: `https://example.org/invented-media/${index}-${attachment}.jpg`,
    }));
    tweets.push({
      tweet: {
        id: Number(id),
        id_str: id,
        created_at: dateString(createdAt),
        full_text: escaped(
          long ? `${content}\u2026 https://t.co/demoNote` : content,
        ),
        ...(likes === null ? {} : { favorite_count: String(likes) }),
        ...(reposts === null ? {} : { retweet_count: String(reposts) }),
        in_reply_to_status_id_str: replyToId,
        in_reply_to_screen_name: item.reference.replyToHandle,
        ...(quotedId ? { quoted_status_id_str: quotedId } : {}),
        entities: {
          urls: quotedId
            ? [
                {
                  expanded_url: `https://x.com/violet_otter/status/${quotedId}`,
                },
              ]
            : [],
          media: media.slice(0, 1),
        },
        extended_entities: { media },
      },
    });
    if (long)
      notes.push({
        noteTweet: {
          noteTweetId: `770${index}`,
          createdAt,
          core: { text: escaped(full), urls: [], mentions: [] },
        },
      });
    const assessment = suggestion(item, sample, assessments.length + 1);
    if (assessment) assessments.push(assessment);
  }
  const instagramItems: Item[] = [];
  const postRows: Row[] = [];
  const reelRows: Row[] = [];
  const occurrences = new Map<string, number>();
  for (let index = 0; index < 120; index++) {
    const sample = commentExamples[index] ?? everyday(index, 'instagram');
    languages.instagram[sample.language]++;
    const seconds = Math.floor(start / 1000) + index * 3600;
    const createdAt = new Date(seconds * 1000).toISOString();
    const owner = ['moss_badger', 'amber_moth', 'violet_otter', 'cobalt_wren'][
      index % 4
    ]!;
    // Instagram identity parts are account key, UTC instant, owner and exact
    // authored text; repeated tuples add the occurrence ordinal after one.
    const parts = [instagramAccount.key, createdAt, owner, sample.text];
    const tuple = JSON.stringify(parts);
    const ordinal = (occurrences.get(tuple) ?? 0) + 1;
    occurrences.set(tuple, ordinal);
    const id = `instagram:${await stableId(ordinal === 1 ? parts : [...parts, String(ordinal)])}`;
    const isReel = index >= 100;
    const item: Item = {
      id,
      platform: 'instagram',
      account: instagramAccount,
      kind: 'comment',
      text: sample.text,
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
      provenance: {
        archive: DEMO_ARCHIVES.instagram,
        file: `your_instagram_activity/comments/${isReel ? 'reels_comments' : 'post_comments_1'}.json`,
        index: isReel ? index - 100 : index,
      },
    };
    instagramItems.push(item);
    (isReel ? reelRows : postRows).push(row(sample.text, owner, seconds));
    const assessment = suggestion(item, sample, assessments.length + 1);
    if (assessment) assessments.push(assessment);
  }
  // A second source name is intentional: v2 keeps one current assessment per
  // (kind, name), so reusing the first name would show only its replacement.
  assessments.push({
    assessmentId: 'demo-example-060',
    itemId: xItems[0]!.id,
    submissionId: null,
    source: {
      kind: 'fixture',
      name: 'demo-examples-context',
      version: DEMO_VERSION,
    },
    category: 'embarrassing',
    risk: 1,
    reason:
      'Dieses zweite Beispiel markiert einen alten Beitrag über das Prahlen mit Partynächten.',
    evidence: 'mit jeder Partynacht geprahlt',
    confidence: null,
    createdAt: exportCreatedAt,
  });
  const xDiagnostics = [
    category('account', 'data/account.js', 1, 'Export records were read.'),
    category('manifest', 'data/manifest.js', 1, 'Export records were read.'),
    category(
      'tweets',
      'data/tweets.js',
      xItems.length,
      'Export records were read.',
    ),
    category(
      'note-tweets',
      'data/note-tweet.js',
      notes.length,
      'Export records were read.',
    ),
    category('deleted-tweets', null, 0, 'This export category is absent.'),
    category('community-tweets', null, 0, 'This export category is absent.'),
  ];
  const instagramDiagnostics = [
    {
      category: 'account',
      status: 'found' as const,
      files: [],
      count: 1,
      message: null,
    },
    category(
      'post-comments',
      'your_instagram_activity/comments/post_comments_1.json',
      postRows.length,
      null,
    ),
    category(
      'reels-comments',
      'your_instagram_activity/comments/reels_comments.json',
      reelRows.length,
      null,
    ),
  ];
  const exports: DemoExport[] = [
    {
      platform: 'x',
      archive: DEMO_ARCHIVES.x,
      files: {
        'data/account.js': accountFile('770001', 'demo_quokka'),
        'data/manifest.js': manifestFile(),
        'data/tweets.js': assignment('tweets', tweets),
        'data/note-tweet.js': assignment('note_tweet', notes),
      },
      expected: {
        status: 'ok',
        records: [
          {
            platform: 'x',
            accounts: [xAccount],
            variant: 'ytd-tweets',
            exportCreatedAt,
            itemCount: xItems.length,
            diagnostics: xDiagnostics,
          },
        ],
        items: xItems,
      },
    },
    {
      platform: 'instagram',
      archive: DEMO_ARCHIVES.instagram,
      files: Object.fromEntries(
        [post(postRows), reels(reelRows)].map(({ path, content }) => [
          path,
          content,
        ]),
      ),
      expected: {
        status: 'ok',
        records: [
          {
            platform: 'instagram',
            accounts: [instagramAccount],
            variant: 'json-current',
            exportCreatedAt: null,
            itemCount: instagramItems.length,
            diagnostics: instagramDiagnostics,
          },
        ],
        items: instagramItems,
      },
    },
  ];
  const assessed = new Set(assessments.map(({ itemId }) => itemId));
  return {
    exports,
    assessments,
    manifest: {
      format: 'socialprune-demo',
      version: DEMO_VERSION,
      kind: 'demo',
      defaultPlatform: 'x',
      createdAt: exportCreatedAt,
      sources: [
        { kind: 'fixture', name: 'demo-examples', version: DEMO_VERSION },
        {
          kind: 'fixture',
          name: 'demo-examples-context',
          version: DEMO_VERSION,
        },
      ],
      banner: {
        de: 'Demo mit erfundenen Beiträgen. Die Vorschläge sind Beispiele für diese Demo. Kein Klassifikator hat sie erzeugt.',
        en: 'Demo with invented posts. The suggestions are examples written for this demo. No classifier produced them.',
      },
      exports: exports.map(({ platform, archive, expected }) => ({
        platform,
        directory: `${platform}/${archive}`,
        archive,
        account: expected.records[0]!.accounts[0]!,
        itemCount: expected.items.length,
      })),
      languages,
      counts: {
        posts: xItems.length,
        comments: instagramItems.length,
        assessments: assessments.length,
        unclear: assessments.filter(({ category }) => category === 'unclear')
          .length,
        itemsWithoutAssessment:
          xItems.length + instagramItems.length - assessed.size,
      },
      twoAssessmentItemId: xItems[0]!.id,
    },
  };
}
function json(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}
export async function demoFiles(): Promise<Map<string, string>> {
  const demo = await createDemo();
  const files = new Map<string, string>([
    ['assessments.json', json(demo.assessments)],
    ['manifest.json', json(demo.manifest)],
  ]);
  for (const entry of demo.exports) {
    files.set(
      `${entry.platform}/variant.json`,
      json({
        id: entry.platform,
        platform: entry.platform,
        description:
          'Invented bilingual demo export with authored example suggestions, never measured classifier output.',
        archives: [entry.archive],
      }),
    );
    files.set(`${entry.platform}/expected.json`, json(entry.expected));
    for (const [path, content] of Object.entries(entry.files))
      files.set(`${entry.platform}/${entry.archive}/${path}`, content);
  }
  return new Map([...files].sort(([a], [b]) => (a < b ? -1 : 1)));
}
export async function generateDemo(root: string): Promise<void> {
  for (const [path, content] of await demoFiles()) {
    const file = join(root, 'demo', fixturePath(path));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content, 'utf8');
  }
}
export async function checkDemo(root: string): Promise<string[]> {
  const actual = await readTree(join(root, 'demo'));
  const expected = await demoFiles();
  return [...new Set([...actual.keys(), ...expected.keys()])]
    .sort()
    .filter((path) => {
      const content = expected.get(path);
      const bytes = actual.get(path);
      return (
        content === undefined ||
        !bytes ||
        !Buffer.from(bytes).equals(Buffer.from(content))
      );
    })
    .map((path) => `demo/${path}`);
}

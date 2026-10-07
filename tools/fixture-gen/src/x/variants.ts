import type { Account, Diagnostic, Item } from '@socialprune/core';
import type { Variant } from '../shared/index.ts';
import {
  accountFile,
  assignment,
  exportCreatedAt,
  manifestFile,
} from './large.ts';

// This oracle starts from authored canonical values and serializes the export
// separately. It neither imports nor calls the X adapter.
const defaultAccount: Account = { key: 'x:700001', handle: 'orbit_quokka' };
const defaultDate = '2018-10-10T20:19:24.000Z';
type Category =
  | 'account'
  | 'manifest'
  | 'tweets'
  | 'note-tweets'
  | 'deleted-tweets'
  | 'community-tweets';
const categoryOrder: Category[] = [
  'account',
  'manifest',
  'tweets',
  'note-tweets',
  'deleted-tweets',
  'community-tweets',
];

interface PostOptions {
  kind?: Item['kind'];
  rawText?: string;
  fullText?: string;
  createdAt?: string;
  rawDate?: string;
  likes?: number | null;
  reposts?: number | null;
  mediaCount?: number | null;
  replyToId?: string | null;
  replyToHandle?: string | null;
  quotedId?: string | null;
  repostOfHandle?: string | null;
  source?: Record<string, unknown>;
}
interface Post {
  raw: Record<string, unknown>;
  canonical: Omit<Item, 'account' | 'provenance'>;
}
function exportDate(iso: string): string {
  const date = new Date(iso);
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getUTCDay()]} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getUTCMonth()]} ${String(date.getUTCDate()).padStart(2, '0')} ${iso.slice(11, 19)} +0000 ${date.getUTCFullYear()}`;
}
function post(id: string, value: string, opts: PostOptions = {}): Post {
  const date = opts.createdAt ?? defaultDate;
  const likes = opts.likes === undefined ? 3 : opts.likes;
  const reposts = opts.reposts === undefined ? 1 : opts.reposts;
  return {
    raw: {
      id: Number(id),
      id_str: id,
      created_at: opts.rawDate ?? exportDate(date),
      full_text: opts.rawText ?? value,
      ...(likes === null ? {} : { favorite_count: String(likes) }),
      ...(reposts === null ? {} : { retweet_count: String(reposts) }),
      ...(opts.replyToId
        ? {
            in_reply_to_status_id_str: opts.replyToId,
            in_reply_to_screen_name: opts.replyToHandle ?? null,
          }
        : {}),
      ...opts.source,
    },
    canonical: {
      id: `x:${id}`,
      platform: 'x',
      kind: opts.kind ?? 'post',
      text: opts.fullText ?? value,
      createdAt: date,
      mediaCount: opts.mediaCount ?? null,
      engagement: { likes, reposts },
      reference: {
        replyToId: opts.replyToId ?? null,
        replyToHandle: opts.replyToHandle ?? null,
        quotedId: opts.quotedId ?? null,
        repostOfHandle: opts.repostOfHandle ?? null,
        ownerHandle: null,
      },
      url: `https://x.com/i/web/status/${id}`,
    },
  };
}
interface CategoryFile {
  category: Category;
  path: string;
  count: number;
  status: 'found' | 'empty' | 'unreadable';
}
interface Export {
  name: string;
  account: Account;
  date: string | null;
  files: Record<string, string>;
  categories: CategoryFile[];
  items: Item[];
}
interface ExportOptions {
  name?: string;
  root?: string;
  accountId?: string;
  handle?: string;
  account?: 'missing' | 'empty' | 'unreadable';
  manifest?: 'missing' | 'unreadable';
  date?: string;
}
function archive(opts: ExportOptions = {}): Export {
  const name = opts.name ?? 'archive';
  const root = opts.root ?? '';
  const account: Account = opts.account
    ? { key: `x:archive:${name}${root ? `:${root}` : ''}`, handle: null }
    : {
        key: `x:${opts.accountId ?? '700001'}`,
        handle: opts.handle ?? 'orbit_quokka',
      };
  const result: Export = {
    name,
    account,
    date: opts.manifest ? null : (opts.date ?? exportCreatedAt),
    files: {},
    categories: [],
    items: [],
  };
  if (opts.account !== 'missing') {
    const path = root + 'data/account.js';
    result.files[path] =
      opts.account === 'empty'
        ? assignment('account', [])
        : opts.account === 'unreadable'
          ? assignment('account', [
              { account: { email: 'never-export-account@example.com' } },
            ])
          : accountFile(opts.accountId, opts.handle);
    result.categories.push({
      category: 'account',
      path,
      count: opts.account ? 0 : 1,
      status:
        opts.account === 'unreadable'
          ? 'unreadable'
          : opts.account === 'empty'
            ? 'empty'
            : 'found',
    });
  }
  if (opts.manifest !== 'missing') {
    const path = root + 'data/manifest.js';
    result.files[path] =
      opts.manifest === 'unreadable'
        ? 'window.__THAR_CONFIG = {"archiveInfo":{"generationDate":"not-a-date"}};\n'
        : manifestFile(result.date!);
    result.categories.push({
      category: 'manifest',
      path,
      count: opts.manifest ? 0 : 1,
      status: opts.manifest ? 'unreadable' : 'found',
    });
  }
  return result;
}
function addPosts(
  output: Export,
  posts: Post[],
  options: {
    root?: string;
    name?: string;
    part?: number;
    flat?: boolean;
    content?: string;
    count?: number;
    failed?: boolean;
    category?: Category;
  } = {},
): void {
  const name = options.name ?? 'tweets';
  const part = options.part ?? 0;
  const path = `${options.root ?? ''}data/${name}${part ? `-part${part}` : ''}.js`;
  output.files[path] =
    options.content ??
    assignment(
      name.replaceAll('-', '_'),
      posts.map(({ raw }) => (options.flat ? raw : { tweet: raw })),
      part,
    );
  const count = options.count ?? posts.length;
  output.categories.push({
    category: options.category ?? 'tweets',
    path,
    count,
    status: options.failed ? 'unreadable' : count ? 'found' : 'empty',
  });
  output.items.push(
    ...posts.map(({ canonical }, index) => ({
      ...canonical,
      account: output.account,
      provenance: { archive: output.name, file: path, index },
    })),
  );
}
function addArray(
  output: Export,
  name: string,
  values: unknown[],
  category: Category,
  options: { content?: string; failed?: boolean; count?: number } = {},
): void {
  const path = `data/${name}.js`;
  output.files[path] =
    options.content ?? assignment(name.replaceAll('-', '_'), values);
  const count = options.count ?? values.length;
  output.categories.push({
    category,
    path,
    count,
    status: options.failed ? 'unreadable' : count ? 'found' : 'empty',
  });
}
function diagnostics(exports: Export[]): Diagnostic[] {
  return categoryOrder.map((category) => {
    const files = exports.flatMap((output) =>
      output.categories.filter((file) => file.category === category),
    );
    const count = files.reduce((sum, file) => sum + file.count, 0);
    const status = files.some((file) => file.status === 'unreadable')
      ? 'unreadable'
      : !files.length
        ? 'missing'
        : count
          ? 'found'
          : 'empty';
    return {
      category,
      status,
      files: files.map((file) => file.path),
      count,
      message:
        status === 'unreadable'
          ? 'Some files or records could not be parsed.'
          : status === 'missing'
            ? 'This export category is absent.'
            : status === 'empty'
              ? 'This export category contains no records.'
              : category === 'deleted-tweets'
                ? 'Already deleted posts were counted and were not imported.'
                : 'Export records were read.',
    };
  });
}
function variant(
  id: string,
  description: string,
  exports: Export[],
  options: { variant?: string; extra?: Diagnostic[] } = {},
): Variant {
  const allDiagnostics = [...diagnostics(exports), ...(options.extra ?? [])];
  const items = exports.flatMap((output) => output.items);
  const accounts = [
    ...new Map(
      exports.map((output) => [output.account.key, output.account]),
    ).values(),
  ];
  return {
    id,
    platform: 'x',
    description,
    archives: exports.map(({ name, files }) => ({ name, files })),
    expected: {
      status: allDiagnostics.some(
        (diagnostic) => diagnostic.status === 'unreadable',
      )
        ? 'partial'
        : 'ok',
      records: [
        {
          platform: 'x',
          accounts,
          variant: options.variant ?? 'ytd-tweets',
          exportCreatedAt:
            exports
              .flatMap(({ date }) => (date ? [date] : []))
              .sort()
              .at(-1) ?? null,
          itemCount: new Set(items.map((item) => item.id)).size,
          diagnostics: allDiagnostics,
        },
      ],
      items,
    },
  };
}
function note(id: string, date: string, value: string): unknown {
  return {
    noteTweet: {
      noteTweetId: id,
      createdAt: date,
      core: { text: value, urls: [], mentions: [] },
    },
  };
}
const output: Variant[] = [];
const minimal = archive();
addPosts(minimal, [post('9007199254740993', 'An invented lantern garden.')]);
output.push(
  variant(
    'current-minimal',
    'Current wrapped tweets.js, account username/ID only, UTC date, string counts and rounded numeric id ignored. Manifest archiveInfo.generationDate is sourced from twitter-archive-reader GDPRManifest; S4 checks the current shape.',
    [minimal],
  ),
);

const rich = archive();
addPosts(rich, [
  post('9007199254740995', 'A <b>lantern</b> & "moss" \'星\' 😀\nfrüh &amp;', {
    mediaCount: 2,
    source: {
      extended_entities: {
        media: [
          { id_str: '7001', type: 'photo' },
          { id_str: '7002', type: 'video' },
        ],
      },
      entities: { media: [{ id_str: '7001' }] },
    },
    rawText:
      'A &lt;b&gt;lantern&lt;/b&gt; &amp; &quot;moss&quot; &#39;&#x661F;&#39; &#128512;\nfrüh &amp;amp;',
  }),
  post('9007199254740997', '@amber_moth invented reply', {
    mediaCount: 1,
    source: { entities: { media: [{ id_str: '7003', type: 'photo' }] } },
    kind: 'reply',
    replyToId: '600001',
    replyToHandle: 'amber_moth',
  }),
  post('9007199254740999', 'RT @moss_badger: invented repost', {
    mediaCount: 0,
    source: { extended_entities: { media: [] } },
    kind: 'repost',
    repostOfHandle: 'moss_badger',
  }),
  post('9007199254741001', 'An explicit quote https://t.co/quote', {
    kind: 'quote',
    quotedId: '600003',
    source: { quoted_status_id_str: '600003' },
  }),
  post('9007199254741003', 'An archive quote https://t.co/invented', {
    kind: 'quote',
    quotedId: '600004',
    source: {
      entities: {
        urls: [
          {
            url: 'https://t.co/invented',
            expanded_url:
              'https://twitter.com/violet_otter/status/600004?synthetic=1',
            display_url: 'twitter.com/violet_otter/status/600004',
          },
        ],
      },
    },
  }),
  post('9007199254741005', 'Counts omitted, text and whitespace stay.  \n', {
    likes: null,
    reposts: null,
    source: {
      entities: { urls: [{ expanded_url: 'https://example.org/ordinary' }] },
    },
  }),
  post('9007199254741007', '@amber_moth replying with a quote', {
    kind: 'reply',
    replyToId: '600005',
    replyToHandle: 'amber_moth',
    quotedId: '600006',
    source: { quoted_status_id_str: '600006' },
  }),
]);
output.push(
  variant(
    'current-rich',
    'Reply/repost/quote precedence, explicit quote ID and status-URL heuristic, entities, Unicode, single-pass HTML decoding, whitespace and missing counts. Status links imply quotes only as an assumption for S4; a linked post is not always a quote.',
    [rich],
  ),
);

const root = 'twitter-2026-10-01-ab12cd/';
const nested = archive({ root });
addPosts(
  nested,
  [post('9007199254741101', 'A post in a top-level export folder.')],
  { root },
);
output.push(
  variant(
    'top-level-folder',
    'ZIP and directory entry paths with a single top-level export folder keep provenance and locate account/manifest siblings. Folder spelling is invented.',
    [nested],
  ),
);

const split = archive();
addPosts(split, [post('9007199254741200', 'Part zero comes first.')]);
addPosts(split, [post('9007199254741201', 'Part one comes second.')], {
  part: 1,
});
addPosts(split, [post('9007199254741202', 'Part two comes third.')], {
  part: 2,
});
addPosts(
  split,
  [post('9007199254741210', 'Part ten sorts numerically, not lexically.')],
  { part: 10 },
);
output.push(
  variant(
    'split-parts',
    'tweets.js part0 plus parts 1, 2 and 10 are streamed in numeric order and retain per-file indexes. The split filename shape is sourced from twitter-archive-reader Files_to_structures.',
    [split],
  ),
);

const long = archive();
const longText =
  'A unique lantern note. ' + 'Invented full text from the garden. '.repeat(12);
addPosts(long, [
  post('9007199254741300', 'A unique lantern note\u2026 https://t.co/note', {
    fullText: longText,
  }),
  post('9007199254741301', 'Ambiguous moss\u2026', {
    createdAt: '2018-10-10T20:20:24.000Z',
  }),
  post('9007199254741302', 'Two identical starts\u2026', {
    createdAt: '2018-10-10T20:21:24.000Z',
  }),
  post('9007199254741303', 'Two identical starts\u2026', {
    createdAt: '2018-10-10T20:21:24.000Z',
  }),
]);
addArray(
  long,
  'note-tweet',
  [
    note('5001', '2018-10-10T20:19:24.345Z', longText),
    note(
      '5002',
      '2018-10-10T20:20:24.000Z',
      'Ambiguous moss first complete version.',
    ),
    note(
      '5003',
      '2018-10-10T20:20:24.000Z',
      'Ambiguous moss second complete version.',
    ),
    note('5004', '2018-10-10T20:22:24.000Z', 'Unmatched invented note text.'),
    note(
      '5005',
      '2018-10-10T20:21:24.000Z',
      'Two identical starts and one complete note.',
    ),
  ],
  'note-tweets',
);
output.push(
  variant(
    'note-tweets',
    'One unique timestamp-second/text-prefix match restores full text; one-to-many and many-to-one ambiguity preserves original text and unmatched notes only produce counts. Same-second matching, terminal ellipsis/t.co stripping and note schema are assumptions for S4; timestamp linkage has public exporter precedent.',
    [long],
    {
      extra: [
        {
          category: 'unmatched-note-tweets',
          status: 'skipped',
          files: ['data/note-tweet.js'],
          count: 4,
          message:
            'Notes without a unique timestamp and text-prefix match were not imported separately.',
        },
        {
          category: 'ambiguous-note-tweets',
          status: 'skipped',
          files: ['data/note-tweet.js'],
          count: 3,
          message:
            'Ambiguous note matches left the original post text unchanged.',
        },
      ],
    },
  ),
);

const deleted = archive();
addPosts(deleted, [post('9007199254741400', 'Still present invented post.')]);
addArray(
  deleted,
  'deleted-tweets',
  [
    post('9007199254741401', 'Already deleted one.').raw,
    post('9007199254741402', 'Already deleted two.').raw,
  ].map((tweet) => ({ tweet })),
  'deleted-tweets',
);
output.push(
  variant(
    'deleted-tweets',
    'Already deleted posts are counted but never become items; the deleted_tweets wrapper shape follows the task and needs S4 confirmation.',
    [deleted],
  ),
);

const community = archive();
addPosts(community, [post('9007199254741500', 'A regular invented post.')]);
addPosts(
  community,
  [
    post('9007199254741501', 'An invented community post.'),
    post('9007199254741502', 'RT @violet_otter: invented community repost', {
      kind: 'repost',
      repostOfHandle: 'violet_otter',
    }),
  ],
  { name: 'community-tweet', category: 'community-tweets' },
);
output.push(
  variant(
    'community-tweets',
    'Community posts use the regular wrapped tweet mapping and deletion hints. community_tweet as the same tweet shape is task-provided, not verified against a real archive yet.',
    [community],
  ),
);

for (const flat of [false, true]) {
  const old = archive();
  addPosts(
    old,
    [
      post(
        flat ? '9007199254741601' : '9007199254741600',
        flat ? 'An older flat tweet.' : 'An older wrapped tweet.',
      ),
    ],
    { name: 'tweet', flat },
  );
  output.push(
    variant(
      flat ? 'old-unwrapped' : 'old-wrapped',
      `Historical data/tweet.js with ${flat ? 'flat' : 'tweet-wrapped'} elements. S4 checks the precise historical schema; id_str remains authoritative.`,
      [old],
      { variant: flat ? 'ytd-tweet-unwrapped' : 'ytd-tweet' },
    ),
  );
}

const grailbird: Export = {
  name: 'archive',
  account: defaultAccount,
  date: null,
  categories: [],
  files: {},
  items: [],
};
grailbird.files['data/js/user_details.js'] =
  `var user_details = ${JSON.stringify({ id: '700001', screen_name: 'orbit_quokka', full_name: 'Invented Orbit', bio: 'Invented bio, never imported', location: 'Invented place' }, null, 2)};\n`;
grailbird.categories.push({
  category: 'account',
  path: 'data/js/user_details.js',
  count: 1,
  status: 'found',
});
const classic = post('9007199254741700', 'An invented classic tweet.', {
  createdAt: '2013-01-15T10:00:00.000Z',
  rawDate: '2013-01-15 10:00:00 +0000',
  likes: null,
  reposts: null,
});
delete classic.raw.full_text;
classic.raw.text = classic.canonical.text;
classic.raw.user = {
  id_str: '700001',
  screen_name: 'orbit_quokka',
  name: 'Invented Orbit',
};
const classicPath = 'data/js/tweets/2013_01.js';
grailbird.files[classicPath] =
  `${['Grailbird', 'data', 'tweets_2013_01'].join('.')} = ${JSON.stringify([classic.raw], null, 2)};\n`;
grailbird.categories.push({
  category: 'tweets',
  path: classicPath,
  count: 1,
  status: 'found',
});
grailbird.items.push({
  ...classic.canonical,
  account: defaultAccount,
  provenance: { archive: 'archive', file: classicPath, index: 0 },
});
output.push(
  variant(
    'grailbird',
    'Monthly flat Grailbird tweets, text field, classic date and var user_details object. Paths and fields are sourced from twitter-archive-reader ClassicTweets and Files_to_structures; S4 checks the assignment spelling. Numeric tweet IDs are never used.',
    [grailbird],
    { variant: 'grailbird' },
  ),
);

const optional = archive({ manifest: 'missing' });
addPosts(optional, [
  post('9007199254741800', 'All optional export categories are absent.'),
]);
output.push(
  variant(
    'missing-optional-files',
    'Absent manifest, notes, deleted posts and communities have missing diagnostics, not empty or unreadable; no generation timestamp is invented.',
    [optional],
  ),
);
const absentAccount = archive({ account: 'missing', manifest: 'missing' });
addPosts(absentAccount, [
  post('9007199254741801', 'Account metadata is absent.'),
]);
output.push(
  variant(
    'missing-account',
    'Absent account.js leaves a deterministic archive-scoped account key with null handle and a missing diagnostic. This fallback is an implementation choice, not a platform field.',
    [absentAccount],
  ),
);

const empty = archive();
addPosts(empty, []);
output.push(
  variant(
    'empty-tweets',
    'A valid assigned empty tweet array stays empty rather than missing or unreadable; account metadata is still imported.',
    [empty],
  ),
);
const allEmpty = archive({ account: 'empty' });
addPosts(allEmpty, []);
addArray(allEmpty, 'note-tweet', [], 'note-tweets');
addArray(allEmpty, 'deleted-tweets', [], 'deleted-tweets');
addPosts(allEmpty, [], {
  name: 'community-tweet',
  category: 'community-tweets',
});
output.push(
  variant(
    'empty-categories',
    'Empty account, tweets, notes, deleted and community arrays stay distinct from missing; empty account uses the archive-scoped fallback.',
    [allEmpty],
  ),
);

const malformed = archive();
addPosts(
  malformed,
  [post('9007199254741900', 'A valid prefix record survives.')],
  {
    content: assignment('tweets', [
      {
        tweet: post('9007199254741900', 'A valid prefix record survives.').raw,
      },
    ]).replace('];\n', ', {"tweet":invalid}];\n'),
    failed: true,
  },
);
addPosts(
  malformed,
  [post('9007199254741901', 'Another category still imports.')],
  { name: 'community-tweet', category: 'community-tweets' },
);
output.push(
  variant(
    'malformed-tweets',
    'Malformed JSON after a valid record gives partial import, preserves the streamed prefix record and continues with community posts. Counts describe consumed records, not an invented total.',
    [malformed],
  ),
);

const injection = archive();
addPosts(injection, [], {
  content: `${['window', 'YTD', 'tweets', 'part0'].join('.')} = (function(){globalThis.__pwned = 1})() || ${JSON.stringify([{ tweet: post('9007199254742000', 'Injection text must not import.').raw }])};\n`,
  failed: true,
});
output.push(
  variant(
    'injection',
    'An executable assignment value is rejected as unreadable before any item is yielded, giving partial import without executing archive text. This adversarial payload is entirely invented.',
    [injection],
  ),
);

const multiA = archive({
  name: 'archive-a',
  accountId: '700011',
  handle: 'cobalt_wren',
  date: '2026-10-01T12:00:00.000Z',
});
const multiB = archive({
  name: 'archive-b',
  accountId: '700012',
  handle: 'plum_gecko',
  date: '2026-10-02T12:00:00.000Z',
});
addPosts(multiA, [post('9007199254742100', 'Account A invented post.')]);
addPosts(multiB, [post('9007199254742101', 'Account B invented post.')]);
output.push(
  variant(
    'two-accounts',
    'Two archives keep distinct account keys and handles per item; core produces one platform import record and its generation timestamp is the newest manifest date. This record-date aggregation is an implementation choice.',
    [multiA, multiB],
  ),
);

const privateFiles = archive();
addPosts(privateFiles, [
  post('9007199254742200', 'Only the public invented post imports.'),
]);
for (const path of [
  'direct-messages.js',
  'direct-message-part1.js',
  'direct-messages-group.js',
  'login.js',
  'ip-audit.js',
  'contact.js',
  'device-token.js',
  'security.js',
])
  privateFiles.files[`data/${path}`] = JSON.stringify({
    planted: `NEVER_OPEN_${path}`,
    email: 'never-open@example.com',
    text: 'Invented private payload never appears in adapter output.',
  });
output.push(
  variant(
    'private-files-ignored',
    'Direct-message, login, IP, contacts, device and security files are present but never read or emitted. Account email/display name are not emitted either; all planted values are invented.',
    [privateFiles],
  ),
);

const broken = archive({ account: 'unreadable', manifest: 'unreadable' });
addPosts(broken, [
  post('9007199254742300', 'Metadata failures do not discard valid posts.'),
]);
addArray(broken, 'note-tweet', [], 'note-tweets', {
  content: assignment('note_tweet', []).replace('[]', '[broken]'),
  failed: true,
});
addArray(broken, 'deleted-tweets', [], 'deleted-tweets', {
  content: assignment('deleted_tweets', []).replace('[]', '[broken]'),
  failed: true,
});
addPosts(broken, [], {
  name: 'community-tweet',
  category: 'community-tweets',
  content: assignment('community_tweet', []).replace('[]', '[broken]'),
  failed: true,
});
output.push(
  variant(
    'unreadable-optional-files',
    'Invalid account, manifest, notes, deleted and community data produce unreadable diagnostics independently; valid tweets still import with the scoped fallback account.',
    [broken],
  ),
);

const invalid = archive();
const valid = post('9007199254742400', 'The only valid tweet imports.');
addPosts(invalid, [valid], {
  count: 4,
  failed: true,
  content: assignment('tweets', [
    { tweet: valid.raw },
    { tweet: { ...valid.raw, id_str: undefined, id: 123 } },
    {
      tweet: {
        ...valid.raw,
        id_str: '9007199254742401',
        created_at: 'Fri Feb 30 10:00:00 +0000 2024',
      },
    },
    { tweet: { ...valid.raw, id_str: '9007199254742402', full_text: 123 } },
  ]),
});
output.push(
  variant(
    'invalid-records',
    'Missing id_str, impossible date and nonstring text are unreadable records, not coerced items; valid neighbors still import and category count includes all consumed elements.',
    [invalid],
  ),
);

const wrong = archive();
addPosts(wrong, [], {
  content: assignment('likes', [
    {
      tweet: post('9007199254742500', 'A wrong assignment cannot import.').raw,
    },
  ]),
  failed: true,
});
output.push(
  variant(
    'wrong-assignment',
    'A known filename assigned to an unrelated global is rejected before item emission. Strict target matching does not execute or treat arbitrary archive arrays as tweets.',
    [wrong],
  ),
);

output.push({
  id: 'no-match',
  platform: 'x',
  description:
    'An invented unrelated JSON export has no recognized X data paths and remains unknown-format without content reads.',
  archives: [
    {
      name: 'archive',
      files: { 'unrelated.json': '{"invented":"not an X export"}\n' },
    },
  ],
  expected: { status: 'unknown-format', records: [], items: [] },
});
export const variants: Variant[] = output;

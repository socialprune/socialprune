import { expect, test } from 'vitest';
import { extract } from './extract.ts';
import { errorStop } from './report.ts';
import * as reports from './report.ts';
import { CliError, CLI_ERRORS } from '../../../cli/errors.ts';
import {
  TEST_PORTS,
  TEST_ORIGINS,
} from '../../../../playwright.ports.config.ts';

test('R11 browser suite ports are validated Node-runner inputs shared by all consumers', () => {
  for (const port of Object.values(TEST_PORTS))
    expect(Number.isInteger(port) && port > 0 && port <= 65535).toBe(true);
  expect(TEST_ORIGINS.x).toBe(`http://127.0.0.1:${TEST_PORTS.x}`);
  expect(TEST_ORIGINS.confirmation).toBe(
    `http://127.0.0.1:${TEST_PORTS.confirmation}`,
  );
});
import {
  detailAnswer,
  detailPost,
  DETAIL_FIXTURE,
} from '../../../originals/test/detail.ts';

// Generated values in the parent-scoped path layout: direct itemContent plus
// content.items[].item.itemContent, note_tweet flags and core author fields.
test('real-path mixed conversation shape accepts cursors and module items but projects only the focal post and its parent chain', () => {
  const parent = {
      ...detailPost('909'),
      legacy: { ...detailPost('909').legacy, in_reply_to_status_id_str: '908' },
    },
    root = detailPost('908'),
    focal = {
      ...detailPost(),
      legacy: { ...detailPost().legacy, in_reply_to_status_id_str: '909' },
      note_tweet: {
        is_expandable: true,
        note_tweet_results: {
          result: {
            id: 'generated-note',
            text: DETAIL_FIXTURE.longText,
            entity_set: { urls: [], hashtags: [], symbols: [] },
            richtext: { richtext_tags: [] },
          },
        },
      },
    };
  const answer = detailAnswer(focal) as {
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: { type: string; entries: unknown[] }[];
      };
    };
  };
  answer.data.threaded_conversation_with_injections_v2.instructions[0]!.entries.unshift(
    {
      entryId: 'cursor-top-generated',
      content: { entryType: 'TimelineTimelineCursor', cursorType: 'Top' },
    },
    {
      entryId: 'conversationthread-generated',
      content: {
        items: [
          {
            entryId: 'generated-root',
            item: { itemContent: { tweet_results: { result: root } } },
          },
          {
            entryId: 'generated-parent',
            item: { itemContent: { tweet_results: { result: parent } } },
          },
          {
            entryId: 'generated-unrelated',
            item: {
              itemContent: { tweet_results: { result: detailPost('907') } },
            },
          },
        ],
      },
    },
  );
  const result = extract(answer, DETAIL_FIXTURE.id, { instruction: null });
  expect(result.kind).toBe('read');
  if (result.kind !== 'read') throw new Error('not read');
  expect(result.post.text).toBe(DETAIL_FIXTURE.longText);
  expect(result.above.map((post) => post.id)).toEqual(['908', '909']);
  expect(JSON.stringify(result)).not.toContain('907');
});
test('a non-expandable note wrapper without text does not label complete legacy text as truncated', () => {
  const focal = {
    ...detailPost(),
    note_tweet: {
      is_expandable: false,
      note_tweet_results: {
        result: { id: 'generated-note', entity_set: {}, richtext: {} },
      },
    },
  };
  expect(
    extract(detailAnswer(focal), DETAIL_FIXTURE.id, { instruction: null }),
  ).toMatchObject({
    kind: 'read',
    post: { text: DETAIL_FIXTURE.text, textCompleteness: 'full' },
  });
});
test('known module result with absent user fields does not block a complete focal projection and makes a referenced chain partial', () => {
  const focal = {
      ...detailPost(),
      legacy: { ...detailPost().legacy, in_reply_to_status_id_str: '909' },
    },
    partial = { ...detailPost('909'), core: { user_results: {} } };
  const answer = detailAnswer(focal) as {
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: { type: string; entries: unknown[] }[];
      };
    };
  };
  answer.data.threaded_conversation_with_injections_v2.instructions[0]!.entries.unshift(
    {
      entryId: 'conversation-generated',
      content: {
        items: [
          {
            entryId: 'generated-parent',
            item: { itemContent: { tweet_results: { result: partial } } },
          },
        ],
      },
    },
  );
  expect(
    extract(answer, DETAIL_FIXTURE.id, { instruction: null }),
  ).toMatchObject({ kind: 'read', above: [], chainAbove: 'partial' });
});
test('module fields from the observed path table without rest_id or expanded user stay out of projection rather than rejecting the complete focal answer', () => {
  const focal = {
      ...detailPost(),
      legacy: { ...detailPost().legacy, in_reply_to_status_id_str: '909' },
    },
    module = {
      __typename: 'Tweet',
      core: { user_results: {} },
      legacy: {
        full_text: 'Generated incomplete module',
        in_reply_to_status_id_str: '908',
      },
      note_tweet: {
        is_expandable: true,
        note_tweet_results: {
          result: { id: 'generated-module-note', entity_set: {}, richtext: {} },
        },
      },
    };
  const answer = detailAnswer(focal) as {
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: { type: string; entries: unknown[] }[];
      };
    };
  };
  answer.data.threaded_conversation_with_injections_v2.instructions[0]!.entries.unshift(
    {
      entryId: 'conversation-generated',
      content: {
        items: [
          {
            entryId: 'generated-module-entry',
            item: { itemContent: { tweet_results: { result: module } } },
          },
        ],
      },
    },
  );
  const value = extract(answer, DETAIL_FIXTURE.id, { instruction: null });
  expect(value).toMatchObject({
    kind: 'read',
    above: [],
    chainAbove: 'partial',
  });
  expect(JSON.stringify(value)).not.toContain('Generated incomplete module');
});

test('R3 every CliError produces its exact closed code without exception values', () => {
  for (const code of Object.keys(CLI_ERRORS) as (keyof typeof CLI_ERRORS)[]) {
    const error = new CliError(
      code,
      'generated-version',
      undefined,
      'render-timeout',
    );
    expect(errorStop(error)).toEqual({
      code,
      ...(code === 'PLATFORM_CHECK' ? { reason: 'render-timeout' } : {}),
    });
  }
  expect(
    errorStop(
      new CliError(
        'PLATFORM_CHECK',
        undefined,
        undefined,
        'generated private value',
      ),
    ),
  ).toEqual({ code: 'PLATFORM_CHECK', reason: 'unspecified' });
});

test('R3 non-CLI stops use only exact internal identities, exact filesystem codes, or closed exception classes', () => {
  for (const [message, code] of [
    ['MEDIA_ORIGIN', 'media-origin'],
    ['MEDIA_FORMAT', 'media-format'],
    ['MEDIA_EXISTS', 'media-exists'],
    ['ORIGINAL_PATH', 'original-path'],
  ] as const)
    expect(errorStop(new Error(message))).toEqual({ code });
  for (const code of [
    'EEXIST',
    'ENOSPC',
    'EACCES',
    'EPERM',
    'ENOENT',
    'EBUSY',
  ] as const)
    expect(
      errorStop(
        Object.assign(new Error('Generated private message with a path'), {
          code,
          path: 'generated/private',
          syscall: 'generated',
        }),
      ),
    ).toEqual({ code: `fs-${code}` });
  expect(errorStop(new TypeError('Generated private type details'))).toEqual({
    code: 'type-error',
  });
  for (const value of [
    new Error('MEDIA_ORIGIN suffix'),
    new Error('prefix MEDIA_FORMAT'),
    new Error('https://example.org/generated-private'),
    'MEDIA_ORIGIN',
    { code: 'CANARY_MISMATCH' },
    { code: 'EACCES-extra' },
    { message: 'MEDIA_EXISTS' },
    null,
    undefined,
    123,
    new Error('Generated unknown error'),
  ])
    expect(errorStop(value)).toEqual({ code: 'other' });
});

test('R9 response windows keep value-free per-operation minima and gate short and long reset distances', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  const windows = new reports.XResponseWindows();
  const headers = (remaining: number, seconds: number) => ({
    'x-rate-limit-limit': '50',
    'x-rate-limit-remaining': String(remaining),
    'x-rate-limit-reset': String(now / 1000 + seconds),
  });
  windows.observe(
    'https://x.com/i/api/graphql/generated/TweetDetail',
    headers(24, 900),
    now,
  );
  expect(windows.beforePage(now)).toEqual({
    kind: 'wait',
    ms: 905000,
    minutes: 16,
  });
  windows.observe(
    'https://api.x.com/i/api/graphql/generated/UserTweets',
    headers(20, 2000),
    now,
  );
  expect(windows.beforePage(now)).toEqual({ kind: 'long' });
  expect(windows.summary()).toEqual([
    {
      operation: 'TweetDetail',
      limit: 50,
      lowestRemaining: 24,
      responses: 1,
      longestResetSeconds: 900,
    },
    {
      operation: 'UserTweets',
      limit: 50,
      lowestRemaining: 20,
      responses: 1,
      longestResetSeconds: 2000,
    },
  ]);
  expect(windows.beforePage(now + 2001000)).toEqual({ kind: 'ready' });
  const empty = new reports.XResponseWindows();
  empty.observe(
    'https://example.org/i/api/graphql/generated/TweetDetail',
    headers(0, 900),
    now,
  );
  empty.observe('https://x.com/i/api/graphql/generated/TweetDetail', {}, now);
  expect(empty.summary()).toEqual([]);
  expect(empty.beforePage(now)).toEqual({ kind: 'ready' });
});

test('R9 window observations use the latest remaining threshold, aggregate reset distances and reject value-like operation paths', () => {
  const now = 0,
    windows = new reports.XResponseWindows();
  const h = (remaining: number, reset: number) => ({
    'x-rate-limit-limit': '50',
    'x-rate-limit-remaining': String(remaining),
    'x-rate-limit-reset': String(reset),
  });
  windows.observe(
    'https://x.com/i/api/graphql/generated/Read_Operation',
    h(25, 960),
    now,
  );
  expect(windows.beforePage(now)).toEqual({ kind: 'ready' });
  windows.observe(
    'https://api.x.com/i/api/graphql/second/Read_Operation',
    h(24, 960),
    now,
  );
  expect(windows.beforePage(now)).toEqual({
    kind: 'wait',
    ms: 965000,
    minutes: 17,
  });
  windows.observe(
    'https://x.com/i/api/graphql/generated/Read_Operation',
    h(30, 2000),
    now,
  );
  expect(windows.beforePage(now)).toEqual({ kind: 'ready' });
  windows.observe(
    'https://x.com/i/api/graphql/generated/Read_Operation',
    h(20, 961),
    now,
  );
  expect(windows.beforePage(now)).toEqual({ kind: 'long' });
  expect(windows.summary()[0]).toEqual({
    operation: 'Read_Operation',
    limit: 50,
    lowestRemaining: 20,
    responses: 4,
    longestResetSeconds: 2000,
  });
  windows.observe(
    'https://x.com/i/api/graphql/generated/Bad-Value-123',
    h(24, 500),
    now,
  );
  expect(windows.summary()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ operation: 'graphql-other' }),
    ]),
  );
  for (const url of [
    'http://x.com/i/api/graphql/g/Op',
    'https://x.com.evil.example/i/api/graphql/g/Op',
    'https://u@x.com/i/api/graphql/g/Op',
  ])
    windows.observe(url, h(0, 500), now);
  for (const headers of [
    { ...h(20, 500), 'x-rate-limit-limit': '0' },
    { ...h(20, 500), 'x-rate-limit-remaining': '-1' },
    { ...h(20, 500), 'x-rate-limit-reset': 'not a number' },
  ])
    windows.observe('https://x.com/i/api/graphql/g/Invalid', headers, now);
  expect(windows.summary().map((window) => window.operation)).not.toContain(
    'Invalid',
  );
});

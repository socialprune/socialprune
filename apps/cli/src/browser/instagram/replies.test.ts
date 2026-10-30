import { expect, test, vi } from 'vitest';
import type { Page } from 'playwright-core';
import { commentReplies, captureRepliesForMode } from './replies.ts';
import * as selectors from './selectors.ts';
import { checkedReplyRows } from './replies-answer.ts';

const match = {
  id: '123',
  createdAt: '2025-01-02T12:00:00.000Z',
  username: 'generated_person',
  text: 'Generated own comment',
};
test('REPLIES revision F1 answers are focal-bound, conflicting rows refuse, bounded counts are retained and answer text wins', () => {
  const reply = {
    pk: '456',
    created_at: Date.parse(match.createdAt) / 1000,
    user: { username: 'generated_reply' },
    text: '  Cafe\u0301\n  second line  ',
    comment_like_count: 7,
  };
  const focal = {
    pk: match.id,
    user: { username: match.username },
    text: match.text,
    created_at: Date.parse(match.createdAt) / 1000,
    child_comment_count: 3,
    preview_child_comments: [reply],
  };
  const row = {
    id: '456',
    account: 'generated_reply',
    text: 'Café second line',
    createdAt: match.createdAt,
    likes: { count: 99, source: 'dom' as const },
  };
  expect(checkedReplyRows([focal], match, [row], false, 0)).toEqual({
    reason: 'reply-answer-incomplete',
  });
  expect(checkedReplyRows([focal], match, [row], true, 0)).toEqual({
    answerChecked: true,
    observation: {
      entries: [
        {
          account: 'generated_reply',
          text: 'Café\n  second line',
          createdAt: match.createdAt,
          likes: { count: 7, source: 'answer' },
        },
      ],
      capped: true,
      moreCount: 2,
    },
  });
  expect(
    checkedReplyRows(
      [{ ...focal, child_comment_count: 1 }],
      match,
      [{ ...row, text: 'Another top-level comment' }],
      false,
      0,
    ),
  ).toEqual({ reason: 'reply-answer-mismatch' });
  expect(
    checkedReplyRows([{ variables: focal }], match, [], false, 0),
  ).toMatchObject({ answerChecked: false });
});
test('REPLIES revision F2 main mode without explicit consent never invokes the reply reader', async () => {
  const read = vi.fn(async () => ({ entries: [] }));
  expect(
    await captureRepliesForMode(read, false, false, () => {}),
  ).toBeUndefined();
  expect(read).not.toHaveBeenCalled();
});
test('REPLIES revision F3 a parsing failure is counted without failing main, but refresh retains the stop', async () => {
  const error = new Error('Generated parser error'),
    failed = vi.fn();
  const read = () => Promise.reject(error);
  expect(
    await captureRepliesForMode(read, false, true, failed),
  ).toBeUndefined();
  expect(failed).toHaveBeenCalledWith('reply-read-failed');
  await expect(captureRepliesForMode(read, true, false, failed)).rejects.toBe(
    error,
  );
});
function pageFixture({
  rows = 0,
  controls = 0,
  rootCount = 1,
  text = '  Cafe\u0301\n  second line  ',
} = {}) {
  const empty = {
    count: async () => 0,
    all: async () => [],
    locator: (_selector: string): unknown => empty,
  };
  const replyText = {
    count: async () => 1,
    innerText: async () => text,
    locator: () => empty,
  };
  const blocks = {
    count: async () => 1,
    locator: (selector: string) =>
      selector === ':scope > div'
        ? { nth: () => ({ locator: () => replyText }) }
        : empty,
  };
  const row = {
    isVisible: async () => true,
    locator: (selector: string) =>
      selector === ':scope > div:not([role])' ? blocks : empty,
  };
  const list = {
    count: async () => rows,
    nth: () => row,
    locator: () => ({ count: async () => 0 }),
  };
  const control = {
    count: async () => controls,
    filter() {
      return this;
    },
    isVisible: async () => true,
  };
  const root = {
    count: async () => rootCount,
    locator: (selector: string) =>
      selector.includes('ul > li')
        ? list
        : selector.includes('button')
          ? control
          : {
              count: async () => (selector.includes(':scope > ul') ? 0 : 1),
              locator: () => ({
                count: async () => 1,
                getAttribute: async () => `/${match.username}/`,
              }),
            },
  };
  const focal = {
    count: async () => 1,
    locator: (selector: string) =>
      selector === 'time[datetime]'
        ? { count: async () => 1, getAttribute: async () => match.createdAt }
        : selector === 'xpath=ancestor::*[5]'
          ? root
          : blocks,
  };
  const page = {
    url: () => 'https://www.instagram.com/p/Generated/',
    locator: () => focal,
  } as unknown as Page;
  vi.spyOn(selectors, 'checkPage').mockResolvedValue();
  let reads = 0;
  vi.spyOn(selectors, 'textBlock').mockImplementation(async () => ({
    username: match.username,
    text: reads++
      ? text.normalize('NFC').replace(/\s+/gu, ' ').trim()
      : match.text,
  }));
  return page;
}
test.each([
  ['reply-window-empty', { rows: 0 }, -1],
  ['reply-controls-changed', { rows: 0, controls: 2 }, 10000],
  ['reply-scope-unverified', { rows: 1, rootCount: 0 }, 10000],
] as const)(
  'REPLIES revision F1 refuses unverified %s instead of storing empty/capped',
  async (reason, options, window) => {
    try {
      await expect(
        commentReplies(
          pageFixture(options),
          [],
          match,
          () => {},
          performance.now() + window,
        ),
      ).rejects.toMatchObject({ reason });
    } finally {
      vi.restoreAllMocks();
    }
  },
);
test('REPLIES revision F1 page answer reporting missing children refuses an unbounded empty observation', async () => {
  try {
    await expect(
      commentReplies(
        pageFixture(),
        [
          {
            comments: [
              {
                pk: match.id,
                created_at: Date.parse(match.createdAt) / 1000,
                user: { username: match.username },
                text: match.text,
                child_comment_count: 3,
                preview_child_comments: [],
              },
            ],
          },
        ],
        match,
        () => {},
        performance.now() + 10000,
      ),
    ).rejects.toMatchObject({ reason: 'reply-answer-incomplete' });
  } finally {
    vi.restoreAllMocks();
  }
});
test('REPLIES revision F4 retains NFC text and internal line breaks from the verified reply text row', async () => {
  try {
    const result = await commentReplies(
      pageFixture({ rows: 1 }),
      [],
      match,
      () => {},
      performance.now() + 10000,
    );
    expect(result.entries[0]?.text).toBe('Café\n  second line');
  } finally {
    vi.restoreAllMocks();
  }
});

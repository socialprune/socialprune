import { expect, test, vi } from 'vitest';
import type { Locator, Page } from 'playwright-core';
import {
  commentReplies,
  captureRepliesForMode,
  ReplyReadFailure,
  replyScopeDiagnostic,
} from './replies.ts';
import { ContextStop, stopDetails } from './report.ts';
import * as selectors from './selectors.ts';
import {
  checkedReplyRows,
  replyAnswerDiagnostic,
  answerReplies,
} from './replies-answer.ts';
import * as scope from './replies-scope.ts';
import { InstagramRepliesSchema, repliesObserved } from '@socialprune/core';
import { pollReplyGrowth } from './reply-neighborhood.ts';

test('STALL2 poll evidence refreshes when reply rows appear between the neighborhood and row reads', async () => {
  let appeared = false;
  const node = {
    locator: () => node,
    or: () => node,
    filter: () => node,
    all: () => Promise.resolve([]),
    count: () => Promise.resolve(appeared ? 5 : 0),
  };
  const checked = vi.spyOn(selectors, 'checkPage').mockResolvedValue(undefined);
  const rows = vi.spyOn(scope, 'matchedReplyRows').mockImplementation(() => {
    appeared = true;
    return Promise.resolve(node as unknown as Locator);
  });
  const poll: Parameters<typeof pollReplyGrowth>[7] = {
    maxMs: 5000,
    elapsedMs: 0,
    firstGrowthMs: null,
    timeout: true,
    observationFailed: false,
    samples: 0,
    after: [],
  };
  try {
    await pollReplyGrowth(
      { locator: () => node } as unknown as Page,
      node as unknown as Locator,
      { kind: 'p', code: 'GeneratedPost' },
      '123',
      [],
      performance.now() + 5000,
      () => {},
      poll,
    );
    expect(poll.timeout).toBe(false);
    expect(poll.observationFailed).toBe(false);
    expect(
      poll.after.find((value) => value.location === 'next-sibling')?.li,
    ).toBe(5);
  } finally {
    rows.mockRestore();
    checked.mockRestore();
  }
});

const match = {
  id: '123',
  createdAt: '2025-01-02T12:00:00.000Z',
  username: 'generated_person',
  text: 'Generated own comment',
};
const sourceReply = {
  pk: '456',
  user: { username: 'generated_reply' },
  text: 'Generated child',
  created_at: Date.parse(match.createdAt) / 1000,
  comment_like_count: 1,
};
const sourceAnswer = {
  pk: match.id,
  user: { username: match.username },
  text: match.text,
  created_at: Date.parse(match.createdAt) / 1000,
  child_comment_count: 1,
  child_comments: [sourceReply],
};
const sourceDom = [
  {
    id: '456',
    account: 'generated_reply',
    text: sourceReply.text,
    createdAt: match.createdAt,
    likes: { count: null, source: null },
  },
];
test('realshape refresh maps a ReplyReadFailure to the closed reason instead of unexpected-error', async () => {
  const reason = 'reply-scope-unverified',
    failed = vi.fn();
  const error = await captureRepliesForMode(
    () => Promise.reject(new ReplyReadFailure(reason)),
    true,
    false,
    failed,
  ).catch((error: unknown) => error);
  expect(error).toBeInstanceOf(ContextStop);
  expect(stopDetails(error)).toMatchObject({
    code: 'INSTAGRAM_SHAPE_CHANGED',
    token: reason,
  });
  expect(failed).toHaveBeenCalledWith(reason);
});
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
  expect(checkedReplyRows([{ variables: focal }], match, [], false, 0)).toEqual(
    { reason: 'reply-answer-absent' },
  );
});
test('realfix missing focal answers never authorize an empty or populated replies observation', () => {
  for (const capped of [false, true])
    for (const rows of [
      [],
      [
        {
          account: 'generated_reply',
          text: 'Generated child',
          createdAt: match.createdAt,
          likes: { count: null, source: null },
        },
      ],
    ])
      expect(checkedReplyRows([], match, rows, capped, 0)).toEqual({
        reason: 'reply-answer-absent',
      });
});
test('ROWANSWER uncapped writes require exactly the answer total, not duplicate row inflation', () => {
  expect(
    checkedReplyRows(
      [sourceAnswer],
      match,
      [...sourceDom, ...sourceDom],
      false,
      0,
    ),
  ).toEqual({ reason: 'reply-answer-incomplete' });
});
test('STALL response traversal stops visiting array entries after its declared object cap', () => {
  let visited = 0;
  const values = Array.from({ length: 100100 }, () => ({}));
  Object.defineProperty(values, 100050, {
    get: () => {
      visited++;
      return sourceAnswer;
    },
  });
  const result = answerReplies([values], match);
  expect(result.valid).toBe(false);
  expect(visited).toBe(0);
});
test('STALL oversized direct child lists refuse before iterating their rows', () => {
  let visited = 0;
  const children = Array.from({ length: 100001 }, () => ({}));
  Object.defineProperty(children, 0, {
    get: () => {
      visited++;
      return {};
    },
  });
  const result = answerReplies(
    [{ ...sourceAnswer, preview_child_comments: children }],
    match,
  );
  expect(result.valid).toBe(false);
  expect(visited).toBe(0);
});

test.each(['owner', 'utc', 'both'] as const)(
  'newestreply threaded focal answers accept %s field forms',
  (mode) => {
    const focal = {
      id: match.id,
      ...(mode === 'utc'
        ? { user: { username: match.username } }
        : { owner: { username: match.username } }),
      text: match.text,
      ...(mode === 'owner'
        ? { created_at: Date.parse(match.createdAt) / 1000 }
        : { created_at_utc: Date.parse(match.createdAt) / 1000 }),
      edge_threaded_comments: { count: 0, edges: [] },
    };
    expect(checkedReplyRows([focal], match, [], false, 0)).toMatchObject({
      answerChecked: true,
      observation: { entries: [], capped: false },
    });
  },
);

test('newestreply diagnostics separate absent, excluded, invalid and incomplete answers without their values', () => {
  const focal = {
    pk: match.id,
    user: { username: match.username },
    text: match.text,
    created_at: Date.parse(match.createdAt) / 1000,
    child_comment_count: 3,
  };
  for (const key of [
    'variables',
    'params',
    'instanceParams',
    'route_match_infos',
  ]) {
    const bodies = [{ [key]: focal }, { comment_id: match.id }];
    const value = replyAnswerDiagnostic(bodies, match, 0, [
      'graphql',
      'api-v1-media-comments',
    ]);
    expect(value).toMatchObject({
      answerPresent: false,
      matchIdBodies: 2,
      parameterMatchIdBodies: 1,
      focalObjects: 0,
      childCountClass: 'positive',
      bodiesInspected: 2,
    });
    expect(checkedReplyRows(bodies, match, [], false, 0)).toEqual({
      reason: 'reply-answer-absent',
    });
    for (const content of Object.values(match))
      expect(JSON.stringify(value)).not.toContain(content);
  }
  expect(replyAnswerDiagnostic([focal], match, 0)).toMatchObject({
    answerPresent: true,
    answerValid: true,
    answerTotal: 3,
    childCountSeen: true,
    childCountClass: 'positive',
    rowsShown: 0,
  });
  expect(
    replyAnswerDiagnostic([{ ...focal, child_comment_count: -1 }], match, 0),
  ).toMatchObject({
    answerPresent: true,
    answerValid: false,
    childCountClass: 'invalid',
  });
  for (const pk of [123, '123'])
    expect(
      checkedReplyRows(
        [{ ...focal, pk, child_comment_count: 0 }],
        match,
        [],
        false,
        0,
      ),
    ).toHaveProperty('answerChecked', true);
  expect(
    checkedReplyRows([{ ...focal, pk: 9007199254740992 }], match, [], false, 0),
  ).toEqual({ reason: 'reply-answer-absent' });
});

test('REPLY-SRC-1 exact script parent with explicit zero or list supplies the missing page answer', () => {
  const focal = {
    pk: match.id,
    user: { username: match.username },
    text: match.text,
    created_at: Date.parse(match.createdAt) / 1000,
  };
  for (const evidence of [{ child_comment_count: 0 }, { child_comments: [] }])
    expect(
      checkedReplyRows([], match, [], false, 0, [{ ...focal, ...evidence }]),
    ).toMatchObject({
      answerChecked: true,
      observation: { entries: [], capped: false },
    });
  expect(
    checkedReplyRows([], match, sourceDom, false, 0, [sourceAnswer]),
  ).toMatchObject({
    answerChecked: true,
    observation: { entries: [{ account: 'generated_reply' }] },
  });
});
test.each(['id', 'author', 'time', 'text', 'count', 'parameter'] as const)(
  'REPLY-SRC-1 script %s failure never supplies an observation',
  (failure) => {
    let focal: Record<string, unknown> = {
      pk: match.id,
      user: { username: match.username },
      text: match.text,
      created_at: Date.parse(match.createdAt) / 1000,
      child_comment_count: 0,
    };
    if (failure === 'id') focal.pk = '999';
    if (failure === 'author') focal.user = { username: 'generated_other' };
    if (failure === 'time') focal.created_at = Number(focal.created_at) + 1;
    if (failure === 'text') focal.text = 'Generated other text';
    if (failure === 'count') delete focal.child_comment_count;
    if (failure === 'parameter') focal = { variables: focal };
    expect(checkedReplyRows([], match, [], false, 0, [focal])).toEqual({
      reason: 'reply-answer-absent',
    });
  },
);
test('REPLY-SRC-1 conflict between network and exact script evidence refuses, network keeps priority on agreement', () => {
  const zero = { ...sourceAnswer, child_comment_count: 0, child_comments: [] };
  expect(
    checkedReplyRows([sourceAnswer], match, sourceDom, false, 0, [zero]),
  ).toEqual({ reason: 'reply-answer-conflict' });
  expect(
    checkedReplyRows([sourceAnswer], match, sourceDom, false, 0, [
      sourceAnswer,
    ]),
  ).toMatchObject({ answerChecked: true });
});

test('replyempty no replies shown requires agreeing exact focal answer evidence', () => {
  const focal = {
    pk: match.id,
    user: { username: match.username },
    text: match.text,
    created_at: Date.parse(match.createdAt) / 1000,
  };
  for (const evidence of [
    { child_comment_count: 0 },
    { preview_child_comments: [] },
    { edge_threaded_comments: { edges: [] } },
  ])
    expect(
      checkedReplyRows([{ ...focal, ...evidence }], match, [], false, 0),
    ).toEqual({
      answerChecked: true,
      observation: { entries: [], capped: false, moreCount: 0 },
    });
  for (const evidence of [
    {},
    { child_comment_count: 1 },
    {
      preview_child_comments: [
        {
          pk: '456',
          user: { username: 'generated_reply' },
          text: 'Generated child',
          created_at: focal.created_at,
        },
      ],
    },
  ])
    expect(
      checkedReplyRows([{ ...focal, ...evidence }], match, [], false, 0),
    ).toEqual({
      reason: Object.keys(evidence).length
        ? 'reply-answer-incomplete'
        : 'reply-answer-absent',
    });
  expect(
    checkedReplyRows(
      [{ ...focal, child_comment_count: -1 }],
      match,
      [],
      false,
      0,
    ),
  ).toEqual({ reason: 'reply-answer-conflict' });
});
test('REPLIES revision F2 main mode without explicit consent never invokes the reply reader', async () => {
  const read = vi.fn(() => Promise.resolve({ entries: [] }));
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
  timeCount = 1,
  nearbyTimeCount = 1,
  legacyShape = false,
  text = '  Cafe\u0301\n  second line  ',
} = {}) {
  const empty = {
    count: () => Promise.resolve(0),
    all: () => Promise.resolve([]),
    locator: (_selector: string): unknown => empty,
  };
  const replyText = {
    count: () => Promise.resolve(1),
    innerText: () => Promise.resolve(text),
    locator: () => empty,
  };
  const blocks = {
    count: () => Promise.resolve(1),
    locator: (selector: string) =>
      selector === ':scope > div'
        ? { nth: () => ({ locator: () => replyText }) }
        : selector === 'time[datetime]'
          ? { count: () => Promise.resolve(nearbyTimeCount) }
          : empty,
  };
  const row = {
    isVisible: () => Promise.resolve(true),
    locator: (selector: string) =>
      selector === ':scope > div:not([role])' ? blocks : empty,
  };
  const list = {
    count: () => Promise.resolve(rows),
    nth: () => row,
    locator: () => ({ count: () => Promise.resolve(0) }),
  };
  const control = {
    count: () => Promise.resolve(controls),
    all: () =>
      Promise.resolve(
        Array.from({ length: controls }, () => ({
          innerText: () => Promise.resolve('View replies'),
          locator: () => ({ count: () => Promise.resolve(1) }),
          getAttribute: () => Promise.resolve(null),
          or() {
            return this;
          },
          count: () => Promise.resolve(controls),
        })),
      ),
    filter() {
      return this;
    },
    isVisible: () => Promise.resolve(true),
  };
  const root = {
    count: () => Promise.resolve(rootCount),
    locator: (selector: string) =>
      selector.includes('ul > li')
        ? list
        : selector.includes('button')
          ? control
          : {
              count: () =>
                Promise.resolve(selector.includes(':scope > ul') ? 0 : 1),
              locator: () => ({
                count: () => Promise.resolve(legacyShape ? 2 : 1),
                getAttribute: () => Promise.resolve(`/${match.username}/`),
              }),
            },
  };
  const focal = {
    count: () => Promise.resolve(1),
    locator: (selector: string) =>
      selector === 'time[datetime]'
        ? {
            count: () => Promise.resolve(timeCount),
            getAttribute: () => Promise.resolve(match.createdAt),
          }
        : selector === 'xpath=ancestor::*[5]'
          ? root
          : blocks,
  };
  const page = {
    url: () => 'https://www.instagram.com/p/Generated/',
    locator: () => focal,
  } as unknown as Page;
  vi.spyOn(scope, 'structuralReplyScope').mockImplementation(
    (_focal, _selector, _zero, shape) => {
      if (rootCount !== 1) return Promise.resolve(null);
      shape.chosenDepth = 5;
      return Promise.resolve(
        root as unknown as import('playwright-core').Locator,
      );
    },
  );
  vi.spyOn(scope, 'ownReplyControls').mockResolvedValue(
    control as unknown as import('playwright-core').Locator,
  );
  vi.spyOn(selectors, 'checkPage').mockResolvedValue();
  let reads = 0;
  vi.spyOn(selectors, 'textBlock').mockImplementation(() =>
    Promise.resolve({
      username: match.username,
      text: reads++
        ? text.normalize('NFC').replace(/\s+/gu, ' ').trim()
        : match.text,
    }),
  );
  return page;
}
test('realfix 2/2 no-avatar focal scope reaches the answer check and cannot store without it', async () => {
  try {
    await expect(
      commentReplies(
        pageFixture({ legacyShape: true }),
        [],
        match,
        () => {},
        performance.now() + 10000,
      ),
    ).rejects.toMatchObject({ reason: 'reply-answer-absent' });
  } finally {
    vi.restoreAllMocks();
  }
});
test.each([
  [0, 0],
  [0, 1],
] as const)(
  'realshape scope absent focal time=%s nearby=%s is counted and still refused',
  async (timeCount, nearbyTimeCount) => {
    try {
      const page = pageFixture({ timeCount, nearbyTimeCount });
      const diagnostic = await replyScopeDiagnostic(page, match, () => {});
      expect(diagnostic).toMatchObject({
        observed: true,
        failedCheck: 'focal-time',
        addressResolved: true,
        focalCount: 1,
        focalTimeCount: 0,
        focalTimePresent: false,
        nearbyTimeCount,
      });
      await expect(
        commentReplies(page, [], match, () => {}, performance.now() + 10000),
      ).rejects.toMatchObject({ reason: 'reply-scope-unverified' });
      for (const value of [
        match.id,
        match.createdAt,
        match.username,
        match.text,
      ])
        expect(JSON.stringify(diagnostic)).not.toContain(value);
    } finally {
      vi.restoreAllMocks();
    }
  },
);
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
      [
        {
          ...match,
          pk: match.id,
          created_at: Date.parse(match.createdAt) / 1000,
          user: { username: match.username },
          child_comment_count: 1,
          preview_child_comments: [
            {
              pk: '456',
              created_at: Date.parse(match.createdAt) / 1000,
              user: { username: match.username },
              text: '  Cafe\u0301\n  second line  ',
            },
          ],
        },
      ],
      match,
      () => {},
      performance.now() + 10000,
    );
    expect(result.entries[0]?.text).toBe('Café\n  second line');
  } finally {
    vi.restoreAllMocks();
  }
});

// REPLY-SET-1 shape: the answer declares 7, the page shows 5 and then only
// "Hide all replies". The rows are generated; no real page was inspected.
const setReply = (ordinal: number) => ({
  pk: String(900000 + ordinal),
  user: { username: `generated_reply_${ordinal}` },
  text: `Generated reply ${ordinal} with local text`,
  created_at: Date.parse(match.createdAt) / 1000,
});
const setRow = (ordinal: number) => ({
  id: String(900000 + ordinal),
  account: `generated_reply_${ordinal}`,
  text: `Generated reply ${ordinal} with local text`,
  createdAt: match.createdAt,
  likes: { count: null, source: null },
});
const setFocal = (entries: number) => ({
  pk: match.id,
  user: { username: match.username },
  text: match.text,
  created_at: Date.parse(match.createdAt) / 1000,
  child_comment_count: 7,
  preview_child_comments: Array.from({ length: entries }, (_, i) =>
    setReply(i),
  ),
});
const shown = Array.from({ length: 5 }, (_, i) => setRow(i));
test.each([
  [
    'full answer entries',
    7,
    { answerEntries: 7, shownRowsMatched: 5, answerOnlyEntries: 2 },
    0,
  ],
  [
    'count only',
    5,
    { answerEntries: 5, shownRowsMatched: 5, answerOnlyEntries: 0 },
    2,
  ],
] as const)(
  'REPLY-SET-1 7 declared / 5 shown with %s keeps the rule and counts the set without values',
  (_name, entries, counts, hiddenCount) => {
    const bodies = [setFocal(entries)];
    // The reading rule is unchanged here: a declared total above the shown
    // rows still refuses until a stored marker for the set is decided.
    expect(checkedReplyRows(bodies, match, shown, false, 0)).toEqual({
      reason: 'reply-answer-incomplete',
    });
    const value = replyAnswerDiagnostic(
      bodies,
      match,
      shown.length,
      [],
      undefined,
      [],
      shown,
    );
    expect(value).toMatchObject({
      answerTotal: 7,
      rowsShown: 5,
      ...counts,
      hiddenCount,
    });
    for (const text of [
      ...Object.values(match),
      ...shown.flatMap((row) => [row.id, row.account, row.text]),
    ])
      expect(JSON.stringify(value)).not.toContain(text);
  },
);
test.each(['unmatched', 'conflicting'] as const)(
  'REPLY-SET-1 a %s shown row still stops with the mismatch and is not counted as matched',
  (mode) => {
    const rows =
      mode === 'unmatched'
        ? [...shown.slice(0, 4), { ...setRow(4), text: 'Generated other text' }]
        : [...shown, { ...setRow(5), account: 'generated_absent' }];
    const bodies = [
      {
        ...setFocal(7),
        child_comment_count: rows.length,
        preview_child_comments: Array.from({ length: rows.length }, (_, i) =>
          setReply(i),
        ),
      },
    ];
    expect(checkedReplyRows(bodies, match, rows, false, 0)).toEqual({
      reason: 'reply-answer-mismatch',
    });
    expect(
      replyAnswerDiagnostic(
        bodies,
        match,
        rows.length,
        [],
        undefined,
        [],
        rows,
      ),
    ).toMatchObject({
      answerEntries: rows.length,
      shownRowsMatched: rows.length - 1,
      answerOnlyEntries: 1,
      hiddenCount: 0,
    });
  },
);
test('REPLY-SET-1 a duplicate answer entry for one shown row is never counted as a unique match', () => {
  const bodies = [
    {
      ...setFocal(1),
      child_comment_count: 1,
      preview_child_comments: [setReply(0)],
    },
  ];
  const { id: _id, ...unlinked } = setRow(0);
  void _id;
  expect(
    replyAnswerDiagnostic(
      bodies,
      match,
      2,
      [],
      undefined,
      [],
      [unlinked, unlinked],
    ),
  ).toMatchObject({
    answerEntries: 1,
    shownRowsMatched: 1,
    answerOnlyEntries: 0,
    hiddenCount: 0,
  });
  expect(replyAnswerDiagnostic(bodies, match, 0)).toMatchObject({
    answerEntries: 1,
    shownRowsMatched: 0,
    answerOnlyEntries: 1,
    hiddenCount: 0,
  });
});

// REPLY-SET-2: the same generated 7/5 shape after "Hide all replies".
test('REPLY-SET-2 7 declared / 5 shown with full answer entries stores all 7, two of them answer-only', () => {
  const checked = checkedReplyRows(
    [setFocal(7)],
    match,
    shown,
    false,
    0,
    [],
    true,
  );
  expect(checked).toEqual({
    answerChecked: true,
    observation: {
      entries: [
        ...shown.map((row) => ({
          account: row.account,
          text: row.text,
          createdAt: row.createdAt,
          likes: { count: null, source: null },
          source: 'shown',
        })),
        ...[5, 6].map((ordinal) => ({
          account: `generated_reply_${ordinal}`,
          text: `Generated reply ${ordinal} with local text`,
          createdAt: match.createdAt,
          likes: { count: null, source: null },
          source: 'answer-only',
        })),
      ],
      moreCount: 0,
      capped: false,
      set: { state: 'complete' },
    },
  });
  expect(
    InstagramRepliesSchema.safeParse(
      (checked as { observation: unknown }).observation,
    ).success,
  ).toBe(true);
});
test('REPLY-SET-2 7 declared / 5 shown with a count only stores the 5 and an incomplete set of 7 with 2 hidden', () => {
  const checked = checkedReplyRows(
    [setFocal(5)],
    match,
    shown,
    false,
    0,
    [],
    true,
  );
  expect(checked).toMatchObject({
    answerChecked: true,
    observation: {
      moreCount: 2,
      capped: false,
      set: { state: 'incomplete', declaredTotal: 7, hiddenCount: 2 },
    },
  });
  const observation = (
    checked as { observation: { entries: { source?: string }[] } }
  ).observation;
  expect(observation.entries.map((entry) => entry.source)).toEqual(
    Array.from({ length: 5 }, () => 'shown'),
  );
  expect(InstagramRepliesSchema.safeParse(observation).success).toBe(true);
  expect(repliesObserved(InstagramRepliesSchema.parse(observation))).toBe(
    false,
  );
});
test.each([
  [
    'a shown row without an answer match',
    [...shown.slice(0, 4), { ...setRow(4), text: 'Generated other text' }],
    7,
  ],
  [
    'a conflicting 6th shown row',
    [...shown, { ...setRow(5), account: 'generated_absent' }],
    7,
  ],
  ['a shown row matching an entry twice', [...shown.slice(0, 4), setRow(0)], 7],
] as const)('REPLY-SET-2 %s still stops', (_name, rows, entries) => {
  expect(
    checkedReplyRows([setFocal(entries)], match, rows, false, 0, [], true),
  ).toEqual({ reason: 'reply-answer-mismatch' });
});
test('REPLY-SET-2 without the hide-all control, or with nothing shown, the declared total above the rows still stops', () => {
  for (const [rows, hideAll] of [
    [shown, false],
    [[], true],
  ] as const)
    expect(
      checkedReplyRows([setFocal(7)], match, rows, false, 0, [], hideAll),
    ).toEqual({ reason: 'reply-answer-incomplete' });
});

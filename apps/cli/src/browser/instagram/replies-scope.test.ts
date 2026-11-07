import { expect, test } from 'vitest';
import type { Locator } from 'playwright-core';
import { emptyReplyScope } from './replies.ts';
import { inspectSoleCommentAnswer } from './sole-comment-answer.ts';
import { REPLY_ROWS, structuralReplyScope } from './replies-scope.ts';

const focalSelector = 'a[href="/p/Generated/c/123/"]';
type Level = {
  controls?: number;
  rows?: number;
  foreign?: number;
  main?: number;
  reply?: number;
  images?: number;
  times?: number;
  children?: {
    focal?: boolean;
    other?: number;
    control?: number;
    selfLink?: boolean;
  }[];
};
function fixture(levels: Level[]) {
  const empty = {
    count: () => Promise.resolve(0),
    all: () => Promise.resolve([]),
    filter: () => empty,
    and: () => empty,
    locator: () => empty,
  };
  const counted = (count: number) => ({
    ...empty,
    count: () => Promise.resolve(count),
  });
  const root = (level: Level) => ({
    ...empty,
    evaluate: <T, A>(read: (node: unknown, args: A) => T, args: A) => {
      const node = (
        tagName: string,
        children: unknown[] = [],
        focal = false,
        link = false,
      ) => ({
        tagName,
        children,
        getAttribute: () => (link ? '/p/Generated/c/123/' : null),
        matches: () => focal,
      });
      const children =
        level.children ??
        (level.foreign ? [{ focal: true }, { other: 1 }] : []);
      return Promise.resolve(
        read(
          node(
            'DIV',
            children.map((child) =>
              child.selfLink
                ? node('A', [], false, true)
                : node('DIV', [
                    ...(child.focal ? [node('A', [], true, true)] : []),
                    ...Array.from({ length: child.other ?? 0 }, () =>
                      node('A', [], false, true),
                    ),
                  ]),
            ),
          ),
          args,
        ),
      );
    },
    count: () => Promise.resolve(1),
    locator: (selector: string) => {
      if (selector === 'xpath=ancestor::main') return counted(level.main ?? 1);
      if (selector === ':scope > *')
        return {
          ...counted(level.children?.length ?? 0),
          all: () =>
            Promise.resolve(
              (level.children ?? []).map((child) => ({
                ...empty,
                locator: (inner: string) => {
                  if (inner === focalSelector)
                    return counted(child.focal ? 1 : 0);
                  if (inner === 'a[href*="/c/"]')
                    return counted((child.focal ? 1 : 0) + (child.other ?? 0));
                  if (inner === 'xpath=self::a[contains(@href,"/c/")]')
                    return counted(child.selfLink ? 1 : 0);
                  if (inner === 'button,[role="button"]')
                    return {
                      ...empty,
                      filter: () => counted(child.control ?? 0),
                    };
                  return empty;
                },
              })),
            ),
        };
      if (selector === REPLY_ROWS)
        return {
          ...counted(level.rows ?? 0),
          locator: (inner: string) =>
            counted(inner === 'a[href*="/c/"]' ? (level.rows ?? 0) : 0),
        };
      if (selector === focalSelector) return counted(1);
      if (selector === 'a[href*="/c/"]')
        return counted(1 + (level.rows ?? 0) + (level.foreign ?? 0));
      if (selector === ':scope > ul, :scope > div > ul')
        return counted(level.rows ? 1 : 0);
      if (selector === 'img') return counted(level.images ?? 0);
      if (selector === 'time[datetime]') return counted(level.times ?? 0);
      if (selector === 'button,[role="button"]')
        return {
          ...empty,
          filter: ({ hasText }: { hasText: RegExp }) =>
            counted(
              hasText.test('Reply')
                ? (level.reply ?? 0)
                : (level.controls ?? 0),
            ),
        };
      if (selector.startsWith(':scope > button'))
        return { ...empty, filter: () => counted(level.controls ?? 0) };
      return empty;
    },
  });
  return {
    ...empty,
    locator: (selector: string) => {
      const depth = Number(/\[(\d+)\]$/u.exec(selector)?.[1]);
      return levels[depth - 1] ? root(levels[depth - 1]!) : empty;
    },
  } as unknown as Locator;
}

test('realfix chooses the nearest own reply boundary independently of wrapper depth and avatar', async () => {
  for (const depth of [4, 5, 7, 12]) {
    const levels = Array.from({ length: depth }, (): Level => ({}));
    levels[depth - 1] = { controls: 1, rows: 3 };
    const shape = emptyReplyScope();
    expect(
      await structuralReplyScope(
        fixture(levels),
        focalSelector,
        false,
        shape,
        () => {},
      ),
    ).not.toBeNull();
    expect(shape).toMatchObject({ chosenDepth: depth, avatarObserved: false });
    expect(shape.levels).toHaveLength(depth);
  }
});

test('realfix refuses a sibling top-level permalink at the reply boundary without climbing past it', async () => {
  const shape = emptyReplyScope();
  expect(
    await structuralReplyScope(
      fixture([
        {},
        {},
        { controls: 1, rows: 3, foreign: 1 },
        { controls: 1, rows: 3 },
      ]),
      focalSelector,
      false,
      shape,
      () => {},
    ),
  ).toBeNull();
  expect(shape.levels).toHaveLength(3);
  expect(shape.chosenDepth).toBeNull();
});

test.each([true, false])(
  'replyempty isolates depth 10 below the first foreign permalink without an expand control, zero answer=%s',
  async (zeroAnswer) => {
    const shape = emptyReplyScope();
    expect(
      await structuralReplyScope(
        fixture([
          ...Array.from({ length: 10 }, (): Level => ({ times: 1 })),
          { foreign: 1 },
        ]),
        focalSelector,
        zeroAnswer,
        shape,
        () => {},
      ),
    ).not.toBeNull();
    expect(shape.chosenDepth).toBe(10);
    expect(shape.levels).toHaveLength(11);
  },
);

test('realfix zero-child answer proves absence only at a focal Reply action, within main and the depth bound', async () => {
  for (const [levels, zero, chosen] of [
    [[{}, { reply: 1 }], true, 2],
    [[{}, { reply: 1 }], false, null],
    [[{}, { reply: 1, main: 0 }], true, null],
    [
      Array.from({ length: 13 }, (_, index) => ({
        controls: index === 12 ? 1 : 0,
      })),
      false,
      null,
    ],
  ] as const) {
    const shape = emptyReplyScope();
    await structuralReplyScope(
      fixture([...levels]),
      focalSelector,
      zero,
      shape,
      () => {},
    );
    expect(shape.chosenDepth).toBe(chosen);
    expect(shape.levels.length).toBeLessThanOrEqual(12);
  }
});
test.each([true, false])(
  'ZEROSCOPE deepest plain item isolates sibling controls only with zero=%s',
  async (zero) => {
    const shape = emptyReplyScope();
    const root = await structuralReplyScope(
      fixture([
        ...Array.from({ length: 10 }, (): Level => ({ times: 1 })),
        {
          foreign: 9,
          controls: 5,
          children: [
            { focal: true },
            ...Array.from({ length: 9 }, () => ({ other: 1, control: 1 })),
          ],
        },
      ]),
      focalSelector,
      zero,
      shape,
      () => {},
    );
    expect(root === null).toBe(!zero);
    expect(shape.chosenDepth).toBe(zero ? 10 : null);
    expect(shape.levels).toHaveLength(11);
  },
);
test.each([0, 2])(
  'ZEROSCOPE candidate must contain the sole focal time, times=%s',
  async (times) => {
    const shape = emptyReplyScope();
    const root = await structuralReplyScope(
      fixture([
        { times },
        {
          foreign: 9,
          controls: 5,
          children: [{ focal: true }, { other: 1, control: 1 }],
        },
      ]),
      focalSelector,
      true,
      shape,
      () => {},
    );
    expect(root).toBeNull();
    expect(shape.chosenDepth).toBeNull();
  },
);
test.each(['foreign-in-focal', 'direct-anchor', 'over-bound'] as const)(
  'ZEROSCOPE rejects contaminated boundary %s',
  async (kind) => {
    const shape = emptyReplyScope();
    const children =
      kind === 'over-bound'
        ? Array.from({ length: 513 }, (_, index) => ({
            focal: index === 0,
            other: index === 0 ? 0 : 1,
            control: 1,
          }))
        : [
            { focal: true, other: kind === 'foreign-in-focal' ? 1 : 0 },
            { other: 1, control: 1, selfLink: kind === 'direct-anchor' },
          ];
    expect(
      await structuralReplyScope(
        fixture([{ times: 1 }, { foreign: 9, controls: 5, children }]),
        focalSelector,
        true,
        shape,
        () => {},
      ),
    ).toBeNull();
    expect(shape.chosenDepth).toBeNull();
  },
);
test.each([20, 38])(
  'SCOPECAP evaluates all forty children with focal at %s and caps only diagnostics',
  async (index) => {
    const shape = emptyReplyScope();
    const root = await structuralReplyScope(
      fixture([
        { times: 1 },
        {
          foreign: 39,
          controls: 39,
          children: Array.from({ length: 40 }, (_, ordinal) => ({
            focal: ordinal === index,
            other: ordinal === index ? 0 : 1,
            control: 1,
          })),
        },
      ]),
      focalSelector,
      true,
      shape,
      () => {},
    );
    expect(root).not.toBeNull();
    expect(shape.chosenDepth).toBe(1);
    expect(shape.levels.at(-1)).toMatchObject({
      childrenCapped: true,
      zeroBoundary: {
        observed: true,
        overBound: false,
        totalChildren: 40,
        focalChildren: 1,
        foreignChildren: 39,
        directAnchors: 0,
      },
    });
    expect(shape.levels.at(-1)?.children).toHaveLength(32);
    expect(
      shape.levels
        .at(-1)
        ?.children.every((child) => child.expandControls === null),
    ).toBe(true);
  },
);
test.each([
  'no-foreign',
  'two-focal',
  'at-child-limit',
  'observation-failed',
] as const)(
  'SCOPECAP complete-boundary condition %s fails closed unless exactly isolated',
  async (mode) => {
    const shape = emptyReplyScope();
    const length = mode === 'at-child-limit' ? 512 : 40;
    const focal = fixture([
      { times: 1 },
      {
        foreign: 39,
        controls: 39,
        children: Array.from({ length }, (_, index) => ({
          focal: index === length - 1 || (mode === 'two-focal' && index === 0),
          other: index === length - 1 || mode === 'no-foreign' ? 0 : 1,
        })),
      },
    ]);
    const target =
      mode === 'observation-failed'
        ? ({
            locator: (selector: string) => {
              const root = focal.locator(selector);
              return new Proxy(root, {
                get(object, property) {
                  return property === 'evaluate'
                    ? () =>
                        Promise.reject(
                          new Error('Generated unreadable boundary'),
                        )
                    : (Reflect.get(object, property) as unknown);
                },
              });
            },
          } as unknown as Locator)
        : focal;
    const root = await structuralReplyScope(
      target,
      focalSelector,
      true,
      shape,
      () => {},
    );
    expect(root === null).toBe(mode !== 'at-child-limit');
    if (mode === 'at-child-limit')
      expect(shape.levels.at(-1)?.zeroBoundary).toMatchObject({
        observed: true,
        overBound: false,
        totalChildren: 512,
      });
  },
);
test('SOLEDIAG focal-time gate is observed without changing scope refusal', async () => {
  const match = {
    id: '123',
    username: 'generated',
    text: 'Generated focal',
    createdAt: '2025-01-01T00:00:00.000Z',
  };
  const answer = inspectSoleCommentAnswer(
    [],
    [
      {
        pk: match.id,
        user: { username: match.username },
        text: match.text,
        created_at: Date.parse(match.createdAt) / 1000,
        child_comment_count: 0,
      },
    ],
    match,
    'Generated',
  );
  const base = fixture(Array.from({ length: 12 }, () => ({ times: 2 }))),
    main = fixture([{ times: 2 }]).locator('xpath=ancestor::*[1]');
  const focal = {
    locator: (selector: string) =>
      selector === 'xpath=ancestor::main' ? main : base.locator(selector),
  } as unknown as Locator;
  const shape = emptyReplyScope();
  await structuralReplyScope(
    focal,
    focalSelector,
    true,
    shape,
    () => {},
    () => {
      shape.soleComment = answer.diagnostic;
      return answer.accepted;
    },
  );
  expect(shape.soleComment).toMatchObject({
    observed: true,
    focalTimes: 2,
    firstFailedGate: 'sole-focal',
  });
});
test('SOLEDIAG failed page observation is explicit and does not replace a thrown guard', async () => {
  const match = {
    id: '123',
    username: 'generated',
    text: 'Generated focal',
    createdAt: '2025-01-01T00:00:00.000Z',
  };
  const answer = inspectSoleCommentAnswer(
    [],
    [
      {
        pk: match.id,
        user: { username: match.username },
        text: match.text,
        created_at: Date.parse(match.createdAt) / 1000,
        child_comment_count: 0,
      },
    ],
    match,
    'Generated',
  );
  const base = fixture(Array.from({ length: 12 }, () => ({ times: 1 })));
  let failed = false;
  const main = {
    count: () => {
      failed = true;
      return Promise.reject(new Error('Generated unavailable observation'));
    },
  };
  const focal = {
    locator: (selector: string) =>
      selector === 'xpath=ancestor::main' ? main : base.locator(selector),
  } as unknown as Locator;
  const shape = emptyReplyScope();
  await expect(
    structuralReplyScope(
      focal,
      focalSelector,
      true,
      shape,
      () => {
        if (failed) throw new Error('Generated stop guard');
      },
      () => {
        shape.soleComment = answer.diagnostic;
        return answer.accepted;
      },
    ),
  ).rejects.toThrow('Generated stop guard');
  expect(shape.soleComment).toMatchObject({
    observed: false,
    observationFailed: true,
    firstFailedGate: 'sole-observation',
  });
});

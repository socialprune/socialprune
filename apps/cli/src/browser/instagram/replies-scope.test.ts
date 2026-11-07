import { expect, test } from 'vitest';
import type { Locator } from 'playwright-core';
import { emptyReplyScope } from './replies.ts';
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
          ...Array.from({ length: 10 }, (): Level => ({})),
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
test.each(['foreign-in-focal', 'direct-anchor', 'capped'] as const)(
  'ZEROSCOPE rejects contaminated boundary %s',
  async (kind) => {
    const shape = emptyReplyScope();
    const children =
      kind === 'capped'
        ? Array.from({ length: 33 }, (_, index) => ({
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

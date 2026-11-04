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
        return { ...counted(0), all: () => Promise.resolve([]) };
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

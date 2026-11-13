import { expect, test, vi } from 'vitest';
import type { Locator, Page } from 'playwright-core';
import {
  fittsMs,
  HUMAN_STEP_EXTRA_MS,
  HumanInput,
  pointerPath,
  targetPoint,
} from './human-input.ts';
import { ContextOrderSchema } from './order.ts';
import { FillOrderSchema } from '../x/fill/order.ts';
import { CONTEXT_WARNING, contextWarning } from './copy.ts';

/** A deterministic generator so the unit cases never depend on luck. */
function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 2 ** 32;
  };
}

test('HUMAN-1 targets lie in the inner 60 percent of the box on both axes', () => {
  const random = seeded(7);
  const box = { x: 100, y: 50, width: 200, height: 40 };
  const points = Array.from({ length: 500 }, () => targetPoint(box, random));
  for (const point of points) {
    expect(point.x).toBeGreaterThanOrEqual(box.x + 0.2 * box.width);
    expect(point.x).toBeLessThanOrEqual(box.x + 0.8 * box.width);
    expect(point.y).toBeGreaterThanOrEqual(box.y + 0.2 * box.height);
    expect(point.y).toBeLessThanOrEqual(box.y + 0.8 * box.height);
  }
  expect(new Set(points.map((point) => point.x.toFixed(3))).size).toBe(500);
  expect(targetPoint(box, () => 0)).toEqual({ x: 140, y: 58 });
  expect(targetPoint(box, () => 1)).toEqual({ x: 260, y: 82 });
});
test('HUMAN-1 Fitts timing grows with distance and stays within 150 to 1,500 ms', () => {
  expect(fittsMs(0, 40)).toBe(150);
  expect(fittsMs(5, 400)).toBe(150);
  expect(fittsMs(100000, 1)).toBe(1500);
  expect(fittsMs(400, 40)).toBe(Math.round(550 + 130 * Math.log2(20)));
  expect(fittsMs(800, 40)).toBeGreaterThan(fittsMs(200, 40));
});
test('HUMAN-1 paths start and end exactly, keep time monotone at about 60 points per second and bend to one side', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const random = seeded(seed);
    const from = { x: 10, y: 20 },
      to = { x: 610, y: 320 };
    const duration = fittsMs(Math.hypot(600, 300), 40);
    const path = pointerPath(from, to, duration, random);
    expect(path[0]).toEqual({ ...from, t: 0 });
    expect(path.at(-1)).toEqual({ ...to, t: duration });
    expect(path.length).toBe(
      Math.max(2, Math.round((duration / 1000) * 60)) + 1,
    );
    for (let index = 1; index < path.length; index++)
      expect(path[index]!.t).toBeGreaterThan(path[index - 1]!.t);
    // Signed distance of the inner points from the straight line: one side,
    // within the 40 px control offset plus the 5 px deviation.
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    const sides = path
      .slice(1, -1)
      .map(
        (point) =>
          ((to.x - from.x) * (point.y - from.y) -
            (to.y - from.y) * (point.x - from.x)) /
          length,
      );
    expect(Math.max(...sides.map(Math.abs))).toBeLessThan(45);
    const middle = sides[Math.floor(sides.length / 2)]!;
    expect(Math.abs(middle)).toBeGreaterThan(5);
  }
});
test('HUMAN-1 waits are only ever longer: pace extra 0 to 50 percent, in-step pause 300 to 1,500 ms', async () => {
  const waits: number[] = [];
  const input = new HumanInput(seeded(3), (ms) => {
    waits.push(ms);
    return Promise.resolve();
  });
  for (let index = 0; index < 200; index++) {
    const extra = input.paceExtra(10000);
    expect(extra).toBeGreaterThanOrEqual(0);
    expect(extra).toBeLessThanOrEqual(5000);
    await input.pause();
  }
  for (const ms of waits) {
    expect(ms).toBeGreaterThanOrEqual(300);
    expect(ms).toBeLessThanOrEqual(1500);
  }
  expect(input.totals.extraWaitMsBucket.lt5000).toBeGreaterThan(0);
  expect(HUMAN_STEP_EXTRA_MS).toBe(30 * 4180);
});
function mockPage() {
  const calls: string[] = [];
  const page = {
    mouse: {
      move: vi.fn(() => {
        calls.push('move');
        return Promise.resolve();
      }),
      down: vi.fn(() => {
        calls.push('down');
        return Promise.resolve();
      }),
      up: vi.fn(() => {
        calls.push('up');
        return Promise.resolve();
      }),
      wheel: vi.fn((_x: number, y: number) => {
        calls.push(`wheel:${y}`);
        return Promise.resolve();
      }),
    },
  } as unknown as Page;
  return { page, calls };
}
const box = { x: 0, y: 0, width: 100, height: 40 };
test('HUMAN-1 a click moves along a path, holds 60 to 180 ms and counts the path bucket', async () => {
  const { page, calls } = mockPage();
  const holds: number[] = [];
  const input = new HumanInput(
    seeded(11),
    () => Promise.resolve(),
    (ms) => {
      holds.push(ms);
      return Promise.resolve();
    },
  );
  const locator = {
    boundingBox: () => Promise.resolve(box),
    hover: vi.fn(() => Promise.resolve()),
  } as unknown as Locator;
  const press = vi.fn();
  expect(await input.click(page, locator, press)).toBe(true);
  expect(press).toHaveBeenCalledOnce();
  expect(calls.filter((call) => call === 'move').length).toBeGreaterThan(5);
  expect(calls.slice(-2)).toEqual(['down', 'up']);
  expect(calls.indexOf('down')).toBeGreaterThan(calls.lastIndexOf('move'));
  const hold = holds.at(-1)!;
  expect(hold).toBeGreaterThanOrEqual(60);
  expect(hold).toBeLessThanOrEqual(180);
  expect(
    (locator.hover as ReturnType<typeof vi.fn>).mock.calls[0]![0],
  ).toMatchObject({ trial: true });
  expect(input.totals.clicks).toBe(1);
  expect(Object.values(input.totals.pathMsBucket).reduce((a, b) => a + b)).toBe(
    1,
  );
});
test('HUMAN-1 a covered or moved target tries one new point, then returns false before any press and counts the fallback', async () => {
  const { page, calls } = mockPage();
  const input = new HumanInput(
    seeded(5),
    () => Promise.resolve(),
    () => Promise.resolve(),
  );
  const locator = {
    boundingBox: () => Promise.resolve(box),
    hover: vi.fn(() => Promise.reject(new Error('Generated covered target'))),
  } as unknown as Locator;
  const press = vi.fn();
  expect(await input.click(page, locator, press)).toBe(false);
  expect(press).not.toHaveBeenCalled();
  expect(calls).not.toContain('down');
  expect((locator.hover as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(
    2,
  );
  expect(input.totals).toMatchObject({ clicks: 0, fallbacks: 1 });
  const step = input.beginStep();
  expect(step).toMatchObject({ clicks: 0, fallbacks: 0 });
});
test('HUMAN-1 a wheel burst is 2 to 5 events of 60 to 180 px after a path onto the column', async () => {
  for (let seed = 1; seed <= 30; seed++) {
    const { page, calls } = mockPage();
    const gaps: number[] = [];
    const input = new HumanInput(
      seeded(seed),
      () => Promise.resolve(),
      (ms) => {
        gaps.push(ms);
        return Promise.resolve();
      },
    );
    await input.wheelBurst(
      page,
      { x: 0, y: 0, width: 300, height: 500 },
      () => {},
    );
    const wheels = calls.filter((call) => call.startsWith('wheel:'));
    expect(wheels.length).toBeGreaterThanOrEqual(2);
    expect(wheels.length).toBeLessThanOrEqual(5);
    for (const wheel of wheels) {
      const y = Number(wheel.slice('wheel:'.length));
      expect(y).toBeGreaterThanOrEqual(60);
      expect(y).toBeLessThanOrEqual(180);
    }
    expect(calls.indexOf(wheels[0]!)).toBeGreaterThan(
      calls.lastIndexOf('move'),
    );
    for (const gap of gaps.slice(-(wheels.length - 1))) {
      expect(gap).toBeGreaterThanOrEqual(40);
      expect(gap).toBeLessThanOrEqual(160);
    }
    expect(input.totals.scrollBursts).toBe(1);
  }
});
test('HUMAN-1 only the context-instagram order accepts humanInput; the X fill order refuses it', () => {
  const reading = {
    scope: 'context-instagram',
    account: 'generated_person',
    givenAt: '2026-11-13T12:00:00.000Z',
    words: 'Read these generated comments slowly.',
  };
  expect(
    ContextOrderSchema.parse({ ...reading, humanInput: true }),
  ).toMatchObject({ humanInput: true });
  expect(ContextOrderSchema.parse(reading)).not.toHaveProperty('humanInput');
  expect(
    ContextOrderSchema.safeParse({ ...reading, humanInput: 'yes' }).success,
  ).toBe(false);
  expect(
    FillOrderSchema.safeParse({
      scope: 'originals-fill-x',
      account: 'generated_person',
      givenAt: '2026-11-13T12:00:00.000Z',
      words: 'Fill these generated originals.',
      humanInput: true,
    }).success,
  ).toBe(false);
});
test('HUMAN-1 the reading warning changes only with the flag and keeps the rest', () => {
  for (const lang of ['en', 'de'] as const) {
    expect(contextWarning(lang)).toBe(CONTEXT_WARNING[lang]);
    expect(contextWarning(lang, false)).toBe(CONTEXT_WARNING[lang]);
    const human = contextWarning(lang, true);
    expect(human).not.toBe(CONTEXT_WARNING[lang]);
    expect(human.startsWith(CONTEXT_WARNING[lang].slice(0, 120))).toBe(true);
    expect(human.endsWith(CONTEXT_WARNING[lang].slice(-60))).toBe(true);
  }
  expect(contextWarning('en', true)).toContain(
    'In this run SocialPrune moves the pointer along curved paths and varies its waits on purpose, so its input looks less mechanical. The marks by which a browser shows that a program drives it stay as they are.',
  );
  expect(contextWarning('de', true)).toContain(
    'In diesem Lauf bewegt SocialPrune den Mauszeiger absichtlich in Bögen und wartet unterschiedlich lange',
  );
  for (const word of ['safe', 'undetectable', 'bypass', 'guaranteed'])
    expect(contextWarning('en', true).toLowerCase()).not.toContain(word);
});

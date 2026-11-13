import { setTimeout as sleep } from 'node:timers/promises';
import type { BrowserContext, Locator, Page } from 'playwright-core';

/**
 * HUMAN-1 (ADR-028 amendment of 2026-11-13, card IG-APPROACH-1 v1 D2 B):
 * less mechanical pointer input for the Instagram reading pass, only when its
 * written order sets `humanInput`. It moves the pointer, presses, wheels and
 * waits longer; it never types, runs a script in the page or changes the
 * browser's identity, automation marks or fingerprint. Written for this
 * project after the published method (curved paths, Fitts's law timing).
 */
export interface Point {
  x: number;
  y: number;
}
export interface Box extends Point {
  width: number;
  height: number;
}
export interface PathPoint extends Point {
  t: number;
}
export interface HumanCounts {
  clicks: number;
  fallbacks: number;
  pathMsBucket: { lt300: number; lt700: number; lt1500: number };
  scrollBursts: number;
  extraWaitMsBucket: { lt1000: number; lt5000: number; lt16000: number };
}
export function emptyHumanCounts(): HumanCounts {
  return {
    clicks: 0,
    fallbacks: 0,
    pathMsBucket: { lt300: 0, lt700: 0, lt1500: 0 },
    scrollBursts: 0,
    extraWaitMsBucket: { lt1000: 0, lt5000: 0, lt16000: 0 },
  };
}
export type Random = () => number;
/**
 * Extra step budget for the slower input: up to 30 own actions, each with a
 * 1.5 s in-step pause, a 1.5 s path, a 180 ms hold and 1 s of checks.
 */
export const HUMAN_STEP_EXTRA_MS = 30 * (1500 + 1500 + 180 + 1000);
const between = (random: Random, low: number, high: number) =>
  low + random() * (high - low);
/** A point inside the inner 60 percent of the box on both axes. */
export function targetPoint(box: Box, random: Random): Point {
  return {
    x: box.x + box.width * between(random, 0.2, 0.8),
    y: box.y + box.height * between(random, 0.2, 0.8),
  };
}
/** Fitts's law, 0.55 s + 0.13 s * log2(2 * distance / width), 150 to 1500 ms. */
export function fittsMs(distance: number, width: number): number {
  const index = Math.log2(Math.max(1e-9, (2 * distance) / Math.max(1, width)));
  return Math.min(1500, Math.max(150, Math.round(550 + 130 * index)));
}
const ease = (u: number) => u * u * (3 - 2 * u);
/**
 * A cubic Bezier from `from` to `to` whose control points sit on one side of
 * the straight line, 20 to 40 px away, with a few 1 to 5 px deviation zones
 * that vanish at both ends; time follows an S-shaped speed profile at about
 * 60 points per second. The first point is `from`, the last exactly `to`.
 */
export function pointerPath(
  from: Point,
  to: Point,
  durationMs: number,
  random: Random,
): PathPoint[] {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const side = random() < 0.5 ? -1 : 1;
  const normal = { x: (-dy / length) * side, y: (dx / length) * side };
  const control = (fraction: number) => {
    const offset = between(random, 20, 40);
    return {
      x: from.x + dx * fraction + normal.x * offset,
      y: from.y + dy * fraction + normal.y * offset,
    };
  };
  const c1 = control(between(random, 0.2, 0.4)),
    c2 = control(between(random, 0.6, 0.8));
  const zones = Array.from(
    { length: Math.floor(between(random, 0, 4)) },
    () => ({
      centre: between(random, 0.2, 0.8),
      width: between(random, 0.05, 0.15),
      size: between(random, 1, 5) * (random() < 0.5 ? -1 : 1),
    }),
  );
  const count = Math.max(2, Math.round((durationMs / 1000) * 60));
  const points: PathPoint[] = [];
  for (let index = 0; index <= count; index++) {
    const t = (durationMs * index) / count,
      u = ease(index / count),
      v = 1 - u;
    let x =
      v * v * v * from.x +
      3 * v * v * u * c1.x +
      3 * v * u * u * c2.x +
      u * u * u * to.x;
    let y =
      v * v * v * from.y +
      3 * v * v * u * c1.y +
      3 * v * u * u * c2.y +
      u * u * u * to.y;
    for (const zone of zones) {
      const distance = Math.abs(u - zone.centre);
      if (distance < zone.width) {
        const weight = zone.size * (1 - distance / zone.width);
        x += normal.x * weight;
        y += normal.y * weight;
      }
    }
    points.push({ x, y, t });
  }
  points[0] = { ...from, t: 0 };
  points[count] = { ...to, t: durationMs };
  return points;
}
const pathBucket = (ms: number) =>
  ms < 300 ? 'lt300' : ms < 700 ? 'lt700' : ('lt1500' as const);
const waitBucket = (ms: number) =>
  ms < 1000 ? 'lt1000' : ms < 5000 ? 'lt5000' : ('lt16000' as const);

export class HumanInput {
  readonly totals = emptyHumanCounts();
  private step = emptyHumanCounts();
  private readonly positions = new WeakMap<Page, Point>();
  readonly random: Random;
  /** The run's own guarded wait, so in-step pauses stay under its controls. */
  private readonly wait: (ms: number) => Promise<void>;
  private readonly realSleep: (ms: number) => Promise<void>;
  constructor(
    random: Random,
    wait: (ms: number) => Promise<void>,
    realSleep: (ms: number) => Promise<void> = (ms) => sleep(ms),
  ) {
    this.random = random;
    this.wait = wait;
    this.realSleep = realSleep;
  }
  beginStep(): HumanCounts {
    this.step = emptyHumanCounts();
    return this.step;
  }
  private count(update: (counts: HumanCounts) => void) {
    update(this.totals);
    update(this.step);
  }
  /** An extra of 0 to 50 percent of the ordered pace; never negative. */
  paceExtra(intervalMs: number): number {
    return Math.round(intervalMs * between(this.random, 0, 0.5));
  }
  countExtraWait(ms: number) {
    this.count((counts) => counts.extraWaitMsBucket[waitBucket(ms)]++);
  }
  /** 300 to 1,500 ms between the run's own actions inside a step. */
  async pause(): Promise<void> {
    const ms = Math.round(between(this.random, 300, 1500));
    this.countExtraWait(ms);
    await this.wait(ms);
  }
  async moveTo(page: Page, to: Point, width: number): Promise<void> {
    const from = this.positions.get(page) ?? { x: 0, y: 0 };
    const duration = fittsMs(Math.hypot(to.x - from.x, to.y - from.y), width);
    this.count((counts) => counts.pathMsBucket[pathBucket(duration)]++);
    const started = performance.now();
    for (const point of pointerPath(from, to, duration, this.random).slice(1)) {
      const due = started + point.t - performance.now();
      if (due > 0) await this.realSleep(due);
      await page.mouse.move(point.x, point.y);
      this.positions.set(page, { x: point.x, y: point.y });
    }
  }
  /** After a fallback click Playwright leaves the pointer at the centre. */
  placed(page: Page, point: Point) {
    this.positions.set(page, point);
  }
  /**
   * Move along a path to a random inner point, check that the element is
   * still the hit target there with Playwright's own actionability check,
   * press with a short hold. Returns false, before any press, when the check
   * fails twice; the caller then falls back to today's click.
   */
  async click(
    page: Page,
    locator: Locator,
    press: () => void,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const box = await locator
        .boundingBox({ timeout: 5000 })
        .catch(() => null);
      if (!box || box.width <= 0 || box.height <= 0) break;
      const target = targetPoint(box, this.random);
      await this.moveTo(page, target, Math.min(box.width, box.height));
      if (!(await stillHit(locator, target))) continue;
      press();
      await page.mouse.down();
      await this.realSleep(Math.round(between(this.random, 60, 180)));
      await page.mouse.up();
      this.count((counts) => counts.clicks++);
      return true;
    }
    this.count((counts) => counts.fallbacks++);
    return false;
  }
  /** Move onto the area, then 2 to 5 wheel events of 60 to 180 px. */
  async wheelBurst(page: Page, box: Box, before: () => void): Promise<void> {
    before();
    await this.moveTo(page, targetPoint(box, this.random), box.width);
    const events = 2 + Math.floor(this.random() * 4);
    for (let index = 0; index < events; index++) {
      if (index)
        await this.realSleep(Math.round(between(this.random, 40, 160)));
      before();
      await page.mouse.wheel(0, Math.round(between(this.random, 60, 180)));
    }
    this.count((counts) => counts.scrollBursts++);
  }
}
/**
 * A bounding-box re-read, then Playwright's own hit-target check at the point
 * (a trial hover, which runs in Playwright's utility world and blocks its own
 * pointer events), never a script in Instagram's page.
 */
async function stillHit(locator: Locator, point: Point): Promise<boolean> {
  try {
    const box = await locator.boundingBox({ timeout: 1000 });
    if (
      !box ||
      point.x < box.x ||
      point.y < box.y ||
      point.x > box.x + box.width ||
      point.y > box.y + box.height
    )
      return false;
    await locator.hover({
      trial: true,
      position: { x: point.x - box.x, y: point.y - box.y },
      timeout: 1000,
    });
    return true;
  } catch {
    return false;
  }
}

const inputs = new WeakMap<BrowserContext, HumanInput>();
/** Only reading runs whose written order sets humanInput register one. */
export function useHumanInput(context: BrowserContext, input: HumanInput) {
  inputs.set(context, input);
}
export function humanInputFor(page: Page): HumanInput | undefined {
  try {
    return typeof page.context === 'function'
      ? inputs.get(page.context())
      : undefined;
  } catch {
    return undefined;
  }
}

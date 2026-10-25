import { expect, test } from 'vitest';
import { summarizeFrame } from '../e2e/frame-attribution-model.ts';

test('asynchronous window lifetime and commit timestamp do not explain a long frame', () => {
  const result = summarizeFrame(0, 80, [
    {
      kind: 'window',
      start: 0,
      end: 80,
      selfMs: 0,
      detail: 'generated',
      scope: 'async-lifetime',
    },
    {
      kind: 'commit',
      start: 80,
      end: 80,
      selfMs: 0,
      detail: 'generated',
      scope: 'marker',
    },
  ]);
  expect(result.observedSyncWallMs).toBe(0);
  expect(result.unobservedMs).toBe(80);
  expect(result.largestMeasuredKind).toBeNull();
});
test('nested virtualizer and layout spans are not counted twice', () => {
  const result = summarizeFrame(0, 100, [
    {
      kind: 'virtualizer',
      start: 10,
      end: 80,
      selfMs: 20,
      detail: 'generated',
      scope: 'sync-wall',
    },
    {
      kind: 'layout',
      start: 20,
      end: 70,
      selfMs: 50,
      detail: 'generated',
      scope: 'sync-wall',
    },
  ]);
  expect(result.observedSyncWallMs).toBe(70);
  expect(result.unobservedMs).toBe(30);
  expect(result.exclusiveByKind).toEqual({ virtualizer: 20, layout: 50 });
  expect(result.largestMeasuredKind).toBe('layout');
});
test('spans crossing frame boundaries are clipped rather than counted fully twice', () => {
  const work = [
    {
      kind: 'callback',
      start: 0,
      end: 100,
      selfMs: 100,
      detail: 'generated',
      scope: 'sync-wall' as const,
    },
  ];
  expect(summarizeFrame(0, 60, work).exclusiveByKind.callback).toBe(60);
  expect(summarizeFrame(60, 100, work).exclusiveByKind.callback).toBe(40);
});

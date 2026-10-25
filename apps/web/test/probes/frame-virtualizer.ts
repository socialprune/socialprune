import { useVirtualizer as original } from '@tanstack/react-virtual';
import { measure } from './frame-runtime.ts';
export function useVirtualizer(...args: Parameters<typeof original>) {
  const result = measure('virtualizer-hook', () => original(...args));
  const target = result as unknown as Record<string, unknown>;
  for (const method of [
    'measureElement',
    '_measureElement',
    'resizeItem',
    'getMeasurements',
    'getVirtualItems',
    'getTotalSize',
    'calculateRange',
    'scrollToIndex',
    'measure',
  ]) {
    const callback = target[method];
    if (typeof callback !== 'function' || Reflect.get(callback, '__spMeasured'))
      continue;
    const wrapped = (...input: unknown[]) =>
      measure(
        `virtualizer-${method}`,
        () => Reflect.apply(callback, result, input) as unknown,
      );
    Reflect.set(wrapped, '__spMeasured', true);
    target[method] = wrapped;
  }
  return result;
}

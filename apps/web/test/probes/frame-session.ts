import { FeedSession as Original } from '../../src/review/feed/session.ts';
import { measure } from './frame-runtime.ts';
const prototype = Original.prototype as unknown as Record<string, unknown>;
const update = prototype['update'];
if (typeof update !== 'function')
  throw Error('Feed update probe target missing.');
prototype['update'] = function (this: Original, ...args: unknown[]) {
  const change = args[0] as Record<string, unknown>;
  return measure(
    'feed-count-window-update',
    () => Reflect.apply(update, this, args) as unknown,
    Object.keys(change).sort().join(','),
  );
};
export { Original as FeedSession };

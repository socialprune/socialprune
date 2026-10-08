import { registerHooks } from 'node:module';
import { isMainThread } from 'node:worker_threads';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'node:sqlite' && isMainThread)
      throw new Error('SQLITE_ON_HTTP_THREAD');
    return next(specifier, context);
  },
});

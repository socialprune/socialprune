import { registerHooks } from 'node:module';

// A negative loader, invoked only by the test process, not by production.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'node:sqlite')
      throw new Error(
        'The test forbids loading SQLite on a non-workspace path.',
      );
    return next(specifier, context);
  },
});

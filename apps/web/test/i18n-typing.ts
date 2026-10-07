import type { useT } from '../src/i18n/index.ts';

// Typecheck-only negative controls. This module is not an app entry/import.
export function messageTypeControls(t: ReturnType<typeof useT>) {
  t('import.complete', { count: 1 });
  // @ts-expect-error Unknown catalog ID must fail the generated contract.
  t('unknown.message');
  // @ts-expect-error Required plural argument must not be optional.
  t('import.complete');
  // @ts-expect-error Misspelled arguments must not pass the wrapper.
  t('import.complete', { counts: 1 });
  // @ts-expect-error Count is numeric, never a string.
  t('import.complete', { count: 'one' });
}

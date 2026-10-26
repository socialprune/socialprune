import type { FeedTab } from '@socialprune/core/criteria';
const key = 'sp-feed-single';
export function singleMode(workspace: string, account: string, tab: FeedTab) {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
    return (
      typeof raw === 'object' &&
      raw !== null &&
      Reflect.get(raw, JSON.stringify([workspace, account, tab])) === true
    );
  } catch {
    return false;
  }
}
export function setSingleMode(
  workspace: string,
  account: string,
  tab: FeedTab,
  single: boolean,
) {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
    const values =
      typeof raw === 'object' && raw !== null
        ? Object.fromEntries(
            Object.entries(raw)
              .filter(
                ([name, value]) =>
                  name.length <= 2048 && typeof value === 'boolean',
              )
              .slice(-999),
          )
        : {};
    values[JSON.stringify([workspace, account, tab])] = single;
    localStorage.setItem(key, JSON.stringify(values));
  } catch {
    /* A browser-local preference never changes workspace data. */
  }
}

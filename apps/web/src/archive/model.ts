import type { Item, OutcomeValue } from '@socialprune/core';

export interface ArchivedItem {
  item: Item;
  outcome: OutcomeValue;
}

export function bannerVariant(handle: string): number {
  let hash = 0;
  for (const char of handle.normalize('NFC').toLowerCase())
    hash = (Math.imul(hash, 31) + char.codePointAt(0)!) >>> 0;
  return hash % 4;
}

/** A foreign reply handle wins over a coincidentally matching exported ID. */
export function joinThreads(
  entries: readonly ArchivedItem[],
): ArchivedItem[][] {
  const byId = new Map(entries.map((entry) => [entry.item.id, entry]));
  const parent = new Map<string, string>();
  for (const { item } of entries) {
    if (item.kind !== 'reply' || !item.reference.replyToId) continue;
    const id = item.reference.replyToId.includes(':')
      ? item.reference.replyToId
      : `${item.platform}:${item.reference.replyToId}`;
    const target = byId.get(id)?.item;
    const handle = item.reference.replyToHandle
      ?.replace(/^@/, '')
      .toLowerCase();
    if (
      !target ||
      target.id === item.id ||
      target.platform !== item.platform ||
      target.account.key !== item.account.key
    )
      continue;
    if (
      handle &&
      handle !== item.account.handle?.replace(/^@/, '').toLowerCase()
    )
      continue;
    parent.set(item.id, target.id);
  }
  const groups = new Map<string, ArchivedItem[]>();
  for (const entry of entries) {
    let root = entry.item.id;
    const seen = new Set<string>();
    while (parent.has(root) && !seen.has(root)) {
      seen.add(root);
      root = parent.get(root)!;
    }
    // Cyclic references are not a thread; leave them as individual posts.
    if (seen.has(root)) root = entry.item.id;
    const group = groups.get(root) ?? [];
    group.push(entry);
    groups.set(root, group);
  }
  return [...groups.values()]
    .map((group) =>
      group.sort((a, b) => a.item.createdAt.localeCompare(b.item.createdAt)),
    )
    .sort((a, b) =>
      b.at(-1)!.item.createdAt.localeCompare(a.at(-1)!.item.createdAt),
    );
}

export function recap(
  entries: readonly ArchivedItem[],
  now = new Date(),
  zone = 'UTC',
) {
  const years = new Map<string, number>();
  const yearFormat = new Intl.DateTimeFormat('en', {
    year: 'numeric',
    timeZone: zone,
  });
  let oldest: string | null = null,
    likes: number | null = null,
    lols = 0;
  for (const { item } of entries) {
    if (!oldest || item.createdAt < oldest) oldest = item.createdAt;
    const year = yearFormat.format(new Date(item.createdAt));
    years.set(year, (years.get(year) ?? 0) + 1);
    if (item.engagement.likes !== null)
      likes = Math.max(likes ?? 0, item.engagement.likes);
    lols += (item.text.match(/\blol\b/giu) ?? []).length;
  }
  const active = [...years].sort(
    (a, b) => b[1] - a[1] || b[0].localeCompare(a[0]),
  )[0];
  const first = oldest ? new Date(oldest) : null;
  let age = first ? now.getUTCFullYear() - first.getUTCFullYear() : 0;
  if (
    first &&
    (now.getUTCMonth() < first.getUTCMonth() ||
      (now.getUTCMonth() === first.getUTCMonth() &&
        now.getUTCDate() < first.getUTCDate()))
  )
    age--;
  return {
    age: Math.max(0, age),
    year: active?.[0] ?? null,
    activeCount: active?.[1] ?? 0,
    likes,
    lols,
    oldest,
    years: [...years.keys()].sort().reverse(),
  };
}

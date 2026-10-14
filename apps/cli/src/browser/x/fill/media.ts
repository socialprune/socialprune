import type { OriginalMedia } from '@socialprune/core';

/** A later gated answer never removes an earlier stored file or arms a download. */
export function mergeFillMedia(
  current: readonly OriginalMedia[],
  previous: readonly OriginalMedia[],
  gated: boolean,
): OriginalMedia[] {
  if (gated) {
    const retained = new Map(
      previous
        .filter((entry) => entry.status === 'stored' || entry.poster !== null)
        .map((entry) => [
          entry.n,
          entry.status === 'stored'
            ? entry
            : {
                ...entry,
                status: 'not-stored' as const,
                url: null,
                file: null,
                bytes: null,
              },
        ]),
    );
    for (const entry of current)
      if (!retained.has(entry.n))
        retained.set(entry.n, {
          ...entry,
          status: 'not-stored',
          url: null,
          file: null,
          poster: null,
          bytes: null,
        });
    return [...retained.values()].sort((a, b) => a.n - b.n);
  }
  return current.map((entry) => {
    const stored = previous.find(
      (value) =>
        value.n === entry.n &&
        value.kind === entry.kind &&
        value.url === entry.url &&
        value.status === 'stored',
    );
    return stored
      ? {
          ...entry,
          status: stored.status,
          file: stored.file,
          poster: stored.poster,
          bytes: stored.bytes,
        }
      : entry;
  });
}

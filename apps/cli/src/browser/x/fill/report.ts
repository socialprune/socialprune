import { object } from '@socialprune/core';
export function structureReport(body: unknown): {
  paths: { path: string; type: string }[];
  entries: Record<string, number>;
} {
  const paths = new Map<string, string>(),
    entries: Record<string, number> = {};
  function walk(value: unknown, path: string) {
    const type = Array.isArray(value)
      ? 'array'
      : value === null
        ? 'null'
        : typeof value;
    paths.set(path, type);
    if (Array.isArray(value))
      for (const entry of value) walk(entry, path + '[]');
    else if (value && typeof value === 'object')
      for (const [key, entry] of Object.entries(object(value))) {
        if (key === 'entryId' && typeof entry === 'string') {
          const prefix = /^tweet-\d+$/.test(entry)
            ? 'tweet-*'
            : entry.startsWith('cursor-')
              ? 'cursor-*'
              : entry.startsWith('promoted-')
                ? 'promoted-*'
                : 'other';
          entries[prefix] = (entries[prefix] ?? 0) + 1;
        }
        walk(entry, path ? path + '.' + key : key);
      }
  }
  walk(body, '');
  return { paths: [...paths].map(([path, type]) => ({ path, type })), entries };
}

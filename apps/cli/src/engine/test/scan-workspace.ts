import { contractWorkspace } from '@socialprune/core/workspace/store-contract';

/** Generated scan entries with a complete import, so review summary exposes the account. */
export function scanWorkspace(count = 75) {
  const seed = contractWorkspace();
  seed.settings.criteria = {
    selected: ['political'],
    custom: [],
    nextCustom: 1,
    level: 0,
  };
  seed.items = Array.from({ length: count }, (_, index) => ({
    ...seed.items[0]!,
    id: `x:generated-${index}`,
    text: `Generated packaged scan note ${index}.`,
  }));
  seed.counts.items = seed.items.length;
  seed.imports = [
    {
      id: 'generated-scan-import',
      platform: 'x',
      importedAt: seed.createdAt,
      archives: ['contract'],
      exportCreatedAt: null,
      accounts: [{ ...seed.items[0]!.account }],
      adapter: { name: 'generated', version: '1' },
      variant: null,
      diagnostics: [],
      itemCount: count,
      status: 'complete',
    },
  ];
  seed.counts.imports = 1;
  return seed;
}

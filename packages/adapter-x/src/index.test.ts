import { expect, test } from 'vitest';
import { createMemoryArchive, importArchive } from '@socialprune/core';
import type { ArchiveReader, Item } from '@socialprune/core';
import {
  listFixtureVariants,
  loadFixtureVariant,
} from '@socialprune/fixture-gen';
import { xAdapter } from './index.ts';

const variantIds = await listFixtureVariants('x');
test('fixture matrix is present, not a vacuous sweep', () => {
  expect(variantIds).toContain('current-minimal');
  expect(variantIds).toContain('injection');
  expect(variantIds).toContain('two-accounts');
});
for (const id of variantIds) {
  test.each(['directory', 'zip'] as const)(
    `${id} through %s import`,
    async (as) => {
      const { archive, expected } = await loadFixtureVariant('x', id, { as });
      const items: Item[] = [];
      try {
        const summary = await importArchive(archive, [xAdapter], {
          onItems(batch) {
            items.push(...batch);
          },
        });
        const records = summary.records.map(
          ({
            platform,
            accounts,
            variant,
            exportCreatedAt,
            itemCount,
            diagnostics,
          }) => ({
            platform,
            accounts,
            variant,
            exportCreatedAt,
            itemCount,
            diagnostics,
          }),
        );
        expect({ status: summary.status, records, items }).toEqual(expected);
      } finally {
        await archive.close();
      }
    },
  );
}

test.each(['directory', 'zip'] as const)(
  'injection never executes through %s',
  async (as) => {
    const planted = globalThis as typeof globalThis & { __pwned?: unknown };
    expect(planted.__pwned).toBeUndefined();
    const { archive } = await loadFixtureVariant('x', 'injection', { as });
    try {
      const items: Item[] = [];
      const summary = await importArchive(archive, [xAdapter], {
        onItems(batch) {
          items.push(...batch);
        },
      });
      expect(summary.status).toBe('partial');
      expect(
        summary.records[0]?.diagnostics.find(
          ({ category }) => category === 'tweets',
        ),
      ).toMatchObject({ status: 'unreadable', count: 0 });
      expect(items).toEqual([]);
      expect(planted.__pwned).toBeUndefined();
    } finally {
      await archive.close();
    }
  },
);

test('metadata reads are bounded, tweets streamed, private entries never opened', async () => {
  const { archive: original } = await loadFixtureVariant(
    'x',
    'private-files-ignored',
    { as: 'zip' },
  );
  const opened: string[] = [];
  const archive: ArchiveReader = {
    archives: original.archives,
    rejectedEntries: original.rejectedEntries,
    list: () => original.list(),
    close: () => original.close(),
    readText(entry, opts) {
      expect(entry.path).toMatch(/^data\/(?:account|manifest)\.js$/);
      expect(opts?.maxBytes).toBeLessThanOrEqual(1024 * 1024);
      opened.push(entry.path);
      return original.readText(entry, opts);
    },
    streamText(entry, opts) {
      expect(entry.path).toBe('data/tweets.js');
      opened.push(entry.path);
      return original.streamText(entry, opts);
    },
  };
  try {
    const items: Item[] = [];
    const summary = await importArchive(archive, [xAdapter], {
      onItems(batch) {
        items.push(...batch);
      },
    });
    expect(summary.status).toBe('ok');
    expect(opened).toEqual([
      'data/account.js',
      'data/manifest.js',
      'data/tweets.js',
    ]);
    const rendered = JSON.stringify({ summary, items });
    for (const sentinel of [
      'NEVER_OPEN_',
      'never-open@example.com',
      'orbit_quokka@example.org',
      'Invented Orbit',
      'Invented private payload',
    ])
      expect(rendered).not.toContain(sentinel);
  } finally {
    await archive.close();
  }
});

test('private paths cannot impersonate public data even with matching basenames', async () => {
  const original = createMemoryArchive('archive', {
    'data/direct-messages/data/tweets.js': 'this must not be read',
    'private/data/tweets.js': 'this must not be read either',
    'login/data/account.js': 'this must not be read either',
  });
  const reader: ArchiveReader = {
    ...original,
    archives: original.archives,
    rejectedEntries: 0,
    list: () => original.list(),
    readText() {
      throw new Error('Unexpected content read.');
    },
    streamText() {
      throw new Error('Unexpected content stream.');
    },
    close: () => original.close(),
  };
  try {
    expect((await importArchive(reader, [xAdapter])).status).toBe(
      'unknown-format',
    );
  } finally {
    await original.close();
  }
});

test('cancellation is propagated instead of downgraded to an unreadable category', async () => {
  const { archive } = await loadFixtureVariant('x', 'split-parts', {
    as: 'directory',
  });
  const controller = new AbortController();
  try {
    await expect(
      importArchive(archive, [xAdapter], {
        signal: controller.signal,
        batchSize: 1,
        onItems() {
          controller.abort();
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  } finally {
    await archive.close();
  }
});

test('deletion hints contain only the platform review URL and human action', async () => {
  const { archive } = await loadFixtureVariant('x', 'current-rich', {
    as: 'directory',
  });
  const items: Item[] = [];
  try {
    await importArchive(archive, [xAdapter], {
      onItems(batch) {
        items.push(...batch);
      },
    });
    for (const item of items)
      expect(xAdapter.deletionHint(item)).toEqual({
        action: item.kind === 'repost' ? 'undo-repost' : 'delete',
        url: `https://x.com/i/web/status/${item.id.slice(2)}`,
        group: null,
      });
  } finally {
    await archive.close();
  }
});

test('a failed preliminary note pass cannot invent a unique match', async () => {
  const { archive: original } = await loadFixtureVariant('x', 'note-tweets', {
    as: 'directory',
  });
  let tweetReads = 0;
  const reader: ArchiveReader = {
    archives: original.archives,
    rejectedEntries: 0,
    list: () => original.list(),
    close: () => original.close(),
    readText: (entry, opts) => original.readText(entry, opts),
    streamText(entry, opts) {
      if (entry.path === 'data/tweets.js' && ++tweetReads === 1)
        throw new Error('Test-only preliminary stream failure.');
      return original.streamText(entry, opts);
    },
  };
  try {
    const items: Item[] = [];
    const summary = await importArchive(reader, [xAdapter], {
      onItems(batch) {
        items.push(...batch);
      },
    });
    expect(summary.status).toBe('partial');
    expect(items[0]?.text).toBe(
      'A unique lantern note\u2026 https://t.co/note',
    );
    expect(
      summary.records[0]?.diagnostics.find(
        ({ category }) => category === 'tweets',
      ),
    ).toMatchObject({ status: 'unreadable', count: 4 });
    expect(
      summary.records[0]?.diagnostics.find(
        ({ category }) => category === 'unmatched-note-tweets',
      ),
    ).toMatchObject({ status: 'skipped', count: 5 });
  } finally {
    await reader.close();
  }
});

test('an unreadable notes file cannot invent a unique match from its valid prefix', async () => {
  const target = (name: string) => ['window', 'YTD', name, 'part0'].join('.');
  const archive = createMemoryArchive('archive', {
    'data/tweets.js': `${target('tweets')} = ${JSON.stringify([
      {
        tweet: {
          id_str: '9007199254749999',
          created_at: 'Wed Oct 10 20:19:24 +0000 2018',
          full_text: 'Invented prefix\u2026',
        },
      },
    ])};`,
    'data/note-tweet.js': `${target('note_tweet')} = [${JSON.stringify({
      noteTweet: {
        createdAt: '2018-10-10T20:19:24.000Z',
        core: { text: 'Invented prefix and a complete version.' },
      },
    })}, invalid];`,
  });
  try {
    const items: Item[] = [];
    const summary = await importArchive(archive, [xAdapter], {
      onItems(batch) {
        items.push(...batch);
      },
    });
    expect(summary.status).toBe('partial');
    expect(items[0]?.text).toBe('Invented prefix\u2026');
    expect(
      summary.records[0]?.diagnostics.find(
        ({ category }) => category === 'note-tweets',
      ),
    ).toMatchObject({ status: 'unreadable', count: 1 });
    expect(
      summary.records[0]?.diagnostics.find(
        ({ category }) => category === 'unmatched-note-tweets',
      ),
    ).toMatchObject({ status: 'skipped', count: 1 });
  } finally {
    await archive.close();
  }
});

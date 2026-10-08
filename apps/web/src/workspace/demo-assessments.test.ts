import { readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import type { Assessment, Item, ImportRecord } from '@socialprune/core';
import {
  createMemoryStore,
  MemoryStoreBacking,
} from '@socialprune/core/workspace/memory-store';
import {
  createWorkspace,
  readWorkspace,
} from '@socialprune/core/workspace/store';
import { attachDemoAssessments } from './demo-assessments.ts';

test('worker-internal examples are imported-ID filtered, idempotent and rejected in a personal workspace', async () => {
  const root = new URL('../../../../fixtures/synthetic/demo/', import.meta.url);
  const assessments = JSON.parse(
    await readFile(new URL('assessments.json', root), 'utf8'),
  ) as Assessment[];
  const expected = JSON.parse(
    await readFile(new URL('x/expected.json', root), 'utf8'),
  ) as {
    items: Item[];
    records: Omit<ImportRecord, 'id' | 'status' | 'adapter' | 'importedAt'>[];
  };
  const fixture = createWorkspace({ kind: 'demo' });
  fixture.items = expected.items;
  fixture.imports = expected.records.map((record, index) => ({
    ...record,
    id: `demo-import-${index}`,
    status: 'complete',
    archives: [expected.items[0]!.provenance.archive],
    importedAt: fixture.createdAt,
    adapter: { name: 'fixture', version: '1' },
  }));
  fixture.counts.items = fixture.items.length;
  fixture.counts.imports = fixture.imports.length;
  const demo = createMemoryStore(new MemoryStoreBacking(fixture));
  const personal = createMemoryStore(
    new MemoryStoreBacking({ ...fixture, kind: 'personal' }),
  );
  try {
    await expect(
      attachDemoAssessments(personal, assessments),
    ).rejects.toMatchObject({ code: 'FIXTURE_NOT_ALLOWED' });
    expect((await personal.read(readWorkspace)).assessments).toEqual([]);
    await attachDemoAssessments(demo, assessments);
    await attachDemoAssessments(demo, assessments);
    const ids = new Set(expected.items.map(({ id }) => id));
    expect((await demo.read(readWorkspace)).assessments).toEqual(
      assessments.filter(({ itemId }) => ids.has(itemId)),
    );
    expect((await demo.read(readWorkspace)).decisionEvents).toEqual([]);
  } finally {
    await demo.close();
    await personal.close();
  }
});

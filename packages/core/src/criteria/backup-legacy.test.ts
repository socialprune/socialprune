import { expect, test } from 'vitest';
import { createWorkspace, readWorkspace } from '../workspace/store.ts';
import { createMemoryStore } from '../workspace/memory-store.ts';
import { restoreBackup } from '../workspace/backup.ts';
import { writeInstagramContextContract } from '../workspace/store-contract.ts';

const chunks = (value: unknown) =>
  (async function* () {
    await Promise.resolve();
    yield JSON.stringify(value);
  })();
test('backup-context first cause is the post-v6 reviewPlans field on a downgraded current fixture, not its confirmation evidence', async () => {
  const source = createMemoryStore();
  await writeInstagramContextContract(source);
  const current = await source.read(readWorkspace);
  await source.close();
  const hybrid = { ...current, schemaVersion: 6 };
  const bad = createMemoryStore();
  await expect(restoreBackup(bad, chunks(hybrid))).rejects.toMatchObject({
    code: 'BACKUP_INVALID_SCHEMA',
    cause: { code: 'BACKUP_INVALID_SCHEMA' },
  });
  await bad.close();
  const legacy = structuredClone(hybrid);
  delete legacy.reviewPlans;
  delete legacy.counts.reviewPlans;
  delete legacy.settings.criteria;
  delete legacy.settings.keepRules;
  const good = createMemoryStore();
  try {
    await restoreBackup(good, chunks(legacy));
    expect((await good.read(readWorkspace)).instagramContext).toEqual(
      current.instagramContext,
    );
  } finally {
    await good.close();
  }
});

test('v6 may not carry a reviewPlans array even empty', async () => {
  const current = createWorkspace();
  const target = createMemoryStore();
  try {
    await expect(
      restoreBackup(target, chunks({ ...current, schemaVersion: 6 })),
    ).rejects.toHaveProperty('code', 'BACKUP_INVALID_SCHEMA');
  } finally {
    await target.close();
  }
});

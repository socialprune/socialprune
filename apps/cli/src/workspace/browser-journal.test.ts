import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';
import {
  OriginalsFillWriter,
  records,
} from '@socialprune/core/workspace/store';
import { fixtureWorkspace, FIXTURE } from '../../e2e/fake-x/fixture.ts';
import { planDeletion } from '../browser/plan.ts';
import { migrateOriginal } from '@socialprune/core';
import { InstagramContextWriter } from '@socialprune/core/workspace/instagram-context-writer';
import { instagramContractRecord } from '@socialprune/core/workspace/store-contract';
import {
  instagramFixture,
  IG_FIXTURE,
} from '../../e2e/fake-instagram/fixture.ts';
import { SQLiteStore } from './sqlite-store.ts';
import { acknowledgeWarningCard } from '../commands/delete.ts';

test('D6 warning gate survives reopen, rejects early and wrong acknowledgements and binds the latest warned run', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sp-d6-warning-'));
  const path = join(directory, 'socialprune.sqlite');
  let store = await SQLiteStore.open(path, {
    initial: fixtureWorkspace(['1001']),
  });
  const at = '2026-10-11T22:30:00.000Z';
  try {
    const writer = store.browserOutcomeWriter();
    await writer.begin({
      runId: 'warned',
      platform: 'x',
      accountKey: FIXTURE.account.key,
      mode: 'delete',
      planHash: 'a'.repeat(64),
      startedAt: at,
      endedAt: null,
      endReason: null,
      bodyShapes: {},
      profileReport: null,
    });
    await writer.recordXWarning(
      'warned',
      at,
      'America/Los_Angeles',
      'http-429',
    );
    await writer.finish({
      runId: 'warned',
      platform: 'x',
      accountKey: FIXTURE.account.key,
      mode: 'delete',
      planHash: 'a'.repeat(64),
      startedAt: at,
      endedAt: at,
      endReason: 'platform-check',
      warningKind: 'http-429',
      bodyShapes: {},
      profileReport: null,
    });
    await store.close();
    store = await SQLiteStore.open(path);
    const reopened = store.browserOutcomeWriter();
    await expect(
      reopened.requireXWarningClear(
        FIXTURE.account.key,
        '2026-10-12T01:00:00.000Z',
        'America/Los_Angeles',
      ),
    ).rejects.toMatchObject({ code: 'X_WARNING_DAY' });
    await expect(
      reopened.requireXWarningClear(
        FIXTURE.account.key,
        '2026-10-12T08:00:00.000Z',
        'America/Los_Angeles',
      ),
    ).rejects.toMatchObject({ code: 'X_WARNING_CARD_REQUIRED' });
    const read = vi.fn(() => Promise.resolve('wrong'));
    await expect(
      acknowledgeWarningCard(
        store,
        FIXTURE.account.key,
        'warned',
        '2026-10-12T01:00:00.000Z',
        'America/Los_Angeles',
        'en',
        read,
      ),
    ).rejects.toMatchObject({ code: 'X_WARNING_DAY' });
    expect(read).not.toHaveBeenCalled();
    await expect(
      acknowledgeWarningCard(
        store,
        FIXTURE.account.key,
        'warned',
        '2026-10-12T08:00:00.000Z',
        'America/Los_Angeles',
        'en',
        read,
      ),
    ).rejects.toMatchObject({ code: 'X_WARNING_CARD_REQUIRED' });
    await acknowledgeWarningCard(
      store,
      FIXTURE.account.key,
      'warned',
      '2026-10-12T08:00:00.000Z',
      'America/Los_Angeles',
      'de',
      () => Promise.resolve('Ich habe die Karte zu warned gelesen'),
    );
    await expect(
      reopened.requireXWarningClear(
        FIXTURE.account.key,
        '2026-10-12T08:00:00.000Z',
        'America/Los_Angeles',
      ),
    ).resolves.toBeUndefined();
    await expect(
      reopened.acknowledgeXWarning(
        FIXTURE.account.key,
        'other-run',
        '2026-10-12T08:00:00.000Z',
        'America/Los_Angeles',
      ),
    ).rejects.toMatchObject({ code: 'X_WARNING_CARD_REQUIRED' });
    await store.close();
    store = await SQLiteStore.open(path);
    expect(
      await store.browserOutcomeWriter().xWarning(FIXTURE.account.key),
    ).toMatchObject({ runId: 'warned', acknowledged: true });
    const portable = await store.read(async (tx) => ({
      browserRuns: await records(tx.browserRuns),
      browserAttempts: await records(tx.browserAttempts),
    }));
    const restored = await SQLiteStore.open(
      join(directory, 'restored.sqlite'),
      {
        initial: {
          ...fixtureWorkspace(['1001']),
          browserRuns: portable.browserRuns,
          browserAttempts: portable.browserAttempts,
          counts: {
            ...fixtureWorkspace(['1001']).counts,
            browserRuns: portable.browserRuns.length,
            browserAttempts: portable.browserAttempts.length,
          },
        },
      },
    );
    try {
      await restored.browserOutcomeWriter().rebuildXWarnings();
      await expect(
        restored
          .browserOutcomeWriter()
          .requireXWarningClear(
            FIXTURE.account.key,
            '2026-10-13T12:00:00.000Z',
            'Europe/Berlin',
          ),
      ).rejects.toMatchObject({ code: 'X_WARNING_CARD_REQUIRED' });
      expect(
        await restored.browserOutcomeWriter().xWarning(FIXTURE.account.key),
      ).toMatchObject({ runId: 'warned', acknowledged: false });
    } finally {
      await restored.close();
    }
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('D7 B profile gate survives an older or fresh workspace and acknowledgement clears both copies', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sp-d7-profile-gate-'));
  const profile = join(directory, 'profile');
  const { createProfile, profileSnapshot, changedProfileFiles } =
    await import('../browser/profile.ts');
  const { requireXWarningFileClear, readXWarningFile } =
    await import('./x-warning-file.ts');
  await createProfile(profile);
  const before = await profileSnapshot(profile);
  const store = await SQLiteStore.open(join(directory, 'original.sqlite'), {
    initial: fixtureWorkspace(['1001']),
  });
  try {
    const writer = store.browserOutcomeWriter();
    writer.bindXWarningProfile(profile);
    const run = {
      runId: 'mirrored-warning',
      platform: 'x' as const,
      accountKey: FIXTURE.account.key,
      mode: 'delete' as const,
      planHash: 'a'.repeat(64),
      startedAt: FIXTURE.now,
      endedAt: null,
      endReason: null,
      bodyShapes: {},
      profileReport: null,
    };
    await writer.begin(run);
    await writer.recordXWarning(
      run.runId,
      FIXTURE.now,
      'Europe/Berlin',
      'http-429',
    );
    await writer.finish({
      ...run,
      endedAt: FIXTURE.now,
      endReason: 'platform-check',
      warningKind: 'http-429',
    });
    expect(changedProfileFiles(before, await profileSnapshot(profile))).toEqual(
      ['socialprune-x-warning.json'],
    );
    for (const name of ['older-backup', 'fresh-workspace']) {
      const other = await SQLiteStore.open(join(directory, `${name}.sqlite`), {
        initial: fixtureWorkspace(['1001']),
      });
      try {
        expect(
          await other.browserOutcomeWriter().xWarning(FIXTURE.account.key),
        ).toBeNull();
        await expect(
          requireXWarningFileClear(profile, FIXTURE.now, 'Europe/Berlin'),
        ).rejects.toMatchObject({ code: 'X_WARNING_DAY' });
        await expect(
          requireXWarningFileClear(
            profile,
            '2026-10-12T12:00:00.000Z',
            'Europe/Berlin',
          ),
        ).rejects.toMatchObject({ code: 'X_WARNING_CARD_REQUIRED' });
        const { runWithDependencies } = await import('../browser/runner.ts');
        const { planDeletion } = await import('../browser/plan.ts');
        const launch = vi.fn(() => {
          throw new Error('Must refuse before browser');
        });
        await expect(
          runWithDependencies(
            {
              store: other,
              profile,
              plan: await planDeletion(
                other,
                FIXTURE.account.key,
                new Set(),
                new Date('2026-10-12T12:00:00.000Z'),
              ),
              executablePath: 'generated',
              verify: false,
              list: '',
              lang: 'en',
              signal: new AbortController().signal,
              now: () => new Date('2026-10-12T12:00:00.000Z'),
              notice() {},
            },
            {
              pace: {
                intervalMs: 30000,
                batchSize: 20,
                pauseMs: 900000,
                perDay: 200,
              },
              confirmationPort: 0,
              sleep: () => Promise.resolve(),
              driver: launch,
            },
          ),
        ).rejects.toMatchObject({ code: 'X_WARNING_CARD_REQUIRED' });
        expect(launch).not.toHaveBeenCalled();
      } finally {
        await other.close();
      }
    }
    await acknowledgeWarningCard(
      store,
      FIXTURE.account.key,
      run.runId,
      '2026-10-12T12:00:00.000Z',
      'Europe/Berlin',
      'en',
      () => Promise.resolve(`I read the card for ${run.runId}`),
      profile,
    );
    expect(await readXWarningFile(profile)).toBeNull();
    await expect(
      writer.requireXWarningClear(
        FIXTURE.account.key,
        '2026-10-12T12:00:00.000Z',
        'Europe/Berlin',
      ),
    ).resolves.toBeUndefined();
    const markerRun = {
      ...run,
      runId: 'fresh-profile-warning',
      startedAt: '2026-10-12T12:00:00.000Z',
    };
    await writer.begin(markerRun);
    await writer.recordXWarning(
      markerRun.runId,
      markerRun.startedAt,
      'Europe/Berlin',
      'limit-notice',
    );
    await writer.finish({
      ...markerRun,
      endedAt: markerRun.startedAt,
      endReason: 'platform-check',
      warningKind: 'limit-notice',
    });
    const fresh = await SQLiteStore.open(
      join(directory, 'fresh-after-warning.sqlite'),
      { initial: fixtureWorkspace(['1001']) },
    );
    try {
      await acknowledgeWarningCard(
        fresh,
        FIXTURE.account.key,
        markerRun.runId,
        '2026-10-13T12:00:00.000Z',
        'Europe/Berlin',
        'en',
        () => Promise.resolve(`I read the card for ${markerRun.runId}`),
        profile,
      );
      expect(await readXWarningFile(profile)).toBeNull();
      expect(
        await fresh.browserOutcomeWriter().xWarning(FIXTURE.account.key),
      ).toMatchObject({ runId: markerRun.runId, acknowledged: true });
    } finally {
      await fresh.close();
    }
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('D8 an acknowledged newer warning in another workspace cannot strand an older profile gate', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sp-d8-profile-ack-'));
  const { createProfile } = await import('../browser/profile.ts');
  const { readXWarningFile, requireXWarningFileClear } =
    await import('./x-warning-file.ts');
  const profiles = [join(directory, 'profile-a'), join(directory, 'profile-b')];
  const stores: SQLiteStore[] = [];
  try {
    for (const [index, profile] of profiles.entries()) {
      await createProfile(profile);
      const store = await SQLiteStore.open(join(directory, `${index}.sqlite`), {
        initial: fixtureWorkspace(['1001']),
      });
      stores.push(store);
      const writer = store.browserOutcomeWriter();
      writer.bindXWarningProfile(profile);
      const run = {
        runId: `warning-${index}`,
        platform: 'x' as const,
        accountKey: FIXTURE.account.key,
        mode: 'delete' as const,
        planHash: 'a'.repeat(64),
        startedAt: `2026-10-${11 + index}T12:00:00.000Z`,
        endedAt: null,
        endReason: null,
        bodyShapes: {},
        profileReport: null,
      };
      await writer.begin(run);
      await writer.recordXWarning(run.runId, run.startedAt, 'UTC', 'http-429');
      await writer.finish({
        ...run,
        endedAt: run.startedAt,
        endReason: 'platform-check',
        warningKind: 'http-429',
      });
    }
    const other = stores[1]!;
    const before = await readXWarningFile(profiles[0]!);
    const noPrompt = vi.fn(() =>
      Promise.resolve('I read the card for warning-0'),
    );
    await expect(
      acknowledgeWarningCard(
        other,
        FIXTURE.account.key,
        'warning-0',
        '2026-10-13T12:00:00.000Z',
        'UTC',
        'en',
        noPrompt,
        profiles[0],
      ),
    ).rejects.toMatchObject({ code: 'X_WARNING_CARD_REQUIRED' });
    expect(noPrompt).not.toHaveBeenCalled();
    // Mirroring the newer unacknowledged warning can only strengthen P's gate.
    expect(await readXWarningFile(profiles[0]!)).toMatchObject({
      runId: 'warning-1',
    });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      join(profiles[0]!, 'socialprune-x-warning.json'),
      JSON.stringify(before),
    );
    await acknowledgeWarningCard(
      other,
      FIXTURE.account.key,
      'warning-1',
      '2026-10-13T12:00:00.000Z',
      'UTC',
      'en',
      () => Promise.resolve('I read the card for warning-1'),
      profiles[1],
    );
    expect(await readXWarningFile(profiles[1]!)).toBeNull();
    await expect(
      requireXWarningFileClear(profiles[0]!, '2026-10-13T12:00:00.000Z', 'UTC'),
    ).rejects.toMatchObject({ code: 'X_WARNING_CARD_REQUIRED' });
    const wrong = vi.fn(() => Promise.resolve('I read the card for warning-1'));
    await expect(
      acknowledgeWarningCard(
        other,
        FIXTURE.account.key,
        'warning-0',
        '2026-10-13T12:00:00.000Z',
        'UTC',
        'en',
        wrong,
        profiles[0],
      ),
    ).rejects.toMatchObject({ code: 'X_WARNING_CARD_REQUIRED' });
    expect(await readXWarningFile(profiles[0]!)).toMatchObject({
      runId: 'warning-0',
    });
    const race = vi.fn(async () => {
      const writer = other.browserOutcomeWriter();
      writer.bindXWarningProfile(profiles[0]!);
      const run = {
        runId: 'warning-during-prompt',
        platform: 'x' as const,
        accountKey: FIXTURE.account.key,
        mode: 'delete' as const,
        planHash: 'a'.repeat(64),
        startedAt: '2026-10-13T12:00:00.000Z',
        endedAt: null,
        endReason: null,
        bodyShapes: {},
        profileReport: null,
      };
      await writer.begin(run);
      await writer.recordXWarning(run.runId, run.startedAt, 'UTC', 'http-429');
      await writer.finish({
        ...run,
        endedAt: run.startedAt,
        endReason: 'platform-check',
        warningKind: 'http-429',
      });
      return 'I read the card for warning-0';
    });
    await expect(
      acknowledgeWarningCard(
        other,
        FIXTURE.account.key,
        'warning-0',
        '2026-10-13T12:00:00.000Z',
        'UTC',
        'en',
        race,
        profiles[0],
      ),
    ).rejects.toMatchObject({ code: 'X_WARNING_CARD_REQUIRED' });
    expect(race).toHaveBeenCalledOnce();
    expect(await readXWarningFile(profiles[0]!)).toMatchObject({
      runId: 'warning-during-prompt',
    });
    await expect(
      requireXWarningFileClear(profiles[0]!, '2026-10-13T12:00:00.000Z', 'UTC'),
    ).rejects.toMatchObject({ code: 'X_WARNING_DAY' });
    await acknowledgeWarningCard(
      other,
      FIXTURE.account.key,
      'warning-during-prompt',
      '2026-10-14T12:00:00.000Z',
      'UTC',
      'en',
      () => Promise.resolve('I read the card for warning-during-prompt'),
      profiles[0],
    );
    // Restore the independent W1 marker to exercise its ordinary acknowledgement
    // after the newer warning has also been acknowledged, never by clearing it.
    await writeFile(
      join(profiles[0]!, 'socialprune-x-warning.json'),
      JSON.stringify(before),
    );
    await acknowledgeWarningCard(
      other,
      FIXTURE.account.key,
      'warning-0',
      '2026-10-14T12:00:00.000Z',
      'UTC',
      'en',
      () => Promise.resolve('I read the card for warning-0'),
      profiles[0],
    );
    expect(await readXWarningFile(profiles[0]!)).toBeNull();
    expect(
      await other.browserOutcomeWriter().xWarning(FIXTURE.account.key),
    ).toMatchObject({ runId: 'warning-during-prompt', acknowledged: true });
    await expect(
      other
        .browserOutcomeWriter()
        .requireXWarningClear(
          FIXTURE.account.key,
          '2026-10-14T12:00:00.000Z',
          'UTC',
        ),
    ).resolves.toBeUndefined();
    // The other workspace's marker cannot clear A's independent database gate.
    expect(
      await stores[0]!.browserOutcomeWriter().xWarning(FIXTURE.account.key),
    ).toMatchObject({ runId: 'warning-0', acknowledged: false });
    await stores[1]!.close();
    stores[1] = await SQLiteStore.open(join(directory, '1.sqlite'));
    expect(
      await stores[1]
        .browserOutcomeWriter()
        .xWarning(FIXTURE.account.key, 'warning-0'),
    ).toMatchObject({ runId: 'warning-0', acknowledged: true });
  } finally {
    for (const store of stores) await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test.each(['delete', 'verify'] as const)(
  'D2 %s starts after a positively dead fill run and preserves the read identity',
  async (mode) => {
    const directory = await mkdtemp(join(tmpdir(), 'sp-d2-recovery-'));
    const store = await SQLiteStore.open(
      join(directory, 'socialprune.sqlite'),
      { initial: fixtureWorkspace(['1001']) },
    );
    const fill = new OriginalsFillWriter(store);
    await store.write((tx) =>
      tx.originals.put(
        migrateOriginal({
          id: '900001',
          status: 'not-found',
          fetchedAt: FIXTURE.now,
          text: null,
          authorName: null,
          authorHandle: null,
          photos: [],
          quotedId: null,
          parentId: null,
          raw: null,
          textCompleteness: 'unknown',
          video: null,
        }),
      ),
    );
    await fill.startRun({
      runId: 'dead-fill',
      accountKey: FIXTURE.account.key,
      planHash: 'a'.repeat(64),
      canary: false,
      startedAt: FIXTURE.now,
      ownerPid: 2147483647,
    });
    await fill.sending({
      runId: 'dead-fill',
      attemptId: 'dead-read',
      originalId: '900001',
      at: FIXTURE.now,
    });
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('Generated dead process'), {
        code: 'ESRCH',
      });
    });
    try {
      const writer = store.browserOutcomeWriter();
      await writer.begin({
        runId: `new-${mode}`,
        platform: 'x',
        accountKey: FIXTURE.account.key,
        mode,
        planHash: mode === 'verify' ? null : 'b'.repeat(64),
        startedAt: FIXTURE.now,
        endedAt: null,
        endReason: null,
        bodyShapes: {},
        profileReport: null,
        ownerPid: process.pid,
      });
      expect(kill).toHaveBeenCalledWith(2147483647, 0);
      expect(
        (await store.read((tx) => records(tx.browserRuns))).map((run) => ({
          id: run.runId,
          end: run.endReason,
        })),
      ).toEqual([
        { id: 'dead-fill', end: 'error' },
        { id: `new-${mode}`, end: null },
      ]);
      expect(
        (await store.read((tx) => records(tx.browserAttempts))).at(-1),
      ).toMatchObject({
        runId: 'dead-fill',
        originalId: '900001',
        itemId: null,
        action: 'read-post',
        state: 'failed',
        settles: 'dead-read',
        code: 'INTERRUPTED',
      });
    } finally {
      kill.mockRestore();
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test('D2 dead deletion recovery remains ambiguous and blocks inclusion; a live owner remains busy', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sp-d2-delete-recovery-'));
  const store = await SQLiteStore.open(join(directory, 'socialprune.sqlite'), {
    initial: fixtureWorkspace(['1001']),
  });
  const writer = store.browserOutcomeWriter();
  const run = {
    runId: 'dead-delete',
    platform: 'x' as const,
    accountKey: FIXTURE.account.key,
    mode: 'delete' as const,
    planHash: 'a'.repeat(64),
    startedAt: FIXTURE.now,
    endedAt: null,
    endReason: null,
    bodyShapes: {},
    profileReport: null,
    ownerPid: 2147483647,
  };
  try {
    await writer.begin(run);
    await writer.check(
      (await planDeletion(store, FIXTURE.account.key)).rows[0]!,
      run.runId,
      FIXTURE.now,
      true,
    );
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('Generated dead process'), {
        code: 'ESRCH',
      });
    });
    try {
      await writer.begin({
        ...run,
        runId: 'new-verify',
        mode: 'verify',
        planHash: null,
        ownerPid: process.pid,
      });
    } finally {
      kill.mockRestore();
    }
    expect((await store.browserJournal()).attempts.at(-1)).toMatchObject({
      action: 'delete-post',
      state: 'ambiguous',
      code: 'PROCESS_LOST',
    });
    expect(
      (await planDeletion(store, FIXTURE.account.key, new Set(['x:1001'])))
        .rows,
    ).toEqual([]);
    await expect(
      writer.begin({ ...run, runId: 'contender' }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_BUSY' });
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('D2 fill recovers a dead deletion through the shared guard without losing its ambiguous receipt', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sp-d2-fill-recovery-'));
  const store = await SQLiteStore.open(join(directory, 'socialprune.sqlite'), {
    initial: fixtureWorkspace(['1001']),
  });
  const journal = store.browserOutcomeWriter();
  const run = {
    runId: 'dead-delete',
    platform: 'x' as const,
    accountKey: FIXTURE.account.key,
    mode: 'delete' as const,
    planHash: 'a'.repeat(64),
    startedAt: FIXTURE.now,
    endedAt: null,
    endReason: null,
    bodyShapes: {},
    profileReport: null,
    ownerPid: 2147483647,
  };
  try {
    await journal.begin(run);
    await journal.check(
      (await planDeletion(store, FIXTURE.account.key)).rows[0]!,
      run.runId,
      FIXTURE.now,
      true,
    );
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('Generated dead owner'), { code: 'ESRCH' });
    });
    try {
      await journal.recover(FIXTURE.account.key, FIXTURE.now);
    } finally {
      kill.mockRestore();
    }
    await new OriginalsFillWriter(store).startRun({
      runId: 'new-fill',
      accountKey: FIXTURE.account.key,
      planHash: 'b'.repeat(64),
      canary: false,
      startedAt: FIXTURE.now,
      ownerPid: process.pid,
    });
    expect(
      (await store.read((tx) => records(tx.browserRuns))).map((value) => [
        value.mode,
        value.endReason,
      ]),
    ).toEqual([
      ['delete', 'error'],
      ['fill', null],
    ]);
    expect(
      (await store.read((tx) => records(tx.browserAttempts))).at(-1),
    ).toMatchObject({
      action: 'delete-post',
      state: 'ambiguous',
      code: 'PROCESS_LOST',
    });
  } finally {
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test.each(['missing-owner', 'unknown-owner'] as const)(
  'D2 recovery refuses %s and leaves the journal unchanged',
  async (mode) => {
    const directory = await mkdtemp(join(tmpdir(), 'sp-d2-owner-recovery-'));
    const store = await SQLiteStore.open(
      join(directory, 'socialprune.sqlite'),
      { initial: fixtureWorkspace(['1001']) },
    );
    const writer = store.browserOutcomeWriter();
    const run = {
      runId: 'unproven-owner',
      platform: 'x' as const,
      accountKey: FIXTURE.account.key,
      mode: 'delete' as const,
      planHash: 'a'.repeat(64),
      startedAt: FIXTURE.now,
      endedAt: null,
      endReason: null,
      bodyShapes: {},
      profileReport: null,
      ...(mode === 'unknown-owner' ? { ownerPid: 2147483647 } : {}),
    };
    try {
      await writer.begin(run);
      const before = await store.browserJournal();
      const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
        throw Object.assign(new Error('Generated ownership query refused'), {
          code: 'EPERM',
        });
      });
      try {
        await expect(
          writer.recover(FIXTURE.account.key, FIXTURE.now),
        ).rejects.toMatchObject({ code: 'WORKSPACE_BUSY' });
      } finally {
        kill.mockRestore();
      }
      expect(await store.browserJournal()).toEqual(before);
    } finally {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

async function auditFixture(confirmed = 5, skipped = 10, extra = 0, mode = '') {
  const directory = await mkdtemp(join(tmpdir(), 'sp-c8-audit-')),
    fixture = await instagramFixture(confirmed + skipped + extra),
    store = await SQLiteStore.open(join(directory, 'socialprune.sqlite'), {
      initial: fixture.workspace,
    }),
    writer = new InstagramContextWriter(store),
    journal = store.browserOutcomeWriter(),
    runId = 'generated-c8-audit';
  const profileReport = {
    accountBefore: fixture.items[0]!.account.handle,
    accountAfter: fixture.items[0]!.account.handle,
    extensionsBefore: 0,
    extensionsAfter: 0,
    changedFiles: [],
    unexpectedRequests: [],
  };
  await writer.startRun({
    runId,
    accountKey: fixture.items[0]!.account.key,
    planHash: 'a'.repeat(64),
    startedAt: IG_FIXTURE.now,
  });
  await journal.recordContextOrder(runId, 'b'.repeat(64));
  const itemIds: string[] = [];
  for (const [index, item] of fixture.items.entries()) {
    const attemptId = `generated-c8-send-${index}`;
    await writer.sending({
      runId,
      attemptId,
      itemId: item.id,
      at: IG_FIXTURE.now,
    });
    if (index < skipped)
      await writer.settle({
        attemptId,
        at: IG_FIXTURE.now,
        state:
          mode === 'failed' && index === 0
            ? 'failed'
            : mode === 'not-listed' && index === 0
              ? 'not-listed'
              : mode === 'unavailable' && index === 0
                ? 'unavailable'
                : index % 2
                  ? 'unavailable'
                  : 'unconfirmed',
        code:
          index === 0 && mode
            ? mode === 'not-listed'
              ? 'no-row'
              : mode === 'unavailable'
                ? null
                : mode
            : index % 2
              ? null
              : 'not-shown',
      });
    else if (index < skipped + confirmed) {
      const record = instagramContractRecord(item);
      await writer.confirm({
        ...record,
        runId,
        attemptId,
        confirmedAt: IG_FIXTURE.now,
        comment: {
          ...record.comment,
          id: String(910001 + index),
          createdAt: item.createdAt,
        },
      });
      itemIds.push(item.id);
    }
  }
  const counts = {
    commentsConfirmed: confirmed,
    fields: Object.fromEntries(
      ['owner', 'time', 'caption', 'image'].map((field) => [
        field,
        { compared: confirmed, agreed: confirmed },
      ]),
    ),
    imagesMatched: confirmed,
    screenshotsStored: confirmed,
    unexpectedActions: 0,
    extensionIdsAdded: 0,
    extensionIdsRemoved: 0,
  };
  return {
    store,
    fixture,
    counts,
    itemIds,
    profileReport,
    runId,
    accept: () =>
      journal.recordContextAudit(runId, counts, undefined, true, {
        at: IG_FIXTURE.now,
        itemIds,
        profileReport,
      }),
    async close() {
      await store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test('C8 journal atomically accepts five checked records after ten skips, with counts only', async () => {
  const h = await auditFixture();
  try {
    await h.accept();
    const run = (await h.store.browserJournal()).runs[0]!;
    expect(run).toMatchObject({
      canaryAcceptedAt: IG_FIXTURE.now,
      acceptedBy: 'automatic-check',
      endReason: 'canary',
      canaryCounts: h.counts,
    });
    const text = JSON.stringify(run);
    for (const value of Object.values(IG_FIXTURE.other))
      expect(text).not.toContain(value);
    expect(text).not.toContain(h.fixture.items[0]!.text);
    await expect(h.accept()).rejects.toMatchObject({
      code: 'CANARY_CHECK_FAILED',
    });
  } finally {
    await h.close();
  }
});

test.each([
  'owner',
  'time',
  'text',
  'several',
  'not-listed',
  'not-shown',
  'unavailable',
])('C9 journal accepts five checked records after skipped %s', async (code) => {
  const h = await auditFixture(5, 10, 0, code);
  try {
    await h.accept();
    const run = (await h.store.browserJournal()).runs[0]!;
    expect(run).toMatchObject({
      canaryAcceptedAt: IG_FIXTURE.now,
      acceptedBy: 'automatic-check',
      endReason: 'canary',
      canaryCounts: h.counts,
    });
    for (const value of [
      ...Object.values(IG_FIXTURE.other),
      ...h.fixture.items.map((item) => item.text),
    ])
      expect(JSON.stringify(run)).not.toContain(value);
  } finally {
    await h.close();
  }
});

test.each([
  ['four confirmed and eleven skipped', 4, 11, 0, ''],
  ['sixteen sends', 5, 11, 0, ''],
  ['sending', 5, 9, 1, ''],
  ['failed', 5, 10, 0, 'failed'],
  ['short sample', 4, 0, 0, ''],
] as const)(
  'C8 journal refuses %s and rolls back acceptance',
  async (_name, confirmed, skipped, extra, mode) => {
    const h = await auditFixture(confirmed, skipped, extra, mode);
    try {
      const before = await h.store.browserJournal();
      await expect(h.accept()).rejects.toMatchObject({
        code: 'CANARY_CHECK_FAILED',
      });
      expect(await h.store.browserJournal()).toEqual(before);
      expect(before.runs[0]!.canaryAcceptedAt).toBeNull();
      expect(before.runs[0]!.acceptedBy).toBeUndefined();
    } finally {
      await h.close();
    }
  },
);

test.each([
  'ambiguous',
  'missing-record',
  'missing-check',
  'bad-check',
  'image',
  'screenshot',
] as const)(
  'C8 journal refuses %s even with five confirmed settlements',
  async (mode) => {
    const h = await auditFixture(5, mode === 'ambiguous' ? 10 : 0);
    try {
      if (mode === 'missing-record' || mode === 'ambiguous') {
        const original = h.store.write.bind(h.store);
        h.store.write = (operation) =>
          original((tx) =>
            operation({
              ...tx,
              instagramContext: {
                ...tx.instagramContext,
                get: (id) =>
                  mode === 'missing-record' && id === h.itemIds[0]
                    ? Promise.resolve(undefined)
                    : tx.instagramContext.get(id),
              },
              browserAttempts: {
                ...tx.browserAttempts,
                async *iterate() {
                  for await (const attempt of tx.browserAttempts.iterate())
                    yield mode === 'ambiguous' &&
                    attempt.settles !== null &&
                    attempt.itemId === h.fixture.items[0]!.id
                      ? { ...attempt, state: 'ambiguous' }
                      : attempt;
                },
              },
            }),
          );
      } else if (mode === 'missing-check') h.itemIds.pop();
      else if (mode === 'bad-check') h.counts.fields.owner!.agreed--;
      else if (mode === 'image') h.counts.imagesMatched--;
      else h.counts.screenshotsStored--;
      await expect(h.accept()).rejects.toMatchObject({
        code: 'CANARY_CHECK_FAILED',
      });
      expect((await h.store.browserJournal()).runs[0]).toMatchObject({
        endedAt: null,
        canaryAcceptedAt: null,
      });
    } finally {
      await h.close();
    }
  },
);

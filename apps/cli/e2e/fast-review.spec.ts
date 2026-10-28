import { test, expect } from './quiet-review-fixture.ts';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteStore } from '../src/workspace/sqlite-store.ts';
import { startReviewServer } from '../src/review/server.ts';
import { reviewAssetDirectory } from '../src/review/static.ts';
import { scaleWorkspace, SCALE_ACCOUNT } from '../../web/e2e/scale-data.ts';
import { WorkspaceSchema } from '@socialprune/core';
import { readWorkspace } from '@socialprune/core/workspace/store';
import { checkFastFeed } from '../../web/e2e/fast-feed-check.ts';
import { headerFixture } from '../../web/e2e/header-style.ts';
import { checkHistoryRecovery } from '../../web/e2e/fast-revision-check.ts';

for (const direction of ['back', 'forward'] as const)
  test(`F2/F5 real review ${direction} preserves the failed decision`, async ({
    page,
  }) => {
    const workspace = await mkdtemp(
      join(tmpdir(), 'socialprune-revision-history-generated-'),
    );
    const store = await SQLiteStore.open(
      join(workspace, 'socialprune.sqlite'),
      { initial: headerFixture() },
    );
    await store.close();
    const server = await startReviewServer({
      workspace,
      assetDirectory: reviewAssetDirectory(),
      handleSignals: false,
      // eslint-disable-next-line no-restricted-properties -- Explicit generated test listener, never credentials.
      port: Number(process.env['SP_REVIEW_CONTEXT_PORT'] ?? 0),
    });
    try {
      await page.addInitScript(() => localStorage.setItem('sp-locale', 'en'));
      await page.goto(server.launchUrl);
      await page
        .getByRole('navigation', { name: 'Primary navigation', exact: true })
        .getByRole('link', { name: 'Review', exact: true })
        .click();
      await checkHistoryRecovery(page, direction);
    } finally {
      await server.stop();
      await rm(workspace, { recursive: true, force: true });
    }
  });

test('F1 reviewer SQLite probe: failed keep followed by Undo never changes the earlier marked item', async ({
  page,
}) => {
  const workspace = await mkdtemp(
    join(tmpdir(), 'socialprune-revision-undo-generated-'),
  );
  const store = await SQLiteStore.open(join(workspace, 'socialprune.sqlite'), {
    initial: headerFixture(),
  });
  await store.close();
  const server = await startReviewServer({
    workspace,
    assetDirectory: reviewAssetDirectory(),
    handleSignals: false,
    // eslint-disable-next-line no-restricted-properties -- Explicit generated test listener, never credentials.
    port: Number(process.env['SP_REVIEW_CONTEXT_PORT'] ?? 0),
  });
  try {
    await page.addInitScript(() => localStorage.setItem('sp-locale', 'en'));
    await page.goto(server.launchUrl);
    await page
      .getByRole('navigation', { name: 'Primary navigation', exact: true })
      .getByRole('link', { name: 'Review', exact: true })
      .click();
    const feed = page.getByRole('feed');
    await expect(feed).toHaveAttribute('aria-busy', 'false');
    await page.getByRole('tab', { name: /^All,/ }).click();
    await feed
      .locator('article[data-card-id="x:feed-1"] [data-mark-action]')
      .click();
    await page.evaluate(() => window.workspace.flushCommands());
    await page.evaluate(() => {
      const request = window.workspace.request.bind(window.workspace);
      window.workspace.request = async (input, transfer) => {
        if (input.type === 'decide') {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return {
            type: 'failed',
            requestId: input.requestId,
            code: 'STORAGE',
          };
        }
        return request(input, transfer);
      };
    });
    const second = feed.locator('article[data-card-id="x:feed-2"]');
    await second.locator('[data-keep-action]').click();
    await second.focus();
    await page.keyboard.press('Control+z');
    await page.evaluate(() => window.workspace.flushCommands());
    await expect(page.getByRole('status')).toContainText(
      'Nothing was undone or redone.',
    );
    const reopened = await SQLiteStore.open(
      join(workspace, 'socialprune.sqlite'),
    );
    const data = await reopened.read(readWorkspace);
    await reopened.close();
    expect(
      data.decisionEvents
        .slice(headerFixture().decisionEvents.length)
        .map((event) => [event.itemId, event.value, event.source.kind]),
    ).toEqual([['x:feed-1', 'delete', 'human']]);
  } finally {
    await server.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('reviewer retained proof: write two of three fails without erasing writes one and three', async ({
  page,
}) => {
  // Keep this proof valid when the first observation frame is later than a
  // failed receipt. The injected receipt is released by queue order, not time.
  await page.addInitScript(() => {
    const frame = requestAnimationFrame;
    window.requestAnimationFrame = (callback) =>
      frame((time) => {
        setTimeout(() => callback(time), 180);
      });
  });
  const initial = headerFixture(),
    workspace = await mkdtemp(
      join(tmpdir(), 'socialprune-revision-three-generated-'),
    );
  const store = await SQLiteStore.open(join(workspace, 'socialprune.sqlite'), {
    initial,
  });
  await store.close();
  const server = await startReviewServer({
    workspace,
    assetDirectory: reviewAssetDirectory(),
    handleSignals: false,
    // eslint-disable-next-line no-restricted-properties -- Explicit generated test listener, never credentials.
    port: Number(process.env['SP_REVIEW_CONTEXT_PORT'] ?? 0),
  });
  try {
    await page.addInitScript(() => localStorage.setItem('sp-locale', 'en'));
    await page.goto(server.launchUrl);
    await page
      .getByRole('navigation', { name: 'Primary navigation', exact: true })
      .getByRole('link', { name: 'Review', exact: true })
      .click();
    const feed = page.getByRole('feed');
    await expect(feed).toHaveAttribute('aria-busy', 'false');
    await page.getByRole('tab', { name: /^All,/ }).click();
    await page
      .getByRole('button', { name: 'One at a time', exact: true })
      .click();
    await page.evaluate(() => {
      const request = window.workspace.request.bind(window.workspace);
      let count = 0;
      window.workspace.request = async (input, transfer) => {
        if (input.type === 'decide') {
          count++;
          if (count === 2) {
            await new Promise<void>((resolve) =>
              Reflect.set(window, '__releaseSecondWrite', resolve),
            );
            return {
              type: 'failed',
              requestId: input.requestId,
              code: 'STORAGE',
            };
          }
        }
        return request(input, transfer);
      };
    });
    const ids = await page.evaluate(async () => {
      const ids: string[] = [];
      for (let index = 0; index < 3; index++) {
        const card = document.querySelector<HTMLElement>(
          'article[data-card-id]',
        )!;
        ids.push(card.dataset['cardId']!);
        card.querySelector<HTMLButtonElement>('[data-keep-action]')!.click();
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () =>
              reject(new Error('Queued decision did not advance the card.')),
            5000,
          );
          const frame = () =>
            document.querySelector<HTMLElement>('article[data-card-id]')
              ?.dataset['cardId'] !== ids.at(-1)
              ? (clearTimeout(timeout), resolve())
              : requestAnimationFrame(frame);
          requestAnimationFrame(frame);
        });
      }
      return ids;
    });
    expect(ids).toEqual(['x:feed-1', 'x:feed-2', 'x:feed-3']);
    await expect
      .poll(() =>
        page.evaluate(() => typeof Reflect.get(window, '__releaseSecondWrite')),
      )
      .toBe('function');
    await page.evaluate(() =>
      (Reflect.get(window, '__releaseSecondWrite') as () => void)(),
    );
    await page.evaluate(() => window.workspace.flushCommands());
    await expect(feed.locator('article')).toHaveAttribute(
      'data-card-id',
      ids[1]!,
    );
    await expect(feed.locator('article')).toHaveAttribute(
      'data-decision',
      'undecided',
    );
    const reopened = await SQLiteStore.open(
      join(workspace, 'socialprune.sqlite'),
    );
    const data = await reopened.read(readWorkspace);
    await reopened.close();
    expect(
      data.decisionEvents
        .slice(initial.decisionEvents.length)
        .map((event) => [event.itemId, event.value, event.source.kind]),
    ).toEqual([
      [ids[0], 'keep', 'human'],
      [ids[2], 'keep', 'human'],
    ]);
  } finally {
    await server.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('FAST-1 real server failure restores the card before any deletion mark', async ({
  page,
}) => {
  const workspace = await mkdtemp(
    join(tmpdir(), 'socialprune-fast-failure-generated-'),
  );
  const store = await SQLiteStore.open(join(workspace, 'socialprune.sqlite'), {
    initial: headerFixture(),
  });
  await store.close();
  const server = await startReviewServer({
    workspace,
    assetDirectory: reviewAssetDirectory(),
    handleSignals: false,
    // eslint-disable-next-line no-restricted-properties -- Explicit generated test listener, never credentials.
    port: Number(process.env['SP_REVIEW_CONTEXT_PORT'] ?? 0),
  });
  try {
    await page.addInitScript(() => localStorage.setItem('sp-locale', 'en'));
    await page.goto(server.launchUrl);
    await page
      .getByRole('navigation', { name: 'Primary navigation', exact: true })
      .getByRole('link', { name: 'Review', exact: true })
      .click();
    await checkFastFeed(page);
  } finally {
    await server.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});

test('FAST-1 real SQLite review measures 60 human decisions on 6000 generated entries', async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const data = WorkspaceSchema.parse(
    JSON.parse((await scaleWorkspace(6000)).text) as unknown,
  );
  data.imports = [
    {
      id: 'generated-fast-import',
      platform: 'x',
      status: 'complete',
      accounts: [data.items[0]!.account],
      archives: ['synthetic-scale'],
      importedAt: data.createdAt,
      exportCreatedAt: null,
      adapter: { name: 'generated-fast', version: '1' },
      variant: null,
      diagnostics: [],
      itemCount: 6000,
    },
  ];
  data.counts.imports = 1;
  const workspace = await mkdtemp(
    join(tmpdir(), 'socialprune-fast-generated-'),
  );
  const store = await SQLiteStore.open(join(workspace, 'socialprune.sqlite'), {
    initial: data,
  });
  await store.close();
  const server = await startReviewServer({
    workspace,
    assetDirectory: reviewAssetDirectory(),
    handleSignals: false,
    // eslint-disable-next-line no-restricted-properties -- Explicit generated test listener, never credentials.
    port: Number(process.env['SP_REVIEW_CONTEXT_PORT'] ?? 0),
  });
  try {
    await page.addInitScript(() => localStorage.setItem('sp-locale', 'en'));
    await page.goto(server.launchUrl);
    await page
      .getByRole('navigation', { name: 'Primary navigation', exact: true })
      .getByRole('link', { name: 'Review', exact: true })
      .click();
    await expect(page.getByRole('feed')).toHaveAttribute('aria-busy', 'false');
    await page.getByRole('tab', { name: /^All,/ }).click();
    const single = page.getByRole('button', {
      name: 'One at a time',
      exact: true,
    });
    if (await single.isVisible()) await single.click();
    else {
      await page
        .getByRole('button', { name: 'Review options', exact: true })
        .click();
      await page
        .getByRole('menuitem', { name: 'One at a time', exact: true })
        .click();
    }
    const samples: { nextMs: number; confirmedMs: number }[] = [];
    for (let index = 0; index < 60; index++) {
      const first = page
        .getByRole('feed')
        .locator('article[data-card-id]')
        .first();
      await expect(first).toBeVisible();
      const itemId = await first.getAttribute('data-card-id');
      expect(itemId).toBe(`x:scale-${index.toString().padStart(6, '0')}`);
      const nextMs = await page.evaluate(
        async ({ itemId }) => {
          const now = performance.now();
          const card = document.querySelector<HTMLElement>(
            `article[data-card-id="${itemId}"]`,
          )!;
          card.querySelector<HTMLButtonElement>('[data-keep-action]')!.click();
          return new Promise<number>((resolve, reject) => {
            const deadline = setTimeout(
              () => reject(new Error('Next card not ready')),
              10000,
            );
            const frame = () => {
              const next = [
                ...document.querySelectorAll<HTMLElement>(
                  'article[data-card-id]',
                ),
              ].find((card) => card.dataset['cardId'] !== itemId);
              const button =
                next?.querySelector<HTMLButtonElement>('[data-keep-action]');
              if (
                button &&
                !button.disabled &&
                next!.getBoundingClientRect().height > 0
              ) {
                clearTimeout(deadline);
                resolve(performance.now() - now);
              } else requestAnimationFrame(frame);
            };
            requestAnimationFrame(frame);
          });
        },
        { itemId },
      );
      const confirmedMs = await page.evaluate(async () => {
        const before = performance.now();
        await window.workspace.flushCommands();
        return performance.now() - before;
      });
      samples.push({ nextMs, confirmedMs: nextMs + confirmedMs });
    }
    const p = (key: 'nextMs' | 'confirmedMs', q: number) =>
      samples.map((s) => s[key]).sort((a, b) => a - b)[
        Math.ceil(q * samples.length) - 1
      ]!;
    const backlog = await page.evaluate(async () => {
      const durations: number[] = [],
        pending: number[] = [];
      document.querySelector<HTMLElement>('article[data-card-id]')!.focus();
      for (let index = 0; index < 20; index++) {
        const card = document.querySelector<HTMLElement>(
            'article[data-card-id]',
          )!,
          id = card.dataset['cardId'],
          start = performance.now();
        card.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'k',
            bubbles: true,
            cancelable: true,
          }),
        );
        await new Promise<void>((resolve, reject) => {
          const deadline = setTimeout(
            () => reject(Error('Backlog card did not advance')),
            5000,
          );
          const frame = () => {
            const next = document.querySelector<HTMLElement>(
              'article[data-card-id]',
            );
            if (
              next &&
              next.dataset['cardId'] !== id &&
              !next.querySelector<HTMLButtonElement>('[data-keep-action]')
                ?.disabled
            ) {
              clearTimeout(deadline);
              durations.push(performance.now() - start);
              pending.push(window.workspace.commands.pending);
              next.focus();
              resolve();
            } else requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
        });
      }
      const started = performance.now();
      await window.workspace.flushCommands();
      return {
        durations,
        pending,
        maxPending: Math.max(...pending),
        drainMs: performance.now() - started,
      };
    });
    const sortedBacklog = backlog.durations.slice().sort((a, b) => a - b);
    const report = {
      engine: info.project.name,
      account: SCALE_ACCOUNT,
      entries: 6000,
      decisions: samples.length,
      next: { p50: p('nextMs', 0.5), p95: p('nextMs', 0.95) },
      confirmed: { p50: p('confirmedMs', 0.5), p95: p('confirmedMs', 0.95) },
      samples,
      backlog: { ...backlog, p50: sortedBacklog[9]!, p95: sortedBacklog[18]! },
    };
    expect(report.next.p95).toBeLessThanOrEqual(100);
    expect(report.backlog.p95).toBeLessThanOrEqual(100);
    expect(report.backlog.maxPending).toBeGreaterThan(1);
    const reopened = await SQLiteStore.open(
      join(workspace, 'socialprune.sqlite'),
    );
    const decisions = (await reopened.read(readWorkspace)).decisionEvents;
    expect(decisions).toHaveLength(80);
    expect(decisions.every((event) => event.source.kind === 'human')).toBe(
      true,
    );
    await reopened.close();
    console.log('FAST_REVIEW_MEASUREMENT', JSON.stringify(report));
    await info.attach('fast-review-measurement', {
      body: JSON.stringify(report),
      contentType: 'application/json',
    });
    // eslint-disable-next-line no-restricted-properties -- Explicit measurement destination, never credentials.
    const out = process.env['SP_FAST_MEASURE_DIR'];
    if (out)
      await writeFile(
        join(out, `${info.project.name}.json`),
        JSON.stringify(report, null, 2),
      );
  } finally {
    await server.stop();
    await rm(workspace, { recursive: true, force: true });
  }
});

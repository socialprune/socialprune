import { expect, test } from 'vitest';
import { inputs, request } from './test/helpers.ts';
import { startReviewServer } from './server.ts';
import { SQLiteStore } from '../workspace/sqlite-store.ts';
import type { HttpReviewRequest } from '@socialprune/core/workspace/protocol';
import { records } from '@socialprune/core/workspace/store';
import { join } from 'node:path';

test('real socket serves feed counts, final-mark preview and an atomic plan record', async () => {
  const data = await inputs();
  const path = join(data.workspace, 'socialprune.sqlite');
  const seed = await SQLiteStore.open(path);
  await seed.write(async (tx) => {
    const meta = await tx.meta.get();
    await tx.meta.set({
      ...meta,
      settings: {
        ...meta.settings,
        categories: [...meta.settings.categories, 'earlier-generated'],
        criteria: {
          selected: ['political'],
          custom: [],
          nextCustom: 1,
          level: 0,
        },
        keepRules: [],
      },
    });
    await tx.assessments.append([
      {
        assessmentId: 'generated-hit',
        itemId: 'x:101',
        submissionId: null,
        category: 'political',
        risk: 2,
        source: { kind: 'model', name: 'generated', version: null },
        reason: 'Generated reason.',
        evidence: null,
        confidence: null,
        createdAt: '2026-10-20T12:00:00.000Z',
      },
    ]);
  });
  await seed.close();
  const server = await startReviewServer({
    workspace: data.workspace,
    assetDirectory: data.assets,
    handleSignals: false,
  });
  try {
    const origin = server.url.slice(0, -1);
    const base = {
      Host: new URL(origin).host,
      Origin: origin,
      'Content-Type': 'application/json',
    };
    const exchange = await request(origin, {
      path: '/session',
      headers: {
        ...base,
        'X-SocialPrune-Bootstrap': new URL(server.launchUrl).hash.slice(
          '#bootstrap='.length,
        ),
      },
    });
    const headers = {
      ...base,
      Cookie: exchange.headers['set-cookie']![0]!.split(';', 1)[0]!,
      'X-SocialPrune-CSRF': (exchange.data as { csrf: string }).csrf,
    };
    const api = (input: Record<string, unknown>) =>
      request(origin, {
        path: `/api/${String(input.type)}`,
        headers,
        body: JSON.stringify(input),
      });
    const counts = await api({
      type: 'planCounts',
      requestId: 'counts',
      accountKey: 'x:generated',
    });
    expect(counts.status).toBe(200);
    expect(counts.data).toMatchObject([
      { type: 'planCounts', tabs: { suggested: 1, all: 2 } },
    ]);
    const wireRequests = [
      {
        type: 'planCounts',
        requestId: 'wire-counts',
        accountKey: 'x:generated',
      },
      {
        type: 'feedWindow',
        requestId: 'wire-feed',
        accountKey: 'x:generated',
        tab: 'all',
        sort: 'reposts',
        offset: 0,
        limit: 50,
      },
      {
        type: 'previewPlan',
        requestId: 'wire-preview',
        accountKey: 'x:generated',
        pageId: 'wire-page',
        previewId: 'wire-plan',
      },
      {
        type: 'setCriteria',
        requestId: 'wire-criteria',
        criteria: {
          selected: ['political'],
          custom: [],
          nextCustom: 1,
          level: 0,
        },
        removeCategories: ['earlier-generated'],
      },
      { type: 'setKeepRules', requestId: 'wire-rules', keepRules: [] },
    ];
    for (const input of wireRequests) {
      expect((await api(input)).status).toBe(200);
      expect(
        (
          await request(origin, {
            path: `/api/${input.type}`,
            headers: { ...headers, 'X-SocialPrune-CSRF': 'wrong' },
            body: JSON.stringify(input),
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await request(origin, {
            path: `/api/${input.type}`,
            headers: { ...headers, Cookie: '' },
            body: JSON.stringify(input),
          })
        ).status,
      ).toBe(401);
      expect((await api({ ...input, approve: true })).status).toBe(400);
    }
    expect(
      (
        await api({
          type: 'feedWindow',
          requestId: 'oversized',
          accountKey: 'x:generated',
          tab: 'all',
          offset: 0,
          limit: 51,
        })
      ).status,
    ).toBe(400);
    const preview = await api({
      type: 'previewPlan',
      requestId: 'preview',
      pageId: 'page',
      previewId: 'plan',
      accountKey: 'x:generated',
    });
    expect(preview.status).toBe(200);
    expect(preview.data).toMatchObject([
      {
        type: 'bulkPreview',
        willChange: 1,
        plan: { accountKey: 'x:generated' },
      },
    ]);
    const confirm = {
      type: 'confirmBulk',
      requestId: 'confirm',
      commandId: 'confirm',
      pageId: 'page',
      previewId: 'plan',
    } satisfies HttpReviewRequest;
    expect((await api(confirm)).data).toMatchObject([
      { type: 'committed', changed: 1 },
    ]);
    expect((await api(confirm)).data).toMatchObject([
      { type: 'committed', changed: 1 },
    ]);
  } finally {
    await server.stop();
  }
  try {
    const result = await SQLiteStore.open(path);
    try {
      const saved = await result.read(async (tx) => ({
        events: await records(tx.decisionEvents),
        plans: await records(tx.reviewPlans),
      }));
      expect(saved.events).toHaveLength(1);
      expect(saved.events[0]).toMatchObject({
        itemId: 'x:101',
        value: 'delete',
        source: { kind: 'human', via: 'local-review' },
        action: { kind: 'bulk', size: 1 },
      });
      expect(saved.plans).toHaveLength(1);
      expect(saved.plans[0]?.actionId).toBe(saved.events[0]?.action.id);
    } finally {
      await result.close();
    }
  } finally {
    await data.dispose();
  }
}, 60_000);

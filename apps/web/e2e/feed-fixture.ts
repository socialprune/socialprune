import type { WorkspaceV2, InstagramContext } from '@socialprune/core';
import {
  criterionHash,
  migrateReviewContract,
} from '@socialprune/core/criteria';
import { reviewFixture } from './review-fixture.ts';
import { waitForApp } from './helpers.ts';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createServer, request as proxyRequest } from 'node:http';
import { fileURLToPath } from 'node:url';

export const liveExpected = {
  account: 'x:feed',
  instagram: 'instagram:feed',
  suggested: ['x:feed-1', 'x:feed-2', 'x:feed-3'],
  held: ['x:feed-4'],
  kept: ['x:feed-5'],
  unclear: ['x:feed-6', 'x:feed-8'],
  marked: ['x:feed-7'],
  readComment: 'instagram:feed-read',
  caption:
    'Generated park photograph. A new path through the neighbourhood garden.',
};
export const generatedPostImage =
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320"><rect width="320" height="320" fill="#dce7e1"/><path d="M0 190 110 105 210 205 320 130V320H0Z" fill="#7e9b87"/><path d="M90 320 155 190H180L225 320" fill="#f4eee2"/><circle cx="246" cy="68" r="28" fill="#f4eee2"/></svg>';
export const generatedPostScreenshot =
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="420" viewBox="0 0 320 420"><rect width="320" height="420" fill="#fff"/><circle cx="24" cy="24" r="14" fill="#dce7e1"/><text x="48" y="29" font-family="sans-serif" font-size="14" fill="#172033">demo_maple</text><rect y="48" width="320" height="270" fill="#dce7e1"/><path d="M0 230 110 130 210 240 320 170V318H0Z" fill="#7e9b87"/><path d="M90 318 155 218H180L225 318" fill="#f4eee2"/><circle cx="246" cy="100" r="28" fill="#f4eee2"/><text x="12" y="345" font-family="sans-serif" font-size="13" fill="#172033">demo_maple: A generated garden.</text><text x="12" y="375" font-family="sans-serif" font-size="13" fill="#172033">demo_fern: An invented comment.</text><text x="12" y="405" font-family="sans-serif" font-size="12" fill="#475569">Generated screenshot for this review</text></svg>';
export function generatedReadPost(): InstagramContext {
  return {
    itemId: liveExpected.readComment,
    accountKey: liveExpected.instagram,
    confirmedBy: 'post',
    ownerCheck: 'matched-export',
    post: {
      kind: 'p',
      code: 'Generated_feed',
      owner: 'generated_owner',
      ownerCount: 1,
      createdAt: '2024-01-31T00:00:00.000Z',
      caption: liveExpected.caption,
      captionComplete: true,
    },
    comment: {
      id: '910002',
      createdAt: '2024-01-31T00:00:00.000Z',
      expandClicks: 0,
    },
    image: {
      file: 'image.png',
      host: 'generated.cdninstagram.com',
      status: 'stored',
    },
    screenshot: { file: null, bytes: null, status: 'failed' },
    confirmedAt: '2026-10-15T00:00:00.000Z',
    runId: 'generated-feed-read',
    attemptId: 'generated-feed-read-one',
  };
}
export function liveFeedFixture(count = 8): WorkspaceV2 {
  const old = reviewFixture('personal', false, Math.max(8, count));
  old.settings.categories = ['political', 'unclear'];
  old.items.forEach((item, n) => {
    item.id = `x:feed-${n + 1}`;
    item.account = { key: liveExpected.account, handle: 'invented_feed' };
    item.text = `Invented political post ${n + 1}. A generated council discussion.`;
    item.kind = 'post';
    item.mediaCount = n === 1 ? 2 : 0;
    item.createdAt = new Date(
      Date.UTC(2024, 0, 31) - n * 86400000,
    ).toISOString();
    item.engagement = { likes: n === 3 ? 14 : 0, reposts: 0 };
  });
  const instagram = {
    ...structuredClone(old.items[0]!),
    id: 'instagram:feed-comment',
    platform: 'instagram' as const,
    account: { key: liveExpected.instagram, handle: 'invented_commenter' },
    kind: 'comment' as const,
    text: 'Invented comment about a park and council.',
    engagement: { likes: null, reposts: null },
    url: null,
  };
  instagram.reference.ownerHandle = 'generated_owner';
  old.items.push(instagram);
  old.items.push({
    ...structuredClone(instagram),
    id: liveExpected.readComment,
    text: 'Invented comment about the generated garden path and council.',
    createdAt: '2024-01-31T00:00:00.000Z',
  });
  const data = migrateReviewContract(old);
  data.settings.criteria!.selected = ['political'];
  data.settings.criteria!.level = 0;
  data.settings.keepRules = [
    {
      id: 'likes-ten',
      kind: 'likes-at-least',
      count: 10,
      alsoWhenUnknown: false,
      enabled: true,
    },
  ];
  data.settings.review = {
    accountKey: liveExpected.account,
    filter: {},
    search: '',
    sort: [{ by: 'createdAt', direction: 'desc' }],
    feed: { tab: 'suggested', anchors: {} },
  };
  data.assessments = data.items.map((item, index) => ({
    assessmentId: `generated-feed-${index}`,
    itemId: item.id,
    submissionId: 'generated-feed-labels',
    source: { kind: 'agent', name: 'Synthetic reader', version: '1' },
    category: index === 5 ? 'unclear' : 'political',
    risk: index === 5 ? 0 : 2,
    reason:
      index === 5
        ? 'The generated context is unclear.'
        : 'The generated post discusses council policy.',
    evidence: index === 5 ? null : 'generated',
    confidence: null,
    createdAt: '2026-10-01T12:00:00.000Z',
  }));
  data.submissions = [
    {
      submissionId: 'generated-feed-labels',
      contentHash: `sha256:${'b'.repeat(64)}`,
      source: { kind: 'agent', name: 'Synthetic reader', version: '1' },
      receivedAt: '2026-10-01T12:00:00.000Z',
      labelCount: data.assessments.length,
      criteria: ['political', 'unclear'].map((id) => ({
        id,
        hash: criterionHash(id, data.settings),
      })),
    },
  ];
  data.decisionEvents = (
    count === 8
      ? ([
          [4, 'keep'],
          [6, 'delete'],
          [7, 'later'],
        ] as const)
      : []
  ).map(([index, value], n) => ({
    eventId: `generated-decision-${n}`,
    seq: n + 1,
    itemId: data.items[index]!.id,
    value,
    previous: 'undecided',
    decidedAt: '2026-10-10T12:00:00.000Z',
    source: { kind: 'human', via: 'web-review' },
    action: {
      id: `generated-action-${n}`,
      kind: 'single',
      size: 1,
      reverts: null,
    },
  }));
  data.counts = {
    ...data.counts,
    items: data.items.length,
    assessments: data.assessments.length,
    submissions: 1,
    decisionEvents: data.decisionEvents.length,
  };
  return data;
}
export async function restoreLiveFeed(
  page: Page,
  data = liveFeedFixture(),
  inspectInitial?: () => Promise<void>,
  contextRecords: InstagramContext[] = [],
) {
  // Only the Instagram-specific config serves generated context media.
  await waitForApp(page);
  await inspectInitial?.();
  const reply = await page.evaluate(
    (text) =>
      window.workspace.request({
        type: 'restore',
        requestId: crypto.randomUUID(),
        file: new File([text], 'generated-feed.json'),
      }),
    JSON.stringify(data),
  );
  expect(reply.type).toBe('opened');
  // Pages intentionally returns no context. This UI-only fixture injects the
  // same bounded client response local review/desktop receive, never production.
  const records = contextRecords.filter((record) =>
    data.items.some((item) => item.id === record.itemId),
  );
  // Clear a preceding injected answer too when generated states share a page.
  await page.evaluate((records) => {
    window.workspace.getInstagramContext = (ids) =>
      Promise.resolve(records.filter((record) => ids.includes(record.itemId)));
  }, records);
  await page.goto('/socialprune/#/review');
  await expect(page.getByRole('feed')).toBeVisible();
  await expect(page.getByRole('feed')).toHaveAttribute('aria-busy', 'false');
  return data;
}

/** Test-only preview. No production config imports this fixture entrypoint. */
async function previewGeneratedFeed(port: number, outDir?: string) {
  if (!Number.isInteger(port) || port < 1024 || port >= 65535)
    throw new Error('Invalid feed preview port.');
  const { preview } = await import('vite');
  const app = await preview({
    ...(outDir ? { build: { outDir } } : {}),
    preview: { host: '127.0.0.1', port: port + 1, strictPort: true },
  });
  const server = createServer((request, response) => {
    if (
      request.method === 'GET' &&
      /^\/context\/instagram\/Generated_feed\/(?:image\.png|shot\.jpg)$/.test(
        request.url ?? '',
      )
    ) {
      response.writeHead(200, {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'no-store',
      });
      response.end(
        request.url!.endsWith('shot.jpg')
          ? generatedPostScreenshot
          : generatedPostImage,
      );
      return;
    }
    const forwarded = proxyRequest(
      {
        hostname: '127.0.0.1',
        port: port + 1,
        path: request.url,
        method: request.method,
        headers: request.headers,
      },
      (upstream) => {
        response.writeHead(upstream.statusCode!, upstream.headers);
        upstream.pipe(response);
      },
    );
    forwarded.on('error', () => {
      response.writeHead(502);
      response.end();
    });
    request.pipe(forwarded);
  });
  server.listen(port, '127.0.0.1', () =>
    console.log(`Generated feed preview ready on ${port}.`),
  );
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => {
      server.close();
      app.httpServer.close();
    });
}

if (
  process.argv[1] === fileURLToPath(import.meta.url) &&
  process.argv[2] === '--preview'
)
  await previewGeneratedFeed(Number(process.argv[3]), process.argv[4]);

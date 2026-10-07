import type { WorkspaceV2 } from '@socialprune/core';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { waitForApp } from './helpers.ts';

export function reviewFixture(
  kind: 'personal' | 'demo' = 'personal',
  suggestions = true,
  count = 8,
): WorkspaceV2 {
  const time = '2026-10-01T12:00:00.000Z';
  const account = { key: 'synthetic-review', handle: 'invented_review' };
  const items: WorkspaceV2['items'] = Array.from(
    { length: count },
    (_, index) => ({
      id: `x:review-${index.toString().padStart(4, '0')}`,
      platform: 'x',
      account,
      kind: index === 2 ? 'reply' : 'post',
      text:
        index === 0
          ? 'Invented café note with a literal <script>globalThis.__pwned = 1</script> and ordinary words.'
          : index === 1
            ? ''
            : `Invented review entry ${index}, not a platform post.`,
      mediaCount: index === 1 ? 2 : 0,
      createdAt: `2026-10-${(20 - (index % 20)).toString().padStart(2, '0')}T12:00:00.000Z`,
      engagement: { likes: index === 0 ? null : index, reposts: null },
      reference: {
        replyToId: null,
        replyToHandle: null,
        quotedId: null,
        repostOfHandle: null,
        ownerHandle: null,
      },
      url: `https://x.com/invented_review/status/${index + 1}`,
      provenance: { archive: 'invented', file: 'invented.json', index },
    }),
  );
  const source =
    kind === 'demo'
      ? { kind: 'fixture' as const, name: 'demo-examples', version: '1' }
      : { kind: 'agent' as const, name: 'Synthetic reviewer', version: '1' };
  const assessments: WorkspaceV2['assessments'] = suggestions
    ? [
        {
          assessmentId: 'invented-assessment',
          submissionId: kind === 'demo' ? null : 'invented-submission',
          itemId: items[0]!.id,
          source,
          category: 'unclear',
          risk: 2,
          reason: 'This invented excerpt is included to test the review.',
          evidence: 'café note',
          confidence: null,
          createdAt: time,
        },
        {
          assessmentId: 'invented-mismatch',
          submissionId: kind === 'demo' ? null : 'invented-submission',
          itemId: items[2]!.id,
          source,
          category: 'political',
          risk: 1,
          reason: 'This invented example has no evidence match.',
          evidence: null,
          confidence: null,
          createdAt: time,
        },
      ]
    : [];
  const submissions: WorkspaceV2['submissions'] =
    suggestions && source.kind === 'agent'
      ? [
          {
            submissionId: 'invented-submission',
            contentHash: `sha256:${'a'.repeat(64)}`,
            source,
            receivedAt: time,
            labelCount: assessments.length,
          },
        ]
      : [];
  return {
    format: 'socialprune-workspace',
    schemaVersion: 2,
    id: `synthetic-review-${kind}`,
    kind,
    createdAt: time,
    updatedAt: time,
    lastBackupAt: time,
    settings: {
      categories: ['unclear', 'political'],
      timeZone: 'Europe/Berlin',
    },
    imports: [],
    items,
    assessments,
    submissions,
    decisionEvents: [],
    outcomeEvents: [],
    counts: {
      imports: 0,
      items: items.length,
      assessments: assessments.length,
      submissions: submissions.length,
      decisionEvents: 0,
      outcomeEvents: 0,
    },
  };
}
export async function restoreReview(page: Page, workspace = reviewFixture()) {
  await waitForApp(page);
  const reply = await page.evaluate(
    (text) =>
      window.workspace.request({
        type: 'restore',
        requestId: crypto.randomUUID(),
        file: new File([text], 'invented-review-backup.json'),
      }),
    JSON.stringify(workspace),
  );
  expect(reply.type).toBe('opened');
  await page.goto('/socialprune/#/review');
  await expect(page.getByRole('grid')).toBeVisible();
  await expect(page.getByRole('row').first()).toContainText(
    workspace.items[0]!.text,
  );
  return workspace;
}

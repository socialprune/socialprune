import type { WorkspaceV2, Assessment, Item } from '../model/index.ts';
import { createMemoryStore } from '../workspace/memory-store.ts';
import { readWorkspace } from '../workspace/store.ts';
import {
  writeInstagramContextContract,
  instagramContractItem,
} from '../workspace/store-contract.ts';

/** Generated-only input for the migration proofs, never a production entrypoint. */
export async function legacyReviewFixture(): Promise<WorkspaceV2> {
  const source = createMemoryStore();
  const post = instagramContractItem();
  const list = {
    ...post,
    id: `${post.id}-list`,
    text: 'A second generated comment',
  };
  try {
    await writeInstagramContextContract(source, post);
    const value = await source.read(readWorkspace);
    value.items.push(list);
    const context = value.instagramContext![0]!;
    value.instagramContext!.push({
      ...context,
      itemId: list.id,
      confirmedBy: 'list',
      comment: { id: null, createdAt: null, expandClicks: 0 },
      attemptId: 'generated-list-send',
    });
    const send = value.browserAttempts![0]!;
    const settled = value.browserAttempts![1]!;
    value.browserAttempts!.push(
      { ...send, seq: 3, attemptId: 'generated-list-send', itemId: list.id },
      {
        ...settled,
        seq: 4,
        attemptId: 'generated-list-confirmed',
        itemId: list.id,
        settles: 'generated-list-send',
      },
    );
    value.counts.items++;
    value.counts.instagramContext!++;
    value.counts.browserAttempts! += 2;
    value.schemaVersion = 6;
    value.settings = {
      categories: ['political', 'sexual', 'earlier', 'harmless', 'unclear'],
      timeZone: 'Europe/Berlin',
    };
    delete value.reviewPlans;
    delete value.counts.reviewPlans;
    const x: Item = {
      ...post,
      id: 'x:7001',
      account: { key: 'x:generated', handle: null },
      platform: 'x',
      kind: 'post',
      text: 'A generated political remark',
      engagement: { likes: 0, reposts: null },
    };
    value.items.push(x);
    const label: Assessment = {
      assessmentId: 'generated-review-legacy',
      itemId: x.id,
      submissionId: 'generated-review-run',
      source: { kind: 'agent', name: 'generated-agent', version: '1' },
      category: 'earlier',
      risk: 2,
      reason: 'A generated earlier category applies.',
      evidence: null,
      confidence: null,
      createdAt: value.createdAt,
    };
    value.submissions.push({
      submissionId: label.submissionId!,
      contentHash: `sha256:${'a'.repeat(64)}`,
      source: { ...label.source, kind: 'agent' },
      receivedAt: label.createdAt,
      labelCount: 1,
    });
    value.assessments.push(label);
    value.counts.items++;
    value.counts.submissions++;
    value.counts.assessments++;
    return value;
  } finally {
    await source.close();
  }
}

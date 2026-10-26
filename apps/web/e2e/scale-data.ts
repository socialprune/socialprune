import { createHash } from 'node:crypto';
import { createDemo, createRandom } from '@socialprune/fixture-gen';
import { createWorkspace } from '@socialprune/core/workspace/store';
import { criterionHash } from '@socialprune/core/criteria';
import type { FeedSort } from '@socialprune/core/criteria';

export const SCALE_ACCOUNT = 'x:scale-generated';
export const SCALE_SUGGESTIONS = 6_000;
export const SCALE_COUNT_ITEMS = 100_000;
export const SCALE_SEED = 20261023;

/** Expand only the existing synthetic demo generator, never platform data. */
export async function scaleWorkspace(count: number, sort: FeedSort = 'newest') {
  if (count < SCALE_SUGGESTIONS || count > SCALE_COUNT_ITEMS)
    throw new Error('Scale item count must be between 6,000 and 100,000.');
  const demo = await createDemo();
  const templates = demo.exports.find((value) => value.platform === 'x')!
    .expected.items;
  const random = createRandom(SCALE_SEED);
  const workspace = createWorkspace({ id: `generated-scale-${count}` });
  const time = '2026-10-23T12:00:00.000Z';
  workspace.createdAt = time;
  workspace.updatedAt = time;
  workspace.lastBackupAt = time;
  workspace.settings.criteria!.selected = ['political'];
  workspace.settings.criteria!.level = 2;
  workspace.settings.keepRules = [];
  workspace.settings.review = {
    accountKey: SCALE_ACCOUNT,
    filter: {},
    search: '',
    sort: [{ by: 'createdAt', direction: 'desc' }],
    feed: {
      tab: 'suggested',
      anchors: {},
      views: {
        [SCALE_ACCOUNT]: Object.fromEntries(
          ['suggested', 'held', 'kept', 'unclear', 'marked', 'all'].map(
            (tab) => [tab, { sort }],
          ),
        ),
      },
    },
  };
  workspace.items = Array.from({ length: count }, (_, index) => {
    const template = templates[Math.floor(random() * templates.length)]!;
    return {
      ...structuredClone(template),
      id: `x:scale-${index.toString().padStart(6, '0')}`,
      platform: 'x' as const,
      account: { key: SCALE_ACCOUNT, handle: 'scale_reader_demo' },
      kind: 'post' as const,
      text: `${template.text}\nGenerated scale entry ${index + 1}.`,
      createdAt: new Date(Date.parse(time) - index * 60_000).toISOString(),
      mediaCount: 0,
      engagement: { likes: Math.floor(random() * 20), reposts: 0 },
      reference: {
        replyToId: null,
        replyToHandle: null,
        quotedId: null,
        repostOfHandle: null,
        ownerHandle: null,
      },
      url: null,
      provenance: {
        archive: 'synthetic-scale',
        file: 'generated-demo-expansion',
        index,
      },
    };
  });
  const source = {
    kind: 'agent' as const,
    name: 'generated-scale-suggestions',
    version: '1',
  };
  workspace.assessments = workspace.items.map((item, index) => ({
    assessmentId: `scale-assessment-${index}`,
    submissionId: 'scale-generated-submission',
    itemId: item.id,
    source,
    category: index < SCALE_SUGGESTIONS ? 'political' : 'harmless',
    risk: index < SCALE_SUGGESTIONS ? 2 : 0,
    reason:
      index < SCALE_SUGGESTIONS
        ? 'This generated suggestion exercises the connected feed.'
        : 'This generated entry exercises the clear count.',
    evidence: index < SCALE_SUGGESTIONS ? 'Generated scale entry' : null,
    confidence: null,
    createdAt: time,
  }));
  workspace.submissions = [
    {
      submissionId: 'scale-generated-submission',
      contentHash: `sha256:${'a'.repeat(64)}`,
      source,
      receivedAt: time,
      labelCount: count,
      criteria: [
        {
          id: 'political',
          hash: criterionHash('political', workspace.settings),
        },
      ],
    },
  ];
  workspace.counts.items = count;
  workspace.counts.assessments = count;
  workspace.counts.submissions = 1;
  const text = JSON.stringify(workspace);
  const suggestionOrder = workspace.items
    .slice(0, SCALE_SUGGESTIONS)
    .sort((a, b) => {
      if (sort === 'likes' || sort === 'reposts') {
        const byCount = (b.engagement[sort] ?? -1) - (a.engagement[sort] ?? -1);
        if (byCount) return byCount;
      }
      return (
        (sort === 'oldest'
          ? a.createdAt.localeCompare(b.createdAt)
          : b.createdAt.localeCompare(a.createdAt)) || a.id.localeCompare(b.id)
      );
    })
    .map((item) => item.id);
  return {
    text,
    suggestionOrder,
    manifest: {
      generator: '@socialprune/fixture-gen createDemo + createRandom',
      seed: SCALE_SEED,
      items: count,
      suggestions: SCALE_SUGGESTIONS,
      bytes: Buffer.byteLength(text),
      sha256: createHash('sha256').update(text).digest('hex'),
      accountKey: SCALE_ACCOUNT,
      sort,
      firstId: workspace.items[0]!.id,
      finalSuggestionId: workspace.items[SCALE_SUGGESTIONS - 1]!.id,
    },
  };
}

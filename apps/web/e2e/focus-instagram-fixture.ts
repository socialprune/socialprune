import {
  generatedReadPost,
  liveExpected,
  liveFeedFixture,
} from './feed-fixture.ts';
import type { InstagramContext } from '@socialprune/core';

export const instagramStates = [
  'post',
  'list',
  'missing-owner',
  'missing-post',
] as const;
export type InstagramState = (typeof instagramStates)[number];

/** Generated single-comment views exercise each retained evidence path. */
export function focusInstagramFixture(state: InstagramState) {
  const data = liveFeedFixture();
  data.items = data.items.filter(
    (item) =>
      item.platform !== 'instagram' || item.id === liveExpected.readComment,
  );
  const comment = data.items.find(
    (item) => item.id === liveExpected.readComment,
  )!;
  if (state === 'missing-owner') comment.reference.ownerHandle = null;
  data.assessments = data.assessments.filter((assessment) =>
    data.items.some((item) => item.id === assessment.itemId),
  );
  data.counts.items = data.items.length;
  data.counts.assessments = data.assessments.length;
  data.submissions[0]!.labelCount = data.assessments.length;
  const record = generatedReadPost();
  if (state === 'list') {
    record.confirmedBy = 'list';
    record.comment = { id: null, createdAt: null, expandClicks: 0 };
  }
  if (state === 'missing-owner') record.ownerCheck = 'not-in-export';
  const records: InstagramContext[] = state === 'missing-post' ? [] : [record];
  return { data, records };
}

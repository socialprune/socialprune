import type { InstagramContext } from '@socialprune/core';
import type { ConfirmationResult, PostProjection } from './selectors.ts';
import { ownerName } from './plan.ts';
import { ContextStop } from './report.ts';

export type RefreshSettledCode = 'post-unavailable' | 'comment-not-shown';
/** Missing content is a settled observation, never a replacement confirmation. */
export function refreshOutcome(input: {
  opened: boolean;
  context?: InstagramContext;
  post?: Pick<PostProjection, 'owner' | 'ownerCount' | 'code'> &
    Partial<Pick<PostProjection, 'comments'>>;
  result?: ConfirmationResult;
}): RefreshSettledCode | null {
  const { context, post, result } = input;
  if (!context || context.confirmedBy !== 'post')
    throw new ContextStop('PLATFORM_CHECK', 'post-structure');
  if (!input.opened) return 'post-unavailable';
  if (
    !post ||
    !result ||
    post.ownerCount !== 1 ||
    ownerName(post.owner) !== ownerName(context.post.owner) ||
    post.code !== context.post.code
  )
    throw new ContextStop('PLATFORM_CHECK', 'post-structure');
  if (result.state === 'confirmed') {
    if (
      result.comment.id !== context.comment.id ||
      result.comment.createdAt !== context.comment.createdAt
    )
      throw new ContextStop('PLATFORM_CHECK', 'post-structure');
    return null;
  }
  // Even a not-shown classification cannot erase a changed known ID/time.
  if (
    result.code !== 'not-shown' ||
    post.comments?.some((comment) => comment.id === context.comment.id)
  )
    throw new ContextStop('PLATFORM_CHECK', 'post-structure');
  return 'comment-not-shown';
}

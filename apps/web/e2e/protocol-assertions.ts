import assert from 'node:assert/strict';
import {
  WorkspaceReplySchema,
  WorkspaceNotificationSchema,
} from '@socialprune/core/workspace/protocol';

export function assertUnknownRequestReply(
  reply: unknown,
  requestId: string,
): void {
  assert.deepEqual(reply, {
    type: 'failed',
    requestId,
    code: 'INVALID_REQUEST',
  });
}
export function assertCanonicalWorkerPosts(messages: unknown[]): void {
  assert(messages.length > 0, 'The worker must have posted an actual message.');
  const invalid = messages.filter(
    (message) =>
      !WorkspaceReplySchema.safeParse(message).success &&
      !WorkspaceNotificationSchema.safeParse(message).success,
  );
  assert.deepEqual(
    invalid,
    [],
    'Every workspace post must pass a shared core schema.',
  );
}

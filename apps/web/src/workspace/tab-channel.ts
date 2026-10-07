import {
  WorkspaceNotificationSchema,
  WorkspaceSummarySchema,
} from '@socialprune/core/workspace/protocol';

// This browser-only channel has no HTTP transport. Treat every peer-origin
// message as data, even when another tab claims it is SocialPrune.
export const TabChangeSchema = WorkspaceNotificationSchema.options[0]
  .omit({ type: true, countsChanged: true })
  .extend({
    workspaceId: WorkspaceSummarySchema.shape.workspaceId,
    revision: WorkspaceNotificationSchema.options[0].shape.revision.max(
      Number.MAX_SAFE_INTEGER,
    ),
  });
export function tabChange(input: unknown, workspaceId: string) {
  const parsed = TabChangeSchema.safeParse(input);
  return parsed.success && parsed.data.workspaceId === workspaceId
    ? parsed.data
    : null;
}

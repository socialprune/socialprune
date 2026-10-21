import type { WorkspaceMeta } from '../model/index.ts';
import { WorkspaceError } from '../workspace/errors.ts';

/** Shared by graph validation and the streaming reader before legacy migration. */
export function assertReviewVersion(
  version: number,
  settings: unknown,
  plansPresent = false,
  submissions: readonly { criteria?: unknown }[] = [],
): void {
  if (version >= 7) return;
  const value = settings as
    | { criteria?: unknown; keepRules?: unknown; review?: { feed?: unknown } }
    | undefined;
  if (
    plansPresent ||
    value?.criteria !== undefined ||
    value?.keepRules !== undefined ||
    value?.review?.feed !== undefined ||
    submissions.some((value) => value.criteria !== undefined)
  )
    throw new WorkspaceError('BACKUP_INVALID_SCHEMA');
}

/** The settings zod schema enforces limits; this binds IDs to their 32-ID room. */
export function assertReviewSettings(
  settings: WorkspaceMeta['settings'],
): void {
  const criteria = settings.criteria;
  if (!criteria || !settings.keepRules)
    throw new WorkspaceError('BACKUP_INVALID_SCHEMA');
  if (
    criteria.selected.some((id) => !settings.categories.includes(id)) ||
    criteria.custom.some((value) => !settings.categories.includes(value.id))
  )
    throw new WorkspaceError('UNKNOWN_CATEGORY');
  if (
    settings.categories.some(
      (id) =>
        /^custom-[1-9][0-9]*$/.test(id) &&
        Number(id.slice(7)) >= criteria.nextCustom,
    )
  )
    throw new WorkspaceError('BACKUP_INVALID_SCHEMA');
}

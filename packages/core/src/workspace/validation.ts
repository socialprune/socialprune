import { WorkspaceV2Schema } from '../model/index.ts';
import type { WorkspaceCounts, WorkspaceV2 } from '../model/index.ts';
import { WorkspaceError } from './errors.ts';
import { deriveState } from './state.ts';

export function workspaceCounts(
  workspace: Pick<
    WorkspaceV2,
    | 'imports'
    | 'items'
    | 'assessments'
    | 'submissions'
    | 'decisionEvents'
    | 'outcomeEvents'
  >,
): WorkspaceCounts {
  return {
    imports: workspace.imports.length,
    items: workspace.items.length,
    assessments: workspace.assessments.length,
    submissions: workspace.submissions.length,
    decisionEvents: workspace.decisionEvents.length,
    outcomeEvents: workspace.outcomeEvents.length,
  };
}
export function validateWorkspace(input: unknown): WorkspaceV2 {
  const parsed = WorkspaceV2Schema.safeParse(input);
  if (!parsed.success) throw new WorkspaceError('INVALID_WORKSPACE');
  const workspace = parsed.data;
  const actual = workspaceCounts(workspace);
  for (const key of Object.keys(actual) as (keyof WorkspaceCounts)[])
    if (workspace.counts[key] !== actual[key])
      throw new WorkspaceError('COUNT_MISMATCH');
  const unique = (values: string[]) => {
    if (new Set(values).size !== values.length)
      throw new WorkspaceError('DUPLICATE_ID');
  };
  unique(workspace.items.map((item) => item.id));
  unique(workspace.imports.map((record) => record.id));
  unique(workspace.assessments.map((record) => record.assessmentId));
  unique(workspace.submissions.map((record) => record.submissionId));
  unique(
    [...workspace.decisionEvents, ...workspace.outcomeEvents].map(
      (record) => record.eventId,
    ),
  );
  for (const item of workspace.items)
    if (!item.id.startsWith(`${item.platform}:`))
      throw new WorkspaceError('INVALID_ITEM_ID');
  const itemIds = new Set(workspace.items.map((item) => item.id));
  const submissions = new Map(
    workspace.submissions.map((record) => [record.submissionId, record]),
  );
  const submissionCounts = new Map<string, number>();
  for (const assessment of workspace.assessments) {
    if (!itemIds.has(assessment.itemId))
      throw new WorkspaceError('UNKNOWN_ITEM');
    if (assessment.source.kind === 'fixture' && workspace.kind !== 'demo')
      throw new WorkspaceError('FIXTURE_NOT_ALLOWED');
    if (
      assessment.submissionId !== null &&
      !submissions.has(assessment.submissionId)
    )
      throw new WorkspaceError('UNKNOWN_SUBMISSION');
    if (assessment.submissionId !== null) {
      const submission = submissions.get(assessment.submissionId)!;
      if (
        JSON.stringify(assessment.source) !== JSON.stringify(submission.source)
      )
        throw new WorkspaceError('INVALID_LABEL');
      submissionCounts.set(
        assessment.submissionId,
        (submissionCounts.get(assessment.submissionId) ?? 0) + 1,
      );
    }
  }
  for (const submission of workspace.submissions)
    if (
      (submissionCounts.get(submission.submissionId) ?? 0) !==
      submission.labelCount
    )
      throw new WorkspaceError('COUNT_MISMATCH');
  const actions = new Map<
    string,
    (
      | (typeof workspace.decisionEvents)[number]
      | (typeof workspace.outcomeEvents)[number]
    )[]
  >();
  for (const event of [
    ...workspace.decisionEvents,
    ...workspace.outcomeEvents,
  ]) {
    const group = actions.get(event.action.id) ?? [];
    group.push(event);
    actions.set(event.action.id, group);
    if (event.value === event.previous && event.action.kind !== 'migrated')
      throw new WorkspaceError('ACTION_INVALID');
    if (
      (event.action.kind === 'single' || event.action.kind === 'migrated') &&
      (event.action.size !== 1 || event.action.reverts !== null)
    )
      throw new WorkspaceError('ACTION_INVALID');
    if (event.action.kind === 'bulk' && event.action.reverts !== null)
      throw new WorkspaceError('ACTION_INVALID');
    if (
      (event.action.kind === 'undo' || event.action.kind === 'redo') &&
      event.action.reverts === null
    )
      throw new WorkspaceError('ACTION_INVALID');
    if (
      'recordedAt' in event &&
      event.source.via === 'v1-unrecorded' &&
      event.action.kind !== 'migrated'
    )
      throw new WorkspaceError('ACTION_INVALID');
  }
  for (const group of actions.values()) {
    const first = group[0]!;
    if (
      group.length !== first.action.size ||
      new Set(group.map((event) => event.itemId)).size !== group.length ||
      group.some(
        (event) =>
          JSON.stringify(event.action) !== JSON.stringify(first.action) ||
          'decidedAt' in event !== 'decidedAt' in first,
      )
    )
      throw new WorkspaceError('ACTION_INVALID');
    if (
      first.action.reverts !== null &&
      (first.action.reverts === first.action.id ||
        !actions.has(first.action.reverts))
    )
      throw new WorkspaceError('ACTION_INVALID');
  }
  deriveState(workspace);
  return workspace;
}

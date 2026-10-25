import {
  WorkspaceV2Schema,
  migrateOriginal,
  validateOriginal,
  validateInstagramContexts,
  migrateInstagramContext,
} from '../model/index.ts';
import type { WorkspaceCounts, WorkspaceV2 } from '../model/index.ts';
import { WorkspaceError } from './errors.ts';
import {
  assertReviewSettings,
  assertReviewVersion,
} from '../criteria/admission.ts';
import { deriveState } from './state.ts';
import {
  validateBrowserJournal,
  validateInstagramDeletionEvidence,
  validateBrowserOutcomes,
} from '../model/browser.ts';

export function workspaceCounts(
  workspace: Pick<
    WorkspaceV2,
    | 'imports'
    | 'items'
    | 'assessments'
    | 'submissions'
    | 'decisionEvents'
    | 'outcomeEvents'
    | 'originals'
    | 'browserRuns'
    | 'browserAttempts'
    | 'instagramContext'
    | 'reviewPlans'
  >,
): WorkspaceCounts {
  return {
    imports: workspace.imports.length,
    items: workspace.items.length,
    assessments: workspace.assessments.length,
    submissions: workspace.submissions.length,
    decisionEvents: workspace.decisionEvents.length,
    outcomeEvents: workspace.outcomeEvents.length,
    ...(workspace.reviewPlans !== undefined
      ? { reviewPlans: workspace.reviewPlans.length }
      : {}),
    ...(workspace.originals !== undefined
      ? { originals: workspace.originals.length }
      : {}),
    ...(workspace.browserRuns !== undefined
      ? { browserRuns: workspace.browserRuns.length }
      : {}),
    ...(workspace.browserAttempts !== undefined
      ? { browserAttempts: workspace.browserAttempts.length }
      : {}),
    ...(workspace.instagramContext?.length
      ? { instagramContext: workspace.instagramContext.length }
      : {}),
  };
}
export function validateWorkspace(input: unknown): WorkspaceV2 {
  if (
    input &&
    typeof input === 'object' &&
    'schemaVersion' in input &&
    typeof input.schemaVersion === 'number'
  ) {
    const value = input as {
      settings?: unknown;
      reviewPlans?: unknown;
      submissions?: { criteria?: unknown }[];
    };
    assertReviewVersion(
      input.schemaVersion,
      value.settings,
      value.reviewPlans !== undefined,
      value.submissions,
    );
  }
  let candidate =
    input &&
    typeof input === 'object' &&
    'schemaVersion' in input &&
    typeof input.schemaVersion === 'number' &&
    input.schemaVersion < 4 &&
    'originals' in input &&
    Array.isArray(input.originals)
      ? { ...input, originals: input.originals.map(migrateOriginal) }
      : input;
  if (
    candidate &&
    typeof candidate === 'object' &&
    'schemaVersion' in candidate &&
    typeof candidate.schemaVersion === 'number' &&
    candidate.schemaVersion >= 5 &&
    candidate.schemaVersion < 8 &&
    'instagramContext' in candidate &&
    Array.isArray(candidate.instagramContext)
  ) {
    try {
      const contextVersion = candidate.schemaVersion === 5 ? 5 : 7;
      candidate = {
        ...candidate,
        schemaVersion:
          candidate.schemaVersion === 5 ? 6 : candidate.schemaVersion,
        instagramContext: candidate.instagramContext.map((record) =>
          migrateInstagramContext(record, contextVersion),
        ),
      };
    } catch {
      throw new WorkspaceError('INVALID_WORKSPACE');
    }
  }
  const parsed = WorkspaceV2Schema.safeParse(candidate);
  if (!parsed.success) throw new WorkspaceError('INVALID_WORKSPACE');
  const workspace = parsed.data;
  if (
    workspace.schemaVersion < 10 &&
    (workspace.browserRuns?.some(
      (run) =>
        run.instagramWarning ||
        run.pageDays ||
        (run.platform === 'instagram' && run.mode !== 'context'),
    ) ||
      workspace.browserAttempts?.some(
        (attempt) => attempt.action === 'delete-comment',
      ) ||
      workspace.outcomeEvents.some(
        (event) => event.source.via === 'browser-instagram',
      ))
  )
    throw new WorkspaceError('INVALID_WORKSPACE');
  if (
    workspace.schemaVersion < 9 &&
    workspace.browserRuns?.some((run) => run.warningKind !== undefined)
  )
    throw new WorkspaceError('INVALID_WORKSPACE');
  if (
    workspace.schemaVersion >= 7 &&
    (!workspace.settings.criteria ||
      !workspace.settings.keepRules ||
      !workspace.reviewPlans ||
      workspace.submissions.some((value) => !value.criteria))
  )
    throw new WorkspaceError('INVALID_WORKSPACE');
  if (workspace.schemaVersion >= 7) assertReviewSettings(workspace.settings);
  if (
    (workspace.schemaVersion >= 3 &&
      (!workspace.browserRuns || !workspace.browserAttempts)) ||
    (workspace.schemaVersion < 5 &&
      (workspace.instagramContext !== undefined ||
        workspace.counts.instagramContext !== undefined)) ||
    (workspace.schemaVersion === 2 &&
      (workspace.browserRuns !== undefined ||
        workspace.browserAttempts !== undefined))
  )
    throw new WorkspaceError('INVALID_WORKSPACE');
  const actual = workspaceCounts(workspace);
  for (const key of Object.keys(actual) as (keyof WorkspaceCounts)[])
    if ((workspace.counts[key] ?? 0) !== actual[key])
      throw new WorkspaceError('COUNT_MISMATCH');
  const unique = (values: string[]) => {
    if (new Set(values).size !== values.length)
      throw new WorkspaceError('DUPLICATE_ID');
  };
  unique(workspace.items.map((item) => item.id));
  unique(workspace.imports.map((record) => record.id));
  unique((workspace.originals ?? []).map((record) => record.id));
  if ((workspace.counts.originals ?? 0) !== (workspace.originals?.length ?? 0))
    throw new WorkspaceError('COUNT_MISMATCH');
  if (
    (workspace.counts.instagramContext ?? 0) !==
    (workspace.instagramContext?.length ?? 0)
  )
    throw new WorkspaceError('COUNT_MISMATCH');
  unique(workspace.assessments.map((record) => record.assessmentId));
  unique(workspace.submissions.map((record) => record.submissionId));
  unique((workspace.reviewPlans ?? []).map((record) => record.actionId));
  unique(
    [...workspace.decisionEvents, ...workspace.outcomeEvents].map(
      (record) => record.eventId,
    ),
  );
  const sequences = new Set<number>();
  for (const events of [workspace.decisionEvents, workspace.outcomeEvents]) {
    let high = 0;
    for (const event of events) {
      if (event.seq <= high || sequences.has(event.seq))
        throw new WorkspaceError('EVENT_SEQUENCE');
      high = event.seq;
      sequences.add(event.seq);
    }
  }
  for (const item of workspace.items)
    if (!item.id.startsWith(`${item.platform}:`))
      throw new WorkspaceError('INVALID_ITEM_ID');
  const itemIds = new Set(workspace.items.map((item) => item.id));
  try {
    validateBrowserJournal(
      workspace.browserRuns ?? [],
      workspace.browserAttempts ?? [],
      itemIds,
      new Set((workspace.originals ?? []).map((value) => value.id)),
      new Map(workspace.items.map((item) => [item.id, item])),
    );
    validateInstagramContexts(
      workspace.instagramContext ?? [],
      new Map(workspace.items.map((item) => [item.id, item])),
      workspace.browserRuns ?? [],
      workspace.browserAttempts ?? [],
    );
    validateInstagramDeletionEvidence(
      workspace.browserAttempts ?? [],
      workspace.instagramContext ?? [],
    );
    if (workspace.schemaVersion >= 3)
      validateBrowserOutcomes(
        workspace.browserAttempts ?? [],
        workspace.outcomeEvents,
      );
    const accountedReads = new Set<string>();
    for (const original of workspace.originals ?? []) {
      validateOriginal(original);
      if (original.signedIn) {
        const run = (workspace.browserRuns ?? []).find(
            (run) => run.runId === original.signedIn!.runId,
          ),
          attempt = (workspace.browserAttempts ?? []).find(
            (attempt) => attempt.attemptId === original.signedIn!.attemptId,
          );
        if (
          run?.mode !== 'fill' ||
          attempt?.action !== 'read-post' ||
          attempt.state !== original.signedIn.status
        )
          throw new Error('INVALID_ORIGINAL_JOURNAL');
        accountedReads.add(attempt.attemptId);
      }
    }
    for (const attempt of workspace.browserAttempts ?? [])
      if (
        attempt.action === 'read-post' &&
        attempt.state === 'read' &&
        !accountedReads.has(attempt.attemptId) &&
        !(workspace.originals ?? []).some(
          (original) =>
            original.id === attempt.originalId &&
            original.signedInRecord !== null,
        )
      )
        throw new Error('INVALID_ORIGINAL_JOURNAL');
  } catch {
    throw new WorkspaceError('INVALID_WORKSPACE');
  }
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
  for (const plan of workspace.reviewPlans ?? []) {
    const group = actions.get(plan.actionId);
    if (
      !group ||
      group[0]!.action.kind !== 'bulk' ||
      group.some(
        (event) =>
          !('decidedAt' in event) ||
          event.value !== 'delete' ||
          workspace.items.find((item) => item.id === event.itemId)?.account
            .key !== plan.accountKey,
      ) ||
      plan.counts.suggested !== group.length
    )
      throw new WorkspaceError('ACTION_INVALID');
  }
  deriveState(workspace);
  return workspace;
}

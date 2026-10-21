import type {
  Assessment,
  Submission,
  WorkspaceMeta,
  WorkspaceV2,
} from '../model/index.ts';
import { criterionHash, criterionRoom } from './presets.ts';
import { defaultKeepRules, CRITERIA_SELECTED_MAX } from './schema.ts';

export function migrateReviewSettings(
  settings: WorkspaceMeta['settings'],
  assessments: readonly Assessment[] = [],
): WorkspaceMeta['settings'] {
  if (settings.criteria) return settings;
  const current = new Map<string, Assessment>();
  for (const value of assessments)
    current.set(
      JSON.stringify([value.itemId, value.source.kind, value.source.name]),
      value,
    );
  const earlier = [
    ...new Set([
      ...settings.categories,
      ...[...current.values()].map((value) => value.category),
    ]),
  ];
  const { categories } = criterionRoom(earlier);
  const nextCustom =
    Math.max(
      0,
      ...categories
        .filter((id) => /^custom-[1-9][0-9]*$/.test(id))
        .map((id) => Number(id.slice(7))),
    ) + 1;
  return {
    ...settings,
    categories,
    criteria: {
      selected: earlier
        .filter((id) => id !== 'harmless' && id !== 'unclear')
        .slice(0, CRITERIA_SELECTED_MAX),
      custom: [],
      nextCustom,
      level: 2,
    },
    keepRules: defaultKeepRules(),
  };
}
export function migrateSubmission(
  input: Submission,
  settings: WorkspaceMeta['settings'],
): Submission {
  return input.criteria
    ? input
    : {
        ...input,
        criteria: settings.categories.map((id) => ({
          id,
          hash: criterionHash(id, settings),
        })),
      };
}
export function migrateReviewContract(workspace: WorkspaceV2): WorkspaceV2 {
  if (workspace.schemaVersion >= 7) return workspace;
  const settings = migrateReviewSettings(
    workspace.settings,
    workspace.assessments,
  );
  const submissionSettings = {
    ...settings,
    categories: workspace.settings.categories,
  };
  return {
    ...workspace,
    schemaVersion: 7,
    settings,
    submissions: workspace.submissions.map((value) =>
      migrateSubmission(value, submissionSettings),
    ),
    browserRuns: workspace.browserRuns ?? [],
    browserAttempts: workspace.browserAttempts ?? [],
    reviewPlans: workspace.reviewPlans ?? [],
    counts: {
      ...workspace.counts,
      browserRuns: workspace.browserRuns?.length ?? 0,
      browserAttempts: workspace.browserAttempts?.length ?? 0,
      reviewPlans: workspace.reviewPlans?.length ?? 0,
    },
  };
}

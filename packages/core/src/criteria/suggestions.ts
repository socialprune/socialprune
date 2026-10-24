import type { Assessment, WorkspaceV2 } from '../model/index.ts';
import { criterionHash, PRESET_IDS } from './presets.ts';

export interface CriterionCheck {
  criterion: string;
  source: Assessment['source'];
  status: 'hit' | 'unclear' | 'clear';
  assessment?: Assessment;
}
/** Submission array order is authoritative; source version and timestamps are not. */
export function currentChecks(
  workspace: Pick<WorkspaceV2, 'assessments' | 'submissions' | 'settings'>,
): Map<string, CriterionCheck[]> {
  const result = new Map<string, Map<string, CriterionCheck>>();
  const bySubmission = new Map<string, Map<string, Assessment[]>>();
  const standalone = new Map<string, Map<string, Assessment>>();
  for (const label of workspace.assessments) {
    if (label.submissionId === null) {
      const item =
        standalone.get(label.itemId) ?? new Map<string, Assessment>();
      item.set(JSON.stringify([label.source.kind, label.source.name]), label);
      standalone.set(label.itemId, item);
    } else {
      const run =
        bySubmission.get(label.submissionId) ?? new Map<string, Assessment[]>();
      const labels = run.get(label.itemId) ?? [];
      labels.push(label);
      run.set(label.itemId, labels);
      bySubmission.set(label.submissionId, run);
    }
  }
  const accept = (
    labels: Assessment[],
    checked: { id: string; hash: string }[],
  ) => {
    labels = [
      ...new Map(labels.map((label) => [label.category, label])).values(),
    ];
    const first = labels[0]!;
    const item = result.get(first.itemId) ?? new Map<string, CriterionCheck>();
    for (const criterion of checked) {
      // A removed active slot may still be named by historical submissions.
      // Its recorded hash remains provenance; it is never selected for new work.
      if (
        workspace.settings.categories.includes(criterion.id) &&
        criterion.hash !== criterionHash(criterion.id, workspace.settings)
      )
        continue;
      const hit = labels.findLast((label) => label.category === criterion.id);
      const unclear = labels.find((label) => label.category === 'unclear');
      const assessment =
        hit ?? unclear ?? labels.find((label) => label.category === 'harmless');
      item.set(
        JSON.stringify([first.source.kind, first.source.name, criterion.id]),
        {
          criterion: criterion.id,
          source: first.source,
          status: hit ? 'hit' : unclear ? 'unclear' : 'clear',
          ...(assessment ? { assessment } : {}),
        },
      );
    }
    result.set(first.itemId, item);
  };
  for (const sources of standalone.values())
    for (const label of sources.values())
      accept(
        [label],
        [...new Set([...PRESET_IDS, label.category])].map((id) => ({
          id,
          hash: criterionHash(id, workspace.settings),
        })),
      );
  for (const submission of workspace.submissions) {
    const checked =
      submission.criteria ??
      workspace.settings.categories.map((id) => ({
        id,
        hash: criterionHash(id, workspace.settings),
      }));
    for (const labels of bySubmission.get(submission.submissionId)?.values() ??
      [])
      accept(labels, checked);
  }
  return new Map([...result].map(([id, checks]) => [id, [...checks.values()]]));
}

export function currentAssessments(
  workspace: Pick<WorkspaceV2, 'assessments' | 'submissions' | 'settings'>,
): Map<string, Assessment[]> {
  const result = new Map<string, Assessment[]>();
  const checks = currentChecks(workspace);
  for (const [id, current] of checks) {
    const labels = new Map<string, Assessment>();
    for (const check of current)
      if (check.assessment)
        labels.set(check.assessment.assessmentId, check.assessment);
    result.set(id, [...labels.values()]);
  }
  return result;
}

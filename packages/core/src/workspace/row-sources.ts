import type { Assessment, AssessmentSource } from '../model/index.ts';

export const ROW_SOURCE_LIMIT = 8;

/** Locale-independent UTF-16 ordinal order; a null version precedes strings. */
export function compareAssessmentSources(
  first: AssessmentSource,
  second: AssessmentSource,
): number {
  for (const field of ['kind', 'name', 'version'] as const) {
    const a = first[field];
    const b = second[field];
    if (a === b) continue;
    if (a === null) return -1;
    if (b === null) return 1;
    return a < b ? -1 : 1;
  }
  return 0;
}

export function currentRowSources(assessments: readonly Assessment[]): {
  sources: AssessmentSource[];
  moreSources: number;
} {
  const current = new Map<string, AssessmentSource>();
  for (const assessment of assessments)
    current.set(
      JSON.stringify([assessment.source.kind, assessment.source.name]),
      assessment.source,
    );
  const sources = [...current.values()].sort(compareAssessmentSources);
  return {
    sources: sources
      .slice(0, ROW_SOURCE_LIMIT)
      .map((source) => ({ ...source })),
    moreSources: Math.max(0, sources.length - ROW_SOURCE_LIMIT),
  };
}

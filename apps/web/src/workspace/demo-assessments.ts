import { AssessmentSchema } from '@socialprune/core';
import { LabelService } from '@socialprune/core/workspace/labels';
import type { WorkspaceStore } from '@socialprune/core/workspace/store';

/** Worker-internal only. No assessment-writing request is exposed to the page. */
export async function attachDemoAssessments(
  store: WorkspaceStore,
  input: unknown,
): Promise<void> {
  const meta = await store.read((tx) => tx.meta.get());
  if (meta.kind !== 'demo')
    throw Object.assign(new Error('Demo only.'), {
      code: 'FIXTURE_NOT_ALLOWED',
    });
  const assessments = AssessmentSchema.array().parse(input);
  if (assessments.some(({ source }) => source.kind !== 'fixture'))
    throw new Error('Demo assessments must be examples.');
  const { ids, attached } = await store.read(async (tx) => {
    const complete = new Set<string>();
    for await (const record of tx.imports.iterate())
      if (record.status === 'complete') complete.add(record.id);
    const ids = new Set<string>();
    for await (const stored of tx.items.iterate())
      if (complete.has(stored.importId)) ids.add(stored.item.id);
    const attached = new Set<string>();
    for await (const assessment of tx.assessments.iterate())
      attached.add(assessment.assessmentId);
    return { ids, attached };
  });
  const labels = new LabelService(store);
  for (const assessment of assessments)
    if (ids.has(assessment.itemId) && !attached.has(assessment.assessmentId))
      await labels.appendAssessment(assessment);
}

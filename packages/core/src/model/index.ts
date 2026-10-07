import { z } from 'zod';
import * as v1 from './v1.ts';

export {
  PlatformIdSchema,
  CategoryIdSchema,
  UtcTimestampSchema,
  DEFAULT_CATEGORIES,
  ItemKindSchema,
  AccountSchema,
  DiagnosticSchema,
  DecisionSchema,
  OutcomeSchema,
} from './v1.ts';
export type {
  PlatformId,
  CategoryId,
  ItemKind,
  Account,
  Diagnostic,
  Decision,
  Outcome,
} from './v1.ts';

const id = z.string().min(1);
const count = z.number().int().nonnegative();
export const ItemSchema = v1.ItemSchema.extend({
  mediaCount: count.nullable(),
});
export type Item = z.infer<typeof ItemSchema>;
export const AssessmentSourceSchema = v1.AssessmentSchema.shape.source.extend({
  kind: z.enum(['rules', 'model', 'agent', 'fixture']),
});
export type AssessmentSource = z.infer<typeof AssessmentSourceSchema>;
export const AssessmentSchema = v1.AssessmentSchema.extend({
  assessmentId: id,
  submissionId: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,128}$/)
    .nullable(),
  source: AssessmentSourceSchema,
});
export type Assessment = z.infer<typeof AssessmentSchema>;
export function evidenceIsVerbatim(
  item: Item,
  assessment: Assessment,
): boolean {
  return (
    assessment.evidence === null || item.text.includes(assessment.evidence)
  );
}
export const ImportRecordSchema = v1.ImportRecordSchema.extend({
  status: z.enum(['complete', 'incomplete']),
});
export type ImportRecord = z.infer<typeof ImportRecordSchema>;
export const DecisionValueSchema = z.enum([
  'keep',
  'delete',
  'later',
  'undecided',
]);
export type DecisionValue = z.infer<typeof DecisionValueSchema>;
export const OutcomeValueSchema = v1.OutcomeSchema.shape.value;
export type OutcomeValue = z.infer<typeof OutcomeValueSchema>;
export const HumanSourceSchema = v1.DecisionSchema.shape.source;
export const ActionSchema = z.strictObject({
  id,
  kind: z.enum(['single', 'bulk', 'undo', 'redo', 'migrated']),
  size: count.min(1),
  reverts: id.nullable(),
});
export type Action = z.infer<typeof ActionSchema>;
export const DecisionEventSchema = z.strictObject({
  eventId: id,
  itemId: id,
  value: DecisionValueSchema,
  previous: DecisionValueSchema,
  decidedAt: v1.UtcTimestampSchema,
  source: HumanSourceSchema,
  action: ActionSchema,
});
export type DecisionEvent = z.infer<typeof DecisionEventSchema>;
export const OutcomeEventSchema = z.strictObject({
  eventId: id,
  itemId: id,
  value: OutcomeValueSchema,
  previous: OutcomeValueSchema,
  recordedAt: v1.UtcTimestampSchema,
  source: HumanSourceSchema.extend({
    via: z.enum(['web-review', 'local-review', 'v1-unrecorded']),
  }),
  action: ActionSchema,
});
export type OutcomeEvent = z.infer<typeof OutcomeEventSchema>;
export const SubmissionSchema = z.strictObject({
  submissionId: z.string().regex(/^[A-Za-z0-9._-]{1,128}$/),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  source: AssessmentSourceSchema.extend({ kind: z.literal('agent') }),
  receivedAt: v1.UtcTimestampSchema,
  labelCount: count,
});
export type Submission = z.infer<typeof SubmissionSchema>;
export const WorkspaceCountsSchema = z.strictObject({
  imports: count,
  items: count,
  assessments: count,
  submissions: count,
  decisionEvents: count,
  outcomeEvents: count,
});
export type WorkspaceCounts = z.infer<typeof WorkspaceCountsSchema>;
export const WorkspaceMetaSchema = z.strictObject({
  format: z.literal('socialprune-workspace'),
  schemaVersion: z.literal(2),
  id,
  kind: z.enum(['personal', 'demo']),
  createdAt: v1.UtcTimestampSchema,
  updatedAt: v1.UtcTimestampSchema,
  lastBackupAt: v1.UtcTimestampSchema.nullable(),
  settings: z.strictObject({
    categories: z.array(v1.CategoryIdSchema).max(32),
    timeZone: z.string().min(1).nullable(),
  }),
});
export type WorkspaceMeta = z.infer<typeof WorkspaceMetaSchema>;
export const WorkspaceV2Schema = WorkspaceMetaSchema.extend({
  counts: WorkspaceCountsSchema,
  imports: z.array(ImportRecordSchema),
  items: z.array(ItemSchema),
  submissions: z.array(SubmissionSchema),
  assessments: z.array(AssessmentSchema),
  decisionEvents: z.array(DecisionEventSchema),
  outcomeEvents: z.array(OutcomeEventSchema),
});
export type WorkspaceV2 = z.infer<typeof WorkspaceV2Schema>;
export const WorkspaceSchema = WorkspaceV2Schema;
export type Workspace = WorkspaceV2;

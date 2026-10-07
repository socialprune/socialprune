import { z } from 'zod';

export const PlatformIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
export type PlatformId = z.infer<typeof PlatformIdSchema>;
export const CategoryIdSchema = PlatformIdSchema;
export type CategoryId = z.infer<typeof CategoryIdSchema>;
export const UtcTimestampSchema = z.iso.datetime({ offset: false });
const id = z.string().min(1);
const nullableText = z.string().nullable();
const count = z.number().int().nonnegative();

export const DEFAULT_CATEGORIES = [
  'toxic',
  'personal-attack',
  'political',
  'sexual',
  'drugs-illegal',
  'personal-info',
  'embarrassing',
  'empty',
  'harmless',
  'unclear',
] as const satisfies readonly CategoryId[];

export const ItemKindSchema = z.enum([
  'post',
  'reply',
  'quote',
  'repost',
  'comment',
]);
export type ItemKind = z.infer<typeof ItemKindSchema>;
export const AccountSchema = z.strictObject({ key: id, handle: nullableText });
export type Account = z.infer<typeof AccountSchema>;
export const ItemSchema = z.strictObject({
  id,
  platform: PlatformIdSchema,
  account: AccountSchema,
  kind: ItemKindSchema,
  text: z.string(),
  createdAt: UtcTimestampSchema,
  engagement: z.strictObject({
    likes: count.nullable(),
    reposts: count.nullable(),
  }),
  reference: z.strictObject({
    replyToId: nullableText,
    replyToHandle: nullableText,
    quotedId: nullableText,
    repostOfHandle: nullableText,
    ownerHandle: nullableText,
  }),
  url: nullableText,
  provenance: z.strictObject({ archive: id, file: id, index: count }),
});
export type Item = z.infer<typeof ItemSchema>;

// A sentence stays on one line and has no sentence-ending punctuation followed
// by another word. This is a format check, not a linguistic classifier.
export const AssessmentSchema = z.strictObject({
  itemId: id,
  source: z.strictObject({
    kind: z.enum(['rules', 'model', 'agent']),
    name: id,
    version: nullableText,
  }),
  category: CategoryIdSchema,
  risk: z.number().int().min(0).max(3),
  reason: z
    .string()
    .min(1)
    .max(300)
    .regex(/^(?=[\s\S]*\S)(?![\s\S]*[.!?]\s+\S)(?![\s\S]*[\r\n])[\s\S]+$/),
  evidence: nullableText,
  confidence: z.number().min(0).max(1).nullable(),
  createdAt: UtcTimestampSchema,
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

export const DecisionSchema = z.strictObject({
  itemId: id,
  value: z.enum(['keep', 'delete', 'later']),
  decidedAt: UtcTimestampSchema,
  source: z.strictObject({
    kind: z.literal('human'),
    via: z.enum(['web-review', 'local-review']),
  }),
});
export type Decision = z.infer<typeof DecisionSchema>;
export const OutcomeSchema = z.strictObject({
  itemId: id,
  value: z.enum(['deleted-by-user', 'skipped', 'unknown']),
  recordedAt: UtcTimestampSchema,
});
export type Outcome = z.infer<typeof OutcomeSchema>;
export const DiagnosticSchema = z.strictObject({
  category: id,
  status: z.enum(['found', 'missing', 'empty', 'unreadable', 'skipped']),
  files: z.array(z.string()),
  count,
  message: nullableText,
});
export type Diagnostic = z.infer<typeof DiagnosticSchema>;
export const ImportRecordSchema = z.strictObject({
  id,
  platform: PlatformIdSchema,
  importedAt: UtcTimestampSchema,
  archives: z.array(z.string()),
  exportCreatedAt: UtcTimestampSchema.nullable(),
  accounts: z.array(AccountSchema),
  adapter: z.strictObject({ name: id, version: id }),
  variant: nullableText,
  diagnostics: z.array(DiagnosticSchema),
  itemCount: count,
});
export type ImportRecord = z.infer<typeof ImportRecordSchema>;
export const WorkspaceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
  settings: z.strictObject({ categories: z.array(CategoryIdSchema) }),
  imports: z.array(ImportRecordSchema),
  items: z.array(ItemSchema),
  assessments: z.array(AssessmentSchema),
  decisions: z.array(DecisionSchema),
  outcomes: z.array(OutcomeSchema),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;

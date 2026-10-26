import '../browser-init.ts';
import { z } from 'zod';
import { CategoryIdSchema, UtcTimestampSchema } from '../model/v1.ts';

// ADR-034 accepted on 2026-10-21: up to 32 selected IDs.
// Harmless and unclear stay unselectable.
export const CRITERIA_SELECTED_MAX = 32;

export const CriterionHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const CheckedCriterionSchema = z.strictObject({
  id: CategoryIdSchema,
  hash: CriterionHashSchema,
});
export const CheckedCriteriaSchema = z
  .array(CheckedCriterionSchema)
  .max(32)
  .refine(
    (values) => new Set(values.map((value) => value.id)).size === values.length,
  );
export const CustomCriterionSchema = z.strictObject({
  id: z.string().regex(/^custom-[1-9][0-9]*$/),
  label: z.string().trim().min(1).max(60),
  description: z.string().trim().min(1).max(300),
  createdAt: UtcTimestampSchema,
});
export const CriteriaSettingsSchema = z
  .strictObject({
    selected: z
      .array(CategoryIdSchema)
      .max(CRITERIA_SELECTED_MAX)
      .refine(
        (values) =>
          new Set(values).size === values.length &&
          !values.some((value) => value === 'harmless' || value === 'unclear'),
      ),
    custom: z.array(CustomCriterionSchema).max(8),
    nextCustom: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    level: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  })
  .refine(
    (value) =>
      new Set(value.custom.map((criterion) => criterion.id)).size ===
        value.custom.length &&
      value.custom.every(
        (criterion) => Number(criterion.id.slice(7)) < value.nextCustom,
      ),
  );
const baseRule = { id: z.string().min(1).max(128), enabled: z.boolean() };
const threshold = {
  count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  alsoWhenUnknown: z.boolean(),
};
export const KeepRuleSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...baseRule, kind: z.literal('top-liked-tenth') }),
  z.strictObject({
    ...baseRule,
    kind: z.literal('likes-at-least'),
    ...threshold,
  }),
  z.strictObject({
    ...baseRule,
    kind: z.literal('reposts-at-least'),
    ...threshold,
  }),
  z.strictObject({
    ...baseRule,
    kind: z.literal('created-from'),
    date: z.iso.date(),
  }),
]);
export const KeepRulesSchema = z
  .array(KeepRuleSchema)
  .max(16)
  .refine(
    (values) => new Set(values.map((value) => value.id)).size === values.length,
  );
export const FeedTabSchema = z.enum([
  'suggested',
  'held',
  'kept',
  'unclear',
  'marked',
  'all',
]);
export const FeedSortSchema = z.enum(['newest', 'oldest', 'likes', 'reposts']);
export type FeedSort = z.infer<typeof FeedSortSchema>;
export const FeedViewSchema = z.strictObject({
  tab: FeedTabSchema,
  anchors: z.partialRecord(FeedTabSchema, z.string().min(1)),
  views: z
    .record(
      z.string().min(1).max(512),
      z.partialRecord(
        FeedTabSchema,
        z.strictObject({
          sort: FeedSortSchema,
          single: z.boolean().optional(),
          anchor: z.string().min(1).optional(),
        }),
      ),
    )
    .optional(),
});
const count = z.number().int().nonnegative();
export const FeedTabCountsSchema = z.strictObject({
  suggested: count,
  held: count,
  kept: count,
  unclear: count,
  marked: count,
  all: count,
});
export const ReviewPlanSchema = z.strictObject({
  actionId: z.string().min(1),
  accountKey: z.string().min(1),
  createdAt: UtcTimestampSchema,
  criteria: CheckedCriteriaSchema,
  level: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  keepRules: KeepRulesSchema,
  counts: FeedTabCountsSchema,
  sources: z.array(
    z.strictObject({
      kind: z.enum(['agent', 'model', 'rules', 'fixture']),
      name: z.string().min(1),
      count,
    }),
  ),
});
export type CriteriaSettings = z.infer<typeof CriteriaSettingsSchema>;
export type KeepRule = z.infer<typeof KeepRuleSchema>;
export type FeedTab = z.infer<typeof FeedTabSchema>;
export type ReviewPlan = z.infer<typeof ReviewPlanSchema>;
export const defaultCriteria = (): CriteriaSettings => ({
  selected: [],
  custom: [],
  nextCustom: 1,
  level: 0,
});
export const defaultKeepRules = (): KeepRule[] => [
  { id: 'top-liked-tenth', kind: 'top-liked-tenth', enabled: true },
];

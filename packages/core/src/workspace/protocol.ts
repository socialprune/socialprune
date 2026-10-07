import { z } from 'zod';
import {
  AccountSchema,
  AssessmentSchema,
  AssessmentSourceSchema,
  CategoryIdSchema,
  DecisionEventSchema,
  DecisionValueSchema,
  ItemKindSchema,
  ItemSchema,
  OutcomeEventSchema,
  OutcomeValueSchema,
  UtcTimestampSchema,
  WorkspaceCountsSchema,
} from '../model/index.ts';
import { WORKSPACE_ERROR_CODES } from './errors.ts';
import { ROW_SOURCE_LIMIT } from './row-sources.ts';

const id = z.string().min(1).max(512);
const nonnegative = z.number().int().nonnegative();
const generation = nonnegative;
export const ProtocolErrorCodeSchema = z.enum(WORKSPACE_ERROR_CODES);
export const DecisionCountsSchema = z.strictObject({
  keep: nonnegative,
  delete: nonnegative,
  later: nonnegative,
  undecided: nonnegative,
});
export const OutcomeCountsSchema = z.strictObject({
  'deleted-by-user': nonnegative,
  skipped: nonnegative,
  unknown: nonnegative,
});
export const QueryCountsSchema = z.strictObject({
  decisions: DecisionCountsSchema,
  outcomes: OutcomeCountsSchema,
});
export const WorkspaceSummarySchema = z.strictObject({
  workspaceId: id,
  schemaVersion: z.literal(2),
  kind: z.enum(['personal', 'demo']),
  accounts: z.array(AccountSchema),
  counts: WorkspaceCountsSchema,
  decisions: DecisionCountsSchema,
  outcomes: OutcomeCountsSchema,
  lastBackupAt: UtcTimestampSchema.nullable(),
  timeZone: z.string().min(1).nullable(),
  revision: nonnegative,
});
export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>;
const DateKeySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const range = z.strictObject({
  min: nonnegative.nullable(),
  max: nonnegative.nullable(),
  unknown: z.enum(['include', 'exclude', 'only']),
});
export const QueryFilterSchema = z.strictObject({
  decisions: z.array(DecisionValueSchema).optional(),
  outcomes: z.array(OutcomeValueSchema).optional(),
  kinds: z.array(ItemKindSchema).optional(),
  risk: z
    .strictObject({
      min: z.number().int().min(0).max(3),
      max: z.number().int().min(0).max(3),
      unknown: z.enum(['include', 'exclude', 'only']),
    })
    .optional(),
  categories: z.array(CategoryIdSchema).optional(),
  sources: z.array(AssessmentSchema.shape.source.shape.kind).optional(),
  dates: z
    .strictObject({
      from: DateKeySchema.nullable(),
      to: DateKeySchema.nullable(),
    })
    .optional(),
  likes: range.optional(),
  reposts: range.optional(),
});
export type QueryFilter = z.infer<typeof QueryFilterSchema>;
export const QuerySortSchema = z
  .array(
    z.strictObject({
      by: z.enum(['risk', 'createdAt', 'id', 'likes', 'reposts']),
      direction: z.enum(['asc', 'desc']),
    }),
  )
  .min(1)
  .max(5);
export type QuerySort = z.infer<typeof QuerySortSchema>;
export const ReviewRowSchema = z.strictObject({
  id,
  kind: ItemKindSchema,
  createdAt: UtcTimestampSchema,
  text: z.string().max(280),
  highestRisk: z.number().int().min(0).max(3).nullable(),
  categories: z.array(CategoryIdSchema),
  sources: z.array(AssessmentSourceSchema).max(ROW_SOURCE_LIMIT),
  moreSources: nonnegative,
  decision: DecisionValueSchema,
  outcome: OutcomeValueSchema,
  mediaCount: nonnegative.nullable(),
});
export type ReviewRow = z.infer<typeof ReviewRowSchema>;
export const BulkPreviewSchema = z.strictObject({
  previewId: id,
  pageId: id,
  queryId: id,
  generation,
  value: DecisionValueSchema,
  overwrite: z.array(DecisionValueSchema).min(1).max(4),
  total: nonnegative,
  willChange: nonnegative,
  unchanged: nonnegative,
  byCurrentValue: DecisionCountsSchema,
  sample: z.array(ReviewRowSchema).max(20),
  revision: nonnegative,
  expiresAt: UtcTimestampSchema,
  selection: z
    .strictObject({
      requested: nonnegative,
      inView: nonnegative,
      notInView: nonnegative,
    })
    .optional(),
});
export type BulkPreview = z.infer<typeof BulkPreviewSchema>;
export const ItemDetailSchema = z.strictObject({
  item: ItemSchema,
  assessments: z.array(AssessmentSchema),
  events: z.array(z.union([DecisionEventSchema, OutcomeEventSchema])),
});
export type ItemDetail = z.infer<typeof ItemDetailSchema>;
export const HistoryEntrySchema = z.strictObject({
  actionId: id,
  kind: DecisionEventSchema.shape.action.shape.kind,
  value: z.union([DecisionValueSchema, OutcomeValueSchema]),
  size: nonnegative.min(1),
  time: UtcTimestampSchema,
});
const itemIds = z.array(id).min(1).max(1000);
const expectedDecisions = z.record(id, DecisionValueSchema);
const expectedOutcomes = z.record(id, OutcomeValueSchema);
const requestBase = { requestId: id };
export const DecideRequestSchema = z.strictObject({
  ...requestBase,
  type: z.literal('decide'),
  commandId: id,
  itemIds,
  value: DecisionValueSchema,
  expected: expectedDecisions,
});
export const OutcomeRequestSchema = z.strictObject({
  ...requestBase,
  type: z.literal('outcome'),
  commandId: id,
  itemIds,
  value: OutcomeValueSchema,
  expected: expectedOutcomes,
});
// N1: overwrite is explicit; N2: every preview operation binds the page ID.
export const PreviewBulkRequestSchema = z.strictObject({
  ...requestBase,
  type: z.literal('previewBulk'),
  pageId: id,
  previewId: id,
  queryId: id,
  generation,
  value: DecisionValueSchema,
  overwrite: z.array(DecisionValueSchema).min(1).max(4),
  itemIds: z
    .array(id)
    .min(1)
    .max(10_000)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'Selection item IDs must be unique.',
    })
    .optional(),
});
const requests = [
  z.strictObject({ ...requestBase, type: z.literal('open'), workspaceId: id }),
  z.strictObject({
    ...requestBase,
    type: z.literal('query'),
    queryId: id,
    generation,
    accountKey: id,
    filter: QueryFilterSchema,
    sort: QuerySortSchema,
    search: z.string().max(4096),
  }),
  z.strictObject({
    ...requestBase,
    type: z.literal('window'),
    queryId: id,
    generation,
    offset: nonnegative,
    limit: z.number().int().min(1).max(200),
  }),
  z.strictObject({ ...requestBase, type: z.literal('detail'), itemId: id }),
  DecideRequestSchema,
  PreviewBulkRequestSchema,
  z.strictObject({
    ...requestBase,
    type: z.literal('confirmBulk'),
    commandId: id,
    pageId: id,
    previewId: id,
  }),
  z.strictObject({
    ...requestBase,
    type: z.literal('releasePreview'),
    pageId: id,
    previewId: id,
  }),
  z.strictObject({ ...requestBase, type: z.literal('undo'), commandId: id }),
  z.strictObject({ ...requestBase, type: z.literal('redo'), commandId: id }),
  z.strictObject({
    ...requestBase,
    type: z.literal('history'),
    limit: z.number().int().min(1).max(200),
  }),
  OutcomeRequestSchema,
  z.strictObject({ ...requestBase, type: z.literal('revision') }),
  z.strictObject({ ...requestBase, type: z.literal('shutdown') }),
] as const;
export const HttpReviewRequestSchema = z
  .discriminatedUnion('type', requests)
  .superRefine((request, ctx) => {
    if (request.type !== 'decide' && request.type !== 'outcome') return;
    if (
      new Set(request.itemIds).size !== request.itemIds.length ||
      Object.keys(request.expected).length !== request.itemIds.length ||
      request.itemIds.some((itemId) => !(itemId in request.expected))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Expected values must match the item IDs.',
      });
    if (
      request.itemIds.some((itemId) => !Object.hasOwn(request.expected, itemId))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Expected values must be own item keys.',
      });
  });
export type HttpReviewRequest = z.infer<typeof HttpReviewRequestSchema>;
const browserRequests = [
  z.strictObject({
    ...requestBase,
    type: z.literal('backup'),
    target: z.custom<WritableStream<Uint8Array>>(
      (value) =>
        typeof WritableStream !== 'undefined' &&
        value instanceof WritableStream,
    ),
  }),
  z.strictObject({
    ...requestBase,
    type: z.literal('restore'),
    file: z.custom<Blob>(
      (value) => typeof Blob !== 'undefined' && value instanceof Blob,
    ),
  }),
  z.strictObject({
    ...requestBase,
    type: z.literal('attachImport'),
    port: z.custom<MessagePort>(
      (value) =>
        typeof MessagePort !== 'undefined' && value instanceof MessagePort,
    ),
  }),
] as const;
export const WorkspaceRequestSchema = z.union([
  HttpReviewRequestSchema,
  z.discriminatedUnion('type', browserRequests),
]);
export type WorkspaceRequest = z.infer<typeof WorkspaceRequestSchema>;
const replyBase = { requestId: id };
export const WorkspaceReplySchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...replyBase,
    type: z.literal('opened'),
    summary: WorkspaceSummarySchema,
  }),
  z.strictObject({
    ...replyBase,
    type: z.literal('queryResult'),
    queryId: id,
    generation,
    total: nonnegative,
    counts: QueryCountsSchema,
  }),
  z.strictObject({
    ...replyBase,
    type: z.literal('rows'),
    queryId: id,
    generation,
    offset: nonnegative,
    rows: z.array(ReviewRowSchema).max(200),
  }),
  z.strictObject({
    ...replyBase,
    type: z.literal('itemDetail'),
    ...ItemDetailSchema.shape,
  }),
  z.strictObject({
    ...replyBase,
    type: z.literal('committed'),
    commandId: id,
    actionId: id.nullable(),
    revision: nonnegative,
    changed: nonnegative,
    skipped: nonnegative.optional(),
  }),
  z.strictObject({
    ...replyBase,
    type: z.literal('rejected'),
    commandId: id,
    code: ProtocolErrorCodeSchema,
    changedSince: nonnegative.optional(),
  }),
  z.strictObject({
    ...replyBase,
    type: z.literal('bulkPreview'),
    ...BulkPreviewSchema.shape,
  }),
  z.strictObject({ ...replyBase, type: z.literal('released') }),
  z.strictObject({
    ...replyBase,
    type: z.literal('historyEntries'),
    entries: z.array(HistoryEntrySchema).max(200),
  }),
  z.strictObject({
    ...replyBase,
    type: z.literal('progress'),
    completed: nonnegative,
    total: nonnegative.nullable(),
  }),
  z.strictObject({ ...replyBase, type: z.literal('done') }),
  z.strictObject({
    ...replyBase,
    type: z.literal('failed'),
    code: ProtocolErrorCodeSchema,
  }),
  z.strictObject({
    ...replyBase,
    type: z.literal('cancelled'),
    queryId: id,
    generation,
  }),
  z.strictObject({
    ...replyBase,
    type: z.literal('revision'),
    revision: nonnegative,
  }),
]);
export type WorkspaceReply = z.infer<typeof WorkspaceReplySchema>;
export const WorkspaceNotificationSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('changed'),
    revision: nonnegative,
    itemIds: z.union([z.array(id).max(1000), z.literal('many')]),
    countsChanged: z.boolean(),
  }),
  z.strictObject({
    type: z.literal('storageState'),
    persisted: z.boolean(),
    usage: nonnegative,
    quota: nonnegative,
  }),
]);
export type WorkspaceNotification = z.infer<typeof WorkspaceNotificationSchema>;

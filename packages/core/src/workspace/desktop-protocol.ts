import { z } from 'zod';
import '../browser-init.ts';
import { ItemKindSchema, UtcTimestampSchema } from '../model/v1.ts';
import { HttpReviewRequestSchema, WorkspaceReplySchema } from './protocol.ts';
import { platformPostUrl } from './desktop-links.ts';
import {
  DesktopCliErrorCodeSchema,
  DesktopErrorCodeSchema,
  InstagramHostClassSchema,
  InstagramPathClassSchema,
  RunActionSchema,
  RunEndReasonSchema,
  RunJournalCodeSchema,
  RunJournalOutcomeSchema,
  RunReadbackOutcomeSchema,
  RunSettledStateSchema,
  RunStopDetailSchema,
  XRateOperationSchema,
} from './desktop-tokens.ts';
export * from './desktop-tokens.ts';

const id = z.string().min(1).max(512);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const timestamp = UtcTimestampSchema.max(32);
const duration = z.number().int().min(0).max(86_400_000);
const planHash = z
  .string()
  .length(64)
  .regex(/^[a-f0-9]{64}$/);
const account = z
  .string()
  .min(1)
  .max(50)
  .regex(/^[A-Za-z0-9_.]+$/);
const calendarDay = z.iso.date().length(10);
const unique = <T>(values: readonly T[]) =>
  new Set(values).size === values.length;

export const DesktopPlatformSchema = z.enum(['x', 'instagram']);
/** Main resolves guide identifiers or checks a closed post route after a click. */
export const DesktopLinkSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('guide-source'),
    platform: DesktopPlatformSchema,
    factId: z
      .string()
      .min(3)
      .max(128)
      .regex(/^(?:x|instagram)\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
    locale: z.enum(['en', 'de']),
  }),
  z.strictObject({ kind: z.literal('guide-report') }),
  z.strictObject({
    kind: z.literal('platform-post'),
    url: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => platformPostUrl(value) !== null),
  }),
]);
export type DesktopLink = z.infer<typeof DesktopLinkSchema>;
export const DesktopBrowserSchema = z.enum(['edge', 'chrome']);
export const DesktopRunModeSchema = z.enum([
  'delete',
  'verify',
  'fill',
  'context',
]);
export type DesktopPlatform = z.infer<typeof DesktopPlatformSchema>;
export type DesktopBrowser = z.infer<typeof DesktopBrowserSchema>;
export type DesktopRunMode = z.infer<typeof DesktopRunModeSchema>;
export const DesktopRunActionSchema = z.enum([
  'acknowledge-warning',
  'start',
  'continue',
  'matches',
  'does-not-match',
  'pause',
  'resume',
  'stop',
]);
export type DesktopRunAction = z.infer<typeof DesktopRunActionSchema>;

/** Only the person's own entry text belongs here, never an original's body. */
export const RunEntrySchema = z.strictObject({
  kind: ItemKindSchema,
  date: z.union([timestamp, calendarDay]),
  firstLine: z
    .string()
    .max(10_000)
    .regex(/^[^\r\n\u0000-\u0008\u000b-\u001f\u007f]*$/u),
  textTruncated: z.boolean(),
  action: RunActionSchema,
});
export type RunEntry = z.infer<typeof RunEntrySchema>;

export const RunProgressSchema = z
  .strictObject({
    planned: count,
    completed: count,
    marked: count,
    bulk: count,
    // Sending is not settled. Reloads can cause several settlements per entry,
    // so only completed/marked/bulk, not the settlement sum, are <= planned.
    settled: z.record(RunSettledStateSchema, count),
  })
  .refine(
    (value) =>
      value.completed <= value.planned &&
      value.marked <= value.planned &&
      value.bulk <= value.planned,
    'Progress exceeds the plan.',
  );
export type RunProgress = z.infer<typeof RunProgressSchema>;
export const RunTodaySchema = z.strictObject({
  date: calendarDay,
  timeZone: z.string().min(1).max(128),
  used: count,
  cap: z.number().int().min(1).max(600),
  unit: z.enum(['pages', 'steps']),
  sharedWithXDeleteAndFill: z.boolean(),
});
export const RunJournalLineSchema = z.strictObject({
  at: timestamp,
  action: RunActionSchema,
  outcome: RunJournalOutcomeSchema,
  code: RunJournalCodeSchema.nullable(),
});
export type RunToday = z.infer<typeof RunTodaySchema>;
export type RunJournalLine = z.infer<typeof RunJournalLineSchema>;
export const XRateWindowSchema = z
  .strictObject({
    operation: XRateOperationSchema,
    // Unknown operation names are data, not catalog tokens. Keep separate rows
    // for them instead of merging distinct rate windows under graphql-other.
    operationName: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9_]+$/)
      .nullable(),
    limit: count.min(1),
    remaining: count,
    resetAt: timestamp,
  })
  .refine(
    (value) =>
      value.operation === 'graphql-other' || value.operationName === null,
    'Only other GraphQL operations carry an observed name.',
  );
export type XRateWindow = z.infer<typeof XRateWindowSchema>;

const readiness = z
  .strictObject({
    count,
    // The existing median of two integer durations can have a half millisecond.
    medianMs: z.number().min(0).max(86_400_000).multipleOf(0.5).nullable(),
    maxMs: duration.nullable(),
  })
  .refine(
    (value) =>
      value.count === 0
        ? value.medianMs === null && value.maxMs === null
        : value.medianMs !== null &&
          value.maxMs !== null &&
          value.medianMs <= value.maxMs,
    'Readiness values must agree with their count.',
  );
export const InstagramResponsesSchema = z.strictObject({
  responses: z
    .array(
      z
        .strictObject({
          host: InstagramHostClassSchema,
          path: InstagramPathClassSchema,
          count,
          status4xx: z.record(
            z
              .string()
              .length(3)
              .regex(/^4\d{2}$/),
            count,
          ),
          status5xx: count,
        })
        .refine(
          (group) =>
            Object.values(group.status4xx).reduce(
              (sum, count) => sum + count,
              group.status5xx,
            ) <= group.count,
          'Error responses exceed the response count.',
        ),
    )
    .max(28)
    .refine(
      (groups) => unique(groups.map((group) => `${group.host}|${group.path}`)),
      'Response groups must be unique.',
    ),
  ready: z.strictObject({ list: readiness, post: readiness }),
  // Header names are bounded data from signals.ts, never header values. That
  // source permits a grammar, not a closed list of every future header name.
  headerNames: z
    .array(
      z
        .string()
        .min(1)
        .max(61)
        .regex(
          /^(?:retry-after|x-rate-?limit(?:-[a-z0-9-]{1,48})?|ratelimit(?:-(?:limit|remaining|reset|policy))?)$/,
        ),
    )
    .max(128)
    .refine(unique, 'Header names must be unique.'),
});
export type InstagramResponses = z.infer<typeof InstagramResponsesSchema>;

const extensionIds = z
  .array(
    z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9_-]+$/),
  )
  .max(512)
  .refine(unique, 'Extension IDs must be unique.');
export const RunProfileReadbackSchema = z
  .strictObject({
    outcome: RunReadbackOutcomeSchema,
    profileObserved: z.boolean(),
    accountBefore: account.nullable(),
    accountAfter: account.nullable(),
    extensionIdsBefore: extensionIds,
    extensionIdsAfter: extensionIds,
    extensionIdsAdded: extensionIds,
    extensionIdsRemoved: extensionIds,
    changedFiles: z.array(z.string().min(1).max(4096)).max(10_000),
    unexpectedRequests: z
      .array(
        z.strictObject({
          method: z
            .string()
            .min(1)
            .max(16)
            .regex(/^[A-Z]+$/),
          host: z.string().min(1).max(512),
          path: z.string().min(1).max(4096),
          status: z.number().int().min(100).max(599).nullable(),
          operation: z
            .string()
            .min(1)
            .max(256)
            .regex(/^[A-Za-z0-9_]+$/)
            .nullable(),
        }),
      )
      .max(10_000),
  })
  .superRefine((value, ctx) => {
    const added = value.extensionIdsAfter.filter(
      (id) => !value.extensionIdsBefore.includes(id),
    );
    const removed = value.extensionIdsBefore.filter(
      (id) => !value.extensionIdsAfter.includes(id),
    );
    if (
      added.length !== value.extensionIdsAdded.length ||
      added.some((id) => !value.extensionIdsAdded.includes(id)) ||
      removed.length !== value.extensionIdsRemoved.length ||
      removed.some((id) => !value.extensionIdsRemoved.includes(id))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Extension differences must match the observed sets.',
      });
    if (
      value.outcome === 'unchanged' &&
      (!value.profileObserved ||
        !value.accountBefore ||
        value.accountBefore.toLowerCase() !==
          value.accountAfter?.toLowerCase() ||
        added.length ||
        removed.length)
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Unchanged requires an observed matching account and extension set.',
      });
  });
export type RunProfileReadback = z.infer<typeof RunProfileReadbackSchema>;
export const RunEndSchema = z
  .strictObject({
    at: timestamp,
    reason: RunEndReasonSchema,
    detail: RunStopDetailSchema.nullable(),
    cliCode: DesktopCliErrorCodeSchema.nullable(),
  })
  .refine(
    (value) =>
      ![
        'error',
        'platform-check',
        'shape-changed',
        'account-mismatch',
        'canary-mismatch',
      ].includes(value.reason) ||
      (value.detail !== null && value.cliCode !== null),
    'Error ends need their closed detail and CLI code.',
  );
export type RunEnd = z.infer<typeof RunEndSchema>;

const warning = z.strictObject({
  form: z.enum(['full', 'short']),
  acknowledged: z.boolean(),
  text: z.string().min(1).max(8192),
});
const active = {
  version: count,
  runId: id,
  platform: DesktopPlatformSchema,
  mode: DesktopRunModeSchema,
  accountKey: id,
  expectedHandle: account,
  planHash,
  canary: z.boolean(),
  pauseRequested: z.boolean(),
  progress: RunProgressSchema,
  today: RunTodaySchema,
  pace: z.strictObject({
    // productionPace accepts safe-integer milliseconds without a semantic upper
    // bound. Retain that numeric maximum, including subsecond slower overrides.
    secondsPerStep: z
      .number()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER / 1000)
      .refine(
        (seconds) =>
          Number.isSafeInteger(Math.round(seconds * 1000)) &&
          seconds === Math.round(seconds * 1000) / 1000,
      ),
    batchSize: count.min(1).max(100),
    batchPauseMs: count,
  }),
  nextStepAt: timestamp.nullable(),
  currentEntry: RunEntrySchema.nullable(),
  journal: z.array(RunJournalLineSchema).max(10),
  xWindows: z
    .array(XRateWindowSchema)
    .max(256)
    .refine(
      (windows) =>
        unique(
          windows.map(
            (window) => `${window.operation}|${window.operationName ?? ''}`,
          ),
        ),
      'Rate windows must have unique operation identities.',
    ),
  instagram: InstagramResponsesSchema.nullable(),
  warning,
  profile: z.strictObject({
    canChange: z.array(z.string().min(1).max(2048)).min(1).max(32),
    before: z
      .strictObject({ account: account.nullable(), extensionIds })
      .nullable(),
    readback: RunProfileReadbackSchema.nullable(),
  }),
  browserWindow: z
    .strictObject({
      browser: DesktopBrowserSchema,
      placement: z.enum(['beside', 'own-size']),
    })
    .nullable(),
};
/** Push this same schema on socialprune:run-view; idle has no invented run. */
export const RunViewSchema = z
  .discriminatedUnion('phase', [
    z.strictObject({ phase: z.literal('idle'), version: count }),
    z.strictObject({
      ...active,
      phase: z.literal('planning'),
      expectedHandle: account.nullable(),
      planHash: planHash.nullable(),
      warning: warning.nullable(),
    }),
    z.strictObject({ ...active, phase: z.literal('awaiting-warning') }),
    z.strictObject({ ...active, phase: z.literal('awaiting-start') }),
    z.strictObject({ ...active, phase: z.literal('running') }),
    z.strictObject({
      ...active,
      phase: z.literal('batch-pause'),
      remainingMs: count,
      until: timestamp,
    }),
    z.strictObject({
      ...active,
      phase: z.literal('rate-wait'),
      remainingMs: duration.max(965_000),
      resetAt: timestamp,
    }),
    z.strictObject({
      ...active,
      phase: z.literal('reload-wait'),
      remainingMs: duration.max(60_000),
      until: timestamp,
      reload: z.number().int().min(1).max(3),
    }),
    z.strictObject({
      ...active,
      phase: z.literal('paused'),
      pausedAt: timestamp,
    }),
    z.strictObject({
      ...active,
      phase: z.literal('canary-review'),
      canary: z.literal(true),
    }),
    z.strictObject({
      ...active,
      phase: z.literal('awaiting-continue'),
      canary: z.literal(true),
    }),
    z.strictObject({
      ...active,
      phase: z.literal('ending'),
      end: RunEndSchema.nullable(),
    }),
    z.strictObject({ ...active, phase: z.literal('ended'), end: RunEndSchema }),
  ])
  .superRefine((view, ctx) => {
    if (view.phase === 'idle') return;
    const { mode, pace, today } = view;
    const boundedOrder = mode === 'fill' || mode === 'context';
    const minSeconds = mode === 'delete' ? 30 : 10;
    const maxBatch = mode === 'verify' ? 100 : 20;
    const maxCap =
      mode === 'verify'
        ? 100
        : mode === 'delete'
          ? 200
          : mode === 'fill'
            ? 300
            : 600;
    if (
      pace.secondsPerStep < minSeconds ||
      (boundedOrder &&
        (!Number.isInteger(pace.secondsPerStep) || pace.secondsPerStep > 30)) ||
      (mode === 'context' && view.canary && pace.secondsPerStep !== 30) ||
      pace.batchSize > maxBatch ||
      (boundedOrder && pace.batchSize !== maxBatch) ||
      (boundedOrder
        ? ![0, 900_000].includes(pace.batchPauseMs)
        : pace.batchPauseMs < (mode === 'delete' ? 900_000 : 0)) ||
      today.cap > maxCap ||
      (view.phase === 'batch-pause' && view.remainingMs > pace.batchPauseMs) ||
      (view.phase === 'reload-wait' && view.canary) ||
      (mode !== 'fill' && ['rate-wait', 'reload-wait'].includes(view.phase))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Pace, cap or wait exceeds this run mode.',
      });
    if (
      (view.platform === 'instagram') !== (view.mode === 'context') ||
      !view.accountKey.startsWith(`${view.platform}:`)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Platform, account and run mode must agree.',
      });
    if (
      (view.platform === 'x') !== view.today.sharedWithXDeleteAndFill ||
      (view.platform === 'x'
        ? view.today.unit !== 'pages'
        : view.today.unit !== 'steps')
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Daily counts must retain their platform scope.',
      });
    if (
      view.platform === 'instagram' &&
      (view.xWindows.length ||
        ['rate-wait', 'reload-wait'].includes(view.phase))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'X windows and waits do not belong to Instagram.',
      });
    if (view.platform === 'x' && view.instagram !== null)
      ctx.addIssue({
        code: 'custom',
        message: 'Instagram responses do not belong to X.',
      });
    const actions =
      view.mode === 'context'
        ? ['confirm-comment']
        : view.mode === 'fill'
          ? ['read-post']
          : view.mode === 'verify'
            ? ['verify']
            : ['delete-post', 'undo-repost'];
    if (
      (view.currentEntry &&
        (!actions.includes(view.currentEntry.action) ||
          (view.platform === 'instagram') !==
            (view.currentEntry.kind === 'comment'))) ||
      view.journal.some((line) => !actions.includes(line.action))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Entry and journal actions must agree with this run mode.',
      });
    if (view.phase === 'awaiting-warning' && view.warning?.acknowledged)
      ctx.addIssue({
        code: 'custom',
        message: 'Warning acknowledgement is still pending.',
      });
    if (
      !['planning', 'awaiting-warning', 'ending', 'ended'].includes(
        view.phase,
      ) &&
      !view.warning?.acknowledged
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Acknowledge the warning before Start.',
      });
  });
export type RunView = z.infer<typeof RunViewSchema>;

const request = { requestId: id };
export const DesktopCommandSchema = z.discriminatedUnion('type', [
  z
    .strictObject({
      ...request,
      type: z.literal('planRun'),
      platform: DesktopPlatformSchema,
      mode: DesktopRunModeSchema,
      accountKey: id,
      handle: account.optional(),
    })
    .superRefine((value, ctx) => {
      if (
        (value.platform === 'instagram') !== (value.mode === 'context') ||
        !value.accountKey.startsWith(`${value.platform}:`) ||
        (value.handle !== undefined &&
          !(
            value.platform === 'x'
              ? /^[A-Za-z0-9_]{1,15}$/
              : /^[A-Za-z0-9_.]{1,30}$/
          ).test(value.handle))
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Run scope and account must agree.',
        });
    }),
  z.strictObject({
    ...request,
    type: z.literal('startRun'),
    planHash,
    browser: DesktopBrowserSchema,
  }),
  // version rejects stale confirmation clicks; runId prevents a delayed Stop
  // or Matches from affecting a later run. The state machine enforces legality.
  z.strictObject({
    ...request,
    type: z.literal('runAction'),
    runId: id,
    version: count,
    action: DesktopRunActionSchema,
  }),
  z.strictObject({ ...request, type: z.literal('runView') }),
  z.strictObject({ ...request, type: z.literal('browsers') }),
  z.strictObject({
    ...request,
    type: z.literal('profileStatus'),
    platform: DesktopPlatformSchema,
  }),
  z.strictObject({
    ...request,
    type: z.literal('profileSetup'),
    platform: DesktopPlatformSchema,
    browser: DesktopBrowserSchema,
  }),
  // The engine's existing adoption procedure is Instagram-only.
  z.strictObject({
    ...request,
    type: z.literal('profileAdopt'),
    platform: z.literal('instagram'),
  }),
  z.strictObject({
    ...request,
    type: z.literal('profileForget'),
    platform: DesktopPlatformSchema,
  }),
  z.strictObject({ ...request, type: z.literal('importExport') }),
  z.strictObject({ ...request, type: z.literal('backupExport') }),
  z.strictObject({ ...request, type: z.literal('backupRestore') }),
  z.strictObject({ ...request, type: z.literal('dataFolderInfo') }),
  z.strictObject({ ...request, type: z.literal('dataFolderOpen') }),
  z.strictObject({
    ...request,
    type: z.literal('openLink'),
    link: DesktopLinkSchema,
  }),
]);
export type DesktopCommand = z.infer<typeof DesktopCommandSchema>;
// Preserve HttpReviewRequestSchema's refinements, especially exact decision
// expected-value keys. Flattening its .options would silently lose those checks.
export const DesktopRequestSchema = z.union([
  HttpReviewRequestSchema,
  DesktopCommandSchema,
]);
export type DesktopRequest = z.infer<typeof DesktopRequestSchema>;

export const DesktopProfileStatusSchema = z
  .strictObject({
    platform: DesktopPlatformSchema,
    exists: z.boolean(),
    ready: z.boolean(),
    inUse: z.boolean(),
    browser: DesktopBrowserSchema.nullable(),
    canAdopt: z.boolean(),
  })
  .refine(
    (value) =>
      (!value.ready || value.exists) &&
      (!value.inUse || value.exists) &&
      (!value.canAdopt || value.platform === 'instagram'),
    'Profile state must agree.',
  );
export type DesktopProfileStatus = z.infer<typeof DesktopProfileStatusSchema>;
export const DesktopRunPlanSchema = z
  .strictObject({
    platform: DesktopPlatformSchema,
    mode: DesktopRunModeSchema,
    accountKey: id,
    expectedHandle: account,
    planHash,
    planned: count,
    marked: count,
    bulk: count,
    estimateMs: count,
    canary: z.boolean(),
    rows: z.array(RunEntrySchema).max(20),
  })
  .refine(
    (value) =>
      (value.platform === 'instagram') === (value.mode === 'context') &&
      value.accountKey.startsWith(`${value.platform}:`) &&
      value.marked <= value.planned &&
      value.bulk <= value.planned &&
      value.rows.length <= value.planned,
    'Plan scope and counts must agree.',
  );
export type DesktopRunPlan = z.infer<typeof DesktopRunPlanSchema>;
const cancelled = z.strictObject({ status: z.literal('cancelled') });
export const DesktopDataFolderSchema = z.strictObject({
  // Display-only reply from main. There is no request that accepts it back.
  path: z.string().min(1).max(32_767),
  storeBuild: z.boolean(),
  folders: z
    .array(
      z.strictObject({
        kind: z.enum(['workspace', 'profile-x', 'profile-instagram', 'logs']),
        bytes: count,
      }),
    )
    .max(4)
    .refine(
      (folders) => unique(folders.map((folder) => folder.kind)),
      'Data folders must be unique.',
    ),
});
export type DesktopDataFolder = z.infer<typeof DesktopDataFolderSchema>;
export const DesktopReplySchema = z.discriminatedUnion('type', [
  // ReviewRuntime can return progress/chunks followed by one terminal reply.
  // Keep those bytes and shapes unchanged inside a bounded IPC reply envelope.
  z
    .strictObject({
      ...request,
      type: z.literal('reviewReply'),
      replies: z.array(WorkspaceReplySchema).min(1).max(16_384),
    })
    .superRefine((value, ctx) => {
      for (const [index, reply] of value.replies.entries())
        if (
          reply.requestId !== value.requestId ||
          (reply.type === 'progress' ||
            reply.type === 'clickListExportChunk') !==
            index < value.replies.length - 1
        )
          ctx.addIssue({
            code: 'custom',
            message: 'Review reply identity or terminal ordering differs.',
          });
    }),
  z.strictObject({
    ...request,
    type: z.literal('runPlanned'),
    plan: DesktopRunPlanSchema,
  }),
  z.strictObject({
    ...request,
    type: z.literal('runStarted'),
    view: RunViewSchema,
  }),
  z.strictObject({
    ...request,
    type: z.literal('runActionResult'),
    view: RunViewSchema,
  }),
  z.strictObject({
    ...request,
    type: z.literal('runView'),
    view: RunViewSchema,
  }),
  z
    .strictObject({
      ...request,
      type: z.literal('browsersFound'),
      browsers: z.array(DesktopBrowserSchema).max(2).refine(unique),
      preferred: DesktopBrowserSchema.nullable(),
    })
    .refine(
      (value) =>
        value.preferred === null || value.browsers.includes(value.preferred),
      'Preferred browser must be installed.',
    ),
  z.strictObject({
    ...request,
    type: z.literal('profileStatus'),
    profile: DesktopProfileStatusSchema,
  }),
  z.strictObject({
    ...request,
    type: z.literal('profileSetupResult'),
    profile: DesktopProfileStatusSchema,
  }),
  z.strictObject({
    ...request,
    type: z.literal('profileAdoptResult'),
    profile: DesktopProfileStatusSchema.refine(
      (value) => value.platform === 'instagram',
    ),
  }),
  z.strictObject({
    ...request,
    type: z.literal('profileForgetResult'),
    profile: DesktopProfileStatusSchema,
  }),
  z.strictObject({
    ...request,
    type: z.literal('exportImported'),
    result: z.discriminatedUnion('status', [
      cancelled,
      z.strictObject({
        status: z.literal('imported'),
        items: count,
        duplicates: count,
        accounts: count,
        partial: z.boolean(),
      }),
    ]),
  }),
  z.strictObject({
    ...request,
    type: z.literal('backupExported'),
    result: z.discriminatedUnion('status', [
      cancelled,
      z.strictObject({
        status: z.literal('exported'),
        bytes: count,
        mediaFiles: count,
        mediaBytes: count,
      }),
    ]),
  }),
  z.strictObject({
    ...request,
    type: z.literal('backupRestored'),
    result: z.discriminatedUnion('status', [
      cancelled,
      z.strictObject({ status: z.literal('restored'), items: count }),
    ]),
  }),
  z.strictObject({
    ...request,
    type: z.literal('dataFolderInfo'),
    folder: DesktopDataFolderSchema,
  }),
  z.strictObject({
    ...request,
    type: z.literal('dataFolderOpened'),
    opened: z.literal(true),
  }),
  z.strictObject({ ...request, type: z.literal('linkOpened') }),
  z.strictObject({
    ...request,
    type: z.literal('desktopFailed'),
    code: DesktopErrorCodeSchema,
  }),
]);
export type DesktopReply = z.infer<typeof DesktopReplySchema>;

const commandReplies = {
  planRun: 'runPlanned',
  startRun: 'runStarted',
  runAction: 'runActionResult',
  runView: 'runView',
  browsers: 'browsersFound',
  profileStatus: 'profileStatus',
  profileSetup: 'profileSetupResult',
  profileAdopt: 'profileAdoptResult',
  profileForget: 'profileForgetResult',
  importExport: 'exportImported',
  backupExport: 'backupExported',
  backupRestore: 'backupRestored',
  dataFolderInfo: 'dataFolderInfo',
  dataFolderOpen: 'dataFolderOpened',
  openLink: 'linkOpened',
} as const satisfies Record<DesktopCommand['type'], DesktopReply['type']>;
export type DesktopReplyFor<Request extends DesktopRequest> = Extract<
  DesktopReply,
  {
    type:
      | 'desktopFailed'
      | (Request extends DesktopCommand
          ? (typeof commandReplies)[Request['type']]
          : 'reviewReply');
  }
>;

/** Validate both ends of request/reply IPC, including method and identity. */
export function parseDesktopReply<Request extends DesktopRequest>(
  request: Request,
  raw: unknown,
): DesktopReplyFor<Request> {
  const input = DesktopRequestSchema.parse(request);
  const reply = DesktopReplySchema.parse(raw);
  const command = DesktopCommandSchema.safeParse(input);
  const expected = command.success
    ? commandReplies[command.data.type]
    : 'reviewReply';
  if (
    reply.requestId !== input.requestId ||
    (reply.type !== 'desktopFailed' && reply.type !== expected)
  )
    throw new Error('Desktop reply method or request identity differs.');
  return reply as DesktopReplyFor<Request>;
}

export interface DesktopBridge {
  request(message: DesktopRequest): Promise<DesktopReply>;
  onRunView(listener: (view: RunView) => void): () => void;
}

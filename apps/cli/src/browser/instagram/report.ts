import { CLI_ERRORS, CliError } from '../../cli/errors.ts';
import type { CliErrorCode } from '../../cli/errors.ts';
import { z } from 'zod';
import { POST_PATH_CLASSES } from './signals.ts';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { listImageOnlyManual } from './list-image-only.ts';

const count = z.number().int().nonnegative();
const sourceCountSchema = z.strictObject({
  responses: count,
  bodies: count,
  single: count,
  sequence: count,
  failed: count,
  responsesWithCode: count,
  bodiesWithCode: count,
});
const sourceFieldsSchema = z.strictObject({
  owner: z.boolean(),
  time: z.boolean(),
  caption: z.boolean(),
  image: z.boolean(),
});
export const SecondSourceReportSchema = z.strictObject({
  contentTypes: z.strictObject({
    json: sourceCountSchema,
    javascript: sourceCountSchema,
  }),
  objects: z
    .array(
      z.strictObject({
        path: z
          .string()
          .max(1024)
          .refine((path) =>
            path.split('.').every((part) => {
              const stem = part.replace(/(?:\[\])+$/u, '');
              return (
                /^(?:[a-z_]+|\*)?(?:\[\])*$/u.test(part) &&
                (REPORT_KEYS.has(stem) || (stem === '' && part.length > 0))
              );
            }),
          ),
        keys: z.array(z.string().refine((key) => REPORT_KEYS.has(key))).max(64),
        keysCapped: z.boolean(),
        fields: sourceFieldsSchema,
      }),
    )
    .max(64),
  objectsCapped: z.boolean(),
  skippedParameters: count,
});
export type SecondSourceReport = z.infer<typeof SecondSourceReportSchema>;
export const BODY_CLASSES = [
  'bare-not-found',
  'json',
  'html',
  'empty',
  'other',
  'unreadable',
  'large',
  'not-classified',
] as const;
export type BodyClass = (typeof BODY_CLASSES)[number];
export const PostRequestsSchema = z
  .array(
    z
      .strictObject({
        path: z.enum(POST_PATH_CLASSES),
        status: z.number().int().min(100).max(599),
        count: z.number().int().positive(),
        bodyClasses: z
          .array(
            z.strictObject({
              class: z.enum(BODY_CLASSES),
              count: z.number().int().positive(),
            }),
          )
          .max(BODY_CLASSES.length)
          .optional(),
      })
      .refine((group) => {
        if (group.status < 400 || group.status > 499)
          return group.bodyClasses === undefined;
        return (
          group.bodyClasses !== undefined &&
          new Set(group.bodyClasses.map((body) => body.class)).size ===
            group.bodyClasses.length &&
          group.bodyClasses.reduce((sum, body) => sum + body.count, 0) ===
            group.count
        );
      }),
  )
  .max(POST_PATH_CLASSES.length * 500);
export type PostRequestStatus = z.infer<typeof PostRequestsSchema>[number];
const PostRetrySchema = z.strictObject({
  step: z.number().int().positive(),
  retryStep: z.number().int().positive().nullable(),
  stage: z.enum(['post-open', 'list']),
  waitedMs: count,
  outcome: z.enum(['ready', 'timeout']).nullable(),
});
export type PostRetry = z.infer<typeof PostRetrySchema>;
export const PostRetriesSchema = z
  .strictObject({
    used: z.number().int().min(0).max(3),
    entries: z.array(PostRetrySchema).max(3),
  })
  .refine((value) => value.used === value.entries.length);

export const ListTimeoutDiagnosticSchema = z
  .strictObject({
    rowContainers: count,
    readableRows: count,
    imageOnlyRows: count,
    statusElementPresent: z.boolean(),
    busyElementPresent: z.boolean(),
    // No real empty-result class has been established for this reader.
    emptyStateClassKnown: z.literal(false),
    emptyStatePresent: z.literal(false),
    rowsObserved: z.boolean(),
    filter: z.strictObject({
      applied: z.boolean(),
      readbackObserved: z.boolean(),
      startMatches: z.boolean(),
      endMatches: z.boolean(),
    }),
    dom: z.strictObject({
      observed: z.boolean(),
      changes: count,
      lastChangeAfterApplyMs: count.nullable(),
      observedForMs: count,
    }),
    observationFailed: z.boolean(),
  })
  .refine(
    (value) =>
      value.readableRows + value.imageOnlyRows <= value.rowContainers &&
      (value.dom.lastChangeAfterApplyMs === null ||
        (value.dom.observed &&
          value.dom.lastChangeAfterApplyMs <= value.dom.observedForMs)) &&
      (value.filter.readbackObserved ||
        (!value.filter.startMatches && !value.filter.endMatches)),
  );
export type ListTimeoutDiagnostic = z.infer<typeof ListTimeoutDiagnosticSchema>;
const memoryFields = {
  jsHeapUsedMB: count,
  jsHeapTotalMB: count,
  nodes: count,
  documents: count,
  jsEventListeners: count,
  frames: count,
};
export const MemoryValuesSchema = z
  .strictObject(memoryFields)
  .refine((value) => value.jsHeapUsedMB <= value.jsHeapTotalMB);
export type MemoryValues = z.infer<typeof MemoryValuesSchema>;
export const MemorySampleSchema = z.union([
  z
    .strictObject({
      observed: z.literal(true),
      observationFailed: z.literal(false),
      ...memoryFields,
    })
    .refine((value) => value.jsHeapUsedMB <= value.jsHeapTotalMB),
  z.strictObject({
    observed: z.literal(false),
    observationFailed: z.literal(true),
    jsHeapUsedMB: z.null(),
    jsHeapTotalMB: z.null(),
    nodes: z.null(),
    documents: z.null(),
    jsEventListeners: z.null(),
    frames: z.null(),
  }),
]);
export type MemorySample = z.infer<typeof MemorySampleSchema>;
export const RunMemorySchema = z
  .strictObject({
    samples: count,
    failedSamples: count,
    sessionAttached: z.boolean(),
    observationFailed: z.boolean(),
    peak: MemoryValuesSchema.nullable(),
  })
  .refine(
    (value) =>
      value.failedSamples <= value.samples &&
      (value.failedSamples === 0 || value.observationFailed) &&
      (value.peak !== null) === value.samples > value.failedSamples,
  );
export type RunMemory = z.infer<typeof RunMemorySchema>;
export function combineRunMemory(values: readonly RunMemory[]): RunMemory {
  let peak: MemoryValues | null = null;
  for (const value of values)
    if (value.peak) {
      if (!peak) peak = { ...value.peak };
      else
        for (const key of Object.keys(memoryFields) as (keyof MemoryValues)[])
          peak[key] = Math.max(peak[key], value.peak[key]);
    }
  return RunMemorySchema.parse({
    samples: values.reduce((n, value) => n + value.samples, 0),
    failedSamples: values.reduce((n, value) => n + value.failedSamples, 0),
    sessionAttached: values.some((value) => value.sessionAttached),
    observationFailed: values.some((value) => value.observationFailed),
    peak,
  });
}
export const PageRecyclingSchema = z
  .strictObject({
    intervalSteps: z.literal(20),
    count: count,
    events: z.array(
      z.strictObject({
        afterStep: count,
        nextStep: count,
        reason: z.literal('step-interval'),
        checks: z.literal('next-list'),
      }),
    ),
  })
  .refine(
    (value) =>
      value.count === value.events.length &&
      value.events.every(
        (event, index) =>
          event.nextStep === event.afterStep + 1 &&
          event.afterStep >=
            (index ? value.events[index - 1]!.afterStep : 0) + 20,
      ),
  );
const imageDiagnosticFields = {
  qualifyingObjects: count,
  matchingLists: count,
  distinctListLengths: z.array(count),
  source: z.enum(['img-current-src', 'none']),
};
export const ImageDiagnosticSchema = z
  .strictObject(imageDiagnosticFields)
  .refine(
    (value) =>
      value.matchingLists <= value.qualifyingObjects &&
      value.distinctListLengths.length <= value.qualifyingObjects &&
      value.distinctListLengths.every(
        (length, index) =>
          index === 0 || length > value.distinctListLengths[index - 1]!,
      ) &&
      (value.source !== 'none' || value.matchingLists === 0),
  );
export type ImageDiagnostic = z.infer<typeof ImageDiagnosticSchema>;
const StepImageSchema = z
  .strictObject({
    status: z.enum([
      'stored',
      'not-captured',
      'too-large',
      'not-image',
      'not-attempted',
    ]),
    bytes: count,
    ...imageDiagnosticFields,
  })
  .refine(
    (value) =>
      ImageDiagnosticSchema.safeParse({
        qualifyingObjects: value.qualifyingObjects,
        matchingLists: value.matchingLists,
        distinctListLengths: value.distinctListLengths,
        source: value.source,
      }).success,
  );
export const ContextStepReportSchema = z
  .looseObject({
    image: StepImageSchema.optional(),
    memory: MemorySampleSchema.optional(),
    listTimeout: ListTimeoutDiagnosticSchema.optional(),
    ready: z.strictObject({ postMs: count }).optional(),
    postRequests: PostRequestsSchema.optional(),
    secondSource: SecondSourceReportSchema.optional(),
    otherName: z.number().int().nonnegative().optional(),
    confirmedBy: z.enum(['post', 'list']).optional(),
    ownerLinksOneAccount: z.boolean().optional(),
    ownerEqualsExport: z.boolean().optional(),
    firstProfileNamesOwner: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value['result'] !== 'list-image-only' ||
      (value['confirmed'] === false &&
        value['candidates'] === 0 &&
        value.image?.status === 'not-attempted' &&
        value.listTimeout !== undefined &&
        listImageOnlyManual(value.listTimeout)),
  );

export const CONTEXT_STOP_TOKENS = [
  'login',
  'challenge',
  'checkpoint',
  'locked',
  'rate-limit',
  'notice-error',
  'http-429',
  'rate-signal',
  'list-timeout',
  'post-timeout',
  'navigation',
  'browser-closed',
  'extensions-added',
  'account-readback',
  'account-changed',
  'page-language',
  'row-structure',
  'filter-control',
  'post-structure',
  'comment-structure',
  'unexpected-action',
  'unexpected-page',
  'request-journal',
  'second-source',
  'field-mismatch',
  'canary-check',
  'disk-low',
  'stopped',
] as const;
export type ContextStopToken = (typeof CONTEXT_STOP_TOKENS)[number];
export const AccountCheckSchema = z
  .strictObject({
    profileLinkFound: z.boolean(),
    outsidePathCount: count,
    rows: count,
    ownRows: count,
    elapsedMs: count,
    reads: z.number().int().positive(),
    lastReadAfterDeadline: z.boolean(),
  })
  .refine((value) => value.ownRows <= value.rows);
export type AccountCheck = z.infer<typeof AccountCheckSchema>;
export const ACCOUNT_CLASSES = ['expected', 'absent', 'other'] as const;
export type AccountClass = (typeof ACCOUNT_CLASSES)[number];
export const AccountReadbackSchema = z.strictObject({
  accountBeforeClass: z.enum(ACCOUNT_CLASSES),
  accountAfterClass: z.enum(ACCOUNT_CLASSES),
});
export function accountClass(
  expected: string,
  paths: readonly string[],
): AccountClass {
  const profiles = paths.filter((path) =>
    /^\/[A-Za-z0-9_.]{1,30}\/$/.test(path),
  );
  if (
    profiles.some(
      (path) => path.toLowerCase() === `/${expected.toLowerCase()}/`,
    )
  )
    return 'expected';
  return profiles.length ? 'other' : 'absent';
}
export class ContextStop extends CliError {
  readonly token: ContextStopToken;
  readonly accountCheck?: AccountCheck;
  constructor(
    code: CliErrorCode,
    token: ContextStopToken,
    accountCheck?: AccountCheck,
  ) {
    super(code);
    this.token = token;
    if (
      accountCheck &&
      code === 'ACCOUNT_MISMATCH' &&
      token === 'account-changed'
    )
      this.accountCheck = Object.freeze(AccountCheckSchema.parse(accountCheck));
  }
}
export const CONTEXT_CAUSE_STAGES = [
  'run',
  'run-start',
  'browser-launch',
  'browser-setup',
  'start',
  'checkpoint',
  'pace',
  'attempt',
  'list-read',
  'post-open',
  'post-read',
  'capture',
  'compare',
  'settlement',
  'canary-check',
  'progress',
  'answers',
  'network',
  'manual-match',
  'snapshot',
  'read-back',
  'structure-report',
  'extension-report',
  'automatic-check',
  'audit',
  'end-run',
  'acceptance',
  'browser-close',
  'confirmation-close',
  'projection',
] as const;
export type ContextCauseStage = (typeof CONTEXT_CAUSE_STAGES)[number];
export const ERROR_CLASSES = [
  'target-closed',
  'page-crashed',
  'timeout',
  'navigation',
  'protocol',
  'other',
] as const;
export type ErrorClass = (typeof ERROR_CLASSES)[number];
/** Exact type/name only: generic Playwright errors retain the class other. */
export function errorClass(error: unknown): ErrorClass {
  if (!(error instanceof Error)) return 'other';
  const names = [error.name, error.constructor.name];
  for (const [name, value] of [
    ['TargetClosedError', 'target-closed'],
    // Playwright 1.63.0's packaged client preserves this constructor spelling.
    ['TargetClosedError2', 'target-closed'],
    ['PageCrashedError', 'page-crashed'],
    ['TimeoutError', 'timeout'],
    ['NavigationError', 'navigation'],
    ['ProtocolError', 'protocol'],
  ] as const)
    if (names.includes(name)) return value;
  return 'other';
}
export const ERROR_NAMES = [
  'Error',
  'ZodError',
  'AbortError',
  'AggregateError',
  'EvalError',
  'URIError',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TimeoutError',
  'TargetClosedError',
  'TargetClosedError2',
  'PageCrashedError',
  'NavigationError',
  'ProtocolError',
  'NonRecoverableDOMError',
  'JavaScriptErrorInEvaluate',
  'other-name',
] as const;
export const PLAYWRIGHT_MESSAGE_CLASSES = [
  'execution-context-destroyed',
  'element-detached',
  'strict-mode-violation',
  'target-closed',
  'not-attached',
  'frame-detached',
  'protocol-error',
  'unmatched',
] as const;
// Declaration names in the production Instagram modules, not names from a
// stack or page. Unknown/minified names must not acquire a guessed identity.
const OWN_FUNCTION_MODULES = {
  'driver.ts': [
    'waitPage',
    'filterList',
    'listTimeoutDiagnostic',
    'navigateList',
    'checkedAccountRows',
    'readAccountRows',
    'loadList',
    'openCandidate',
    'reopenCandidate',
    'postReopenTarget',
    'postReady',
    'confirmOnPost',
    'blockCount',
    'settledPost',
  ],
  'selectors.ts': [
    'rows',
    'clickAllowed',
    'checkPage',
    'relativeAgeMs',
    'accountMatches',
    'outsideProfilePaths',
    'readRows',
    'listTimeoutRows',
    'filterWindowMatches',
    'observeListDomChanges',
    'listDiagnosticRead',
    'rowCandidate',
    'utcWindow',
    'postAddress',
    'timestamp',
    'readPost',
    'profileLinks',
    'textBlock',
    'captionText',
    'postLinks',
    'postElement',
    'scrollPostComments',
    'pathTo',
    'confirmComment',
    'currentImageSource',
  ],
  'run.ts': [
    'runContextWithDependencies',
    'runContext',
    'recordCause',
    'stop',
    'guard',
    'pause',
    'checkpoint',
    'platformStop',
    'rejectIncomplete',
    'assertAutomaticCanary',
    'waitToReopen',
    'sampleMemory',
    'snapshot',
    'finalize',
    'structure',
  ],
  'capture.ts': ['pageAnswers', 'writeOnce', 'capturePost', 'writeStructure'],
  'canary.ts': [
    'imageDiagnostic',
    'compareSources',
    'automaticCanaryCheck',
    'automaticReadbackCheck',
    'canaryAudit',
  ],
  'network.ts': [
    'observeContextRuntime',
    'observePageMemory',
    'memoryFromMetrics',
    'bodyClass',
    'allowedInstagramHost',
    'allowedInstagramURL',
    'imageHost',
    'mutation',
    'guardInstagramNetwork',
  ],
  'plan.ts': [
    'normalize',
    'ownerName',
    'instagramHandle',
    'planContext',
    'contextSummary',
    'contextList',
    'canaryRows',
  ],
  'answers.ts': [
    'parseAnswer',
    'object',
    'mediaObject',
    'postObjects',
    'walk',
    'answerSummary',
    'containsCode',
  ],
  'filter.ts': [
    'refuse',
    'values',
    'controls',
    'chooseFilterOption',
    'chooseFilterDate',
  ],
  'order.ts': ['readContextOrder', 'validateContextOrder'],
  'pace.ts': [
    'contextPace',
    'paceSummary',
    'paceText',
    'contextEstimate',
    'instagramDailyCount',
  ],
  'pages.ts': ['contextPages', 'fail', 'reject', 'classify', 'opened'],
  'signals.ts': ['hostClass', 'pathClass', 'postPathClass', 'rateSignal'],
  'report.ts': [
    'accountClass',
    'errorClass',
    'diagnosticString',
    'playwrightMessageClass',
    'ownFunction',
    'unexpectedErrorDetails',
    'causeToken',
    'contextCause',
    'causeChain',
    'stopDetails',
    'stopDetailText',
    'reportKey',
    'keyPaths',
    'pairedCode',
  ],
} as const;
const OWN_FUNCTIONS = [
  ...Object.values(OWN_FUNCTION_MODULES).flat(),
  'outside-own-code',
] as const;
export const UnexpectedErrorSchema = z.strictObject({
  errorClass: z.enum(ERROR_CLASSES),
  errorName: z.enum(ERROR_NAMES),
  playwrightMessageClass: z.enum(PLAYWRIGHT_MESSAGE_CLASSES),
  ownFunction: z.enum(OWN_FUNCTIONS),
});
type UnexpectedError = z.infer<typeof UnexpectedErrorSchema>;
const MESSAGE_PREFIXES = [
  ['Execution context was destroyed', 'execution-context-destroyed'],
  ['Cannot find context with specified id', 'execution-context-destroyed'],
  ['Element is detached from the DOM', 'element-detached'],
  ['Element was detached from the DOM', 'element-detached'],
  ['strict mode violation:', 'strict-mode-violation'],
  ['Target page, context or browser has been closed', 'target-closed'],
  ['Target closed', 'target-closed'],
  ['Element is not attached to the DOM', 'not-attached'],
  ['Frame was detached', 'frame-detached'],
  ['Frame has been detached', 'frame-detached'],
  ['Navigating frame was detached', 'frame-detached'],
  ['Protocol error (', 'protocol-error'],
] as const;
const API_PREFIXES = [
  'locator.innerText: ',
  'locator.textContent: ',
  'locator.getAttribute: ',
  'locator.count: ',
  'locator.all: ',
  'locator.click: ',
  'locator.waitFor: ',
  'locator.boundingBox: ',
  'locator.scrollIntoViewIfNeeded: ',
  'elementHandle.innerText: ',
  'elementHandle.getAttribute: ',
  'page.goto: ',
  'frame.goto: ',
  'page.title: ',
  'page.waitForURL: ',
  'browserContext.newCDPSession: ',
  'cdpSession.send: ',
  'cdpSession.detach: ',
  'mouse.move: ',
  'mouse.wheel: ',
] as const;
function diagnosticString(
  error: Error,
  key: 'name' | 'message' | 'stack',
  limit: number,
): string {
  try {
    const value: unknown = error[key];
    return typeof value === 'string' ? value.slice(0, limit) : '';
  } catch {
    return '';
  }
}
function playwrightMessageClass(
  message: string,
): UnexpectedError['playwrightMessageClass'] {
  const api = API_PREFIXES.find((prefix) => message.startsWith(prefix));
  const wrapped = api ? message.slice(api.length) : message;
  const body = wrapped.startsWith('Error: ') ? wrapped.slice(7) : wrapped;
  return (
    MESSAGE_PREFIXES.find(([prefix]) => body.startsWith(prefix))?.[1] ??
    'unmatched'
  );
}
export function ownFunction(
  stack: string,
  moduleUrl = import.meta.url,
): UnexpectedError['ownFunction'] {
  const self = fileURLToPath(moduleUrl)
    .replaceAll('\\', '/')
    .replace(/^\/([A-Za-z]:\/)/, '$1');
  const sourceDirectory = dirname(self).replaceAll('\\', '/') + '/';
  const isBundle = /\/(?:socialprune\.mjs|engine\.cjs)$/.test(self);
  for (const line of stack.split(/\r?\n/).slice(1, 65)) {
    // Match complete V8 frame syntax; never extract a token from message text.
    const frame = /^\s+at (?:async )?(?:(.*?) \((.+)\)|(.+))$/.exec(line);
    if (!frame) continue;
    const location = /^(.*):\d+:\d+$/.exec(frame[2] ?? frame[3] ?? '');
    if (!location) continue;
    let path = location[1]!;
    try {
      if (path.startsWith('file:')) path = fileURLToPath(path);
      else if (!/^(?:[A-Za-z]:[\\/]|\/)/.test(path)) continue;
    } catch {
      continue;
    }
    path = path.replaceAll('\\', '/').replace(/^\/([A-Za-z]:\/)/, '$1');
    if (path.includes('/node_modules/') && !(isBundle && path === self))
      continue;
    const sourceModule = path.startsWith(sourceDirectory)
      ? /^([^/]+\.ts)$/.exec(path.slice(sourceDirectory.length))?.[1]
      : isBundle
        ? /\/apps\/cli\/src\/browser\/instagram\/([^/]+\.ts)$/.exec(path)?.[1]
        : undefined;
    const module = Object.keys(OWN_FUNCTION_MODULES).find(
      (file) => sourceModule === file,
    );
    if (sourceModule && !module) return 'outside-own-code';
    if (!module && !(isBundle && path === self)) continue;
    const name = /^(?:Module\.|Object\.)?([A-Za-z_$][A-Za-z0-9_$]*)$/.exec(
      frame[1] ?? '',
    )?.[1];
    const allowed: readonly string[] = module
      ? OWN_FUNCTION_MODULES[module as keyof typeof OWN_FUNCTION_MODULES]
      : OWN_FUNCTIONS;
    if (name && allowed.includes(name))
      return name as UnexpectedError['ownFunction'];
    return 'outside-own-code';
  }
  return 'outside-own-code';
}
function unexpectedErrorDetails(error: unknown): UnexpectedError {
  const name =
    error instanceof Error ? diagnosticString(error, 'name', 128) : '';
  const message =
    error instanceof Error ? diagnosticString(error, 'message', 2048) : '';
  const stack =
    error instanceof Error ? diagnosticString(error, 'stack', 32768) : '';
  return UnexpectedErrorSchema.parse({
    errorClass: errorClass(error),
    errorName: ERROR_NAMES.find((value) => value === name) ?? 'other-name',
    playwrightMessageClass: playwrightMessageClass(message),
    ownFunction: ownFunction(stack),
  });
}
const RUNTIME_EVENTS = [
  'page-crash',
  'browser-disconnected',
  'page-close',
] as const;
export const RuntimeReportSchema = z.strictObject({
  pageCrashes: count,
  browserDisconnects: count,
  unexpectedPageCloses: count,
  browserObserved: z.boolean(),
  observationFailed: z.boolean(),
  events: z.array(
    z.strictObject({
      event: z.enum(RUNTIME_EVENTS),
      step: count,
      stage: z.enum(CONTEXT_CAUSE_STAGES),
      count: z.number().int().positive(),
    }),
  ),
});
export type RuntimeReport = z.infer<typeof RuntimeReportSchema>;
const CAUSE_TOKENS = [
  'browser-timeout',
  'browser-closed',
  'aborted',
  'type-error',
  'range-error',
  'reference-error',
  'syntax-error',
  'unexpected-error',
  'unexpected-value',
  'fs-EEXIST',
  'fs-ENOSPC',
  'fs-EACCES',
  'fs-EPERM',
  'fs-ENOENT',
  'fs-EBUSY',
  'socket-EADDRINUSE',
  'socket-ECONNRESET',
  'socket-ECONNREFUSED',
  'socket-ETIMEDOUT',
  'sqlite-busy',
  'sqlite-error',
] as const;
type CauseToken = (typeof CAUSE_TOKENS)[number];
export const ContextCauseSchema = z.strictObject({
  runId: z.uuid(),
  stage: z.enum(CONTEXT_CAUSE_STAGES),
  step: z.number().int().nonnegative(),
  token: z.enum(CAUSE_TOKENS),
  chain: z.array(z.enum(CAUSE_TOKENS)).min(1).max(4),
  errorClass: z.enum(ERROR_CLASSES).optional(),
  errorName: z.enum(ERROR_NAMES).optional(),
  playwrightMessageClass: z.enum(PLAYWRIGHT_MESSAGE_CLASSES).optional(),
  ownFunction: z.enum(OWN_FUNCTIONS).optional(),
});
function causeToken(error: unknown): CauseToken {
  if (error && typeof error === 'object') {
    if ('code' in error) {
      for (const code of [
        'EEXIST',
        'ENOSPC',
        'EACCES',
        'EPERM',
        'ENOENT',
        'EBUSY',
      ] as const)
        if (error.code === code) return `fs-${code}`;
      for (const code of [
        'EADDRINUSE',
        'ECONNRESET',
        'ECONNREFUSED',
        'ETIMEDOUT',
      ] as const)
        if (error.code === code) return `socket-${code}`;
      if (error.code === 'ERR_SQLITE_ERROR') {
        return 'errcode' in error &&
          (error.errcode === 5 || error.errcode === 6)
          ? 'sqlite-busy'
          : 'sqlite-error';
      }
    }
    if ('name' in error) {
      if (error.name === 'TimeoutError') return 'browser-timeout';
      if (error.name === 'TargetClosedError') return 'browser-closed';
      if (error.name === 'AbortError') return 'aborted';
    }
  }
  if (error instanceof TypeError) return 'type-error';
  if (error instanceof RangeError) return 'range-error';
  if (error instanceof ReferenceError) return 'reference-error';
  if (error instanceof SyntaxError) return 'syntax-error';
  return error instanceof Error ? 'unexpected-error' : 'unexpected-value';
}
export function contextCause(
  error: unknown,
  runId: string,
  stage: ContextCauseStage,
  step: number,
) {
  const cause = causeChain(error);
  return ContextCauseSchema.parse({
    runId,
    stage,
    step,
    ...cause,
    ...(cause.token === 'unexpected-error'
      ? unexpectedErrorDetails(error)
      : {}),
  });
}
function causeChain(error: unknown) {
  const seen = new Set<unknown>();
  const chain: CauseToken[] = [];
  let current = error;
  while (chain.length < 4 && !seen.has(current)) {
    seen.add(current);
    chain.push(causeToken(current));
    if (
      !current ||
      typeof current !== 'object' ||
      !('cause' in current) ||
      current.cause === undefined
    )
      break;
    current = current.cause;
  }
  const token =
    [...chain]
      .reverse()
      .find(
        (value) => !['unexpected-error', 'unexpected-value'].includes(value),
      ) ?? chain[0]!;
  return { token, chain };
}
export function stopDetails(error: unknown): {
  code: string;
  token: string;
  accountCheck?: AccountCheck;
  errorClass?: ErrorClass;
  errorName?: UnexpectedError['errorName'];
  playwrightMessageClass?: UnexpectedError['playwrightMessageClass'];
  ownFunction?: UnexpectedError['ownFunction'];
} {
  if (
    error instanceof ContextStop &&
    CONTEXT_STOP_TOKENS.some((token) => token === error.token)
  )
    return {
      code: error.code,
      token: error.token,
      ...(error.accountCheck
        ? { accountCheck: AccountCheckSchema.parse(error.accountCheck) }
        : {}),
    };
  if (error instanceof CliError && Object.hasOwn(CLI_ERRORS, error.code))
    return { code: error.code, token: error.code };
  const { token } = causeChain(error);
  return {
    code: token,
    token,
    ...(token === 'unexpected-error' ? unexpectedErrorDetails(error) : {}),
  };
}
export function stopDetailText(error: unknown): string {
  const detail = stopDetails(error),
    account = detail.accountCheck;
  return (
    detail.token +
    (detail.errorClass ? `; errorClass=${detail.errorClass}` : '') +
    (detail.errorName
      ? `; errorName=${detail.errorName}; playwrightMessageClass=${detail.playwrightMessageClass}; ownFunction=${detail.ownFunction}`
      : '') +
    (account
      ? `; link=${account.profileLinkFound}; outsidePathCount=${account.outsidePathCount}; rows=${account.rows}; own=${account.ownRows}; reads=${account.reads}; elapsedMs=${account.elapsedMs}; lastReadAfterDeadline=${account.lastReadAfterDeadline}`
      : '')
  );
}
const KEYS = new Set([
  'data',
  'items',
  'media',
  'code',
  'user',
  'owner',
  'username',
  'taken_at',
  'caption',
  'text',
  'image_versions2',
  'candidates',
  'url',
  'carousel_media',
  'comments',
  'id',
  'pk',
  'edges',
  'node',
  'shortcode',
  'timestamp',
  'display_url',
]);
const REPORT_KEYS = new Set([...KEYS].map((key) => key.replace(/\d/g, '')));
REPORT_KEYS.add('*');
export function reportKey(key: string): string {
  return KEYS.has(key) ? key.replace(/\d/g, '') : '*';
}
export function keyPaths(body: unknown, equal?: unknown): string[] {
  const paths = new Set<string>();
  let visited = 0;
  function walk(value: unknown, path: string, depth: number): void {
    if (++visited > 100000 || depth > 40) return;
    if (equal === undefined || value === equal) paths.add(path || '*');
    if (Array.isArray(value))
      for (const entry of value) walk(entry, path + '[]', depth + 1);
    else if (value && typeof value === 'object')
      for (const [key, entry] of Object.entries(value))
        walk(entry, (path ? path + '.' : '') + reportKey(key), depth + 1);
  }
  walk(body, '', 0);
  return [...paths].sort();
}
export function pairedCode(body: unknown): boolean {
  let visits = 0;
  function walk(input: unknown, depth: number): boolean {
    if (++visits > 100000 || depth > 40) return false;
    if (Array.isArray(input))
      return input.some((value) => walk(value, depth + 1));
    if (!input || typeof input !== 'object') return false;
    const value = input as Record<string, unknown>;
    return (
      (typeof value.code === 'string' &&
        ('comment_id' in value || 'text' in value)) ||
      Object.values(value).some((entry) => walk(entry, depth + 1))
    );
  }
  return walk(body, 0);
}

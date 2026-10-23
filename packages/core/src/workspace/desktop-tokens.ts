import { z } from 'zod';
import {
  BrowserActionSchema,
  BrowserAttemptStateSchema,
  BrowserRunSchema,
} from '../model/browser.ts';
import { WORKSPACE_ERROR_CODES } from './errors.ts';

// The source-drift tests read the producer declarations, without importing the
// CLI into the renderer's graph. Update this vocabulary and its catalog consumers
// together when a producer gains a token.
export const DesktopCliErrorCodeSchema = z.enum([
  'SOURCE_FILE_INVALID',
  'SOURCE_PATH_REFUSED',
  'KEY_FILE_INVALID',
  'ENDPOINT_NOT_CONFIRMED',
  'ENDPOINT_UNREACHABLE',
  'ENDPOINT_UNAUTHORIZED',
  'MODEL_NOT_FOUND',
  'MODEL_CHANGED',
  'REMOTE_MODEL',
  'STRUCTURED_OUTPUT_REFUSED',
  'REDIRECT_REFUSED',
  'ANSWERS_INVALID',
  'ENDPOINT_RETRY_EXHAUSTED',
  'ENDPOINT_RATE_LIMITED',
  'SCAN_FAILED',
  'CONTEXT_ORDER_INVALID',
  'CANARY_REQUIRED',
  'CANARY_NO_SECOND_SOURCE',
  'CANARY_CHECK_FAILED',
  'PAGE_LANGUAGE',
  'INSTAGRAM_SHAPE_CHANGED',
  'CONTEXT_FAILED',
  'INSTAGRAM_ACCOUNT_NAME_MISSING',
  'ORDER_INVALID',
  'CANARY_MISMATCH',
  'SHAPE_CHANGED',
  'UNEXPECTED_ACTION',
  'DISK_LOW',
  'MEDIA_RATE_LIMIT',
  'MEDIA_FAILED',
  'ORIGINALS_PENDING',
  'ORIGINALS_FAILED',
  'OUTCOME_FINAL',
  'NOT_INTERACTIVE',
  'STALE_PLAN',
  'PROFILE_INVALID',
  'BROWSER_NOT_FOUND',
  'ACCOUNT_MISMATCH',
  'ACCOUNT_NAME_MISSING',
  'PLATFORM_CHECK',
  'RUN_STOPPED',
  'DELETE_FAILED',
  'SHARING_NOT_CONFIRMED',
  'INVALID_CURSOR',
  'ACCOUNT_REQUIRED',
  'INVALID_LABELS',
  'SUBMISSION_CONFLICT',
  'BATCH_FAILED',
  'LABELS_FAILED',
  'NO_TOKEN_CHANNEL',
  'BROWSER_OPEN_FAILED',
  'REVIEW_ASSETS_MISSING',
  'REVIEW_FAILED',
  'INVALID_ARGUMENTS',
  'INVALID_ARCHIVE_PATH',
  'STRUCTURE_FAILED',
  'SCHEMAS_FAILED',
  'GUIDE_UNAVAILABLE',
  'NOT_AVAILABLE',
  'CANCELLED',
  'CLI_ERROR',
  'NODE_TOO_OLD',
  'MISSING_WORKSPACE',
  'WORKSPACE_BUSY',
  'WORKSPACE_SCHEMA_UNSUPPORTED',
  'WORKSPACE_INVALID',
  'BACKUP_SCHEMA_UNSUPPORTED',
  'BACKUP_INVALID',
  'BACKUP_CHANGED',
  'STORAGE_FULL',
  'IO_ERROR',
  'UNKNOWN_FORMAT',
  'HTML_EXPORT',
  'IMPORT_FAILED',
  'SUMMARY_FAILED',
  'BACKUP_FAILED',
  'EXPORT_FAILED',
  'PARTIAL_IMPORT',
]);
export type DesktopCliErrorCode = z.infer<typeof DesktopCliErrorCodeSchema>;

/** apps/cli/src/cli/errors.ts: PLATFORM_CHECK_REASONS. */
export const XPlatformCheckTokenSchema = z.enum([
  'count',
  'hidden',
  'render-timeout',
  'marker-login',
  'marker-challenge',
  'marker-locked',
  'marker-rate-limit',
  'notice-text',
  'account-handle',
  'focal-count',
  'focal-time',
  'bad-id',
  'answer-status',
  'answer-type',
  'answer-timeout',
  'body-timeout',
  'gone-check',
  'extensions-changed',
  'account-readback',
  'account-changed',
  'unspecified',
  'http-429',
]);
/** apps/cli/src/browser/instagram/report.ts: CONTEXT_STOP_TOKENS. */
export const InstagramStopTokenSchema = z.enum([
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
]);
/** apps/cli/src/browser/x/fill/report.ts: ErrorStopClass. */
export const RunErrorClassSchema = z.enum([
  'media-origin',
  'media-format',
  'media-exists',
  'original-path',
  'fs-EEXIST',
  'fs-ENOSPC',
  'fs-EACCES',
  'fs-EPERM',
  'fs-ENOENT',
  'fs-EBUSY',
  'type-error',
  'other',
]);
/** The long-window stop is emitted in x/fill/run.ts, not CLI_ERRORS. */
export const RunStopDetailSchema = z.enum([
  ...DesktopCliErrorCodeSchema.options,
  ...XPlatformCheckTokenSchema.options,
  ...InstagramStopTokenSchema.options,
  ...RunErrorClassSchema.options,
  'x-window-long',
]);
export type RunStopDetail = z.infer<typeof RunStopDetailSchema>;

/** Confirmation display reasons in browser/copy.ts, including journal reasons. */
export const RunEndReasonSchema = z.enum([
  ...BrowserRunSchema.shape.endReason.unwrap().options,
  'canary-mismatch',
  'account-mismatch',
]);
export const RunReadbackOutcomeSchema = z.enum([
  'unchanged',
  'account-readback',
  'account-handle',
  'account-changed',
  'extensions-changed',
  'not-completed',
]);
export const RunActionSchema = BrowserActionSchema;
export const RunJournalOutcomeSchema = BrowserAttemptStateSchema;
export const RunSettledStateSchema = BrowserAttemptStateSchema.exclude([
  'sending',
]);
/** Driver/runner recovery codes and Instagram confirmation-result codes. */
export const RunJournalCodeSchema = z.enum([
  ...DesktopCliErrorCodeSchema.options,
  'CLICK_INTERRUPTED',
  'RESPONSE_UNKNOWN',
  'INVALID_RESPONSE',
  'PLATFORM_RESPONSE',
  'CONFIRMATION_MISSING',
  'BROWSER_INTERRUPTED',
  'PROCESS_LOST',
  'READ_FAILED',
  'INTERRUPTED',
  'text',
  'time',
  'owner',
  'several',
  'not-shown',
  'no-row',
  'window-full',
]);

/** signals.ts keeps these identities separate from host names and URLs. */
export const InstagramHostClassSchema = z.enum([
  'instagram',
  'cdninstagram',
  'fbcdn',
  'other',
]);
export const InstagramPathClassSchema = z.enum([
  'list-page',
  'post-page',
  'wbloks-fetch',
  'graphql',
  'api-v1-read',
  'media',
  'other',
]);
export const InstagramRateSignalSchema = z.enum([
  'feedback_required',
  'please_wait',
  'checkpoint_required',
  'spam',
]);

// The producer deliberately accepts arbitrary GraphQL operation identities.
// Known operations below come from read.ts, driver.ts and runner.ts. The facade
// projects any other valid GraphQL name to graphql-other, never a new UI token.
export const XRateOperationSchema = z.enum([
  'TweetDetail',
  'CreateTweet',
  'CreateNoteTweet',
  'DeleteTweet',
  'FavoriteTweet',
  'UnfavoriteTweet',
  'CreateRetweet',
  'DeleteRetweet',
  'CreateBookmark',
  'DeleteBookmark',
  'graphql-other',
  'api-other',
  'other',
]);
export type XRateOperation = z.infer<typeof XRateOperationSchema>;
export function xRateOperationToken(operation: string): XRateOperation {
  const parsed = XRateOperationSchema.safeParse(operation);
  return parsed.success ? parsed.data : 'graphql-other';
}

export const DesktopErrorCodeSchema = z.enum([
  ...DesktopCliErrorCodeSchema.options,
  ...WORKSPACE_ERROR_CODES,
  'ENGINE_UNAVAILABLE',
  'LINK_UNKNOWN',
]);
export type XPlatformCheckToken = z.infer<typeof XPlatformCheckTokenSchema>;
export type InstagramStopToken = z.infer<typeof InstagramStopTokenSchema>;
export type RunErrorClass = z.infer<typeof RunErrorClassSchema>;
export type RunEndReason = z.infer<typeof RunEndReasonSchema>;
export type RunReadbackOutcome = z.infer<typeof RunReadbackOutcomeSchema>;
export type RunAction = z.infer<typeof RunActionSchema>;
export type RunJournalOutcome = z.infer<typeof RunJournalOutcomeSchema>;
export type RunSettledState = z.infer<typeof RunSettledStateSchema>;
export type RunJournalCode = z.infer<typeof RunJournalCodeSchema>;
export type InstagramHostClass = z.infer<typeof InstagramHostClassSchema>;
export type InstagramPathClass = z.infer<typeof InstagramPathClassSchema>;
export type InstagramRateSignal = z.infer<typeof InstagramRateSignalSchema>;
export type DesktopErrorCode = z.infer<typeof DesktopErrorCodeSchema>;

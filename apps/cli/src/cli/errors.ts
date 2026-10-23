export type ExitCode = 0 | 1 | 2 | 3 | 4;

export const EXIT_MEANINGS = {
  0: 'done',
  1: 'runtime error',
  2: 'wrong usage',
  3: 'input format not readable by this version',
  4: 'partial read',
} as const;

export const CLI_ERRORS = {
  SOURCE_FILE_INVALID: {
    message:
      'Name a valid source file with --source; choose its endpoint, model and entries per request explicitly.',
    exitCode: 2,
    retryable: false,
  },
  SOURCE_PATH_REFUSED: {
    message: 'Use a new source file outside every Git working tree.',
    exitCode: 2,
    retryable: false,
  },
  KEY_FILE_INVALID: {
    message:
      'The named key file must hold one non-empty line outside a Git working tree, not another tool configuration.',
    exitCode: 2,
    retryable: false,
  },
  ENDPOINT_NOT_CONFIRMED: {
    message:
      'Confirm the source origin and answering model from scan check before starting the run.',
    exitCode: 2,
    retryable: false,
  },
  ENDPOINT_UNREACHABLE: {
    message:
      'The named endpoint could not be reached or its TLS certificate was rejected.',
    exitCode: 1,
    retryable: false,
  },
  ENDPOINT_UNAUTHORIZED: {
    message:
      'The named endpoint refused authorization. Check the key file yourself.',
    exitCode: 1,
    retryable: false,
  },
  MODEL_NOT_FOUND: {
    message: 'The named endpoint did not find the requested model.',
    exitCode: 1,
    retryable: false,
  },
  MODEL_CHANGED: {
    message:
      'The answering model name changed. The run stopped without switching models.',
    exitCode: 1,
    retryable: false,
  },
  REMOTE_MODEL: {
    message:
      'The Ollama answer did not prove a local model. No chat request was sent.',
    exitCode: 1,
    retryable: false,
  },
  STRUCTURED_OUTPUT_REFUSED: {
    message:
      'The endpoint refused the configured output format. No fallback mode was selected.',
    exitCode: 1,
    retryable: false,
  },
  REDIRECT_REFUSED: {
    message:
      'The endpoint redirected a request. No other origin was contacted.',
    exitCode: 1,
    retryable: false,
  },
  ANSWERS_INVALID: {
    message:
      'Five responses in a row contained no valid entry. The run stopped.',
    exitCode: 1,
    retryable: false,
  },
  ENDPOINT_RETRY_EXHAUSTED: {
    message:
      'The endpoint request still failed after its two retries. Stored suggestions remain; resume the same plan later.',
    exitCode: 1,
    retryable: true,
  },
  ENDPOINT_RATE_LIMITED: {
    message:
      'The endpoint requested a wait longer than 300 seconds. The run stopped for a later resume.',
    exitCode: 1,
    retryable: true,
  },
  SCAN_FAILED: {
    message:
      'The suggestion scan could not finish. Stored suggestions remain unchanged by failed batches.',
    exitCode: 1,
    retryable: false,
  },
  CONTEXT_ORDER_INVALID: {
    message:
      "The written order must name context-instagram and the expected Instagram account, with a valid date and the person's words.",
    exitCode: 2,
    retryable: false,
  },
  CANARY_REQUIRED: {
    message:
      'Accept a watched Instagram canary first, or give a new written order that explicitly accepts the automatic canary checks.',
    exitCode: 2,
    retryable: false,
  },
  CANARY_NO_SECOND_SOURCE: {
    message:
      "A stored Instagram field has no second source in the page's own answers. The canary was not accepted.",
    exitCode: 1,
    retryable: false,
  },
  CANARY_CHECK_FAILED: {
    message:
      'An Instagram canary check failed. Nothing accepted this canary and no full run started.',
    exitCode: 1,
    retryable: false,
  },
  PAGE_LANGUAGE: {
    message: 'Switch Instagram to English before this reading run.',
    exitCode: 1,
    retryable: false,
  },
  INSTAGRAM_SHAPE_CHANGED: {
    message:
      'Instagram returned an unrecognized structure. The run stopped and the next run stays a canary.',
    exitCode: 1,
    retryable: false,
  },
  CONTEXT_FAILED: {
    message:
      'The Instagram reading pass could not finish. Recorded results remain in the workspace; no automatic retry was made.',
    exitCode: 1,
    retryable: false,
  },
  INSTAGRAM_ACCOUNT_NAME_MISSING: {
    message:
      'The export holds no account name. Pass --handle with the Instagram name signed in to the dedicated profile.',
    exitCode: 2,
    retryable: false,
  },
  ORDER_INVALID: {
    message:
      "The written order must name originals-fill-x and the expected account, with a valid date and the person's words.",
    exitCode: 2,
    retryable: false,
  },
  CANARY_MISMATCH: {
    message:
      'The stored original does not match the text or media counts shown on the page. The run stopped without accepting the canary.',
    exitCode: 1,
    retryable: false,
  },
  SHAPE_CHANGED: {
    message:
      'X returned a different page structure. The run stopped and the next run stays a canary.',
    exitCode: 1,
    retryable: false,
  },
  UNEXPECTED_ACTION: {
    message:
      'The signed-in page sent a request that changes the account. The reading run stopped.',
    exitCode: 1,
    retryable: false,
  },
  DISK_LOW: {
    message:
      'Less than 5 GiB remains on the workspace drive. The run stopped before writing a file.',
    exitCode: 1,
    retryable: false,
  },
  MEDIA_RATE_LIMIT: {
    message: 'The media host returned a rate limit. The run stopped.',
    exitCode: 1,
    retryable: false,
  },
  MEDIA_FAILED: {
    message: 'Five media files failed in a row. The run stopped.',
    exitCode: 1,
    retryable: false,
  },
  ORIGINALS_PENDING: {
    message:
      'Some marked replies or quotes have no settled original. Fetch originals first, or explicitly pass --without-originals.',
    exitCode: 2,
    retryable: false,
  },
  ORIGINALS_FAILED: {
    message:
      'Could not fetch the originals. Results already recorded remain in the workspace.',
    exitCode: 1,
    retryable: false,
  },
  OUTCOME_FINAL: {
    message:
      'A browser deletion outcome changes only after a read-only check finds the entry again.',
    exitCode: 1,
    retryable: false,
  },
  NOT_INTERACTIVE: {
    message: 'Run deletion in your own terminal, without --json or a pipe.',
    exitCode: 2,
    retryable: false,
  },
  STALE_PLAN: {
    message: 'The plan changed. Make a new dry run and use its plan hash.',
    exitCode: 1,
    retryable: false,
  },
  PROFILE_INVALID: {
    message: 'Use a dedicated SocialPrune profile for X without extensions.',
    exitCode: 2,
    retryable: false,
  },
  BROWSER_NOT_FOUND: {
    message: 'Install Chrome or Edge before using browser commands.',
    exitCode: 1,
    retryable: false,
  },
  ACCOUNT_MISMATCH: {
    message:
      'The signed-in account does not match the export account. The run stopped.',
    exitCode: 1,
    retryable: false,
  },
  ACCOUNT_NAME_MISSING: {
    message:
      'The export holds no account name. Pass --handle with the X name of the account signed in to the dedicated profile.',
    exitCode: 2,
    retryable: false,
  },
  PLATFORM_CHECK: {
    message:
      'The page is not recognized, or shows a login, challenge, lock or limit. The run stopped.',
    exitCode: 1,
    retryable: false,
  },
  RUN_STOPPED: {
    message:
      'The browser run stopped at the first problem. Check its journal before continuing.',
    exitCode: 1,
    retryable: false,
  },
  DELETE_FAILED: {
    message:
      'The browser deletion command could not finish. No automatic retry was made.',
    exitCode: 1,
    retryable: false,
  },
  SHARING_NOT_CONFIRMED: {
    message:
      'batch next gives item text to the agent that runs it. Pass --share-with-agent once the person has agreed.',
    exitCode: 2,
    retryable: false,
  },
  INVALID_CURSOR: {
    message: 'The cursor is invalid for this account or source name.',
    exitCode: 2,
    retryable: false,
  },
  ACCOUNT_REQUIRED: {
    message: 'This workspace has more than one account. Pass --account.',
    exitCode: 2,
    retryable: false,
  },
  INVALID_LABELS: {
    message: 'Some labels did not pass validation. Nothing was written.',
    exitCode: 1,
    retryable: false,
  },
  SUBMISSION_CONFLICT: {
    message: 'This submission ID was already used with different content.',
    exitCode: 1,
    retryable: false,
  },
  BATCH_FAILED: {
    message: 'Could not read the next batch.',
    exitCode: 1,
    retryable: false,
  },
  LABELS_FAILED: {
    message: 'Could not submit the labels.',
    exitCode: 1,
    retryable: false,
  },
  NO_TOKEN_CHANNEL: {
    message:
      'The review URL can only be printed to a terminal on stderr. Run review in your own terminal.',
    exitCode: 2,
    retryable: false,
  },
  BROWSER_OPEN_FAILED: {
    message:
      'Could not open the browser. Run review in your own terminal. The server stopped.',
    exitCode: 1,
    retryable: false,
  },
  REVIEW_ASSETS_MISSING: {
    message:
      'The local review files are missing. Build or reinstall SocialPrune.',
    exitCode: 1,
    retryable: false,
  },
  REVIEW_FAILED: {
    message: 'Could not run the local review.',
    exitCode: 1,
    retryable: false,
  },
  INVALID_ARGUMENTS: {
    message: 'Invalid arguments. Use --help.',
    exitCode: 2,
    retryable: false,
  },
  INVALID_ARCHIVE_PATH: {
    message: 'Each path must name an existing ZIP file or directory.',
    exitCode: 2,
    retryable: false,
  },
  STRUCTURE_FAILED: {
    message: 'Could not describe the archive structure.',
    exitCode: 1,
    retryable: false,
  },
  SCHEMAS_FAILED: {
    message: 'Could not read the schema catalog.',
    exitCode: 1,
    retryable: false,
  },
  GUIDE_UNAVAILABLE: {
    message: 'The export guide is not yet verified. No platform was contacted.',
    exitCode: 2,
    retryable: false,
  },
  NOT_AVAILABLE: {
    message: 'This command is not available in this version.',
    exitCode: 2,
    retryable: false,
  },
  CANCELLED: {
    message: 'The command was cancelled.',
    exitCode: 1,
    retryable: false,
  },
  CLI_ERROR: {
    message: 'The command could not finish.',
    exitCode: 1,
    retryable: false,
  },
  NODE_TOO_OLD: {
    message: 'SocialPrune needs Node.js 24.15 or newer for workspaces.',
    exitCode: 1,
    retryable: false,
  },
  MISSING_WORKSPACE: {
    message:
      'Name a workspace directory containing socialprune.sqlite, or an empty directory for import or restore.',
    exitCode: 2,
    retryable: false,
  },
  WORKSPACE_BUSY: {
    message:
      'The workspace is in use. Close the other command or review session and try again.',
    exitCode: 1,
    retryable: true,
  },
  WORKSPACE_SCHEMA_UNSUPPORTED: {
    message: 'This workspace needs a newer version of SocialPrune.',
    exitCode: 3,
    retryable: false,
  },
  WORKSPACE_INVALID: {
    message: 'The workspace database could not be read.',
    exitCode: 1,
    retryable: false,
  },
  BACKUP_SCHEMA_UNSUPPORTED: {
    message: 'This backup needs a newer version of SocialPrune.',
    exitCode: 3,
    retryable: false,
  },
  BACKUP_INVALID: {
    message:
      'The backup did not pass validation. The active workspace was not changed.',
    exitCode: 1,
    retryable: false,
  },
  BACKUP_CHANGED: {
    message:
      'The workspace changed while the backup was written. Export it again.',
    exitCode: 1,
    retryable: true,
  },
  STORAGE_FULL: {
    message: 'There is not enough space to write the file or workspace.',
    exitCode: 1,
    retryable: false,
  },
  IO_ERROR: {
    message: 'Could not read or write the named file.',
    exitCode: 1,
    retryable: false,
  },
  UNKNOWN_FORMAT: {
    message: 'This version does not recognize the export format.',
    exitCode: 3,
    retryable: false,
  },
  HTML_EXPORT: {
    message: 'This is an HTML export. Request a JSON export from the platform.',
    exitCode: 1,
    retryable: false,
  },
  IMPORT_FAILED: {
    message: 'Could not finish the import. Run it again to complete it.',
    exitCode: 1,
    retryable: false,
  },
  SUMMARY_FAILED: {
    message: 'Could not read the workspace summary.',
    exitCode: 1,
    retryable: false,
  },
  BACKUP_FAILED: {
    message: 'Could not finish the backup.',
    exitCode: 1,
    retryable: false,
  },
  EXPORT_FAILED: {
    message: 'Could not finish the click-list export.',
    exitCode: 1,
    retryable: false,
  },
  PARTIAL_IMPORT: {
    message: 'Some export data could not be imported.',
    exitCode: 4,
    retryable: false,
  },
} as const;

export type CliErrorCode = keyof typeof CLI_ERRORS;

export const PLATFORM_CHECK_REASONS = [
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
] as const;
export type PlatformCheckReason = (typeof PLATFORM_CHECK_REASONS)[number];
export function platformCheckReason(
  value: unknown,
): PlatformCheckReason | undefined {
  return PLATFORM_CHECK_REASONS.find((reason) => reason === value);
}

export const LABEL_FAILURE_CODES = [
  'UNKNOWN_ITEM',
  'CONTENT_CHANGED',
  'UNKNOWN_CATEGORY',
  'CATEGORY_NOT_CHECKED',
  'CRITERION_CHANGED',
  'INVALID_REASON',
  'INVALID_LABEL',
] as const;
export type LabelFailureCode = (typeof LABEL_FAILURE_CODES)[number];
export interface LabelFailureDetails {
  failures: { index: number; code: LabelFailureCode }[];
}

// Error metadata is a closed protocol, not an exception or input dump.
function labelDetails(value: unknown): LabelFailureDetails | undefined {
  if (
    !value ||
    typeof value !== 'object' ||
    Object.keys(value).length !== 1 ||
    !('failures' in value) ||
    !Array.isArray(value.failures)
  )
    return undefined;
  const failures: LabelFailureDetails['failures'] = [];
  for (const entry of value.failures as unknown[]) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      Object.keys(entry).length !== 2 ||
      !('index' in entry) ||
      typeof entry.index !== 'number' ||
      !Number.isSafeInteger(entry.index) ||
      entry.index < -1 ||
      !('code' in entry) ||
      !LABEL_FAILURE_CODES.some((code) => code === entry.code)
    )
      return undefined;
    failures.push({ index: entry.index, code: entry.code as LabelFailureCode });
  }
  return { failures };
}

export class CliError extends Error {
  readonly code: CliErrorCode;
  readonly nodeVersion?: string;
  readonly details?: LabelFailureDetails;
  readonly reason?: PlatformCheckReason;

  constructor(
    code: CliErrorCode,
    nodeVersion?: string,
    details?: LabelFailureDetails,
    reason?: unknown,
  ) {
    super(CLI_ERRORS[code].message);
    this.name = 'CliError';
    this.code = code;
    this.nodeVersion = nodeVersion;
    this.details =
      code === 'INVALID_LABELS' ? labelDetails(details) : undefined;
    this.reason =
      code === 'PLATFORM_CHECK' ? platformCheckReason(reason) : undefined;
  }
}

export function errorObject(
  code: CliErrorCode,
  nodeVersion?: string,
  details?: LabelFailureDetails,
) {
  const validated =
    code === 'INVALID_LABELS' ? labelDetails(details) : undefined;
  return {
    code,
    ...CLI_ERRORS[code],
    ...(code === 'NODE_TOO_OLD'
      ? {
          message: `${CLI_ERRORS.NODE_TOO_OLD.message} You have ${/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(nodeVersion ?? '') ? nodeVersion : '0.0.0'}.`,
        }
      : {}),
    ...(validated ? { details: validated } : {}),
  };
}

export function normalizeExitCode(code: number): ExitCode {
  if (code === -4 || code === -5) return 2;
  return code === 0 || code === 1 || code === 2 || code === 3 || code === 4
    ? code
    : 1;
}

export type ExitCode = 0 | 1 | 2 | 3 | 4;

export const EXIT_MEANINGS = {
  0: 'done',
  1: 'runtime error',
  2: 'wrong usage',
  3: 'input format not readable by this version',
  4: 'partial read',
} as const;

export const CLI_ERRORS = {
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

export const LABEL_FAILURE_CODES = [
  'UNKNOWN_ITEM',
  'CONTENT_CHANGED',
  'UNKNOWN_CATEGORY',
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

  constructor(
    code: CliErrorCode,
    nodeVersion?: string,
    details?: LabelFailureDetails,
  ) {
    super(CLI_ERRORS[code].message);
    this.name = 'CliError';
    this.code = code;
    this.nodeVersion = nodeVersion;
    this.details =
      code === 'INVALID_LABELS' ? labelDetails(details) : undefined;
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

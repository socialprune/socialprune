export type ExitCode = 0 | 1 | 2 | 3 | 4;

export const EXIT_MEANINGS = {
  0: 'done',
  1: 'runtime error',
  2: 'wrong usage',
  3: 'input format not readable by this version',
  4: 'partial read',
} as const;

export const CLI_ERRORS = {
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
} as const;

export type CliErrorCode = keyof typeof CLI_ERRORS;

export class CliError extends Error {
  readonly code: CliErrorCode;

  constructor(code: CliErrorCode) {
    super(CLI_ERRORS[code].message);
    this.name = 'CliError';
    this.code = code;
  }
}

export function errorObject(code: CliErrorCode) {
  return { code, ...CLI_ERRORS[code] };
}

export function normalizeExitCode(code: number): ExitCode {
  if (code === -4 || code === -5) return 2;
  return code === 0 || code === 1 || code === 2 || code === 3 || code === 4
    ? code
    : 1;
}

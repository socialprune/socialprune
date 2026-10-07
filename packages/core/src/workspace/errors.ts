export const WORKSPACE_ERROR_CODES = [
  'INVALID_WORKSPACE',
  'INVALID_ITEM_ID',
  'DUPLICATE_ID',
  'UNKNOWN_ITEM',
  'UNKNOWN_SUBMISSION',
  'COUNT_MISMATCH',
  'EVENT_CHAIN',
  'ACTION_INVALID',
  'FIXTURE_NOT_ALLOWED',
  'INVALID_LABEL',
  'SUBMISSION_CONFLICT',
  'EVENT_CONFLICT',
  'ASSESSMENT_CONFLICT',
  'STALE',
  'STORAGE',
  'STALE_PREVIEW',
  'PREVIEW_EXPIRED',
  'NOTHING_TO_UNDO',
  'NOTHING_TO_REDO',
  'UNKNOWN_WORKSPACE',
  'INVALID_QUERY',
  'QUERY_EXPIRED',
  'INVALID_REQUEST',
  'IMPORT_INCOMPLETE',
  'CANCELLED',
  'INVALID_CURSOR',
  'ACCOUNT_REQUIRED',
  'SHARING_NOT_CONFIRMED',
  'INVALID_LABELS',
  'CONTENT_CHANGED',
  'UNKNOWN_CATEGORY',
  'INVALID_REASON',
] as const;
export type WorkspaceErrorCode = (typeof WORKSPACE_ERROR_CODES)[number];
export class WorkspaceError extends Error {
  override readonly name = 'WorkspaceError';
  readonly code: WorkspaceErrorCode;
  constructor(code: WorkspaceErrorCode) {
    super(code);
    this.code = code;
  }
}

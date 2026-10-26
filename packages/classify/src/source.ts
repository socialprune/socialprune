import type { ItemKind } from '@socialprune/core';

export interface Criterion {
  id: string;
  label: string;
  definition: string;
}
export interface CheckEntry {
  id: string;
  platform: 'x' | 'instagram';
  kind: ItemKind;
  text: string;
}
export interface CheckRequest {
  criteria: Criterion[];
  entries: CheckEntry[];
  failures?: { id: string; code: FailureCode }[];
}
export interface RawLabel {
  category: string;
  risk: number;
  quote: string | null;
  reason: string;
}
export interface Usage {
  promptTokens: number | null;
  cachedPromptTokens: number | null;
  completionTokens: number | null;
}
export interface CheckAnswer {
  answeredBy: string | null;
  usage: Usage;
  truncated: boolean;
  // Values remain untrusted until the per-entry normalizer checks them.
  entries: unknown[];
  // Original JSON text may be incomplete when finish_reason is length.
  rawContent?: string;
  format?: 'json' | 'invalid-json' | 'invalid-envelope' | 'truncated-json';
}
export interface SuggestionSource {
  readonly kind: 'model' | 'rules';
  readonly name: string;
  readonly destination: string | null;
  check(request: CheckRequest, signal: AbortSignal): Promise<CheckAnswer>;
}
export type FailureCode =
  'MISSING_ID' | 'DUPLICATE_ID' | 'INVALID_LABEL' | 'MISSING_QUOTE';
export const ERROR_CODES = [
  'SOURCE_FILE_INVALID',
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
  'RUN_STOPPED',
  'REQUEST_SIZE',
  'REQUEST_TIMEOUT',
  'CONNECTION',
  'TLS',
  'RETRYABLE_STATUS',
  'ENDPOINT_RESPONSE_INVALID',
  'WORKSPACE_BUSY',
] as const;
export type ScanCode = (typeof ERROR_CODES)[number];
export class ScanError extends Error {
  readonly code: ScanCode;
  readonly waitSeconds: number | null;
  constructor(code: ScanCode, waitSeconds: number | null = null) {
    super(code);
    this.name = 'ScanError';
    this.code = code;
    this.waitSeconds = waitSeconds;
  }
}
export function stopped(signal: AbortSignal) {
  if (signal.aborted) throw new ScanError('RUN_STOPPED');
}
export const emptyUsage = (): Usage => ({
  promptTokens: null,
  cachedPromptTokens: null,
  completionTokens: null,
});

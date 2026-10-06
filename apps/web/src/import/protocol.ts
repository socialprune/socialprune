import type { ImportSummary, Item } from '@socialprune/core';

export type ImportRequest =
  { type: 'import'; id: number; files: File[] } | { type: 'abort'; id: number };

export interface PolicyViolation {
  directive: string;
  blockedURI: string;
}

export type ImportMessage =
  | { type: 'progress'; id: number; items: number }
  | { type: 'items'; id: number; items: Item[] }
  | { type: 'summary'; id: number; summary: ImportSummary }
  | { type: 'aborted'; id: number }
  | { type: 'error'; id: number; message: string }
  | { type: 'policy-violation'; violation: PolicyViolation };

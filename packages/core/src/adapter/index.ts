import type { ArchiveReader, ImportLimits } from '../archive/index.ts';
import type { Account, Diagnostic, Item, PlatformId } from '../model/index.ts';

export interface Detection {
  result: 'match' | 'no-match' | 'html-export';
  variant: string | null;
  reason: string;
}
export interface ParseContext {
  signal?: AbortSignal;
  limits: ImportLimits;
  now(): Date;
}
export type ParseEvent =
  | { type: 'account'; account: Account }
  | { type: 'item'; item: Item }
  | { type: 'diagnostic'; diagnostic: Diagnostic }
  | { type: 'meta'; exportCreatedAt: string | null };
export interface DeletionHint {
  action: 'delete' | 'undo-repost' | 'delete-comment';
  url: string | null;
  group: string | null;
}
export interface PlatformAdapter {
  readonly platform: PlatformId;
  readonly name: string;
  readonly version: string;
  readonly clickListOrder: 'risk' | 'day';
  detect(archive: ArchiveReader): Promise<Detection>;
  parse(archive: ArchiveReader, ctx: ParseContext): AsyncIterable<ParseEvent>;
  deletionHint(item: Item): DeletionHint;
}

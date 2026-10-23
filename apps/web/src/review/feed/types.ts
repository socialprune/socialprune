/** Presentation only. No workspace, protocol or persistence types cross this seam. */
export type FeedTab =
  'suggested' | 'held' | 'kept' | 'unclear' | 'marked' | 'all';
export type FeedDecision = 'undecided' | 'keep' | 'later' | 'delete';
export type FeedPlatform = 'x' | 'instagram';
export interface FeedPost {
  id: string;
  name: string;
  handle: string;
  createdAt: string;
  text: string;
  mediaCount: number;
}
export interface FeedSuggestion {
  id: string;
  category: string;
  level: 0 | 1 | 2 | 3;
  source: { kind: 'example' | 'agent' | 'model' | 'words'; name?: string };
  reason: string;
  evidence?: string;
  ownCriterion?: boolean;
  unclear?: boolean;
  harmless?: boolean;
}
export interface FeedCardModel extends FeedPost {
  kind: 'post' | 'reply' | 'quote' | 'repost' | 'comment';
  replyTo?: string;
  replyContext?: readonly FeedPost[];
  conversationCount?: number;
  quote?: FeedPost;
  contextMissing?: boolean;
  likes: number | null;
  reposts: number | null;
  suggestions: readonly FeedSuggestion[];
  heldBy: readonly { id: string; value: string; rule: string }[];
  decision: FeedDecision;
  decidedAt?: string;
  markedVia?: 'single' | 'final';
  deleted?: boolean;
  busy?: boolean;
}
export interface FeedCounts {
  suggested: number;
  held: number;
  kept: number;
  unclear: number;
  marked: number;
  all: number;
}
export interface MarkPreviewModel {
  account: string;
  platform?: FeedPlatform;
  /** Q7 remains open. Eligibility and this policy come from the owner. */
  laterExcluded?: boolean;
  count: number;
  criteria: string;
  level: string;
  held: number;
  kept: number;
  unclear: number;
  sources: readonly { name: string; count: number }[];
  sample: readonly FeedPost[];
  state: 'ready' | 'loading' | 'changed' | 'error';
  rules?: readonly string[];
}

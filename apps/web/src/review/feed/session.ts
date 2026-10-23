import type { DecisionValue } from '@socialprune/core';
import type { FeedTab } from '@socialprune/core/criteria';
import type {
  BulkPreview,
  FeedCard,
  PlanCounts,
} from '@socialprune/core/workspace/protocol';
import type { WorkspaceClient } from '../../workspace/client.ts';

export interface FeedSnapshot {
  accountKey: string;
  tab: FeedTab;
  start: number;
  total: number;
  cards: FeedCard[];
  counts: PlanCounts | null;
  loading: boolean;
  busy: boolean;
  error: boolean;
  preview: BulkPreview | null;
  previewState: 'ready' | 'loading' | 'changed' | 'error';
}
const id = () => crypto.randomUUID();

/** Owns UI windows and command lifetimes, never derives feed membership. */
export class FeedSession {
  snapshot: FeedSnapshot = {
    accountKey: '',
    tab: 'suggested',
    start: 0,
    total: 0,
    cards: [],
    counts: null,
    loading: false,
    busy: false,
    error: false,
    preview: null,
    previewState: 'ready',
  };
  private epoch = 0;
  private page = id();
  private previewEpoch = 0;
  private membershipChanged = false;
  private listeners = new Set<() => void>();
  private readonly client: WorkspaceClient;
  constructor(client: WorkspaceClient) {
    this.client = client;
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  private update(change: Partial<FeedSnapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of this.listeners) listener();
  }
  async open(accountKey: string, tab: FeedTab, anchor?: string) {
    const epoch = ++this.epoch;
    this.cancelPreview();
    this.membershipChanged = false;
    this.update({
      accountKey,
      tab,
      cards: [],
      start: 0,
      counts: null,
      loading: true,
      busy: false,
      error: false,
    });
    try {
      const [counts, window] = await Promise.all([
        this.client.planCounts(accountKey),
        this.client.feedWindow({
          accountKey,
          tab,
          ...(anchor ? { anchor } : { offset: 0 }),
          limit: 50,
        }),
      ]);
      if (epoch !== this.epoch) return;
      if (counts.type !== 'planCounts' || window.type !== 'feedCards')
        throw new Error('Feed read rejected');
      this.update({
        counts,
        cards: window.cards,
        total: window.total,
        start: window.anchorIndex ?? 0,
      });
    } catch {
      if (epoch === this.epoch) this.update({ error: true });
    } finally {
      if (epoch === this.epoch) this.update({ loading: false });
    }
  }
  async load(offset: number) {
    if (this.snapshot.loading || this.snapshot.busy) return;
    if (this.membershipChanged) {
      const { accountKey, tab, cards } = this.snapshot;
      const anchor = (offset >= this.snapshot.start ? cards.at(-1) : cards[0])
        ?.item.id;
      await this.open(accountKey, tab, anchor);
      return;
    }
    const epoch = this.epoch,
      { accountKey, tab, start, cards } = this.snapshot;
    this.update({ loading: true, error: false });
    try {
      const result = await this.client.feedWindow({
        accountKey,
        tab,
        offset: Math.max(0, offset),
        limit: 50,
      });
      if (epoch !== this.epoch) return;
      if (result.type !== 'feedCards') throw new Error('Feed window rejected');
      let next = result.cards,
        first = Math.max(0, offset);
      if (offset === start + cards.length) {
        next = [...cards, ...result.cards];
        first = start;
      }
      if (offset + result.cards.length === start) {
        next = [...result.cards, ...cards];
        first = offset;
      }
      if (next.length > 300) {
        if (offset >= start) {
          first += next.length - 300;
          next = next.slice(-300);
        } else next = next.slice(0, 300);
      }
      this.update({ cards: next, start: first, total: result.total });
    } catch {
      if (epoch === this.epoch) this.update({ error: true });
    } finally {
      if (epoch === this.epoch) this.update({ loading: false });
    }
  }
  async refreshCounts() {
    const epoch = this.epoch;
    const counts = await this.client.planCounts(this.snapshot.accountKey);
    if (epoch === this.epoch && counts.type === 'planCounts')
      this.update({ counts });
  }
  async undo(anchor?: string) {
    if (this.snapshot.busy || this.snapshot.loading) return null;
    const epoch = this.epoch;
    const { accountKey, tab } = this.snapshot;
    this.update({ busy: true, error: false });
    try {
      const result = await this.client.request({
        type: 'undo',
        requestId: id(),
        commandId: id(),
      });
      if (epoch !== this.epoch) return null;
      if (result.type !== 'committed') throw new Error('Undo rejected');
      await this.open(accountKey, tab, anchor);
      return result;
    } catch {
      if (epoch === this.epoch) this.update({ error: true });
      return null;
    } finally {
      if (epoch === this.epoch) this.update({ busy: false });
    }
  }
  async decide(itemId: string, value: DecisionValue) {
    const card = this.snapshot.cards.find((card) => card.item.id === itemId);
    if (!card || this.snapshot.busy || this.snapshot.loading) return false;
    const epoch = this.epoch;
    this.update({ busy: true, error: false });
    try {
      const result = await this.client.request({
        type: 'decide',
        requestId: id(),
        commandId: id(),
        itemIds: [itemId],
        value,
        expected: { [itemId]: card.decision },
      });
      if (epoch !== this.epoch) return false;
      if (result.type !== 'committed') throw new Error('Decision rejected');
      const updated = await this.client.feedWindow({
        accountKey: this.snapshot.accountKey,
        tab: 'all',
        anchor: itemId,
        limit: 1,
      });
      if (epoch !== this.epoch) return false;
      if (updated.type !== 'feedCards' || updated.cards[0]?.item.id !== itemId)
        throw new Error('Decision readback rejected');
      await this.refreshCounts();
      if (epoch !== this.epoch) return false;
      this.update({
        busy: false,
        cards: this.snapshot.cards.map((entry) =>
          entry.item.id === itemId ? updated.cards[0]! : entry,
        ),
      });
      this.membershipChanged = true;
      return true;
    } catch {
      if (epoch === this.epoch) this.update({ error: true });
      return false;
    } finally {
      if (epoch === this.epoch) this.update({ busy: false });
    }
  }
  async preview(replacement = false) {
    const epoch = this.epoch;
    const previewEpoch = ++this.previewEpoch;
    this.update({ previewState: 'loading', error: false });
    const previewId = id();
    try {
      const reply = await this.client.previewPlan({
        pageId: this.page,
        previewId,
        accountKey: this.snapshot.accountKey,
      });
      if (epoch !== this.epoch || previewEpoch !== this.previewEpoch) {
        void this.client.request({
          type: 'releasePreview',
          requestId: id(),
          pageId: this.page,
          previewId,
        });
        return;
      }
      if (reply.type !== 'bulkPreview') throw new Error('Preview rejected');
      this.update({
        preview: reply,
        previewState: replacement ? 'changed' : 'ready',
      });
    } catch {
      if (epoch === this.epoch && previewEpoch === this.previewEpoch)
        this.update({ previewState: 'error' });
    }
  }
  async confirm(): Promise<'saved' | 'changed' | 'error'> {
    const preview = this.snapshot.preview;
    if (
      !preview ||
      this.snapshot.busy ||
      this.snapshot.previewState === 'loading'
    )
      return 'error';
    const epoch = this.epoch;
    this.update({ busy: true });
    try {
      const result = await this.client.request({
        type: 'confirmBulk',
        requestId: id(),
        commandId: id(),
        pageId: this.page,
        previewId: preview.previewId,
      });
      if (epoch !== this.epoch) return 'error';
      if (
        result.type === 'rejected' &&
        ['STALE_PREVIEW', 'PREVIEW_EXPIRED'].includes(result.code)
      ) {
        await this.preview(true);
        return 'changed';
      }
      if (result.type !== 'committed') throw new Error('Confirm rejected');
      this.update({ preview: null });
      await this.refreshCounts();
      if (epoch !== this.epoch) return 'error';
      return 'saved';
    } catch {
      if (epoch === this.epoch) this.update({ previewState: 'error' });
      return 'error';
    } finally {
      if (epoch === this.epoch) this.update({ busy: false });
    }
  }
  cancelPreview() {
    ++this.previewEpoch;
    const preview = this.snapshot.preview;
    if (preview)
      void this.client
        .request({
          type: 'releasePreview',
          requestId: id(),
          pageId: this.page,
          previewId: preview.previewId,
        })
        .catch(() => undefined);
    this.update({ preview: null, previewState: 'ready' });
  }
  dispose() {
    ++this.epoch;
    this.cancelPreview();
    this.listeners.clear();
  }
}

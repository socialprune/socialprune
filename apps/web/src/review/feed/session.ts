import type { DecisionValue } from '@socialprune/core';
import type { FeedTab, FeedSort } from '@socialprune/core/criteria';
import type {
  BulkPreview,
  FeedCard,
  PlanCounts,
} from '@socialprune/core/workspace/protocol';
import type { WorkspaceClient } from '../../workspace/client.ts';
import { CommandQueue } from '../../workspace/command-queue.ts';

export interface FeedSnapshot {
  accountKey: string;
  tab: FeedTab;
  sort: FeedSort;
  sortOptions: FeedSort[];
  start: number;
  total: number;
  cards: FeedCard[];
  counts: PlanCounts | null;
  loading: boolean;
  busy: boolean;
  error: boolean;
  preview: BulkPreview | null;
  previewState: 'ready' | 'loading' | 'changed' | 'error';
  pending: number;
  saveFailure: { itemId: string; sequence: number } | null;
  historyBlocked: 'undo' | 'redo' | null;
}
const id = () => crypto.randomUUID();

/** Owns bounded UI windows, provisional presentation and human command lifetimes.
 * The server's receipt, card readback and counts remain authoritative. */
export class FeedSession {
  snapshot: FeedSnapshot = {
    accountKey: '',
    tab: 'suggested',
    sort: 'newest',
    sortOptions: ['newest', 'oldest'],
    start: 0,
    total: 0,
    cards: [],
    counts: null,
    loading: false,
    busy: false,
    error: false,
    preview: null,
    previewState: 'ready',
    pending: 0,
    saveFailure: null,
    historyBlocked: null,
  };
  private epoch = 0;
  private windowEpoch = 0;
  private page = id();
  private previewEpoch = 0;
  private membershipChanged = false;
  private listeners = new Set<() => void>();
  private readonly client: WorkspaceClient;
  private readonly commands: CommandQueue;
  private optimistic = new Map<
    string,
    { card: FeedCard; leaves: boolean; generation: number }
  >();
  private failedItems = new Map<string, number>();
  private confirmedCards = new Map<string, FeedCard>();
  private confirmedLeaves = new Set<string>();
  private prefetching: Promise<void> | null = null;
  private failureSequence = 0;
  private history: Promise<unknown> = Promise.resolve();
  constructor(client: WorkspaceClient) {
    this.client = client;
    this.commands = client.commands ?? new CommandQueue();
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
  async open(
    accountKey: string,
    tab: FeedTab,
    anchor?: string,
    sort: FeedSort = this.snapshot.sort,
    keepPreview = false,
  ) {
    this.update({ loading: true });
    if (this.commands.pending) await this.commands.flush();
    if (this.commands.recovery?.accountKey === accountKey)
      anchor = this.commands.recovery.itemId;
    const epoch = ++this.epoch;
    this.confirmedLeaves.clear();
    this.confirmedCards.clear();
    ++this.windowEpoch;
    if (!keepPreview) this.cancelPreview();
    this.membershipChanged = false;
    this.update({
      accountKey,
      tab,
      sort,
      ...(accountKey !== this.snapshot.accountKey
        ? { sortOptions: ['newest', 'oldest'] as FeedSort[] }
        : {}),
      cards: [],
      start: 0,
      counts: null,
      loading: true,
      busy: false,
      error: false,
      saveFailure:
        this.commands.recovery?.accountKey === accountKey
          ? this.commands.recovery
          : null,
    });
    try {
      const [counts, window] = await Promise.all([
        this.client.planCounts(accountKey),
        this.client.feedWindow({
          accountKey,
          tab,
          sort,
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
        sortOptions: window.sortOptions ?? ['newest', 'oldest'],
      });
      void this.prefetch();
    } catch {
      if (epoch === this.epoch) this.update({ error: true });
    } finally {
      if (epoch === this.epoch) this.update({ loading: false });
    }
  }
  async load(offset: number, replace = false) {
    if (this.snapshot.busy || (this.snapshot.loading && !replace)) return;
    if (this.membershipChanged && !replace) {
      const { accountKey, tab, cards } = this.snapshot;
      const anchor = (offset >= this.snapshot.start ? cards.at(-1) : cards[0])
        ?.item.id;
      await this.open(accountKey, tab, anchor);
      return;
    }
    const epoch = this.epoch,
      windowEpoch = ++this.windowEpoch,
      { accountKey, tab, start, cards } = this.snapshot;
    this.update({ loading: true, error: false });
    try {
      const result = await this.client.feedWindow({
        accountKey,
        tab,
        offset: Math.max(0, offset),
        sort: this.snapshot.sort,
        limit: 50,
      });
      if (epoch !== this.epoch || windowEpoch !== this.windowEpoch) return;
      if (result.type !== 'feedCards') throw new Error('Feed window rejected');
      let next = result.cards,
        first = Math.max(0, offset);
      if (!replace && offset === start + cards.length) {
        next = [...cards, ...result.cards];
        first = start;
      }
      if (!replace && offset + result.cards.length === start) {
        next = [...result.cards, ...cards];
        first = offset;
      }
      if (next.length > 300) {
        if (offset >= start) {
          first += next.length - 300;
          next = next.slice(-300);
        } else next = next.slice(0, 300);
      }
      next = next
        .filter(
          (card) =>
            !this.confirmedLeaves.has(card.item.id) &&
            !this.optimistic.get(card.item.id)?.leaves,
        )
        .map((card) => this.optimistic.get(card.item.id)?.card ?? card);
      this.update({ cards: next, start: first, total: result.total });
      if (replace) this.membershipChanged = false;
    } catch {
      if (epoch === this.epoch && windowEpoch === this.windowEpoch)
        this.update({ error: true });
    } finally {
      if (epoch === this.epoch && windowEpoch === this.windowEpoch)
        this.update({ loading: false });
    }
  }
  /** Explicit navigation supersedes background paging; a person's key is not dropped. */
  async seek(index: number): Promise<string | null> {
    if (this.snapshot.busy) return null;
    const epoch = this.epoch;
    const destination = Math.min(
      Math.max(0, index),
      Math.max(0, this.snapshot.total - 1),
    );
    if (destination >= this.snapshot.start + this.snapshot.cards.length - 25)
      void this.prefetch();
    if (
      this.snapshot.loading ||
      !this.snapshot.cards[destination - this.snapshot.start]
    )
      await this.load(Math.floor(destination / 50) * 50, true);
    if (epoch !== this.epoch || this.snapshot.error) return null;
    return (
      this.snapshot.cards[destination - this.snapshot.start]?.item.id ?? null
    );
  }
  async refreshCounts() {
    const epoch = this.epoch;
    const counts = await this.client.planCounts(this.snapshot.accountKey);
    if (epoch === this.epoch && counts.type === 'planCounts')
      this.update({ counts });
  }
  undo(anchor?: string, kind: 'undo' | 'redo' = 'undo') {
    const work = this.reverse(anchor, kind);
    this.history = work;
    return work;
  }
  private async reverse(anchor?: string, kind: 'undo' | 'redo' = 'undo') {
    if (this.snapshot.busy) return null;
    const failures = this.commands.failures;
    const result = await this.commands.enqueue(async () => {
      if (this.commands.failures !== failures) {
        this.update({ historyBlocked: kind });
        return null;
      }
      try {
        const reply = await this.client.request({
          type: kind,
          requestId: id(),
          commandId: id(),
        });
        return reply.type === 'committed' ? reply : null;
      } catch {
        return null;
      }
    });
    if (result) {
      const { accountKey, tab, sort } = this.snapshot;
      await this.open(accountKey, tab, anchor, sort, true);
    }
    return result;
  }
  private belongs(card: FeedCard, value: DecisionValue) {
    const tab = this.snapshot.tab;
    if (tab === 'all') return true;
    if (value === 'keep') return tab === 'kept';
    if (value === 'delete') return tab === 'marked';
    if (value === 'later') return tab === 'unclear';
    const criteria = this.client.summary?.criteria;
    const hit = card.suggestions.some(
      (a) =>
        a.risk >= (criteria?.level ?? 1) &&
        (criteria?.selected.includes(a.category) ?? true) &&
        !['harmless', 'unclear'].includes(a.category),
    );
    return (
      tab ===
      (hit
        ? card.holdingRules.length
          ? 'held'
          : 'suggested'
        : card.suggestions.some((a) => a.category === 'unclear')
          ? 'unclear'
          : 'all')
    );
  }
  async prefetch(force = false) {
    if (
      this.prefetching ||
      !this.snapshot.cards.length ||
      (!force && this.snapshot.cards.length >= 200) ||
      this.snapshot.start + this.snapshot.cards.length >= this.snapshot.total
    )
      return;
    const epoch = this.epoch,
      windowEpoch = this.windowEpoch;
    const { accountKey, tab, sort } = this.snapshot;
    const anchor = this.snapshot.cards.at(-1)!.item.id;
    this.prefetching = (async () => {
      try {
        const result = await this.client.feedWindow({
          accountKey,
          tab,
          sort,
          anchor,
          limit: 50,
        });
        if (
          epoch !== this.epoch ||
          windowEpoch !== this.windowEpoch ||
          result.type !== 'feedCards'
        )
          return;
        const existing = new Set(
          this.snapshot.cards.map((card) => card.item.id),
        );
        const next = result.cards
          .filter(
            (card) =>
              !existing.has(card.item.id) &&
              !this.confirmedLeaves.has(card.item.id) &&
              !this.optimistic.get(card.item.id)?.leaves,
          )
          .map((card) => this.optimistic.get(card.item.id)?.card ?? card);
        const cards = [...this.snapshot.cards, ...next];
        const trim = Math.max(0, cards.length - 300);
        this.update({
          cards: cards.slice(trim),
          start: this.snapshot.start + trim,
        });
      } catch {
        if (epoch === this.epoch && windowEpoch === this.windowEpoch)
          this.update({ error: true });
      }
    })().finally(() => {
      this.prefetching = null;
    });
    await this.prefetching;
  }
  async decide(itemId: string, value: DecisionValue, retainInPlace = false) {
    const card = this.snapshot.cards.find((card) => card.item.id === itemId);
    if (!card || this.snapshot.busy) return false;
    if (card.decision === value) return true;
    const index = this.snapshot.cards.indexOf(card),
      epoch = this.epoch;
    const failureGeneration = this.failedItems.get(itemId) ?? 0;
    if (!this.optimistic.has(itemId)) this.confirmedCards.set(itemId, card);
    const updated = { ...card, decision: value };
    const leaves = !this.belongs(card, value);
    const removes = leaves && !retainInPlace;
    const operation = {
      card: updated,
      leaves: removes,
      generation: failureGeneration,
    };
    this.optimistic.set(itemId, operation);
    this.update({
      cards: removes
        ? this.snapshot.cards.filter((entry) => entry.item.id !== itemId)
        : this.snapshot.cards.map((entry) =>
            entry.item.id === itemId ? updated : entry,
          ),
      total: Math.max(0, this.snapshot.total - (removes ? 1 : 0)),
      pending: this.snapshot.pending + 1,
      saveFailure: null,
      historyBlocked: null,
    });
    if (this.snapshot.cards.length < 50) void this.prefetch();
    return this.commands.enqueue(async () => {
      let saved = false;
      let attempted = false;
      try {
        if ((this.failedItems.get(itemId) ?? 0) !== failureGeneration)
          throw Error('Earlier decision failed');
        attempted = true;
        const result = await this.client.request({
          type: 'decide',
          requestId: id(),
          commandId: id(),
          itemIds: [itemId],
          value,
          expected: { [itemId]: card.decision },
        });
        if (
          result.type !== 'committed' ||
          result.changed !== 1 ||
          result.skipped
        )
          throw Error('Decision not saved');
        saved = true;
        if (this.commands.recovery?.itemId === itemId)
          this.commands.recovery = null;
        if (removes) this.confirmedLeaves.add(itemId);
        this.confirmedCards.set(itemId, updated);
        this.membershipChanged = true;
        if (epoch === this.epoch) {
          const readback = await this.client.feedWindow({
            accountKey: this.snapshot.accountKey,
            tab: 'all',
            sort: this.snapshot.sort,
            anchor: itemId,
            limit: 1,
          });
          if (
            readback.type !== 'feedCards' ||
            readback.cards[0]?.item.id !== itemId
          )
            throw Error('Saved decision readback failed');
          const confirmed = readback.cards[0];
          this.confirmedCards.set(itemId, confirmed);
          if (this.optimistic.get(itemId) === operation) {
            const membership =
              this.snapshot.tab === 'all'
                ? readback
                : await this.client.feedWindow({
                    accountKey: this.snapshot.accountKey,
                    tab: this.snapshot.tab,
                    sort: this.snapshot.sort,
                    anchor: itemId,
                    limit: 1,
                  });
            if (membership.type !== 'feedCards')
              throw Error('Saved membership readback failed');
            if (this.optimistic.get(itemId) === operation) {
              const remains = membership.cards[0]?.item.id === itemId;
              if (remains) this.confirmedLeaves.delete(itemId);
              else if (!retainInPlace) this.confirmedLeaves.add(itemId);
              const cards = this.snapshot.cards.filter(
                (entry) => entry.item.id !== itemId,
              );
              if (remains || retainInPlace)
                cards.splice(Math.min(index, cards.length), 0, confirmed);
              this.update({ cards: cards.slice(0, 300), error: false });
            }
          }
          await this.refreshCounts();
          if (this.snapshot.counts)
            this.update({
              total: Math.max(
                0,
                this.snapshot.counts.tabs[this.snapshot.tab] -
                  [...this.optimistic.entries()].filter(
                    ([key, entry]) => key !== itemId && entry.leaves,
                  ).length,
                ...(retainInPlace
                  ? [this.snapshot.start + this.snapshot.cards.length]
                  : []),
              ),
            });
        }
      } catch {
        if (!saved) {
          if (attempted) {
            this.failedItems.set(
              itemId,
              (this.failedItems.get(itemId) ?? 0) + 1,
            );
            // An actual failed write invalidates its dependent, pre-failure
            // intents. It owns their rollback; an unsent stale intent never
            // takes ownership from a fresh click made after this failure.
            if (this.optimistic.get(itemId)?.generation === failureGeneration)
              this.optimistic.set(itemId, operation);
          }
          if (this.optimistic.get(itemId) === operation) {
            const recovery = {
              itemId,
              accountKey: this.snapshot.accountKey,
              sequence: ++this.failureSequence,
            };
            this.commands.recovery = recovery;
            this.optimistic.delete(itemId);
            if (epoch === this.epoch) {
              const cards = this.snapshot.cards.filter(
                (entry) => entry.item.id !== itemId,
              );
              cards.splice(
                Math.min(index, cards.length),
                0,
                this.confirmedCards.get(itemId) ?? card,
              );
              this.update({
                cards: cards.slice(0, 300),
                total: this.snapshot.total + (removes ? 1 : 0),
                saveFailure: recovery,
              });
            }
          }
        } else if (epoch === this.epoch) this.update({ error: true });
      } finally {
        if (saved && this.optimistic.get(itemId) === operation) {
          this.optimistic.delete(itemId);
          this.confirmedCards.delete(itemId);
        }
        if (epoch === this.epoch)
          this.update({ pending: Math.max(0, this.snapshot.pending - 1) });
      }
      return saved;
    });
  }
  async flush() {
    await this.history;
    await this.commands.flush();
  }
  async preview(replacement = false) {
    const previewEpoch = ++this.previewEpoch;
    this.update({ previewState: 'loading', error: false });
    if (this.commands.pending) {
      await this.history;
      await this.commands.flush();
    }
    if (previewEpoch !== this.previewEpoch) return;
    const epoch = this.epoch;
    const previewId = id();
    try {
      if (epoch !== this.epoch || previewEpoch !== this.previewEpoch) return;
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
      await this.commands.flush();
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
    if (this.commands.pending) {
      void this.commands.flush().then(() => this.dispose());
      return;
    }
    ++this.epoch;
    ++this.windowEpoch;
    this.cancelPreview();
    this.listeners.clear();
  }
}

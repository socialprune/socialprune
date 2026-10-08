import { QueryEngine } from '@socialprune/core/workspace/query';
import { ReviewService } from '@socialprune/core/workspace/review';
import { LabelService } from '@socialprune/core/workspace/labels';
import { ClickListService } from '@socialprune/core/workspace/clicklist';
import { SettingsService } from '@socialprune/core/workspace/settings';
import { records } from '@socialprune/core/workspace/store';
import type { WorkspaceStore } from '@socialprune/core/workspace/store';
import {
  HttpReviewRequestSchema,
  ProtocolErrorCodeSchema,
  WorkspaceReplySchema,
} from '@socialprune/core/workspace/protocol';
import type {
  HttpReviewRequest,
  WorkspaceReply,
  WorkspaceSummary,
} from '@socialprune/core/workspace/protocol';
import { xAdapter } from '@socialprune/adapter-x';
import { instagramAdapter } from '@socialprune/adapter-instagram';

/** Runs inside the database thread. Dependencies allow deterministic test clocks. */
export class ReviewRuntime {
  private readonly store: WorkspaceStore;
  private readonly query: QueryEngine;
  private readonly review: ReviewService;
  private readonly lists: ClickListService;
  private readonly settings: SettingsService;
  private readonly scans = new Map<number, AbortController>();
  private readonly generations = new Map<string, number>();
  private commands: Promise<unknown> = Promise.resolve();
  constructor(
    store: WorkspaceStore,
    options: { now?: () => Date; yieldChunk?: () => Promise<void> } = {},
  ) {
    this.store = store;
    this.query = new QueryEngine(store, {
      yieldChunk: options.yieldChunk,
      now: options.now ? () => options.now!().getTime() : undefined,
    });
    this.review = new ReviewService(store, {
      query: this.query,
      via: 'local-review',
      now: options.now,
    });
    this.lists = new ClickListService(store, [xAdapter, instagramAdapter], {
      query: this.query,
    });
    this.settings = new SettingsService(store, { now: options.now });
  }
  async summary(): Promise<WorkspaceSummary> {
    const summary = await new LabelService(this.store).summary();
    return this.store.read(async (tx) => {
      const meta = await tx.meta.get();
      const accounts = new Map(
        (await records(tx.imports))
          .filter((r) => r.status === 'complete')
          .flatMap((r) => r.accounts.map((a) => [a.key, a] as const)),
      );
      return {
        workspaceId: meta.id,
        schemaVersion: 2,
        kind: meta.kind,
        accounts: [...accounts.values()],
        counts: summary.counts,
        decisions: summary.decisions,
        outcomes: summary.outcomes,
        lastBackupAt: meta.lastBackupAt,
        timeZone: meta.settings.timeZone,
        revision: summary.revision,
      };
    });
  }
  cancel(id: number): void {
    this.scans.get(id)?.abort();
  }
  async close(): Promise<void> {
    for (const scan of this.scans.values()) scan.abort();
    await this.commands;
    this.review.closeSession();
    await this.store.close();
  }
  run(id: number, raw: unknown): Promise<WorkspaceReply[]> {
    const input = HttpReviewRequestSchema.parse(raw);
    if (input.type === 'query') {
      const previous = this.generations.get(input.queryId) ?? -1;
      if (input.generation > previous)
        this.generations.set(input.queryId, input.generation);
      return this.handle(id, input);
    }
    if (input.type === 'window' || input.type === 'revision')
      return this.handle(id, input);
    const result = this.commands.then(() => this.handle(id, input));
    this.commands = result.catch(() => undefined);
    return result;
  }
  private async handle(
    id: number,
    input: HttpReviewRequest,
  ): Promise<WorkspaceReply[]> {
    const requestId = input.requestId;
    const replies: WorkspaceReply[] = [];
    const post = (reply: WorkspaceReply) => {
      replies.push(WorkspaceReplySchema.parse(reply));
    };
    const controller = new AbortController();
    this.scans.set(id, controller);
    try {
      switch (input.type) {
        case 'open':
          await this.query.prepareProjection();
          post({ type: 'opened', requestId, summary: await this.summary() });
          break;
        case 'query':
          post({
            type: 'queryResult',
            requestId,
            ...(await this.query.query({
              ...input,
              signal: controller.signal,
            })),
          });
          break;
        case 'window':
          if (
            (this.generations.get(input.queryId) ?? input.generation) >
            input.generation
          )
            post({
              type: 'cancelled',
              requestId,
              queryId: input.queryId,
              generation: input.generation,
            });
          else
            post({
              type: 'rows',
              requestId,
              queryId: input.queryId,
              generation: input.generation,
              offset: input.offset,
              rows: this.query.window(
                input.queryId,
                input.generation,
                input.offset,
                input.limit,
              ),
            });
          break;
        case 'detail': {
          const detail = await this.store.read(async (tx) => {
            const stored = await tx.items.get(input.itemId);
            if (!stored)
              throw Object.assign(new Error('UNKNOWN_ITEM'), {
                code: 'UNKNOWN_ITEM',
              });
            const assessments = (await records(tx.assessments)).filter(
              (a) => a.itemId === input.itemId,
            );
            const events = [
              ...(await records(tx.decisionEvents)),
              ...(await records(tx.outcomeEvents)),
            ]
              .filter((e) => e.itemId === input.itemId)
              .sort((a, b) => a.seq - b.seq);
            return { item: stored.item, assessments, events };
          });
          post({ type: 'itemDetail', requestId, ...detail });
          break;
        }
        case 'decide':
        case 'outcome': {
          const { commandId, itemIds } = input;
          const result =
            input.type === 'decide'
              ? await this.review.decide({
                  commandId,
                  itemIds,
                  value: input.value,
                  expected: input.expected,
                })
              : await this.review.outcome({
                  commandId,
                  itemIds,
                  value: input.value,
                  expected: input.expected,
                });
          post({ ...result, requestId });
          break;
        }
        case 'previewBulk': {
          const { type, requestId: ignored, ...preview } = input;
          void type;
          void ignored;
          post({
            ...(await this.review.previewBulk(preview)),
            type: 'bulkPreview',
            requestId,
          });
          break;
        }
        case 'confirmBulk':
          post({
            ...(await this.review.confirmBulk({
              commandId: input.commandId,
              pageId: input.pageId,
              previewId: input.previewId,
            })),
            requestId,
          });
          break;
        case 'releasePreview':
          this.review.releasePreview(input.pageId, input.previewId);
          post({ type: 'released', requestId });
          break;
        case 'undo':
        case 'redo':
          post({
            ...(await this.review[input.type](input.commandId)),
            requestId,
          });
          break;
        case 'history':
          post({
            type: 'historyEntries',
            requestId,
            entries: await this.review.history(input.limit),
          });
          break;
        case 'revision':
          post({
            type: 'revision',
            requestId,
            revision: await this.store.read(
              async (tx) => (await tx.runtime.get()).revision,
            ),
          });
          break;
        case 'shutdown':
          post({ type: 'done', requestId });
          break;
        case 'clickListOpen':
          post({
            type: 'clickListOpened',
            requestId,
            ...(await this.lists.open({ ...input, signal: controller.signal })),
          });
          break;
        case 'clickListWindow':
          post({
            type: 'clickListEntries',
            requestId,
            ...(await this.lists.window({
              ...input,
              signal: controller.signal,
            })),
          });
          break;
        case 'clickListExport': {
          const list = await this.lists.window({
            listId: input.listId,
            offset: 0,
            limit: 1,
            signal: controller.signal,
          });
          const decoder = new TextDecoder('utf-8', {
            ignoreBOM: true,
            fatal: true,
          });
          let index = 0,
            bytes = 0;
          for await (const part of this.lists.export({
            ...input,
            signal: controller.signal,
          })) {
            bytes += part.byteLength;
            post({
              type: 'clickListExportChunk',
              requestId,
              listId: input.listId,
              revision: list.revision,
              format: input.format,
              index: index++,
              chunk: decoder.decode(part, { stream: true }),
            });
          }
          const tail = decoder.decode();
          if (tail)
            post({
              type: 'clickListExportChunk',
              requestId,
              listId: input.listId,
              revision: list.revision,
              format: input.format,
              index,
              chunk: tail,
            });
          post({
            type: 'clickListExported',
            requestId,
            listId: input.listId,
            revision: list.revision,
            format: input.format,
            entries: list.total,
            bytes,
          });
          break;
        }
        case 'setTimeZone': {
          const result = await this.settings.setTimeZone(input.timeZone);
          await this.query.noteChanged({
            revision: result.revision,
            itemIds: [],
          });
          post({ type: 'settingsChanged', requestId, ...result });
          break;
        }
      }
    } catch (error) {
      const code = ProtocolErrorCodeSchema.safeParse(
        error && typeof error === 'object' && 'code' in error
          ? error.code
          : undefined,
      );
      if (
        (input.type === 'query' || input.type === 'window') &&
        (controller.signal.aborted ||
          (code.success && code.data === 'CANCELLED'))
      )
        post({
          type: 'cancelled',
          requestId,
          queryId: input.queryId,
          generation: input.generation,
        });
      else
        post({
          type: 'failed',
          requestId,
          code: code.success ? code.data : 'STORAGE',
        });
    } finally {
      this.scans.delete(id);
    }
    return replies;
  }
}

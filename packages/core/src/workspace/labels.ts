import { AssessmentSchema } from '../model/index.ts';
import type { Assessment, Item } from '../model/index.ts';
import { canonicalJson, contentHash } from './canonical.ts';
import { WorkspaceError } from './errors.ts';
import {
  BATCH_NOTICE,
  BatchSchema,
  LabelFileSchema,
  LabelSubmissionSchema,
  SummarySchema,
} from './payloads.ts';
import type { Batch, LabelSubmission, Summary } from './payloads.ts';
import { deriveState } from './state.ts';
import { readWorkspace, records } from './store.ts';
import type { WorkspaceStore } from './store.ts';

interface BatchCursor {
  v: 1;
  after: [string, string];
  account: string;
  sourceName: string;
}
function encodeCursor(value: BatchCursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}
function decodeCursor(value: string): BatchCursor {
  try {
    const bytes = Uint8Array.from(
      atob(value.replaceAll('-', '+').replaceAll('_', '/')),
      (character) => character.charCodeAt(0),
    );
    const parsed: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    );
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('v' in parsed) ||
      parsed.v !== 1 ||
      !('account' in parsed) ||
      typeof parsed.account !== 'string' ||
      !('sourceName' in parsed) ||
      typeof parsed.sourceName !== 'string' ||
      !('after' in parsed) ||
      !Array.isArray(parsed.after) ||
      parsed.after.length !== 2 ||
      parsed.after.some((part: unknown) => typeof part !== 'string')
    )
      throw new WorkspaceError('INVALID_CURSOR');
    return parsed as BatchCursor;
  } catch {
    throw new WorkspaceError('INVALID_CURSOR');
  }
}
function itemOrder(a: Item, b: Item): number {
  const date = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  return date || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
export class LabelValidationError extends WorkspaceError {
  readonly failures: { index: number; code: string }[];
  constructor(failures: { index: number; code: string }[]) {
    super('INVALID_LABELS');
    this.failures = failures;
  }
}
/** Suggestions only; this module has no decision/outcome append capability. */
export class LabelService {
  private readonly store: WorkspaceStore;
  private readonly now: () => Date;
  private readonly uuid: () => string;
  constructor(
    store: WorkspaceStore,
    options: { now?: () => Date; uuid?: () => string } = {},
  ) {
    this.store = store;
    this.now = options.now ?? (() => new Date());
    this.uuid = options.uuid ?? (() => crypto.randomUUID());
  }
  async batchNext(options: {
    shareWithAgent: boolean;
    account?: string;
    size?: number;
    cursor?: string;
    sourceName?: string;
  }): Promise<Batch> {
    if (options.shareWithAgent !== true)
      throw new WorkspaceError('SHARING_NOT_CONFIRMED');
    const size = options.size ?? 50;
    if (!Number.isSafeInteger(size) || size < 1 || size > 200)
      throw new WorkspaceError('INVALID_REQUEST');
    const sourceName = options.sourceName ?? 'agent';
    if (!sourceName) throw new WorkspaceError('INVALID_REQUEST');
    const cursor = options.cursor ? decodeCursor(options.cursor) : null;
    const snapshot = await this.store.read(async (tx) => ({
      workspace: await readWorkspace(tx),
      items: await records(tx.items),
    }));
    const completed = new Set(
      snapshot.workspace.imports
        .filter((record) => record.status === 'complete')
        .map((record) => record.id),
    );
    const visible = snapshot.items
      .filter((stored) => !stored.importId || completed.has(stored.importId))
      .map((stored) => stored.item);
    const accounts = [...new Set(visible.map((item) => item.account.key))];
    const account =
      options.account ?? (accounts.length === 1 ? accounts[0] : undefined);
    if (!account && accounts.length > 1)
      throw new WorkspaceError('ACCOUNT_REQUIRED');
    if (options.account && !accounts.includes(options.account))
      throw new WorkspaceError('INVALID_REQUEST');
    if (
      cursor &&
      (cursor.account !== account || cursor.sourceName !== sourceName)
    )
      throw new WorkspaceError('INVALID_CURSOR');
    const state = deriveState(snapshot.workspace);
    const items = visible
      .filter(
        (item) =>
          item.account.key === account &&
          !state
            .get(item.id)!
            .assessments.some(
              (assessment) =>
                assessment.source.kind === 'agent' &&
                assessment.source.name === sourceName,
            ),
      )
      .sort(itemOrder)
      .filter(
        (item) =>
          !cursor ||
          itemOrder(item, {
            ...item,
            createdAt: cursor.after[0],
            id: cursor.after[1],
          }) > 0,
      );
    const selected: Item[] = [];
    let textBytes = 0;
    for (const item of items) {
      const bytes = new TextEncoder().encode(item.text).byteLength;
      if (
        selected.length >= size ||
        (selected.length && textBytes + bytes > 262_144)
      )
        break;
      selected.push(item);
      textBytes += bytes;
    }
    const last = selected.at(-1);
    const hasMore = selected.length < items.length;
    const batchItems = await Promise.all(
      selected.map(async (item) => ({
        itemId: item.id,
        kind: item.kind,
        createdAt: item.createdAt,
        contentHash: await contentHash(item.text),
        content: {
          trust: 'untrusted' as const,
          source: 'platform-export' as const,
          text: item.text,
        },
      })),
    );
    return BatchSchema.parse({
      batchId: await contentHash(
        canonicalJson([
          options.cursor ?? null,
          size,
          selected.map((item) => item.id),
        ]),
      ),
      categories: snapshot.workspace.settings.categories,
      items: batchItems,
      nextCursor:
        hasMore && last
          ? encodeCursor({
              v: 1,
              after: [last.createdAt, last.id],
              account: account!,
              sourceName,
            })
          : null,
      hasMore,
      remaining: items.length,
      notice: BATCH_NOTICE,
      shared: {
        count: selected.length,
        fields: ['itemId', 'kind', 'createdAt', 'contentHash', 'text'],
      },
    });
  }
  async submitLabels(
    input: unknown,
    options: { dryRun?: boolean } = {},
  ): Promise<LabelSubmission> {
    const parsed = LabelFileSchema.safeParse(input);
    if (!parsed.success)
      throw new LabelValidationError(
        parsed.error.issues.map((issue) => ({
          index: typeof issue.path[1] === 'number' ? issue.path[1] : -1,
          code: issue.path.includes('reason')
            ? 'INVALID_REASON'
            : 'INVALID_LABEL',
        })),
      );
    const file = parsed.data;
    const hash = await contentHash(canonicalJson(file));
    const snapshot = await this.store.read(async (tx) => ({
      meta: await tx.meta.get(),
      prior: await tx.submissions.get(file.submissionId),
      runtime: await tx.runtime.get(),
      items: await Promise.all(
        file.labels.map((label) => tx.items.get(label.itemId)),
      ),
    }));
    if (snapshot.prior) {
      if (snapshot.prior.contentHash !== hash)
        throw new WorkspaceError('SUBMISSION_CONFLICT');
      return LabelSubmissionSchema.parse({
        submissionId: file.submissionId,
        accepted: snapshot.prior.labelCount,
        duplicate: true,
        dryRun: Boolean(options.dryRun),
        droppedEvidence: file.labels.filter(
          (label, index) =>
            label.evidence !== null &&
            !snapshot.items[index]?.item.text.includes(label.evidence),
        ).length,
        revision: snapshot.runtime.revision,
      });
    }
    const hashes = await Promise.all(
      snapshot.items.map((stored) =>
        stored ? contentHash(stored.item.text) : Promise.resolve(null),
      ),
    );
    const failures: { index: number; code: string }[] = [];
    const seen = new Set<string>();
    let droppedEvidence = 0;
    const time = this.now().toISOString();
    const assessments: Assessment[] = [];
    for (const [index, label] of file.labels.entries()) {
      const stored = snapshot.items[index];
      if (!stored) {
        failures.push({ index, code: 'UNKNOWN_ITEM' });
        continue;
      }
      if (hashes[index] !== label.contentHash)
        failures.push({ index, code: 'CONTENT_CHANGED' });
      if (!snapshot.meta.settings.categories.includes(label.category))
        failures.push({ index, code: 'UNKNOWN_CATEGORY' });
      if (seen.has(label.itemId))
        failures.push({ index, code: 'INVALID_LABEL' });
      seen.add(label.itemId);
      const evidence =
        label.evidence === null || stored.item.text.includes(label.evidence)
          ? label.evidence
          : null;
      if (label.evidence !== null && evidence === null) droppedEvidence++;
      assessments.push(
        AssessmentSchema.parse({
          assessmentId: this.uuid(),
          submissionId: file.submissionId,
          itemId: label.itemId,
          source: file.source,
          category: label.category,
          risk: label.risk,
          reason: label.reason,
          confidence: label.confidence,
          evidence,
          createdAt: time,
        }),
      );
    }
    if (failures.length) throw new LabelValidationError(failures);
    if (options.dryRun)
      return {
        submissionId: file.submissionId,
        accepted: assessments.length,
        duplicate: false,
        dryRun: true,
        droppedEvidence,
        revision: snapshot.runtime.revision,
      };
    return this.store.write(async (tx) => {
      const prior = await tx.submissions.get(file.submissionId);
      if (prior) {
        if (prior.contentHash !== hash)
          throw new WorkspaceError('SUBMISSION_CONFLICT');
        return {
          submissionId: file.submissionId,
          accepted: prior.labelCount,
          duplicate: true,
          dryRun: false,
          droppedEvidence,
          revision: (await tx.runtime.get()).revision,
        };
      }
      const meta = await tx.meta.get();
      if (
        canonicalJson(meta.settings.categories) !==
        canonicalJson(snapshot.meta.settings.categories)
      )
        throw new WorkspaceError('INVALID_LABELS');
      for (const [index, label] of file.labels.entries()) {
        const current = await tx.items.get(label.itemId);
        if (!current || current.item.text !== snapshot.items[index]!.item.text)
          throw new WorkspaceError('CONTENT_CHANGED');
      }
      await tx.submissions.add({
        submissionId: file.submissionId,
        contentHash: hash,
        source: file.source,
        receivedAt: time,
        labelCount: assessments.length,
      });
      await tx.assessments.append(assessments);
      const runtime = await tx.runtime.get();
      await tx.runtime.set({ revision: runtime.revision + 1 });
      await tx.meta.set({ ...meta, updatedAt: time });
      return {
        submissionId: file.submissionId,
        accepted: assessments.length,
        duplicate: false,
        dryRun: false,
        droppedEvidence,
        revision: runtime.revision + 1,
      };
    });
  }
  async appendAssessment(input: unknown): Promise<void> {
    const parsed = AssessmentSchema.safeParse(input);
    if (
      !parsed.success ||
      parsed.data.source.kind === 'agent' ||
      parsed.data.submissionId !== null
    )
      throw new WorkspaceError('INVALID_LABEL');
    const assessment = parsed.data;
    const time = this.now().toISOString();
    await this.store.write(async (tx) => {
      const meta = await tx.meta.get();
      if (assessment.source.kind === 'fixture' && meta.kind !== 'demo')
        throw new WorkspaceError('FIXTURE_NOT_ALLOWED');
      if (!(await tx.items.get(assessment.itemId)))
        throw new WorkspaceError('UNKNOWN_ITEM');
      if (!meta.settings.categories.includes(assessment.category))
        throw new WorkspaceError('UNKNOWN_CATEGORY');
      await tx.assessments.append([assessment]);
      const runtime = await tx.runtime.get();
      await tx.runtime.set({ revision: runtime.revision + 1 });
      await tx.meta.set({ ...meta, updatedAt: time });
    });
  }
  async summary(): Promise<Summary> {
    return this.store.read(async (tx) => {
      const workspace = await readWorkspace(tx),
        runtime = await tx.runtime.get();
      const states = deriveState(workspace);
      const complete = new Set(
        workspace.imports
          .filter((record) => record.status === 'complete')
          .map((record) => record.id),
      );
      const items = (await records(tx.items))
        .filter((stored) => !stored.importId || complete.has(stored.importId))
        .map((stored) => stored.item);
      const accounts = new Map<string, number>();
      const kinds = { post: 0, reply: 0, quote: 0, repost: 0, comment: 0 };
      const decisions = { keep: 0, delete: 0, later: 0, undecided: 0 };
      const outcomes = { 'deleted-by-user': 0, skipped: 0, unknown: 0 };
      let withoutAgentAssessment = 0;
      const sources = new Map<
        string,
        { kind: Assessment['source']['kind']; name: string; count: number }
      >();
      const decisionSources = new Map<'web-review' | 'local-review', number>();
      const latestDecisions = new Map(
        workspace.decisionEvents.map((event) => [event.itemId, event]),
      );
      for (const item of items) {
        accounts.set(
          item.account.key,
          (accounts.get(item.account.key) ?? 0) + 1,
        );
        kinds[item.kind]++;
        const state = states.get(item.id)!;
        decisions[state.decision]++;
        outcomes[state.outcome]++;
        if (
          !state.assessments.some(
            (assessment) => assessment.source.kind === 'agent',
          )
        )
          withoutAgentAssessment++;
        for (const assessment of state.assessments) {
          const key = canonicalJson([
            assessment.source.kind,
            assessment.source.name,
          ]);
          const source = sources.get(key) ?? {
            kind: assessment.source.kind,
            name: assessment.source.name,
            count: 0,
          };
          source.count++;
          sources.set(key, source);
        }
        const latest = latestDecisions.get(item.id);
        if (latest)
          decisionSources.set(
            latest.source.via,
            (decisionSources.get(latest.source.via) ?? 0) + 1,
          );
      }
      return SummarySchema.parse({
        workspaceId: workspace.id,
        schemaVersion: 2,
        kind: workspace.kind,
        revision: runtime.revision,
        counts: workspace.counts,
        accounts: [...accounts].map(([key, count]) => ({ key, items: count })),
        kinds,
        assessments: [...sources.values()],
        withoutAgentAssessment,
        decisions,
        decisionSources: [...decisionSources].map(([via, count]) => ({
          via,
          count,
        })),
        outcomes,
        lastImportAt: workspace.imports.at(-1)?.importedAt ?? null,
        lastBackupAt: workspace.lastBackupAt,
      });
    });
  }
}

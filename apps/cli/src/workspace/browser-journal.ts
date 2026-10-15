import type { DatabaseSync } from 'node:sqlite';
import {
  BrowserRunSchema,
  BrowserAttemptSchema,
  WORKSPACE_SCHEMA_VERSION,
} from '@socialprune/core';
import type { DecisionEvent, Item } from '@socialprune/core';
import type { WriteTransaction } from '@socialprune/core/workspace/store';
import { CliError } from '../cli/errors.ts';

export type BrowserAction = 'delete-post' | 'undo-repost' | 'verify';
export type AttemptState =
  | 'withdrawn'
  | 'sending'
  | 'deleted'
  | 'not-found'
  | 'failed'
  | 'ambiguous'
  | 'not-deleted'
  | 'still-gone'
  | 'reappeared';
export interface BrowserAttempt {
  seq: number;
  attemptId: string;
  runId: string;
  itemId: string;
  action: BrowserAction;
  state: AttemptState;
  settles: string | null;
  at: string;
  code: string | null;
  receipt?: { method: string; path: string; status: number; shape: string[] };
}
export interface BrowserRequest {
  runId?: string;
  requestId: string;
  method: string;
  host: string;
  path: string;
  status: number | null;
  operation?: string | null;
}
export interface ProfileReport {
  accountBefore: string | null;
  accountAfter: string | null;
  extensionsBefore: number;
  extensionsAfter: number;
  changedFiles: string[];
  unexpectedRequests: BrowserRequest[];
}
export interface BrowserRun {
  startedBy?: 'agent-on-order';
  orderSha256?: string;
  acceptedBy?: 'automatic-check';
  pageOpens?: number;
  lastPageOpenedAt?: string | null;
  canaryAcceptedAt?: string | null;
  runId: string;
  platform: 'x' | 'instagram';
  accountKey: string;
  mode: 'delete' | 'verify';
  planHash: string | null;
  startedAt: string;
  endedAt: string | null;
  endReason:
    | 'done'
    | 'daily-cap'
    | 'stopped-by-person'
    | 'error'
    | 'platform-check'
    | null;
  bodyShapes: Record<string, string[]>;
  profileReport: ProfileReport | null;
  ownerPid?: number;
}
export interface PlannedEntry {
  item: Item;
  decision: DecisionEvent;
  action: 'delete-post' | 'undo-repost';
}

export const BROWSER_JOURNAL_LAYOUT = `
CREATE TABLE IF NOT EXISTS browser_runs (
  run_id TEXT PRIMARY KEY, account_key TEXT NOT NULL, ended_at TEXT,
  data TEXT NOT NULL CHECK(json_valid(data))
) STRICT;
CREATE UNIQUE INDEX IF NOT EXISTS browser_runs_active ON browser_runs(account_key) WHERE ended_at IS NULL;
CREATE TABLE IF NOT EXISTS browser_attempts (
  seq INTEGER PRIMARY KEY, attempt_id TEXT NOT NULL UNIQUE, run_id TEXT NOT NULL,
  item_id TEXT NOT NULL, state TEXT NOT NULL, settles TEXT UNIQUE,
  data TEXT NOT NULL CHECK(json_valid(data)),
  FOREIGN KEY(run_id) REFERENCES browser_runs(run_id),
  FOREIGN KEY(settles) REFERENCES browser_attempts(attempt_id)
) STRICT;
CREATE INDEX IF NOT EXISTS browser_attempts_item ON browser_attempts(item_id, seq);
CREATE TABLE IF NOT EXISTS browser_requests (
  seq INTEGER PRIMARY KEY, run_id TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)),
  FOREIGN KEY(run_id) REFERENCES browser_runs(run_id)
) STRICT;
CREATE TABLE IF NOT EXISTS browser_order_audit (
  run_id TEXT PRIMARY KEY REFERENCES browser_runs(run_id),
  started_by TEXT NOT NULL CHECK(started_by='agent-on-order'), order_sha256 TEXT NOT NULL,
  accepted_by TEXT CHECK(accepted_by='automatic-check'), data TEXT NOT NULL CHECK(json_valid(data))
) STRICT;
CREATE TRIGGER IF NOT EXISTS browser_runs_finish_once BEFORE UPDATE ON browser_runs
WHEN (OLD.ended_at IS NOT NULL AND NOT (json_extract(OLD.data,'$.mode') IN ('fill','context') AND json_extract(OLD.data,'$.endReason')='canary' AND json_extract(OLD.data,'$.canaryAcceptedAt') IS NULL AND json_extract(NEW.data,'$.canaryAcceptedAt') IS NOT NULL AND NEW.ended_at=OLD.ended_at AND json_remove(NEW.data,'$.canaryAcceptedAt')=json_remove(OLD.data,'$.canaryAcceptedAt'))) OR (NEW.ended_at IS NULL AND NOT (OLD.ended_at IS NULL AND json_remove(NEW.data,'$.pageOpens','$.lastPageOpenedAt')=json_remove(OLD.data,'$.pageOpens','$.lastPageOpenedAt') AND json_extract(NEW.data,'$.pageOpens')=coalesce(json_extract(OLD.data,'$.pageOpens'),0)+1)) OR NEW.run_id != OLD.run_id OR NEW.account_key != OLD.account_key
OR json_extract(NEW.data,'$.startedAt') != json_extract(OLD.data,'$.startedAt')
OR json_extract(NEW.data,'$.mode') != json_extract(OLD.data,'$.mode')
OR json_extract(NEW.data,'$.planHash') IS NOT json_extract(OLD.data,'$.planHash')
BEGIN SELECT RAISE(ABORT,'run-end-once'); END;
CREATE TRIGGER IF NOT EXISTS browser_runs_no_delete BEFORE DELETE ON browser_runs BEGIN SELECT RAISE(ABORT,'append-only'); END;
CREATE TRIGGER IF NOT EXISTS browser_attempts_no_update BEFORE UPDATE ON browser_attempts BEGIN SELECT RAISE(ABORT,'append-only'); END;
CREATE TRIGGER IF NOT EXISTS browser_attempts_no_delete BEFORE DELETE ON browser_attempts BEGIN SELECT RAISE(ABORT,'append-only'); END;
CREATE TRIGGER IF NOT EXISTS browser_requests_no_update BEFORE UPDATE ON browser_requests BEGIN SELECT RAISE(ABORT,'append-only'); END;
CREATE TRIGGER IF NOT EXISTS browser_requests_no_delete BEFORE DELETE ON browser_requests BEGIN SELECT RAISE(ABORT,'append-only'); END;
`;

function decode<T>(rows: Record<string, unknown>[]): T[] {
  return rows.map((row) => JSON.parse(String(row.data)) as T);
}
export function journalExists(db: DatabaseSync): boolean {
  return Boolean(
    db
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type='table' AND name='browser_runs'",
      )
      .get(),
  );
}
export function readJournal(db: DatabaseSync): {
  runs: BrowserRun[];
  attempts: BrowserAttempt[];
  requests: BrowserRequest[];
} {
  if (!journalExists(db)) return { runs: [], attempts: [], requests: [] };
  return {
    runs: decode<BrowserRun>(
      db.prepare('SELECT data FROM browser_runs ORDER BY rowid').all(),
    ).map((run) => {
      if (
        !db
          .prepare(
            "SELECT name FROM sqlite_schema WHERE type='table' AND name='browser_order_audit'",
          )
          .get()
      )
        return run;
      const row = db
        .prepare('SELECT data FROM browser_order_audit WHERE run_id=?')
        .get(run.runId);
      return row
        ? {
            ...run,
            ...(JSON.parse(String(row.data)) as Record<string, unknown>),
          }
        : run;
    }),
    attempts: decode<BrowserAttempt>(
      db.prepare('SELECT data FROM browser_attempts ORDER BY seq').all(),
    ),
    requests: decode<BrowserRequest>(
      db.prepare('SELECT data FROM browser_requests ORDER BY seq').all(),
    ),
  };
}

/** CLI-only capability. It cannot create decisions or choose other outcome values. */
export class BrowserOutcomeWriter {
  private readonly db: DatabaseSync;
  private readonly transact: <T>(
    operation: (tx: WriteTransaction) => Promise<T>,
  ) => Promise<T>;
  constructor(
    db: DatabaseSync,
    transact: <T>(
      operation: (tx: WriteTransaction) => Promise<T>,
    ) => Promise<T>,
  ) {
    this.db = db;
    this.transact = transact;
  }

  async begin(run: BrowserRun): Promise<void> {
    BrowserRunSchema.parse(run);
    await this.transact(async (tx) => {
      this.db.exec(BROWSER_JOURNAL_LAYOUT);
      const meta = await tx.meta.get();
      await tx.meta.set({ ...meta, schemaVersion: WORKSPACE_SCHEMA_VERSION });
      const active = decode<BrowserRun>(
        this.db
          .prepare(
            'SELECT data FROM browser_runs WHERE account_key=? AND ended_at IS NULL',
          )
          .all(run.accountKey),
      )[0];
      if (active) {
        let alive = false;
        if (active.ownerPid) {
          try {
            process.kill(active.ownerPid, 0);
            alive = true;
          } catch (error) {
            if (!(
              error &&
              typeof error === 'object' &&
              'code' in error &&
              error.code === 'ESRCH'
            ))
              alive = true;
          }
        }
        // Only a positively dead prior process permits recovery. Old records
        // without ownership metadata fail closed rather than invent ownership.
        if (alive || !active.ownerPid) throw new CliError('WORKSPACE_BUSY');
        for (const attempt of readJournal(this.db).attempts)
          if (
            attempt.runId === active.runId &&
            attempt.state === 'sending' &&
            !this.db
              .prepare('SELECT seq FROM browser_attempts WHERE settles=?')
              .get(attempt.attemptId)
          )
            this.append({
              attemptId: crypto.randomUUID(),
              runId: active.runId,
              itemId: attempt.itemId,
              action: attempt.action,
              state: 'ambiguous',
              settles: attempt.attemptId,
              at: run.startedAt,
              code: 'PROCESS_LOST',
            });
        const recovered = {
          ...active,
          endedAt: run.startedAt,
          endReason: 'error',
        };
        this.db
          .prepare('UPDATE browser_runs SET ended_at=?,data=? WHERE run_id=?')
          .run(run.startedAt, JSON.stringify(recovered), active.runId);
      }
      this.db
        .prepare('INSERT INTO browser_runs VALUES(?,?,NULL,?)')
        .run(run.runId, run.accountKey, JSON.stringify(run));
      const runtime = await tx.runtime.get();
      await tx.runtime.set({ revision: runtime.revision + 1 });
      await Promise.resolve();
    });
  }
  async finish(run: BrowserRun): Promise<void> {
    if (!run.endedAt || !run.endReason) throw new CliError('WORKSPACE_INVALID');
    await this.transact(async (tx) => {
      const prior = readJournal(this.db).runs.find(
        (value) => value.runId === run.runId,
      );
      run = {
        ...run,
        ...(prior?.pageOpens !== undefined
          ? {
              pageOpens: prior.pageOpens,
              lastPageOpenedAt: prior.lastPageOpenedAt,
            }
          : {}),
      };
      const result = this.db
        .prepare(
          'UPDATE browser_runs SET ended_at=?, data=? WHERE run_id=? AND ended_at IS NULL',
        )
        .run(run.endedAt, JSON.stringify(run), run.runId);
      if (Number(result.changes) !== 1) throw new CliError('WORKSPACE_INVALID');
      const runtime = await tx.runtime.get();
      await tx.runtime.set({ revision: runtime.revision + 1 });
      await Promise.resolve();
    });
  }
  async pageOpen(runId: string, at: string): Promise<void> {
    await this.transact(async (tx) => {
      const run = await tx.browserRuns.get(runId);
      if (!run || run.endedAt) throw new CliError('WORKSPACE_INVALID');
      await tx.browserRuns.put({
        ...run,
        pageOpens: (run.pageOpens ?? 0) + 1,
        lastPageOpenedAt: at,
      });
      const runtime = await tx.runtime.get();
      await tx.runtime.set({ revision: runtime.revision + 1 });
    });
  }
  private append(input: Omit<BrowserAttempt, 'seq'>): BrowserAttempt {
    const seq = Number(
      this.db
        .prepare('SELECT coalesce(max(seq),0)+1 AS seq FROM browser_attempts')
        .get()!.seq,
    );
    const value = BrowserAttemptSchema.parse({ ...input, seq });
    this.db
      .prepare(
        'INSERT INTO browser_attempts(seq,attempt_id,run_id,item_id,state,settles,data) VALUES(?,?,?,?,?,?,?)',
      )
      .run(
        seq,
        input.attemptId,
        input.runId,
        input.itemId,
        input.state,
        input.settles,
        JSON.stringify(value),
      );
    return value as BrowserAttempt;
  }
  private async eligible(
    tx: WriteTransaction,
    row: PlannedEntry,
  ): Promise<boolean> {
    const item = await tx.items.get(row.item.id);
    const state = await tx.state.get(row.item.id);
    let decision: DecisionEvent | undefined;
    for await (const event of tx.decisionEvents.iterate())
      if (event.itemId === row.item.id) decision = event;
    const imported = item ? await tx.imports.get(item.importId) : undefined;
    return Boolean(
      item &&
      imported?.status === 'complete' &&
      item.item.platform === 'x' &&
      item.item.account.key === row.item.account.key &&
      item.item.kind === row.item.kind &&
      item.item.createdAt === row.item.createdAt &&
      item.item.text === row.item.text &&
      state?.outcome === 'unknown' &&
      state.decision === 'delete' &&
      decision?.value === 'delete' &&
      decision.source.kind === 'human' &&
      decision.eventId === row.decision.eventId,
    );
  }
  async check(
    row: PlannedEntry,
    runId: string,
    at: string,
    sending: boolean,
  ): Promise<BrowserAttempt | null> {
    return this.transact(async (tx) => {
      const input = {
        attemptId: crypto.randomUUID(),
        runId,
        itemId: row.item.id,
        action: row.action,
        at,
        settles: null,
        code: null,
      };
      if (!(await this.eligible(tx, row))) {
        const runtime = await tx.runtime.get();
        await tx.runtime.set({ revision: runtime.revision + 1 });
        return this.append({ ...input, state: 'withdrawn' });
      }
      if (!sending) return null;
      const attempts = readJournal(this.db).attempts.filter(
        (a) => a.itemId === row.item.id,
      );
      const open = attempts.some(
        (a) =>
          (a.state === 'sending' || a.state === 'ambiguous') &&
          !attempts.some((other) => other.settles === a.attemptId),
      );
      if (open) throw new CliError('RUN_STOPPED');
      const runtime = await tx.runtime.get();
      await tx.runtime.set({ revision: runtime.revision + 1 });
      return this.append({ ...input, state: 'sending' });
    });
  }
  async record(input: Omit<BrowserAttempt, 'seq'>): Promise<BrowserAttempt> {
    if (
      input.settles ||
      (input.state !== 'not-found' &&
        !(
          input.action === 'verify' &&
          ['not-deleted', 'still-gone'].includes(input.state)
        ))
    )
      throw new CliError('WORKSPACE_INVALID');
    return this.transact(async (tx) => {
      const runtime = await tx.runtime.get();
      await tx.runtime.set({ revision: runtime.revision + 1 });
      await Promise.resolve();
      return this.append(input);
    });
  }
  async settle(
    input: Omit<BrowserAttempt, 'seq'>,
    outcome?: 'deleted-via-browser' | 'unknown',
  ): Promise<BrowserAttempt> {
    return this.transact(async (tx) => {
      if (
        (outcome === 'deleted-via-browser' && input.state !== 'deleted') ||
        (outcome === 'unknown' && input.state !== 'reappeared')
      )
        throw new CliError('WORKSPACE_INVALID');
      if (input.settles) {
        const prior = decode<BrowserAttempt>(
          this.db
            .prepare('SELECT data FROM browser_attempts WHERE attempt_id=?')
            .all(input.settles),
        )[0];
        if (
          !prior ||
          prior.itemId !== input.itemId ||
          prior.runId !== input.runId ||
          prior.action !== input.action ||
          !['sending', 'ambiguous'].includes(prior.state)
        )
          throw new CliError('WORKSPACE_INVALID');
      } else if (
        input.action !== 'verify' ||
        !['still-gone', 'reappeared'].includes(input.state)
      ) {
        throw new CliError('WORKSPACE_INVALID');
      }
      const attempt = this.append(input);
      if (!outcome) {
        const runtime = await tx.runtime.get();
        await tx.runtime.set({ revision: runtime.revision + 1 });
      }
      if (outcome) {
        const state = await tx.state.get(input.itemId);
        if (!state) throw new CliError('WORKSPACE_INVALID');
        if (outcome === 'unknown' && state.outcome !== 'deleted-via-browser')
          throw new CliError('OUTCOME_FINAL');
        const runtime = await tx.runtime.get();
        const meta = await tx.meta.get();
        await tx.outcomeEvents.append([
          {
            eventId: crypto.randomUUID(),
            seq: runtime.lastEventSeq + 1,
            itemId: input.itemId,
            value: outcome,
            previous: state.outcome,
            recordedAt: input.at,
            source: { kind: 'human', via: 'browser-x' },
            action: {
              id: input.attemptId,
              kind: 'single',
              size: 1,
              reverts: null,
            },
          },
        ]);
        await tx.state.put({ ...state, outcome });
        await tx.runtime.set({
          revision: runtime.revision + 1,
          lastEventSeq: runtime.lastEventSeq + 1,
        });
        await tx.meta.set({ ...meta, updatedAt: input.at });
      }
      return attempt;
    });
  }
  async request(runId: string, record: BrowserRequest): Promise<void> {
    await this.transact(async () => {
      this.db
        .prepare('INSERT INTO browser_requests(run_id,data) VALUES(?,?)')
        .run(runId, JSON.stringify({ ...record, runId }));
      await Promise.resolve();
    });
  }
  async recordOrder(runId: string, sha256: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new CliError('ORDER_INVALID');
    await this.transact(async () => {
      this.db.exec(BROWSER_JOURNAL_LAYOUT);
      const run = this.db
        .prepare('SELECT data FROM browser_runs WHERE run_id=?')
        .get(runId);
      if (
        !run ||
        (JSON.parse(String(run.data)) as { mode: string }).mode !== 'fill'
      )
        throw new CliError('ORDER_INVALID');
      this.db
        .prepare('INSERT INTO browser_order_audit VALUES(?,?,?,NULL,?)')
        .run(
          runId,
          'agent-on-order',
          sha256,
          JSON.stringify({ startedBy: 'agent-on-order', orderSha256: sha256 }),
        );
      await Promise.resolve();
    });
  }
  async recordAutomaticAcceptance(
    runId: string,
    at: string,
    counts: readonly {
      stored: { textLength: number; photos: number; videos: number };
      shown: { textLength: number; photos: number; videos: number };
      matches: boolean;
    }[],
  ): Promise<void> {
    await this.transact(async (tx) => {
      const run = this.db
        .prepare('SELECT data FROM browser_runs WHERE run_id=?')
        .get(runId);
      const value = run
        ? BrowserRunSchema.parse(JSON.parse(String(run.data)))
        : null;
      const attempts = readJournal(this.db).attempts.filter(
          (attempt) => attempt.runId === runId,
        ),
        sending = attempts.filter((attempt) => attempt.state === 'sending');
      if (
        !value ||
        value.mode !== 'fill' ||
        value.endReason !== 'canary' ||
        value.canaryAcceptedAt ||
        !value.endedAt ||
        Date.parse(at) < Date.parse(value.endedAt) ||
        sending.length < 1 ||
        sending.length > 5 ||
        counts.length !== sending.length ||
        counts.some(
          (count) =>
            !count.matches ||
            JSON.stringify(count.stored) !== JSON.stringify(count.shown),
        ) ||
        sending.some(
          (send) =>
            !attempts.some(
              (attempt) =>
                attempt.settles === send.attemptId &&
                ['read', 'not-found', 'tombstone', 'unavailable'].includes(
                  attempt.state,
                ),
            ),
        )
      )
        throw new CliError('CANARY_MISMATCH');
      const row = this.db
        .prepare('SELECT data FROM browser_order_audit WHERE run_id=?')
        .get(runId);
      if (!row) throw new CliError('ORDER_INVALID');
      this.db
        .prepare('UPDATE browser_runs SET data=? WHERE run_id=?')
        .run(JSON.stringify({ ...value, canaryAcceptedAt: at }), runId);
      this.db
        .prepare(
          'UPDATE browser_order_audit SET accepted_by=?,data=? WHERE run_id=? AND accepted_by IS NULL',
        )
        .run(
          'automatic-check',
          JSON.stringify({
            ...(JSON.parse(String(row.data)) as Record<string, unknown>),
            acceptedBy: 'automatic-check',
            canaryCounts: counts,
          }),
          runId,
        );
      const runtime = await tx.runtime.get();
      await tx.runtime.set({ revision: runtime.revision + 1 });
      await Promise.resolve();
    });
  }
  async recordCanaryMismatch(runId: string, counts: unknown): Promise<void> {
    await this.transact(async () => {
      const row = this.db
        .prepare('SELECT data FROM browser_order_audit WHERE run_id=?')
        .get(runId);
      if (!row) throw new CliError('ORDER_INVALID');
      this.db
        .prepare(
          'UPDATE browser_order_audit SET data=? WHERE run_id=? AND accepted_by IS NULL',
        )
        .run(
          JSON.stringify({
            ...(JSON.parse(String(row.data)) as Record<string, unknown>),
            displayEndReason: 'canary-mismatch',
            canaryCounts: counts,
          }),
          runId,
        );
      await Promise.resolve();
    });
  }
}

import type { DatabaseSync } from 'node:sqlite';
import {
  BrowserRunSchema,
  validateBrowserRunUpdate,
  BrowserAttemptSchema,
  WORKSPACE_SCHEMA_VERSION,
} from '@socialprune/core';
import type {
  DecisionEvent,
  Item,
  BrowserProfileReport,
} from '@socialprune/core';
import type { WriteTransaction } from '@socialprune/core/workspace/store';
import { InstagramContextWriter } from '@socialprune/core/workspace/instagram-context-writer';
import { CliError, CLI_ERRORS } from '../cli/errors.ts';
import {
  INSTAGRAM_DELETE_PACE,
  instagramDeletionState,
} from './instagram-delete-pace.ts';
function warningDay(at: string, zone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
}

export const X_WARNING_REASONS = [
  'http-429',
  'limit-notice',
  'warning-notice',
] as const;
export function xWarningReason(
  error: unknown,
): import('@socialprune/core').BrowserRun['warningKind'] | null {
  if (error instanceof CliError && error.code === 'MEDIA_RATE_LIMIT')
    return 'http-429';
  if (!(error instanceof CliError) || error.code !== 'PLATFORM_CHECK')
    return null;
  if (error.reason === 'http-429') return 'http-429';
  if (error.reason === 'marker-rate-limit') return 'limit-notice';
  if (error.reason === 'notice-text') return 'warning-notice';
  if (error.reason === 'marker-locked') return 'warning-notice';
  return null;
}
export const X_WARNING_LAYOUT = `
CREATE TABLE IF NOT EXISTS browser_x_warnings (
  seq INTEGER PRIMARY KEY, run_id TEXT NOT NULL UNIQUE,
  account_key TEXT NOT NULL, at TEXT NOT NULL, zone TEXT NOT NULL, day TEXT NOT NULL,
  reason TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS browser_x_warning_ack (
  run_id TEXT PRIMARY KEY REFERENCES browser_x_warnings(run_id), at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS browser_x_warnings_account ON browser_x_warnings(account_key,seq);
CREATE TRIGGER IF NOT EXISTS browser_x_warnings_no_update BEFORE UPDATE ON browser_x_warnings BEGIN SELECT RAISE(ABORT,'append-only'); END;
CREATE TRIGGER IF NOT EXISTS browser_x_warnings_no_delete BEFORE DELETE ON browser_x_warnings BEGIN SELECT RAISE(ABORT,'append-only'); END;
CREATE TRIGGER IF NOT EXISTS browser_x_warning_ack_no_update BEFORE UPDATE ON browser_x_warning_ack BEGIN SELECT RAISE(ABORT,'append-only'); END;
CREATE TRIGGER IF NOT EXISTS browser_x_warning_ack_no_delete BEFORE DELETE ON browser_x_warning_ack BEGIN SELECT RAISE(ABORT,'append-only'); END;
`;
const warningProfiles = new WeakMap<DatabaseSync, string>();
const instagramWarningProfiles = new WeakMap<DatabaseSync, string>();
type WarningPlatform = 'x' | 'instagram';
export const INSTAGRAM_WARNING_LAYOUT = X_WARNING_LAYOUT.replaceAll(
  'browser_x_',
  'browser_instagram_',
);
const warningTables = (platform: WarningPlatform) =>
  platform === 'x'
    ? {
        warnings: 'browser_x_warnings',
        ack: 'browser_x_warning_ack',
        layout: X_WARNING_LAYOUT,
      }
    : {
        warnings: 'browser_instagram_warnings',
        ack: 'browser_instagram_warning_ack',
        layout: INSTAGRAM_WARNING_LAYOUT,
      };
const warningCode = (platform: WarningPlatform, day = false) =>
  platform === 'x'
    ? day
      ? 'X_WARNING_DAY'
      : 'X_WARNING_CARD_REQUIRED'
    : day
      ? 'IG_WARNING_DAY'
      : 'IG_WARNING_CARD_REQUIRED';

export type BrowserAction =
  'delete-post' | 'undo-repost' | 'delete-comment' | 'verify';
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
  instagramWarning?: import('@socialprune/core').BrowserRun['instagramWarning'];
  pageDays?: Record<string, number>;
  pageZone?: string;
  warningKind?: import('@socialprune/core').BrowserRun['warningKind'];
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
    | 'canary'
    | null;
  bodyShapes: Record<string, string[]>;
  profileReport: ProfileReport | null;
  ownerPid?: number;
}
export interface PlannedEntry {
  context?: import('@socialprune/core').InstagramContext;
  item: Item;
  decision: DecisionEvent;
  action: 'delete-post' | 'undo-repost' | 'delete-comment';
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
WHEN (OLD.ended_at IS NOT NULL AND NOT ((json_extract(OLD.data,'$.mode') IN ('fill','context') OR (json_extract(OLD.data,'$.platform')='instagram' AND json_extract(OLD.data,'$.mode')='delete')) AND json_extract(OLD.data,'$.endReason')='canary' AND json_extract(OLD.data,'$.canaryAcceptedAt') IS NULL AND json_extract(NEW.data,'$.canaryAcceptedAt') IS NOT NULL AND NEW.ended_at=OLD.ended_at AND json_remove(NEW.data,'$.canaryAcceptedAt')=json_remove(OLD.data,'$.canaryAcceptedAt'))) OR (NEW.ended_at IS NULL AND NOT (OLD.ended_at IS NULL AND ((json_remove(NEW.data,'$.pageOpens','$.lastPageOpenedAt','$.pageDays','$.pageZone')=json_remove(OLD.data,'$.pageOpens','$.lastPageOpenedAt','$.pageDays','$.pageZone') AND json_extract(NEW.data,'$.pageOpens')=coalesce(json_extract(OLD.data,'$.pageOpens'),0)+1) OR (json_extract(OLD.data,'$.platform')='instagram' AND json_extract(OLD.data,'$.instagramWarning') IS NULL AND json_extract(NEW.data,'$.instagramWarning') IS NOT NULL AND json_remove(NEW.data,'$.instagramWarning')=OLD.data)))) OR NEW.run_id != OLD.run_id OR NEW.account_key != OLD.account_key
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
  bindXWarningProfile(profile: string, platform: WarningPlatform = 'x'): void {
    (platform === 'x' ? warningProfiles : instagramWarningProfiles).set(
      this.db,
      profile,
    );
  }
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

  async recordXWarning(
    runId: string,
    at: string,
    zone: string,
    reason: string,
    platform: WarningPlatform = 'x',
  ): Promise<void> {
    const tables = warningTables(platform);
    if (!X_WARNING_REASONS.some((value) => value === reason))
      throw new CliError('WORKSPACE_INVALID');
    await this.transact(async (tx) => {
      this.db.exec(tables.layout);
      const run = await tx.browserRuns.get(runId);
      if (!run || run.platform !== platform)
        throw new CliError('WORKSPACE_INVALID');
      this.db
        .prepare(
          `INSERT OR IGNORE INTO ${tables.warnings}(run_id,account_key,at,zone,day,reason) VALUES(?,?,?,?,?,?)`,
        )
        .run(runId, run.accountKey, at, zone, warningDay(at, zone), reason);
      if (platform === 'instagram' && !run.endedAt && !run.instagramWarning)
        await tx.browserRuns.put(
          BrowserRunSchema.parse({
            ...run,
            instagramWarning: { kind: reason, at, zone },
          }),
        );
      const runtime = await tx.runtime.get();
      await tx.runtime.set({ revision: runtime.revision + 1 });
    });
    const warningProfile = (
      platform === 'x' ? warningProfiles : instagramWarningProfiles
    ).get(this.db);
    if (warningProfile) {
      const { writeXWarningFile } = await import('./x-warning-file.ts');
      await writeXWarningFile(
        warningProfile,
        {
          runId,
          kind: reason as 'http-429' | 'limit-notice' | 'warning-notice',
          day: warningDay(at, zone),
          zone,
          createdAt: at,
        },
        platform,
      );
    }
  }
  async xWarning(
    accountKey: string,
    runId?: string,
    platform: WarningPlatform = 'x',
  ): Promise<{
    runId: string;
    at: string;
    zone: string;
    day: string;
    kind: string;
    acknowledged: boolean;
  } | null> {
    const tables = warningTables(platform);
    return this.transact(async () => {
      await Promise.resolve();
      if (
        !this.db
          .prepare(
            `SELECT name FROM sqlite_schema WHERE name='${tables.warnings}'`,
          )
          .get()
      )
        return null;
      const row = this.db
        .prepare(
          `SELECT w.*, a.at AS acknowledged_at FROM ${tables.warnings} w LEFT JOIN ${tables.ack} a ON a.run_id=w.run_id WHERE w.account_key=? AND (? IS NULL OR w.run_id=?) ORDER BY w.at DESC,w.seq DESC LIMIT 1`,
        )
        .get(accountKey, runId ?? null, runId ?? null);
      return row
        ? {
            runId: String(row.run_id),
            at: String(row.at),
            zone: String(row.zone),
            day: String(row.day),
            kind: String(row.reason),
            acknowledged: row.acknowledged_at !== null,
          }
        : null;
    });
  }
  async rebuildXWarnings(): Promise<void> {
    const runs = readJournal(this.db).runs;
    const zone = await this.transact(
      async (tx) =>
        (await tx.meta.get()).settings.timeZone ??
        Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    for (const run of runs)
      if (
        run.platform === 'x' &&
        run.warningKind &&
        run.endedAt &&
        run.endReason === 'platform-check'
      )
        await this.recordXWarning(
          run.runId,
          run.endedAt,
          zone,
          run.warningKind,
        );
    for (const run of runs)
      if (
        run.platform === 'instagram' &&
        run.instagramWarning &&
        (!run.endedAt || run.endReason === 'platform-check')
      )
        await this.recordXWarning(
          run.runId,
          run.instagramWarning.at,
          run.instagramWarning.zone,
          run.instagramWarning.kind,
          'instagram',
        );
  }
  async warningKind(
    runId: string,
  ): Promise<import('@socialprune/core').BrowserRun['warningKind']> {
    return this.transact(async () => {
      await Promise.resolve();
      if (
        !this.db
          .prepare(
            "SELECT name FROM sqlite_schema WHERE name='browser_x_warnings'",
          )
          .get()
      )
        return undefined;
      const row = this.db
        .prepare('SELECT reason FROM browser_x_warnings WHERE run_id=?')
        .get(runId);
      return row?.reason as import('@socialprune/core').BrowserRun['warningKind'];
    });
  }
  async mirrorXWarning(
    accountKey: string,
    profile: string,
    platform: WarningPlatform = 'x',
  ): Promise<void> {
    const warning = await this.xWarning(accountKey, undefined, platform);
    if (!warning || warning.acknowledged) return;
    const { lstat } = await import('node:fs/promises');
    const exists = await lstat(profile).catch((error: unknown) => {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      )
        return null;
      throw error;
    });
    if (!exists) return;
    const { writeXWarningFile } = await import('./x-warning-file.ts');
    await writeXWarningFile(
      profile,
      {
        runId: warning.runId,
        kind: warning.kind as 'http-429' | 'limit-notice' | 'warning-notice',
        day: warning.day,
        zone: warning.zone,
        createdAt: warning.at,
      },
      platform,
    );
  }
  async adoptXProfileWarning(
    accountKey: string,
    warning: import('./x-warning-file.ts').XWarningFile,
    platform: WarningPlatform = 'x',
  ): Promise<void> {
    const tables = warningTables(platform);
    await this.transact(async (tx) => {
      let account = false;
      for await (const imported of tx.imports.iterate())
        if (
          imported.platform === platform &&
          imported.accounts.some((value) => value.key === accountKey)
        )
          account = true;
      if (!account)
        for await (const { item } of tx.items.iterate())
          if (item.account.key === accountKey && item.platform === platform) {
            account = true;
            break;
          }
      if (!account) throw new CliError('ACCOUNT_REQUIRED');
      this.db.exec(tables.layout);
      this.db
        .prepare(
          `INSERT OR IGNORE INTO ${tables.warnings}(run_id,account_key,at,zone,day,reason) VALUES(?,?,?,?,?,?)`,
        )
        .run(
          warning.runId,
          accountKey,
          warning.createdAt,
          warning.zone,
          warning.day,
          warning.kind,
        );
    });
  }
  hasUnacknowledgedXWarning(platform: WarningPlatform = 'x'): boolean {
    const tables = warningTables(platform);
    if (
      !this.db
        .prepare(
          `SELECT name FROM sqlite_schema WHERE name='${tables.warnings}'`,
        )
        .get()
    )
      return false;
    return Boolean(
      this.db
        .prepare(
          `SELECT 1 FROM ${tables.warnings} w LEFT JOIN ${tables.ack} a ON a.run_id=w.run_id WHERE a.run_id IS NULL AND w.run_id=(SELECT recent.run_id FROM ${tables.warnings} recent WHERE recent.account_key=w.account_key ORDER BY recent.at DESC,recent.seq DESC LIMIT 1) LIMIT 1`,
        )
        .get(),
    );
  }
  async requireXWarningClear(
    accountKey: string,
    at: string,
    zone: string,
    platform: WarningPlatform = 'x',
  ): Promise<void> {
    const warning = await this.xWarning(accountKey, undefined, platform);
    if (!warning) return;
    // Retain the warned day's original zone as well as the current zone: changing
    // a setting must not shorten the wait already imposed by a warning.
    if (
      warningDay(at, warning.zone) <= warning.day ||
      warningDay(at, zone) <= warningDay(warning.at, zone)
    )
      throw new CliError(warningCode(platform, true));
    if (!warning.acknowledged) throw new CliError(warningCode(platform));
  }
  async acknowledgeXWarning(
    accountKey: string,
    runId: string,
    at: string,
    zone: string,
    platform: WarningPlatform = 'x',
  ): Promise<void> {
    const tables = warningTables(platform);
    const warning = await this.xWarning(accountKey, runId, platform);
    if (!warning || warning.runId !== runId)
      throw new CliError(warningCode(platform));
    if (
      warningDay(at, warning.zone) <= warning.day ||
      warningDay(at, zone) <= warningDay(warning.at, zone)
    )
      throw new CliError(warningCode(platform, true));
    await this.transact(async () => {
      const latest = this.db
        .prepare(
          `SELECT w.run_id, a.at AS acknowledged_at FROM ${tables.warnings} w LEFT JOIN ${tables.ack} a ON a.run_id=w.run_id WHERE w.account_key=? ORDER BY w.at DESC,w.seq DESC LIMIT 1`,
        )
        .get(accountKey);
      // A profile can retain an older warning after this workspace's newer
      // warning was acknowledged through another profile. Never let an
      // outstanding newer warning be cleared by acknowledging that older one.
      if (
        !latest ||
        (latest.run_id !== runId && latest.acknowledged_at === null)
      )
        throw new CliError(warningCode(platform));
      this.db
        .prepare(`INSERT OR IGNORE INTO ${tables.ack} VALUES(?,?)`)
        .run(runId, at);
      await Promise.resolve();
    });
  }

  async begin(run: BrowserRun): Promise<void> {
    BrowserRunSchema.parse(run);
    await this.transact(async (tx) => {
      this.db.exec(BROWSER_JOURNAL_LAYOUT);
      const meta = await tx.meta.get();
      await tx.meta.set({ ...meta, schemaVersion: WORKSPACE_SCHEMA_VERSION });
      await this.recoverDead(tx, run.accountKey, run.startedAt);
      this.db
        .prepare('INSERT INTO browser_runs VALUES(?,?,NULL,?)')
        .run(run.runId, run.accountKey, JSON.stringify(run));
      const runtime = await tx.runtime.get();
      await tx.runtime.set({ revision: runtime.revision + 1 });
      await Promise.resolve();
    });
  }
  /** End only a positively dead owner, using that run mode's settlement. */
  async recover(accountKey: string, at: string): Promise<void> {
    await this.transact(async (tx) => {
      if (await this.recoverDead(tx, accountKey, at)) {
        const runtime = await tx.runtime.get();
        await tx.runtime.set({ revision: runtime.revision + 1 });
      }
    });
  }
  private async recoverDead(
    tx: WriteTransaction,
    accountKey: string,
    at: string,
  ): Promise<boolean> {
    const active = decode<import('@socialprune/core').BrowserRun>(
      this.db
        .prepare(
          'SELECT data FROM browser_runs WHERE account_key=? AND ended_at IS NULL',
        )
        .all(accountKey),
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
      const attempts = [];
      for await (const attempt of tx.browserAttempts.iterate())
        attempts.push(attempt);
      for (const attempt of attempts)
        if (
          attempt.runId === active.runId &&
          attempt.state === 'sending' &&
          !this.db
            .prepare('SELECT seq FROM browser_attempts WHERE settles=?')
            .get(attempt.attemptId)
        )
          await tx.browserAttempts.add({
            ...attempt,
            seq: Number(
              this.db
                .prepare(
                  'SELECT coalesce(max(seq),0)+1 AS seq FROM browser_attempts',
                )
                .get()!.seq,
            ),
            attemptId: crypto.randomUUID(),
            state:
              active.mode === 'delete' || active.mode === 'verify'
                ? 'ambiguous'
                : 'failed',
            settles: attempt.attemptId,
            at,
            code:
              active.mode === 'delete' || active.mode === 'verify'
                ? 'PROCESS_LOST'
                : 'INTERRUPTED',
          });
      const recovered = {
        ...active,
        endedAt: at,
        endReason: active.instagramWarning ? 'platform-check' : 'error',
      };
      this.db
        .prepare('UPDATE browser_runs SET ended_at=?,data=? WHERE run_id=?')
        .run(at, JSON.stringify(recovered), active.runId);
    }
    return Boolean(active);
  }
  async finish(run: BrowserRun): Promise<void> {
    if (!run.endedAt || !run.endReason) throw new CliError('WORKSPACE_INVALID');
    await this.transact(async (tx) => {
      const prior = readJournal(this.db).runs.find(
        (value) => value.runId === run.runId,
      );
      run = {
        ...run,
        ...(prior?.instagramWarning
          ? { instagramWarning: prior.instagramWarning }
          : {}),
        ...(prior?.pageOpens !== undefined
          ? {
              pageOpens: prior.pageOpens,
              lastPageOpenedAt: prior.lastPageOpenedAt,
              ...(prior.pageDays
                ? { pageDays: prior.pageDays, pageZone: prior.pageZone }
                : {}),
            }
          : {}),
      };
      if (!prior) throw new CliError('WORKSPACE_INVALID');
      validateBrowserRunUpdate(prior, BrowserRunSchema.parse(run));
      const result = this.db
        .prepare(
          'UPDATE browser_runs SET ended_at=?, data=? WHERE run_id=? AND ended_at IS NULL',
        )
        .run(
          run.endedAt,
          JSON.stringify(BrowserRunSchema.parse(run)),
          run.runId,
        );
      if (Number(result.changes) !== 1) throw new CliError('WORKSPACE_INVALID');
      const runtime = await tx.runtime.get();
      await tx.runtime.set({ revision: runtime.revision + 1 });
      await Promise.resolve();
    });
  }
  async pageOpen(runId: string, at: string, zone?: string): Promise<void> {
    await this.transact(async (tx) => {
      const run = await tx.browserRuns.get(runId);
      if (!run || run.endedAt) throw new CliError('WORKSPACE_INVALID');
      await tx.browserRuns.put({
        ...run,
        pageOpens: (run.pageOpens ?? 0) + 1,
        lastPageOpenedAt: at,
        ...(run.platform === 'instagram' && zone
          ? {
              pageZone: zone,
              pageDays: {
                ...run.pageDays,
                [warningDay(at, zone)]:
                  (run.pageDays?.[warningDay(at, zone)] ?? 0) + 1,
              },
            }
          : {}),
      });
      const runtime = await tx.runtime.get();
      await tx.runtime.set({ revision: runtime.revision + 1 });
    });
  }
  async acceptInstagramDeleteCanary(runId: string, at: string): Promise<void> {
    await this.transact(async (tx) => {
      const run = await tx.browserRuns.get(runId);
      const attempts = [];
      for await (const a of tx.browserAttempts.iterate())
        if (a.runId === runId) attempts.push(a);
      if (
        run?.platform !== 'instagram' ||
        run.mode !== 'delete' ||
        run.endReason !== 'canary' ||
        !run.endedAt ||
        run.canaryAcceptedAt ||
        attempts.filter(
          (a) => a.action === 'delete-comment' && a.state === 'sending',
        ).length !== 1 ||
        attempts.filter(
          (a) =>
            a.action === 'delete-comment' &&
            a.state === 'deleted' &&
            a.receipt?.status === 200,
        ).length !== 1 ||
        attempts.some((a) => ['ambiguous', 'failed'].includes(a.state))
      )
        throw new CliError('CANARY_CHECK_FAILED');
      await tx.browserRuns.put(
        BrowserRunSchema.parse({ ...run, canaryAcceptedAt: at }),
      );
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
      item.item.platform ===
        (row.action === 'delete-comment' ? 'instagram' : 'x') &&
      (row.action !== 'delete-comment' ||
        (row.context?.confirmedBy === 'post' &&
          row.context.ownerCheck === 'matched-export' &&
          JSON.stringify(await tx.instagramContext.get(row.item.id)) ===
            JSON.stringify(row.context))) &&
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
      const run = await tx.browserRuns.get(runId);
      if (
        !run ||
        run.endedAt ||
        run.mode !== 'delete' ||
        run.accountKey !== row.item.account.key ||
        run.platform !== row.item.platform
      )
        throw new CliError('RUN_STOPPED');
      if (row.action === 'delete-comment' && sending) {
        const zone =
          (await tx.meta.get()).settings.timeZone ??
          Intl.DateTimeFormat().resolvedOptions().timeZone;
        const attempts = [];
        for await (const a of tx.browserAttempts.iterate())
          if (a.action === 'delete-comment') {
            const owner = await tx.browserRuns.get(a.runId);
            if (owner?.accountKey === run.accountKey && owner.mode === 'delete')
              attempts.push(a);
          }
        const budget = instagramDeletionState(attempts, new Date(at), zone);
        if (budget.used >= INSTAGRAM_DELETE_PACE.perDay || budget.wait > 0)
          throw new CliError('RUN_STOPPED');
      }
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
  async requireInstagramDecision(row: PlannedEntry): Promise<void> {
    await this.transact(async (tx) => {
      if (row.action !== 'delete-comment' || !(await this.eligible(tx, row)))
        throw new CliError('RUN_STOPPED');
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
      if (input.itemId?.startsWith('instagram:')) {
        const run = await tx.browserRuns.get(input.runId);
        const item = (await tx.items.get(input.itemId))?.item;
        if (
          !run ||
          run.platform !== 'instagram' ||
          !item ||
          item.account.key !== run.accountKey ||
          !['delete', 'verify'].includes(run.mode) ||
          !['delete-comment', 'verify'].includes(input.action)
        )
          throw new CliError('WORKSPACE_INVALID');
        if (input.state === 'deleted') {
          const record = await tx.instagramContext.get(input.itemId);
          if (
            run.mode !== 'delete' ||
            run.endedAt !== null ||
            input.action !== 'delete-comment' ||
            record?.confirmedBy !== 'post' ||
            record.ownerCheck !== 'matched-export' ||
            !input.settles ||
            input.receipt?.method !== 'POST' ||
            input.receipt.status !== 200 ||
            input.receipt.shape?.join(',') !== 'status' ||
            !new RegExp(
              `^(?:/api/v1)?/web/comments/\\d{1,40}/delete/${record.comment.id}/$`,
            ).test(input.receipt.path)
          )
            throw new CliError('WORKSPACE_INVALID');
        }
        if (
          input.state === 'reappeared' &&
          (run.mode !== 'verify' ||
            run.endedAt !== null ||
            input.action !== 'verify')
        )
          throw new CliError('WORKSPACE_INVALID');
        if (input.state === 'not-deleted') {
          const resolvedIn = readJournal(this.db).runs.find(
            (r) =>
              r.platform === 'instagram' &&
              r.accountKey === run.accountKey &&
              r.mode === 'verify' &&
              !r.endedAt,
          );
          if (
            !resolvedIn ||
            !readJournal(this.db).attempts.some(
              (a) =>
                a.runId === resolvedIn.runId &&
                a.itemId === input.itemId &&
                a.action === 'verify' &&
                a.state === 'not-deleted',
            )
          )
            throw new CliError('WORKSPACE_INVALID');
        }
      }
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
            source: {
              kind: 'human',
              via: input.itemId.startsWith('instagram:')
                ? 'browser-instagram'
                : 'browser-x',
            },
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
  async recordContextOrder(runId: string, sha256: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(sha256))
      throw new CliError('CONTEXT_ORDER_INVALID');
    await this.transact(async (tx) => {
      const run = await tx.browserRuns.get(runId);
      if (
        run?.platform !== 'instagram' ||
        run.mode !== 'context' ||
        run.endedAt
      )
        throw new CliError('CONTEXT_ORDER_INVALID');
      this.db
        .prepare('INSERT INTO browser_order_audit VALUES(?,?,?,NULL,?)')
        .run(
          runId,
          'agent-on-order',
          sha256,
          JSON.stringify({
            scope: 'context-instagram',
            startedBy: 'agent-on-order',
            orderSha256: sha256,
          }),
        );
    });
  }
  async recordContextAudit(
    runId: string,
    input: {
      commentsConfirmed: number;
      fields: Record<string, { compared: number; agreed: number }>;
      imagesMatched: number;
      screenshotsStored: number;
      unexpectedActions: number;
      extensionIdsAdded: number;
      extensionIdsRemoved: number;
    },
    code?: string,
    accepted = false,
    acceptance?: {
      at: string;
      itemIds: readonly string[];
      profileReport: BrowserProfileReport;
      refreshReplies?: boolean;
      repliesChecked?: boolean;
    },
  ): Promise<void> {
    const names = ['owner', 'time', 'caption', 'image'];
    if (
      Object.keys(input.fields).sort().join(',') !==
        [...names].sort().join(',') ||
      (code !== undefined && !Object.hasOwn(CLI_ERRORS, code))
    )
      throw new CliError('CONTEXT_ORDER_INVALID');
    const counts = {
      commentsConfirmed: input.commentsConfirmed,
      fields: Object.fromEntries(
        names.map((name) => [
          name,
          {
            compared: input.fields[name]!.compared,
            agreed: input.fields[name]!.agreed,
          },
        ]),
      ),
      imagesMatched: input.imagesMatched,
      screenshotsStored: input.screenshotsStored,
      unexpectedActions: input.unexpectedActions,
      extensionIdsAdded: input.extensionIdsAdded,
      extensionIdsRemoved: input.extensionIdsRemoved,
    };
    for (const number of [
      counts.commentsConfirmed,
      counts.imagesMatched,
      counts.screenshotsStored,
      counts.unexpectedActions,
      counts.extensionIdsAdded,
      counts.extensionIdsRemoved,
      ...Object.values(counts.fields).flatMap((value) => [
        value.compared,
        value.agreed,
      ]),
    ])
      if (!Number.isSafeInteger(number) || number < 0)
        throw new CliError('CONTEXT_ORDER_INVALID');
    await this.transact(async (tx) => {
      const run = await tx.browserRuns.get(runId),
        row = this.db
          .prepare('SELECT data FROM browser_order_audit WHERE run_id=?')
          .get(runId);
      if (run?.platform !== 'instagram' || run.mode !== 'context' || !row)
        throw new CliError('CONTEXT_ORDER_INVALID');
      if (
        accepted &&
        (!acceptance ||
          run.endedAt ||
          run.canaryAcceptedAt ||
          code !== undefined ||
          counts.commentsConfirmed !== 5 ||
          (acceptance.refreshReplies && acceptance.repliesChecked !== true) ||
          acceptance.itemIds.length !== counts.commentsConfirmed ||
          new Set(acceptance.itemIds).size !== counts.commentsConfirmed ||
          (!acceptance.refreshReplies &&
            counts.imagesMatched !== counts.commentsConfirmed) ||
          (!acceptance.refreshReplies &&
            counts.screenshotsStored !== counts.commentsConfirmed) ||
          counts.unexpectedActions ||
          counts.extensionIdsAdded ||
          counts.extensionIdsRemoved ||
          (!acceptance.refreshReplies &&
            Object.values(counts.fields).some(
              (value) =>
                value.compared !== counts.commentsConfirmed ||
                value.agreed !== value.compared,
            )))
      )
        throw new CliError('CANARY_CHECK_FAILED');
      if (accepted && acceptance) {
        const attempts = [];
        for await (const attempt of tx.browserAttempts.iterate())
          if (attempt.runId === runId) attempts.push(attempt);
        const sends = attempts.filter((attempt) => attempt.state === 'sending');
        const settlements = attempts.filter(
          (attempt) => attempt.settles !== null,
        );
        if (
          sends.length > 15 ||
          sends.length !== settlements.length ||
          attempts.length !== sends.length + settlements.length ||
          settlements.filter(
            (attempt) =>
              attempt.state ===
              (acceptance.refreshReplies ? 'read' : 'confirmed'),
          ).length !== 5
        )
          throw new CliError('CANARY_CHECK_FAILED');
        const itemIds = new Set<string>();
        for (const send of sends) {
          const settles = attempts.filter(
            (attempt) => attempt.settles === send.attemptId,
          );
          if (
            send.action !==
              (acceptance.refreshReplies
                ? 'refresh-comment-replies'
                : 'confirm-comment') ||
            send.settles !== null ||
            !send.itemId ||
            itemIds.has(send.itemId) ||
            settles.length !== 1 ||
            settles[0]!.action !== send.action ||
            settles[0]!.itemId !== send.itemId ||
            (settles[0]!.state !==
              (acceptance.refreshReplies ? 'read' : 'confirmed') &&
              !(acceptance.refreshReplies && settles[0]!.state === 'failed') &&
              settles[0]!.state !== 'unavailable' &&
              settles[0]!.state !== 'unconfirmed' &&
              settles[0]!.state !== 'not-listed')
          )
            throw new CliError('CANARY_CHECK_FAILED');
          itemIds.add(send.itemId);
          if (
            settles[0]!.state ===
            (acceptance.refreshReplies ? 'read' : 'confirmed')
          ) {
            const record = await tx.instagramContext.get(send.itemId);
            if (
              !acceptance.itemIds.includes(send.itemId) ||
              !record ||
              (acceptance.refreshReplies
                ? record.confirmedBy !== 'post' || record.replies === undefined
                : record.runId !== runId ||
                  record.attemptId !== send.attemptId ||
                  !record.post.owner ||
                  !record.post.createdAt ||
                  record.image.status !== 'stored' ||
                  record.screenshot.status !== 'stored')
            )
              throw new CliError('CANARY_CHECK_FAILED');
          }
        }
        // Bind the unchanged narrow writer to this transaction, not a nested SQLite
        // write. If the audit guard or INSERT/UPDATE fails, closure and acceptance
        // roll back with it. No acceptance bit is written outside the core writer.
        const writer = new InstagramContextWriter({
          read: (read) => read(tx),
          write: (write) => write(tx),
          close: () => Promise.resolve(),
        });
        await writer.endRun({
          runId,
          endedAt: acceptance.at,
          endReason: 'canary',
          bodyShapes: {},
          profileReport: acceptance.profileReport,
        });
        await writer.acceptCanary(runId, acceptance.at, acceptance.itemIds);
      }
      const updated = this.db
        .prepare(
          'UPDATE browser_order_audit SET accepted_by=?,data=? WHERE run_id=? AND accepted_by IS NULL',
        )
        .run(
          accepted ? 'automatic-check' : null,
          JSON.stringify({
            ...(JSON.parse(String(row.data)) as Record<string, unknown>),
            canaryCounts: counts,
            ...(code ? { displayEndReason: code } : {}),
            ...(accepted ? { acceptedBy: 'automatic-check' } : {}),
          }),
          runId,
        );
      if (Number(updated.changes) !== 1)
        throw new CliError('CONTEXT_ORDER_INVALID');
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

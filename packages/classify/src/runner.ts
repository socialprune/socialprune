import type { ItemKind } from '@socialprune/core';
import type { SourceLabelFile } from '@socialprune/core/workspace/payloads';
export type { SourceLabelFile } from '@socialprune/core/workspace/payloads';
import { definitionHash } from '@socialprune/core/criteria';
import { normalize, fallback } from './normalize.ts';
import { RUBRIC_VERSION } from './prompt.ts';
import { ScanError, stopped, emptyUsage } from './source.ts';
import type {
  CheckAnswer,
  CheckRequest,
  Criterion,
  FailureCode,
  RawLabel,
  SuggestionSource,
  Usage,
} from './source.ts';

export interface RunCriterion extends Criterion {
  hash: string;
}
export interface RunEntry {
  itemId: string;
  contentHash: string;
  platform: 'x' | 'instagram';
  kind: ItemKind;
  text: string;
  checked?: {
    sourceName: string;
    sourceKind: 'model' | 'rules';
    version: string;
    criteria: { id: string; hash: string }[];
  }[];
}
export interface RunProgress {
  stored: number;
  remaining: number;
  requests: number;
  retries: number;
  secondPassEntries: number;
  secondPassRequests: number;
  split: number;
  unknownIds: number;
  missingIds: number;
  truncatedAnswers: number;
  batchSize: number;
  tokens: Usage;
}
export interface RunOptions {
  source: SuggestionSource;
  answeringModel: string;
  confirmedOrigin: string | null;
  entries: RunEntry[];
  criteria: RunCriterion[];
  entriesPerRequest: number;
  parallelRequests?: number;
  limit?: number;
  submit: (file: SourceLabelFile) => Promise<unknown>;
  progress?: (value: RunProgress) => void;
  wait?: (seconds: number, signal: AbortSignal) => Promise<void>;
  signal: AbortSignal;
}
export const sourceVersion = (model: string) =>
  `${model} rubric ${RUBRIC_VERSION}`;
function addUsage(total: Usage, value: Usage) {
  for (const key of [
    'promptTokens',
    'cachedPromptTokens',
    'completionTokens',
  ] as const)
    if (value[key] !== null) total[key] = (total[key] ?? 0) + value[key];
}
export async function waitSeconds(seconds: number, signal: AbortSignal) {
  stopped(signal);
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(new ScanError('RUN_STOPPED'));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, seconds * 1000);
    signal.addEventListener('abort', abort, { once: true });
  });
}
interface Unique {
  entries: RunEntry[];
  failure?: FailureCode;
}
export async function runBatches(options: RunOptions) {
  const { source, signal } = options;
  const runController = new AbortController();
  const forwardStop = () => runController.abort();
  const requestSignal = runController.signal;
  if (source.destination !== options.confirmedOrigin || !options.answeringModel)
    throw new ScanError('ENDPOINT_NOT_CONFIRMED');
  if (
    !Number.isInteger(options.entriesPerRequest) ||
    options.entriesPerRequest < 1 ||
    options.entriesPerRequest > 50 ||
    !Number.isInteger(options.parallelRequests ?? 1) ||
    (options.parallelRequests ?? 1) < 1 ||
    (options.parallelRequests ?? 1) > 4 ||
    !options.criteria.length ||
    options.criteria.length > 32 ||
    new Set(options.criteria.map((c) => c.id)).size !==
      options.criteria.length ||
    options.criteria.some((c) => ['harmless', 'unclear'].includes(c.id)) ||
    (options.limit !== undefined &&
      (!Number.isSafeInteger(options.limit) || options.limit < 1))
  )
    throw new ScanError('SOURCE_FILE_INVALID');
  const version = sourceVersion(options.answeringModel);
  const groups = new Map<
    string,
    { criteria: RunCriterion[]; unique: Map<string, Unique> }
  >();
  let skipped = 0;
  let planned = 0;
  for (const entry of options.entries) {
    const criteria = options.criteria
      .filter(
        (criterion) =>
          !entry.checked?.some(
            (check) =>
              check.sourceName === source.name &&
              check.sourceKind === source.kind &&
              check.version === version &&
              check.criteria.some(
                (c) => c.id === criterion.id && c.hash === criterion.hash,
              ),
          ),
      )
      .sort((a, b) => a.id.localeCompare(b.id));
    if (!criteria.length) {
      skipped++;
      continue;
    }
    if (planned >= (options.limit ?? Infinity)) continue;
    planned++;
    const key = JSON.stringify(criteria.map((c) => [c.id, c.hash]));
    const group = groups.get(key) ?? {
      criteria,
      unique: new Map<string, Unique>(),
    };
    const textKey = JSON.stringify([entry.platform, entry.kind, entry.text]);
    const unique = group.unique.get(textKey) ?? { entries: [] };
    unique.entries.push(entry);
    group.unique.set(textKey, unique);
    groups.set(key, group);
  }
  const progress: RunProgress = {
    stored: 0,
    remaining: planned,
    requests: 0,
    retries: 0,
    secondPassEntries: 0,
    secondPassRequests: 0,
    split: 0,
    unknownIds: 0,
    missingIds: 0,
    truncatedAnswers: 0,
    batchSize: options.entriesPerRequest,
    tokens: emptyUsage(),
  };
  let invalidStreak = 0;
  let truncatedStreak = 0;
  const wait = options.wait ?? waitSeconds;
  async function check(request: CheckRequest, second: boolean) {
    for (let attempt = 0; ; attempt++) {
      stopped(requestSignal);
      const first = progress.requests === 0;
      progress.requests++;
      if (second) progress.secondPassRequests++;
      options.progress?.(structuredClone(progress));
      try {
        const answer = await source.check(request, requestSignal);
        stopped(requestSignal);
        if (answer.answeredBy !== options.answeringModel)
          throw new ScanError('MODEL_CHANGED');
        addUsage(progress.tokens, answer.usage);
        return answer;
      } catch (error) {
        if (!(error instanceof ScanError)) {
          runController.abort();
          throw new ScanError('ENDPOINT_RESPONSE_INVALID');
        }
        if (error.code === 'TLS' || (first && error.code === 'CONNECTION')) {
          runController.abort();
          throw new ScanError('ENDPOINT_UNREACHABLE');
        }
        if (error.code === 'REQUEST_SIZE') throw error;
        if (
          !['CONNECTION', 'REQUEST_TIMEOUT', 'RETRYABLE_STATUS'].includes(
            error.code,
          )
        ) {
          runController.abort();
          throw error;
        }
        if (attempt === 2) {
          runController.abort();
          throw new ScanError('ENDPOINT_RETRY_EXHAUSTED');
        }
        progress.retries++;
        options.progress?.(structuredClone(progress));
        await wait(
          error.waitSeconds ?? (attempt === 0 ? 10 : 60),
          requestSignal,
        );
      }
    }
  }
  async function submit(
    criteria: RunCriterion[],
    units: Unique[],
    labels: Map<Unique, RawLabel[]>,
  ) {
    const accepted = units.filter((unit) => labels.has(unit));
    if (!accepted.length) return;
    const entries = accepted.flatMap((unit) => unit.entries);
    const identity = [
      source.name,
      version,
      criteria.map((c) => [c.id, c.hash]),
      entries
        .map((e) => [e.itemId, e.contentHash])
        .sort((a, b) => a[0]!.localeCompare(b[0]!)),
    ];
    const file: SourceLabelFile = {
      schemaVersion: 2,
      submissionId:
        'scan-' +
        definitionHash(JSON.stringify(identity))
          .replace(/^sha256:/, '')
          .slice(0, 24),
      source: { kind: source.kind, name: source.name, version },
      criteria: criteria.map(({ id, hash }) => ({ id, hash })),
      labels: accepted.flatMap((unit) =>
        unit.entries.flatMap((entry) =>
          labels.get(unit)!.map((label) => ({
            itemId: entry.itemId,
            contentHash: entry.contentHash,
            category: label.category,
            risk: label.risk,
            reason: label.reason,
            evidence: label.quote,
            confidence: null,
          })),
        ),
      ),
    };
    for (let attempt = 0; ; attempt++) {
      stopped(requestSignal);
      try {
        await options.submit(file);
        break;
      } catch (error) {
        if (!objectCode(error, 'WORKSPACE_BUSY') || attempt === 2) {
          runController.abort();
          throw error;
        }
        await wait(attempt === 0 ? 10 : 60, requestSignal);
      }
    }
    progress.stored += entries.length;
    progress.remaining -= entries.length;
  }
  async function batch(
    criteria: RunCriterion[],
    units: Unique[],
    second: boolean,
  ): Promise<void> {
    stopped(requestSignal);
    const request: CheckRequest = {
      criteria: criteria.map(({ id, label, definition }) => ({
        id,
        label,
        definition,
      })),
      entries: units.map((unit, index) => {
        const entry = unit.entries[0]!;
        return {
          id: `e${index + 1}`,
          platform: entry.platform,
          kind: entry.kind,
          text: entry.text,
        };
      }),
      ...(second
        ? {
            failures: units.map((unit, index) => ({
              id: `e${index + 1}`,
              code: unit.failure!,
            })),
          }
        : {}),
    };
    let answer: CheckAnswer;
    try {
      answer = await check(request, second);
    } catch (error) {
      if (!(error instanceof ScanError && error.code === 'REQUEST_SIZE'))
        throw error;
      if (units.length === 1) {
        await submit(
          criteria,
          units,
          new Map([[units[0]!, fallback('INVALID_LABEL')]]),
        );
        return;
      }
      progress.split++;
      const middle = Math.ceil(units.length / 2);
      await batch(criteria, units.slice(0, middle), second);
      await batch(criteria, units.slice(middle), second);
      return;
    }
    const normalized = normalize(request, answer);
    progress.unknownIds += normalized.unknownIds;
    progress.missingIds += [...normalized.invalid.values()].filter(
      (code) => code === 'MISSING_ID',
    ).length;
    if (answer.truncated) {
      progress.truncatedAnswers++;
      truncatedStreak++;
    } else truncatedStreak = 0;
    if (truncatedStreak >= 2) {
      progress.batchSize = Math.max(1, Math.ceil(progress.batchSize / 2));
      truncatedStreak = 0;
    }
    invalidStreak = normalized.valid.size ? 0 : invalidStreak + 1;
    if (invalidStreak >= 5) {
      runController.abort();
      throw new ScanError('ANSWERS_INVALID');
    }
    const labels = new Map<Unique, RawLabel[]>();
    const retry: Unique[] = [];
    units.forEach((unit, index) => {
      const id = `e${index + 1}`;
      const valid = normalized.valid.get(id);
      const failure = normalized.invalid.get(id);
      if (valid) labels.set(unit, valid);
      else if (second) labels.set(unit, fallback(failure!));
      else retry.push({ entries: unit.entries, failure });
    });
    await submit(criteria, units, labels);
    options.progress?.(structuredClone(progress));
    if (retry.length) {
      progress.secondPassEntries += retry.reduce(
        (n, unit) => n + unit.entries.length,
        0,
      );
      const size = Math.ceil(progress.batchSize / 2);
      for (let offset = 0; offset < retry.length; offset += size)
        await batch(criteria, retry.slice(offset, offset + size), true);
    }
  }
  signal.addEventListener('abort', forwardStop, { once: true });
  if (signal.aborted) runController.abort();
  try {
    for (const group of groups.values()) {
      const units = [...group.unique.values()];
      let offset = 0;
      // The first request of each criteria group completes before concurrency opens.
      if (units.length) {
        const first = units.slice(0, progress.batchSize);
        offset += first.length;
        await batch(group.criteria, first, false);
      }
      while (offset < units.length) {
        const pending: Promise<void>[] = [];
        for (
          let i = 0;
          i < (options.parallelRequests ?? 1) && offset < units.length;
          i++
        ) {
          const next = units.slice(offset, offset + progress.batchSize);
          offset += next.length;
          pending.push(batch(group.criteria, next, false));
        }
        const outcomes = await Promise.allSettled(pending);
        const failed = outcomes.find((value) => value.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
      }
    }
    return {
      ...progress,
      planned,
      skipped,
      uniqueTexts: [...groups.values()].reduce(
        (n, group) => n + group.unique.size,
        0,
      ),
      rubricVersion: RUBRIC_VERSION,
    };
  } finally {
    signal.removeEventListener('abort', forwardStop);
  }
}
function objectCode(error: unknown, code: string) {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === code
  );
}

import type { InstagramContext } from '@socialprune/core';
import { normalize } from './plan.ts';
import type { ReplyAnswerDiagnostic } from './report.ts';
import type { PostPathClass } from './signals.ts';
import { scriptReplySource } from './replies-script.ts';

type Entry = NonNullable<InstagramContext['replies']>['entries'][number];
export interface ReplyMatch {
  id: string;
  createdAt: string;
  username: string;
  text: string;
}
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const stringId = (value: unknown): string =>
  typeof value === 'string'
    ? value
    : typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : '';
const idOf = (value: Record<string, unknown>) => stringId(value.pk ?? value.id);
const authorOf = (value: Record<string, unknown>) =>
  object(value.user ?? value.owner);
const fields = (value: Entry): Entry => ({
  account: value.account,
  text: value.text,
  createdAt: value.createdAt,
  likes: value.likes,
});
function entry(input: unknown): (Entry & { id: string }) | null {
  const value = object(input),
    user = authorOf(value),
    id = idOf(value);
  if (
    !/^\d{1,40}$/.test(id) ||
    typeof user.username !== 'string' ||
    !/^[A-Za-z0-9_.]{1,30}$/.test(user.username) ||
    typeof value.text !== 'string' ||
    !value.text.trim() ||
    value.text.length > 10000
  )
    return null;
  const rawTime = value.created_at ?? value.created_at_utc;
  const timestamp =
    typeof rawTime === 'number' && Number.isFinite(rawTime)
      ? new Date(rawTime * 1000)
      : null;
  const count = value.comment_like_count ?? value.like_count;
  const knownLikes =
    typeof count === 'number' && Number.isSafeInteger(count) && count >= 0;
  return {
    id,
    account: user.username,
    text: value.text.normalize('NFC').trim(),
    createdAt:
      timestamp && Number.isFinite(timestamp.getTime())
        ? timestamp.toISOString()
        : null,
    likes: knownLikes
      ? { count, source: 'answer' }
      : { count: null, source: null },
  };
}

/** Only captured response objects bound to the exact focal comment qualify. */
export function answerReplies(bodies: readonly unknown[], match: ReplyMatch) {
  let visits = 0,
    capped = false,
    present = false,
    valid = true,
    total = 0;
  const entries = new Map<string, Entry & { id: string }>();
  const add = (input: unknown) => {
    const next = entry(input);
    if (!next || next.id === match.id) {
      valid = false;
      return;
    }
    const prior = entries.get(next.id);
    if (
      prior &&
      (prior.account !== next.account ||
        normalize(prior.text) !== normalize(next.text) ||
        prior.createdAt !== next.createdAt)
    )
      valid = false;
    entries.set(next.id, next);
  };
  const walk = (input: unknown, depth: number) => {
    if (++visits > 100000 || depth > 40) {
      capped = true;
      valid = false;
      return;
    }
    if (Array.isArray(input)) {
      for (const item of input) {
        if (capped) break;
        walk(item, depth + 1);
      }
      return;
    }
    const value = object(input);
    if (!Object.keys(value).length) return;
    const user = authorOf(value);
    if (
      idOf(value) === match.id &&
      user.username === match.username &&
      typeof value.text === 'string' &&
      normalize(value.text) === normalize(match.text) &&
      (value.created_at ?? value.created_at_utc) ===
        Date.parse(match.createdAt) / 1000
    ) {
      const threaded = object(value.edge_threaded_comments);
      const count = value.child_comment_count ?? threaded.count;
      const children =
        value.preview_child_comments ??
        value.child_comments ??
        (Array.isArray(threaded.edges)
          ? threaded.edges.map((edge) => object(edge).node)
          : undefined);
      if (count !== undefined || children !== undefined) {
        present = true;
        if (
          count !== undefined &&
          (typeof count !== 'number' ||
            !Number.isSafeInteger(count) ||
            count < 0)
        )
          valid = false;
        else total = Math.max(total, typeof count === 'number' ? count : 0);
        if (children !== undefined && !Array.isArray(children)) valid = false;
        if (Array.isArray(children)) {
          if (children.length > 100000) {
            capped = true;
            valid = false;
            return;
          }
          for (const child of children) add(child);
        }
      }
    }
    // Standalone child-comment responses explicitly bind every row to its parent.
    if (stringId(value.parent_comment_id) === match.id) {
      present = true;
      add(value);
    }
    for (const [key, item] of Object.entries(value))
      if (
        !capped &&
        ![
          'variables',
          'params',
          'instanceParams',
          'route_match_infos',
        ].includes(key)
      )
        walk(item, depth + 1);
  };
  for (const body of bodies) {
    if (capped) break;
    walk(body, 0);
  }
  return {
    present,
    valid,
    total: Math.max(total, entries.size),
    entries: [...entries.values()],
  };
}

type ShownRow = Entry & { id?: string };
const answerMatches = (
  entries: readonly (Entry & { id: string })[],
  row: ShownRow,
) =>
  entries.filter(
    (value) =>
      (row.id ? row.id === value.id : true) &&
      value.account.toLowerCase() === row.account.toLowerCase() &&
      normalize(value.text) === normalize(row.text) &&
      (row.createdAt === null || value.createdAt === row.createdAt),
  );

/**
 * Counts only, never values: how the shown rows relate to the answer's own
 * reply entries. A row counts as matched when exactly one answer entry fits it
 * and no earlier shown row claimed that entry; answer entries no shown row
 * claimed are answer-only; declared replies without any answer entry are hidden.
 */
export function replySetCounts(
  answer: { total: number; entries: readonly (Entry & { id: string })[] },
  rows: readonly ShownRow[],
) {
  const claimed = new Set<string>();
  let shownRowsMatched = 0;
  for (const row of rows) {
    const matches = answerMatches(answer.entries, row);
    if (matches.length !== 1 || claimed.has(matches[0]!.id)) continue;
    claimed.add(matches[0]!.id);
    shownRowsMatched++;
  }
  return {
    answerEntries: answer.entries.length,
    shownRowsMatched,
    answerOnlyEntries: answer.entries.length - claimed.size,
    hiddenCount: Math.max(0, answer.total - answer.entries.length),
  };
}

/**
 * REPLY-SET-2 (parent decision on REPLY-SET-1, option A): only after the
 * expansion left a single "Hide all replies" control, every shown row matched
 * exactly one distinct answer entry and the answer declares more replies than
 * the page shows. Answer entries no row claimed are kept as answer-only; the
 * set is complete when they cover the declared total, else incomplete with
 * the declared total and the hidden count. Every other mismatch still stops.
 */
function hiddenReplySet(
  answer: { total: number; entries: readonly (Entry & { id: string })[] },
  rows: readonly ShownRow[],
) {
  const claimed = new Set<string>();
  const entries: Entry[] = [];
  for (const row of rows) {
    const matches = answerMatches(answer.entries, row);
    if (matches.length !== 1 || claimed.has(matches[0]!.id))
      return { reason: 'reply-answer-mismatch' as const };
    claimed.add(matches[0]!.id);
    entries.push({
      ...fields(matches[0]!),
      createdAt: row.createdAt,
      source: 'shown',
    });
  }
  for (const value of answer.entries)
    if (!claimed.has(value.id))
      entries.push({ ...fields(value), source: 'answer-only' });
  if (entries.length > 50)
    return { reason: 'reply-answer-incomplete' as const };
  const hiddenCount = answer.total - entries.length;
  return {
    observation: {
      entries,
      moreCount: Math.max(0, hiddenCount),
      capped: false,
      set:
        hiddenCount > 0
          ? {
              state: 'incomplete' as const,
              declaredTotal: answer.total,
              hiddenCount,
            }
          : { state: 'complete' as const },
    },
    answerChecked: true,
  };
}

/** The per-step report of a marked set: its state and counts only. */
export function replySetReport(
  replies: NonNullable<InstagramContext['replies']>,
) {
  return replies.set
    ? {
        set: replies.set.state,
        answerOnly: replies.entries.filter(
          (entry) => entry.source === 'answer-only',
        ).length,
        hidden:
          replies.set.state === 'incomplete' ? replies.set.hiddenCount : 0,
      }
    : {};
}

export function checkedReplyRows(
  bodies: readonly unknown[],
  match: ReplyMatch,
  rows: readonly ShownRow[],
  capped: boolean,
  moreCount: number,
  scriptValues: readonly unknown[] = [],
  hideAllAfterExpansion = false,
) {
  const answer = combinedReplyAnswer(bodies, match, scriptValues).answer;
  if (!answer.present) return { reason: 'reply-answer-absent' as const };
  if (answer.present && !answer.valid)
    return { reason: 'reply-answer-conflict' as const };
  if (
    !capped &&
    hideAllAfterExpansion &&
    rows.length > 0 &&
    answer.total > rows.length
  )
    return hiddenReplySet(answer, rows);
  if (answer.present && !capped && answer.total !== rows.length)
    return { reason: 'reply-answer-incomplete' as const };
  const entries: Entry[] = [];
  for (const row of rows) {
    const matches = answerMatches(answer.entries, row);
    if (matches.length !== 1)
      return { reason: 'reply-answer-mismatch' as const };
    entries.push({ ...fields(matches[0]!), createdAt: row.createdAt });
  }
  return {
    observation: {
      entries,
      moreCount: Math.max(moreCount, answer.total - entries.length),
      capped,
    },
    answerChecked: answer.present,
  };
}

/** Network remains authoritative; either source's conflicting evidence refuses. */
export function combinedReplyAnswer(
  bodies: readonly unknown[],
  match: ReplyMatch,
  scriptValues: readonly unknown[] = [],
) {
  const network = answerReplies(bodies, match);
  const scripts = scriptReplySource(scriptValues, match);
  const embedded = answerReplies(scripts.objects, match);
  let conflict = scripts.conflict;
  if (network.present && embedded.present) {
    conflict ||=
      !network.valid || !embedded.valid || network.total !== embedded.total;
    for (const entry of embedded.entries) {
      const prior = network.entries.find((row) => row.id === entry.id);
      if (!prior && network.entries.length === network.total) conflict = true;
      if (
        prior &&
        (prior.account !== entry.account ||
          normalize(prior.text) !== normalize(entry.text) ||
          prior.createdAt !== entry.createdAt ||
          (prior.likes.count !== null &&
            entry.likes.count !== null &&
            prior.likes.count !== entry.likes.count))
      )
        conflict = true;
    }
    if (
      embedded.entries.length === embedded.total &&
      network.entries.some(
        (entry) => !embedded.entries.some((row) => row.id === entry.id),
      )
    )
      conflict = true;
  }
  const chosen = network.present ? network : embedded;
  const answer = {
    ...chosen,
    valid:
      chosen.valid &&
      !conflict &&
      !(scripts.diagnostic.capped && embedded.present),
  };
  return {
    answer,
    scripts: scripts.diagnostic,
    source: conflict
      ? ('conflict' as const)
      : network.present
        ? ('network' as const)
        : embedded.present
          ? ('script' as const)
          : ('absent' as const),
  };
}

/** Counts inspect excluded containers too, but never qualify them as evidence. */
export function replyAnswerDiagnostic(
  bodies: readonly unknown[],
  match: ReplyMatch,
  rowsShown: number,
  paths: readonly PostPathClass[] = [],
  html: ReplyAnswerDiagnostic['html'] = {
    documents: 0,
    jsonScripts: 0,
    matchIdDocuments: 0,
    observationFailed: false,
  },
  scriptValues: readonly unknown[] = [],
  rows: readonly ShownRow[] = [],
): ReplyAnswerDiagnostic {
  const combined = combinedReplyAnswer(bodies, match, scriptValues);
  const answer = combined.answer;
  let matchIdBodies = 0,
    parameterMatchIdBodies = 0,
    focalObjects = 0,
    visits = 0,
    capped = false;
  const classes = new Set<'zero' | 'positive' | 'invalid'>();
  const pathCounts = new Map<PostPathClass, number>();
  for (const [index, body] of bodies.entries()) {
    let found = false,
      parameterFound = false;
    const walk = (input: unknown, depth: number, parameter: boolean) => {
      if (++visits > 100000 || depth > 40) {
        capped = true;
        return;
      }
      if (Array.isArray(input)) {
        for (const value of input) {
          if (capped) break;
          walk(value, depth + 1, parameter);
        }
        return;
      }
      const value = object(input);
      const idMatch = Object.entries(value).some(
        ([key, id]) =>
          /^(?:pk|id)$|(?:_|[a-z])id$|_pk$/iu.test(key) &&
          stringId(id) === match.id,
      );
      found ||= idMatch;
      parameterFound ||= idMatch && parameter;
      if (idMatch) {
        const raw =
          value.child_comment_count ??
          object(value.edge_threaded_comments).count;
        if (raw !== undefined)
          classes.add(
            typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0
              ? 'invalid'
              : raw === 0
                ? 'zero'
                : 'positive',
          );
        if (
          !parameter &&
          idOf(value) === match.id &&
          authorOf(value).username === match.username &&
          typeof value.text === 'string' &&
          normalize(value.text) === normalize(match.text) &&
          (value.created_at ?? value.created_at_utc) ===
            Date.parse(match.createdAt) / 1000
        )
          focalObjects++;
      }
      for (const [key, next] of Object.entries(value)) {
        if (capped) break;
        if (next && typeof next === 'object')
          walk(
            next,
            depth + 1,
            parameter ||
              [
                'variables',
                'params',
                'instanceParams',
                'route_match_infos',
              ].includes(key),
          );
      }
    };
    walk(body, 0, false);
    matchIdBodies += Number(found);
    parameterMatchIdBodies += Number(parameterFound);
    const path = paths[index] ?? 'other';
    pathCounts.set(path, (pathCounts.get(path) ?? 0) + 1);
    if (capped) break;
  }
  return {
    source: combined.source,
    script: {
      ...combined.scripts,
      observationFailed:
        html.observationFailed || combined.scripts.observationFailed,
    },
    answerPresent: answer.present,
    answerValid: answer.valid,
    answerTotal: answer.total,
    rowsShown,
    ...replySetCounts(answer, rows),
    bodiesInspected: [...pathCounts.values()].reduce(
      (sum, count) => sum + count,
      0,
    ),
    matchIdBodies,
    parameterMatchIdBodies,
    focalObjects,
    traversalCapped: capped,
    childCountSeen: classes.size > 0,
    childCountClasses: [...classes],
    childCountClass: classes.size > 1 ? 'mixed' : ([...classes][0] ?? 'absent'),
    paths: [...pathCounts].map(([path, bodies]) => ({ path, bodies })),
    html,
  };
}

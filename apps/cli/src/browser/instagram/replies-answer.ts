import type { InstagramContext } from '@socialprune/core';
import { normalize } from './plan.ts';

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
const idOf = (value: Record<string, unknown>) =>
  String(value.pk ?? value.id ?? '');
function entry(input: unknown): (Entry & { id: string }) | null {
  const value = object(input),
    user = object(value.user),
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
      valid = false;
      return;
    }
    if (Array.isArray(input)) {
      for (const item of input) walk(item, depth + 1);
      return;
    }
    const value = object(input);
    if (!Object.keys(value).length) return;
    const user = object(value.user);
    if (
      idOf(value) === match.id &&
      user.username === match.username &&
      typeof value.text === 'string' &&
      normalize(value.text) === normalize(match.text) &&
      value.created_at === Date.parse(match.createdAt) / 1000
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
        if (Array.isArray(children)) for (const child of children) add(child);
      }
    }
    // Standalone child-comment responses explicitly bind every row to its parent.
    if (String(value.parent_comment_id ?? '') === match.id) {
      present = true;
      add(value);
    }
    for (const [key, item] of Object.entries(value))
      if (
        ![
          'variables',
          'params',
          'instanceParams',
          'route_match_infos',
        ].includes(key)
      )
        walk(item, depth + 1);
  };
  for (const body of bodies) walk(body, 0);
  return {
    present,
    valid,
    total: Math.max(total, entries.size),
    entries: [...entries.values()],
  };
}

export function checkedReplyRows(
  bodies: readonly unknown[],
  match: ReplyMatch,
  rows: readonly (Entry & { id?: string })[],
  capped: boolean,
  moreCount: number,
) {
  const answer = answerReplies(bodies, match);
  if (answer.present && !answer.valid)
    return { reason: 'reply-answer-conflict' as const };
  if (answer.present && !capped && answer.total > rows.length)
    return { reason: 'reply-answer-incomplete' as const };
  const entries: Entry[] = [];
  for (const row of rows) {
    if (!answer.present) {
      const { id: _id, ...value } = row;
      entries.push(value);
      continue;
    }
    const matches = answer.entries.filter(
      (value) =>
        (row.id ? row.id === value.id : true) &&
        value.account.toLowerCase() === row.account.toLowerCase() &&
        normalize(value.text) === normalize(row.text) &&
        (row.createdAt === null || value.createdAt === row.createdAt),
    );
    if (matches.length !== 1)
      return { reason: 'reply-answer-mismatch' as const };
    const { id: _id, ...value } = matches[0]!;
    entries.push(value);
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

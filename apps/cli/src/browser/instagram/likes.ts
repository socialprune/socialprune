import type { Page } from 'playwright-core';
import type { InstagramContext } from '@socialprune/core';
import { normalize } from './plan.ts';
import { readPost } from './selectors.ts';

interface MatchedComment {
  id: string;
  createdAt: string;
  username: string;
  text: string;
}
function answerObservation(
  bodies: readonly unknown[],
  match: MatchedComment,
): { present: boolean; count: number | null } {
  const values = new Set<number>();
  let visits = 0,
    invalid = false,
    present = false;
  const walk = (input: unknown, depth: number) => {
    if (++visits > 100000 || depth > 40 || !input || typeof input !== 'object')
      return;
    if (Array.isArray(input)) {
      for (const value of input) walk(value, depth + 1);
      return;
    }
    const value = input as Record<string, unknown>;
    const user = value['user'] as Record<string, unknown> | undefined;
    if (
      String(value['pk'] ?? value['id']) === match.id &&
      typeof user?.['username'] === 'string' &&
      user['username'].toLowerCase() === match.username.toLowerCase() &&
      typeof value['text'] === 'string' &&
      normalize(value['text']) === normalize(match.text) &&
      typeof value['created_at'] === 'number' &&
      value['created_at'] * 1000 === Date.parse(match.createdAt)
    ) {
      const count = value['comment_like_count'] ?? value['like_count'];
      if (count !== undefined) {
        present = true;
        if (
          typeof count === 'number' &&
          Number.isSafeInteger(count) &&
          count >= 0
        )
          values.add(count);
        else invalid = true;
      }
    }
    for (const [key, entry] of Object.entries(value))
      if (
        ![
          'variables',
          'params',
          'instanceParams',
          'route_match_infos',
        ].includes(key)
      )
        walk(entry, depth + 1);
  };
  for (const body of bodies) walk(body, 0);
  return {
    present,
    count:
      !invalid && visits <= 100000 && values.size === 1
        ? [...values][0]!
        : null,
  };
}
export function answerLikes(
  bodies: readonly unknown[],
  match: MatchedComment,
): number | null {
  return answerObservation(bodies, match).count;
}
export function parseVisibleLikes(text: string): number | null {
  if (!/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+) likes?$/.test(text))
    return null;
  const value = Number(text.replace(/ likes?$/, '').replaceAll(',', ''));
  return Number.isSafeInteger(value) ? value : null;
}
export async function commentLikes(
  page: Page,
  bodies: readonly unknown[],
  match: MatchedComment,
): Promise<NonNullable<InstagramContext['likes']>> {
  const answer = answerObservation(bodies, match);
  if (answer.present)
    return answer.count !== null
      ? { count: answer.count, source: 'answer' }
      : { count: null, source: null };
  try {
    const post = await readPost(page, new URL(page.url()).origin);
    if (
      post.comments.filter(
        (comment) =>
          comment.id === match.id &&
          comment.createdAt === match.createdAt &&
          comment.username.toLowerCase() === match.username.toLowerCase() &&
          normalize(comment.text) === normalize(match.text),
      ).length !== 1
    )
      return { count: null, source: null };
    const links = page.locator(`main a[href$="/c/${match.id}/"]`);
    if ((await links.count()) !== 1) return { count: null, source: null };
    const times = links.locator('time[datetime]');
    if (
      (await times.count()) !== 1 ||
      Date.parse((await times.getAttribute('datetime')) ?? '') !==
        Date.parse(match.createdAt)
    )
      return { count: null, source: null };
    // Only the exact permalink's own comment block; no ancestor post-like lookup.
    const block = links.locator('xpath=ancestor::*[5]');
    if ((await block.locator('a[href*="/c/"]').count()) !== 1)
      return { count: null, source: null };
    const values: number[] = [];
    for (const node of await block.locator('button,[role="button"]').all()) {
      const value = parseVisibleLikes(normalize(await node.innerText()));
      if (value !== null && (await node.isVisible())) values.push(value);
    }
    return values.length === 1
      ? { count: values[0]!, source: 'dom' }
      : { count: null, source: null };
  } catch {
    return { count: null, source: null };
  }
}

import { combinedReplyAnswer } from './replies-answer.ts';
import type { ReplyMatch } from './replies-answer.ts';
import { normalize } from './plan.ts';

const object = (input: unknown): Record<string, unknown> =>
  input && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
const id = (input: unknown) =>
  typeof input === 'string'
    ? input
    : typeof input === 'number' && Number.isSafeInteger(input)
      ? String(input)
      : '';
const parameters = new Set([
  'variables',
  'params',
  'instanceParams',
  'route_match_infos',
]);
const commentSets = new Set([
  'comments',
  'preview_comments',
  'edge_media_to_parent_comment',
  'edge_media_to_comment',
]);

/** Absence proof is limited to the admitted current-post answer, never parameters. */
export function soleCommentAnswer(
  bodies: readonly unknown[],
  scripts: readonly unknown[],
  match: ReplyMatch,
  code: string,
) {
  const answer = combinedReplyAnswer(bodies, match, scripts).answer;
  if (
    !answer.present ||
    !answer.valid ||
    answer.total !== 0 ||
    answer.entries.length !== 0
  )
    return false;
  const comments = new Set<string>();
  let valid = true,
    visits = 0;
  const walk = (input: unknown, depth: number, inSet = false, post = false) => {
    if (++visits > 100000 || depth > 40) {
      valid = false;
      return;
    }
    if (Array.isArray(input)) {
      for (const next of input) {
        if (!valid) break;
        walk(next, depth + 1, inSet, post);
      }
      return;
    }
    const value = object(input);
    if (!Object.keys(value).length) {
      if (inSet) valid = false;
      return;
    }
    const ownCode = value.code ?? value.shortcode;
    if (typeof ownCode === 'string' && ownCode !== code) return;
    const inPost = post || ownCode === code;
    if (
      inPost ||
      'comment_count' in value ||
      'comments_count' in value ||
      [...commentSets].some((key) => key in value)
    ) {
      for (const count of [
        value.comment_count,
        value.comments_count,
        object(value.comments).count,
        object(value.edge_media_to_parent_comment).count,
        object(value.edge_media_to_comment).count,
      ])
        if (count !== undefined && count !== 1) valid = false;
    }
    const commentId = id(value.pk ?? value.id),
      author = object(value.user ?? value.owner);
    const commentLike =
      typeof value.text === 'string' &&
      ('created_at' in value || 'created_at_utc' in value);
    if (commentId && (inSet || commentLike)) {
      comments.add(commentId);
      if (
        commentId !== match.id ||
        author.username !== match.username ||
        typeof value.text !== 'string' ||
        normalize(value.text) !== normalize(match.text) ||
        (value.created_at ?? value.created_at_utc) !==
          Date.parse(match.createdAt) / 1000
      )
        valid = false;
    } else if (
      inSet &&
      !('node' in value) &&
      ('text' in value || 'pk' in value || 'id' in value)
    )
      valid = false;
    for (const [key, next] of Object.entries(value)) {
      if (!valid) break;
      if (!parameters.has(key) && next && typeof next === 'object')
        walk(
          next,
          depth + 1,
          commentSets.has(key) || (inSet && !['user', 'owner'].includes(key)),
          inPost,
        );
    }
  };
  for (const input of [...bodies, ...scripts]) {
    if (!valid) break;
    walk(input, 0);
  }
  return valid && comments.size === 1 && comments.has(match.id);
}

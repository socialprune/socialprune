import { combinedReplyAnswer } from './replies-answer.ts';
import type { ReplyMatch } from './replies-answer.ts';
import { normalize } from './plan.ts';
import type { SoleCommentDiagnostic } from './report.ts';

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
export function inspectSoleCommentAnswer(
  bodies: readonly unknown[],
  scripts: readonly unknown[],
  match: ReplyMatch,
  code: string,
  guard: () => void = () => {},
) {
  guard();
  const combined = combinedReplyAnswer(bodies, match, scripts),
    answer = combined.answer;
  const diagnostic: SoleCommentDiagnostic = {
    observed: false,
    observationFailed: false,
    answerNamesFocal: false,
    answerValid: answer.present && answer.valid,
    childCountProofSource: combined.source,
    childCountProofClass:
      combined.source === 'conflict'
        ? 'mixed'
        : !answer.present
          ? 'absent'
          : !answer.valid
            ? 'invalid'
            : answer.total === 0
              ? 'zero'
              : 'positive',
    answerCommentSetSize: 0,
    answerSetValid: true,
    answerExtraEntries: {
      captionObjects: 0,
      otherParentReferences: 0,
      focalChildReferences: 0,
      unresolvedObjects: 0,
      duplicateFocalObjects: 0,
    },
    answerTraversalCapped: false,
    declaredCountSeen: 0,
    declaredCountsAllOne: null,
    pageMainCount: null,
    pageFocalPermalinks: null,
    pagePermalinks: null,
    pageSamePostPermalinks: null,
    pageReplyControls: null,
    pageOwnReplyControls: null,
    pageForeignReplyControls: null,
    pageExpandControls: null,
    pageRows: null,
    focalPresent: null,
    focalPermalinks: null,
    focalTimes: null,
    focalRows: null,
    focalControls: null,
    firstFailedGate: 'not-evaluated',
  };
  const comments = new Set<string>();
  let valid = true,
    visits = 0;
  let focalObjects = 0;
  const walk = (
    input: unknown,
    depth: number,
    inSet = false,
    post = false,
    inCaption = false,
  ) => {
    guard();
    if (++visits > 100000 || depth > 40) {
      valid = false;
      diagnostic.answerTraversalCapped = true;
      return;
    }
    if (Array.isArray(input)) {
      for (const next of input) {
        if (diagnostic.answerTraversalCapped) break;
        walk(next, depth + 1, inSet, post, inCaption);
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
      ]) {
        if (count !== undefined) {
          diagnostic.declaredCountSeen++;
          diagnostic.declaredCountsAllOne =
            diagnostic.declaredCountsAllOne !== false && count === 1;
        }
      }
    }
    const commentId = id(value.pk ?? value.id),
      author = object(value.user ?? value.owner);
    const commentLike =
      typeof value.text === 'string' &&
      ('created_at' in value || 'created_at_utc' in value);
    const namesFocal =
      commentId === match.id &&
      author.username === match.username &&
      typeof value.text === 'string' &&
      normalize(value.text) === normalize(match.text) &&
      (value.created_at ?? value.created_at_utc) ===
        Date.parse(match.createdAt) / 1000;
    diagnostic.answerNamesFocal ||= namesFocal;
    if (namesFocal && focalObjects++ > 0)
      diagnostic.answerExtraEntries!.duplicateFocalObjects++;
    if (commentId && (inSet || commentLike)) {
      comments.add(commentId);
      if (!namesFocal) {
        valid = false;
        const extra = diagnostic.answerExtraEntries!;
        const parent = id(value.parent_comment_id);
        if (inCaption) extra.captionObjects++;
        else if (parent === match.id) extra.focalChildReferences++;
        else if (parent) extra.otherParentReferences++;
        else extra.unresolvedObjects++;
      }
    } else if (
      inSet &&
      !('node' in value) &&
      ('text' in value || 'pk' in value || 'id' in value)
    )
      valid = false;
    for (const [key, next] of Object.entries(value)) {
      if (diagnostic.answerTraversalCapped) break;
      if (!parameters.has(key) && next && typeof next === 'object')
        walk(
          next,
          depth + 1,
          commentSets.has(key) || (inSet && !['user', 'owner'].includes(key)),
          inPost,
          inCaption || key === 'caption' || key === 'edge_media_to_caption',
        );
    }
  };
  for (const input of [...bodies, ...scripts]) {
    guard();
    if (diagnostic.answerTraversalCapped) break;
    walk(input, 0);
  }
  diagnostic.answerCommentSetSize = comments.size;
  guard();
  diagnostic.answerSetValid =
    valid &&
    !diagnostic.answerTraversalCapped &&
    comments.size === 1 &&
    comments.has(match.id);
  diagnostic.firstFailedGate = !diagnostic.answerNamesFocal
    ? 'sole-answer-focal'
    : !answer.present ||
        !answer.valid ||
        answer.total !== 0 ||
        answer.entries.length !== 0
      ? 'sole-child-proof'
      : !diagnostic.answerSetValid
        ? 'sole-answer-set'
        : diagnostic.declaredCountsAllOne === false
          ? 'sole-declared-count'
          : 'none';
  return { accepted: diagnostic.firstFailedGate === 'none', diagnostic };
}

export function soleCommentAnswer(
  bodies: readonly unknown[],
  scripts: readonly unknown[],
  match: ReplyMatch,
  code: string,
) {
  return inspectSoleCommentAnswer(bodies, scripts, match, code).accepted;
}

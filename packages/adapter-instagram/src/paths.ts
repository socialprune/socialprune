import type { ArchiveEntry } from '@socialprune/core';
import { username } from './format.ts';

export type Layout = 'current' | 'root-comments' | 'activity' | 'legacy';
export interface CommentFile {
  entry: ArchiveEntry;
  category: 'post-comments' | 'reels-comments';
  layout: Layout;
  format: 'json' | 'html';
  part: number;
}
function relativePaths(path: string): string[] {
  const parts = path.replaceAll('\\', '/').split('/');
  if (
    parts.some(
      (part) =>
        /^(?:messages?|direct(?:_messages)?|inbox|message_requests|secret_conversations|(?:security|login|logout|device|contact)[a-z_]*|account_history|threads|text_post_app.*|__macosx)$/i.test(
          part,
        ) || part.startsWith('._'),
    )
  )
    return [];
  const normalized = parts.join('/').toLowerCase();
  // At most one enclosing folder. This deliberately does not suffix-match
  // arbitrary nested paths where a private conversation could mimic a file.
  return [normalized, parts.slice(1).join('/').toLowerCase()];
}
export function commentFile(entry: ArchiveEntry): CommentFile | null {
  for (const path of relativePaths(entry.path)) {
    const match =
      /^(your_instagram_activity\/comments|comments|activity\/comments)\/(post_comments(?:_([1-9]\d*))?|reels_comments)\.(json|html?)$/.exec(
        path,
      );
    if (match) {
      return {
        entry,
        category:
          match[2] === 'reels_comments' ? 'reels-comments' : 'post-comments',
        layout:
          match[1] === 'comments'
            ? 'root-comments'
            : match[1] === 'activity/comments'
              ? 'activity'
              : 'current',
        format: match[4] === 'json' ? 'json' : 'html',
        part: Number(match[3] ?? 0),
      };
    }
    if (/^comments\.json$/.test(path))
      return {
        entry,
        category: 'post-comments',
        layout: 'legacy',
        format: 'json',
        part: 0,
      };
  }
  return null;
}
export function personalFile(entry: ArchiveEntry): boolean {
  return relativePaths(entry.path).some((path) =>
    /^(?:personal_information\/(?:personal_information\/)?|account_information\/)personal_information\.json$/.test(
      path,
    ),
  );
}
export function hasInstagramMarker(entry: ArchiveEntry): boolean {
  return relativePaths(entry.path).some((path) =>
    /^your_instagram_activity\/(?:comments|media|likes|saved)\//.test(path),
  );
}
export function archiveHandle(name: string): string | null {
  const basename = name.replaceAll('\\', '/').split('/').at(-1) ?? '';
  const match =
    /^instagram-([a-z0-9._]{1,30})-(\d{4}-\d{2}-\d{2})-[a-z0-9][a-z0-9_-]*(?:\s*\(\d+\))?(?:\.zip)?$/i.exec(
      basename,
    );
  if (!match) return null;
  const date = new Date(`${match[2]}T00:00:00.000Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== match[2]
  )
    return null;
  return username(match[1]);
}
export function compareFiles(a: CommentFile, b: CommentFile): number {
  const category =
    Number(a.category === 'reels-comments') -
    Number(b.category === 'reels-comments');
  return (
    category ||
    a.part - b.part ||
    (a.entry.path < b.entry.path ? -1 : a.entry.path > b.entry.path ? 1 : 0)
  );
}

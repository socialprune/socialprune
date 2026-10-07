import { parseJsonArrayStream, stableId } from '@socialprune/core';
import type {
  Account,
  ArchiveEntry,
  ArchiveReader,
  Diagnostic,
  ParseContext,
  ParseEvent,
  PlatformAdapter,
} from '@socialprune/core';
import {
  object,
  parseComment,
  parseLegacyComment,
  profileUsername,
} from './format.ts';
import type { CommentData } from './format.ts';
import {
  archiveHandle,
  commentFile,
  compareFiles,
  hasInstagramMarker,
  personalFile,
} from './paths.ts';
import type { CommentFile } from './paths.ts';

export const PLATFORM = 'instagram';
export const PERSONAL_MAX_BYTES = 64 * 1024;
export const REELS_MAX_BYTES = 32 * 1024 * 1024;

function canceled(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new DOMException('Operation aborted.', 'AbortError');
}
function rethrowAbort(error: unknown, signal?: AbortSignal): void {
  canceled(signal);
  if (error instanceof Error && error.name === 'AbortError') throw error;
}
function json(text: string): unknown {
  return JSON.parse(text.replace(/^\uFEFF/, '')) as unknown;
}
function filesFor(archive: ArchiveReader): CommentFile[] {
  return archive.list().flatMap((entry) => {
    const file = commentFile(entry);
    if (!file) return [];
    if (
      file.layout === 'legacy' &&
      !archiveHandle(entry.archive) &&
      !archive
        .list()
        .some(
          (other) =>
            other.archive === entry.archive &&
            (personalFile(other) || hasInstagramMarker(other)),
        )
    )
      return [];
    return [file];
  });
}
async function accountFor(
  archive: ArchiveReader,
  name: string,
  entries: readonly ArchiveEntry[],
  ctx: ParseContext,
): Promise<{ account: Account; diagnostic: Diagnostic }> {
  let handle = archiveHandle(name);
  let status: Diagnostic['status'] = handle ? 'found' : 'missing';
  const files: string[] = [];
  if (!handle) {
    // One small, explicitly allowlisted profile file per archive, never a
    // recursive search through personal fields or security/account history.
    const entry = entries
      .filter(personalFile)
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))[0];
    if (entry) {
      files.push(entry.path);
      try {
        const profile = profileUsername(
          json(
            await archive.readText(entry, {
              signal: ctx.signal,
              maxBytes: Math.min(PERSONAL_MAX_BYTES, ctx.limits.maxTextBytes),
            }),
          ),
        );
        handle = profile.handle;
        status = profile.status;
      } catch (error) {
        rethrowAbort(error, ctx.signal);
        status = 'unreadable';
      }
    }
  }
  return {
    account: { key: `instagram:${handle ?? (await stableId([name]))}`, handle },
    diagnostic: {
      category: 'account',
      status,
      files,
      count: handle ? 1 : 0,
      message:
        status === 'found'
          ? null
          : status === 'unreadable'
            ? 'Account username metadata could not be read; using an archive-specific key.'
            : 'Account handle unavailable; using an archive-specific key.',
    },
  };
}
async function* comments(
  archive: ArchiveReader,
  file: CommentFile,
  ctx: ParseContext,
): AsyncIterable<unknown> {
  if (file.layout !== 'legacy' && file.category === 'post-comments') {
    yield* parseJsonArrayStream(
      archive.streamText(file.entry, { signal: ctx.signal }),
      {
        assignment: 'none',
        signal: ctx.signal,
        maxElementBytes: ctx.limits.maxElementBytes,
      },
    );
    return;
  }
  const data = json(
    await archive.readText(file.entry, {
      signal: ctx.signal,
      maxBytes: Math.min(REELS_MAX_BYTES, ctx.limits.maxTextBytes),
    }),
  );
  let rows: unknown;
  if (file.layout === 'legacy') rows = object(data)?.media_comments;
  else if (Array.isArray(data)) rows = data;
  else {
    const wrapper = object(data);
    if (!wrapper) throw new TypeError('Invalid comments wrapper.');
    const arrays = Object.values(wrapper).filter(Array.isArray);
    // The task's comments_reels_comments wrapper and renamed single-array
    // wrappers are tolerated, but two candidate arrays are not guessed at.
    if (arrays.length !== 1) throw new TypeError('Ambiguous comments wrapper.');
    rows = arrays[0];
  }
  if (!Array.isArray(rows)) throw new TypeError('Invalid comments array.');
  for (const row of rows) {
    canceled(ctx.signal);
    yield row as unknown;
  }
}
function aggregateStatus(states: Diagnostic['status'][]): Diagnostic['status'] {
  return states.includes('unreadable')
    ? 'unreadable'
    : states.includes('missing')
      ? 'missing'
      : states.includes('empty')
        ? 'empty'
        : 'found';
}

export const instagramAdapter: PlatformAdapter = {
  platform: PLATFORM,
  name: 'socialprune-instagram',
  version: '0.1.0',
  // Newest-first matches the planned comment-activity workflow. The platform
  // direction is unverified until the maintainer reads the help pages in GD.
  clickListOrder: 'day',
  detect(archive) {
    const files = filesFor(archive);
    const jsonFiles = files.filter((file) => file.format === 'json');
    const layouts = [...new Set(jsonFiles.map((file) => file.layout))];
    if (!jsonFiles.length && files.some((file) => file.format === 'html'))
      return Promise.resolve({
        result: 'html-export',
        variant: 'html',
        reason:
          'Request the Instagram export in JSON format; HTML comments are not imported.',
      });
    const marker = archive
      .list()
      .some((entry) => personalFile(entry) || hasInstagramMarker(entry));
    const legacyOnly =
      jsonFiles.length > 0 &&
      jsonFiles.every((file) => file.layout === 'legacy');
    if (
      (jsonFiles.length &&
        (!legacyOnly ||
          marker ||
          archive.archives.some((name) => archiveHandle(name) !== null))) ||
      marker
    )
      return Promise.resolve({
        result: 'match',
        variant:
          layouts.length > 1 ? 'json-mixed' : `json-${layouts[0] ?? 'current'}`,
        reason: 'Instagram JSON export layout recognized.',
      });
    return Promise.resolve({
      result: 'no-match',
      variant: null,
      reason: 'No supported Instagram export layout found.',
    });
  },
  async *parse(archive, ctx): AsyncIterable<ParseEvent> {
    const all = filesFor(archive);
    const categories = ['post-comments', 'reels-comments'] as const;
    const stats = new Map(
      categories.map((category) => [
        category,
        { files: [] as string[], count: 0, rows: 0, unreadable: false },
      ]),
    );
    const accountDiagnostics: Diagnostic[] = [];
    const foundAccounts = new Set<string>();
    const emitted = new Set<string>();
    // The order depends only on archive metadata and numbered file paths,
    // never on ZIP central-directory ordering or platform locale collation.
    const names = [...new Set(archive.archives)]
      .filter((name) => {
        return (
          all.some((file) => file.entry.archive === name) ||
          archive
            .list()
            .some(
              (entry) =>
                entry.archive === name &&
                (personalFile(entry) || hasInstagramMarker(entry)),
            )
        );
      })
      .sort();
    for (const name of names) {
      canceled(ctx.signal);
      const entries = archive.list().filter((entry) => entry.archive === name);
      const { account, diagnostic } = await accountFor(
        archive,
        name,
        entries,
        ctx,
      );
      accountDiagnostics.push(diagnostic);
      if (diagnostic.status === 'found') foundAccounts.add(account.key);
      yield { type: 'account', account };
      // Ordinals continue across numbered files in one archive, but restart
      // for another part. Equal IDs in another part represent overlap, not a
      // second copy. Without upstream IDs this is a multiplicity assumption.
      const occurrences = new Map<string, number>();
      for (const file of all
        .filter((file) => file.entry.archive === name)
        .sort(compareFiles)) {
        const state = stats.get(file.category)!;
        state.files.push(file.entry.path);
        if (file.format === 'html') {
          state.unreadable = true;
          continue;
        }
        let index = 0;
        try {
          for await (const row of comments(archive, file, ctx)) {
            canceled(ctx.signal);
            state.rows++;
            const parsed: CommentData | null =
              file.layout === 'legacy'
                ? parseLegacyComment(row)
                : parseComment(row);
            const position = index++;
            if (!parsed) {
              state.unreadable = true;
              continue;
            }
            // Media filenames can change in a later export of the same account.
            // Keep URIs and counts out of identity so re-import preserves IDs
            // (ADR-006); equal media-only rows use the existing ordinal below.
            const parts = [
              account.key,
              parsed.createdAt,
              parsed.ownerHandle ?? '',
              parsed.text,
            ];
            const fingerprint = await stableId(parts);
            const ordinal = (occurrences.get(fingerprint) ?? 0) + 1;
            occurrences.set(fingerprint, ordinal);
            const id = `instagram:${ordinal === 1 ? fingerprint : await stableId([...parts, String(ordinal)])}`;
            if (emitted.has(id)) continue;
            emitted.add(id);
            state.count++;
            yield {
              type: 'item',
              item: {
                id,
                platform: PLATFORM,
                account,
                kind: 'comment',
                text: parsed.text,
                createdAt: parsed.createdAt,
                mediaCount: parsed.mediaCount ?? null,
                engagement: { likes: null, reposts: null },
                reference: {
                  replyToId: null,
                  replyToHandle: null,
                  quotedId: null,
                  repostOfHandle: null,
                  ownerHandle: parsed.ownerHandle,
                },
                url: null,
                provenance: {
                  archive: name,
                  file: file.entry.path,
                  index: position,
                },
              },
            };
          }
        } catch (error) {
          rethrowAbort(error, ctx.signal);
          // Never echo a JSON error, row, private filename or archive content.
          state.unreadable = true;
        }
      }
    }
    yield {
      type: 'diagnostic',
      diagnostic: {
        category: 'account',
        status: aggregateStatus(
          accountDiagnostics.map((diagnostic) => diagnostic.status),
        ),
        files: accountDiagnostics.flatMap((diagnostic) => diagnostic.files),
        count: foundAccounts.size,
        message:
          accountDiagnostics.find((diagnostic) => diagnostic.status !== 'found')
            ?.message ?? null,
      },
    };
    for (const category of categories) {
      const state = stats.get(category)!;
      const status = state.unreadable
        ? 'unreadable'
        : !state.files.length
          ? 'missing'
          : !state.rows
            ? 'empty'
            : 'found';
      yield {
        type: 'diagnostic',
        diagnostic: {
          category,
          status,
          files: state.files,
          count: state.count,
          message:
            status === 'unreadable'
              ? 'Some comment data could not be read; other readable comments were imported.'
              : status === 'missing'
                ? 'Comment category is not present in this export.'
                : null,
        },
      };
    }
    yield { type: 'meta', exportCreatedAt: null };
  },
  deletionHint(_item) {
    // Grouping by day in the user's timezone belongs to the review UI.
    return { action: 'delete-comment', url: null, group: null };
  },
};

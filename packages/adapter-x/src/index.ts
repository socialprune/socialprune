import { DEFAULT_IMPORT_LIMITS, parseJsonArrayStream } from '@socialprune/core';
import type {
  Account,
  ArchiveReader,
  Diagnostic,
  ParseContext,
  ParseEvent,
  PlatformAdapter,
} from '@socialprune/core';
import { assignedObject, files, readArray } from './archive.ts';
import type { Category, File } from './archive.ts';
import {
  decimalId,
  decodeEntities,
  matchingNotes,
  object,
  parseIsoDate,
  parseTweetDate,
  text,
  tweetItem,
  unwrapTweet,
} from './tweet.ts';
import type { Note } from './tweet.ts';

export const PLATFORM = 'x';
const categories: Category[] = [
  'account',
  'manifest',
  'tweets',
  'note-tweets',
  'deleted-tweets',
  'community-tweets',
];
const smallFileBytes = 1024 * 1024;

interface State {
  files: string[];
  count: number;
  failed: boolean;
}
function diagnostic(category: Category, state: State): Diagnostic {
  const status = state.failed
    ? 'unreadable'
    : !state.files.length
      ? 'missing'
      : state.count
        ? 'found'
        : 'empty';
  return {
    category,
    status,
    files: state.files,
    count: state.count,
    message:
      status === 'unreadable'
        ? 'Some files or records could not be parsed.'
        : status === 'missing'
          ? 'This export category is absent.'
          : status === 'empty'
            ? 'This export category contains no records.'
            : category === 'deleted-tweets'
              ? 'Already deleted posts were counted and were not imported.'
              : 'Export records were read.',
  };
}
function rethrowAbort(error: unknown, ctx: ParseContext): void {
  if (ctx.signal?.aborted)
    throw new DOMException('Operation aborted.', 'AbortError');
  if (error instanceof Error && error.name === 'AbortError') throw error;
}

async function accountFrom(
  archive: ArchiveReader,
  file: File,
  ctx: ParseContext,
): Promise<Account[]> {
  const content = await archive.readText(file.entry, {
    maxBytes: Math.min(smallFileBytes, ctx.limits.maxTextBytes),
    signal: ctx.signal,
  });
  if (file.format === 'grailbird') {
    const user = assignedObject(content, true);
    const id = decimalId(user.id);
    if (!id) throw new TypeError('Invalid account metadata.');
    return [{ key: `x:${id}`, handle: text(user.screen_name) }];
  }
  async function* chunks() {
    await Promise.resolve();
    yield content;
  }
  const parser = parseJsonArrayStream(chunks(), {
    assignment: 'allowed',
    maxElementBytes: ctx.limits.maxElementBytes,
    signal: ctx.signal,
  });
  const accounts: Account[] = [];
  for await (const value of parser) {
    const account = object(object(value)?.account);
    const id = decimalId(account?.accountId);
    if (!id) throw new TypeError('Invalid account metadata.');
    accounts.push({ key: `x:${id}`, handle: text(account?.username) });
  }
  const target = await parser.target;
  if (target !== ['window', 'YTD', 'account', 'part0'].join('.'))
    throw new TypeError('Invalid account metadata.');
  if (accounts.length > 1)
    throw new TypeError('An export root must describe one account.');
  return accounts;
}

async function* parse(
  archive: ArchiveReader,
  ctx: ParseContext,
): AsyncGenerator<ParseEvent> {
  const selected = files(archive);
  const states = Object.fromEntries(
    categories.map((category) => [
      category,
      {
        files: selected
          .filter((file) => file.category === category)
          .map((file) => file.path),
        count: 0,
        failed: false,
      },
    ]),
  ) as Record<Category, State>;
  const roots = new Map<string, File[]>();
  for (const file of selected) {
    const key = JSON.stringify([file.archive, file.root]);
    const group = roots.get(key) ?? [];
    group.push(file);
    roots.set(key, group);
  }
  const dates: string[] = [];
  let unmatched = 0;
  let ambiguous = 0;
  for (const group of roots.values()) {
    const first = group[0]!;
    let account: Account = {
      key: `x:archive:${first.archive}${first.root ? `:${first.root}` : ''}`,
      handle: null,
    };
    for (const file of group.filter((file) => file.category === 'account')) {
      try {
        const accounts = await accountFrom(archive, file, ctx);
        states.account.count += accounts.length;
        if (accounts[0]) account = accounts[0];
      } catch (error) {
        rethrowAbort(error, ctx);
        states.account.failed = true;
      }
    }
    yield { type: 'account', account };
    for (const file of group.filter((file) => file.category === 'manifest')) {
      try {
        const content = await archive.readText(file.entry, {
          maxBytes: Math.min(smallFileBytes, ctx.limits.maxTextBytes),
          signal: ctx.signal,
        });
        const manifest = assignedObject(content);
        const date = parseIsoDate(object(manifest.archiveInfo)?.generationDate);
        if (!date) throw new TypeError('Invalid export generation timestamp.');
        dates.push(date);
        states.manifest.count++;
      } catch (error) {
        rethrowAbort(error, ctx);
        states.manifest.failed = true;
      }
    }
    const notes = new Map<string, Note[]>();
    let matchingComplete = true;
    for (const file of group.filter(
      (file) => file.category === 'note-tweets',
    )) {
      try {
        for await (const value of readArray(archive, file, ctx)) {
          states['note-tweets'].count++;
          const note = object(object(value)?.noteTweet);
          const date = parseIsoDate(note?.createdAt);
          const content = text(object(note?.core)?.text);
          if (!note || !date || content === null) {
            states['note-tweets'].failed = true;
            matchingComplete = false;
            continue;
          }
          const key = date.slice(0, 19);
          const bucket = notes.get(key) ?? [];
          bucket.push({
            text: decodeEntities(content),
            createdAt: date,
            hits: 0,
            used: false,
            ambiguous: false,
          });
          notes.set(key, bucket);
        }
      } catch (error) {
        rethrowAbort(error, ctx);
        states['note-tweets'].failed = true;
        matchingComplete = false;
      }
    }
    const itemFiles = ['tweets', 'community-tweets'].flatMap((category) =>
      group.filter((file) => file.category === category),
    );
    // A preliminary pass counts both sides of the heuristic relation. Only
    // mutually unique matches can replace text, regardless of array order.
    if (notes.size) {
      for (const file of itemFiles) {
        try {
          for await (const value of readArray(archive, file, ctx)) {
            const tweet = unwrapTweet(value);
            const date = parseTweetDate(tweet?.created_at);
            const content = text(tweet?.full_text) ?? text(tweet?.text);
            if (!date || content === null || !decimalId(tweet?.id_str))
              continue;
            const matches = matchingNotes(decodeEntities(content), date, notes);
            for (const note of matches) {
              note.hits++;
              if (matches.length > 1 || note.hits > 1) note.ambiguous = true;
            }
          }
        } catch (error) {
          rethrowAbort(error, ctx);
          states[file.category].failed = true;
          matchingComplete = false;
        }
      }
    }
    for (const file of itemFiles) {
      let index = 0;
      try {
        for await (const value of readArray(archive, file, ctx)) {
          states[file.category].count++;
          const item = tweetItem(value, account, file.entry, index++);
          if (!item) {
            states[file.category].failed = true;
            continue;
          }
          if (notes.size && matchingComplete) {
            const matches = matchingNotes(item.text, item.createdAt, notes);
            const note = matches[0];
            if (matches.length === 1 && note?.hits === 1 && !note.ambiguous) {
              item.text = note.text;
              note.used = true;
            }
          }
          yield { type: 'item', item };
        }
      } catch (error) {
        rethrowAbort(error, ctx);
        states[file.category].failed = true;
      }
    }
    for (const file of group.filter(
      (file) => file.category === 'deleted-tweets',
    )) {
      try {
        for await (const value of readArray(archive, file, ctx)) {
          void value;
          states['deleted-tweets'].count++;
        }
      } catch (error) {
        rethrowAbort(error, ctx);
        states['deleted-tweets'].failed = true;
      }
    }
    for (const bucket of notes.values())
      for (const note of bucket) {
        if (!note.used) unmatched++;
        if (note.ambiguous) ambiguous++;
      }
  }
  // A composed import has one record in core. Keep the newest known export
  // date there; account association remains scoped to each archive/root.
  yield { type: 'meta', exportCreatedAt: dates.sort().at(-1) ?? null };
  for (const category of categories)
    yield {
      type: 'diagnostic',
      diagnostic: diagnostic(category, states[category]),
    };
  if (unmatched)
    yield {
      type: 'diagnostic',
      diagnostic: {
        category: 'unmatched-note-tweets',
        status: 'skipped',
        files: states['note-tweets'].files,
        count: unmatched,
        message:
          'Notes without a unique timestamp and text-prefix match were not imported separately.',
      },
    };
  if (ambiguous)
    yield {
      type: 'diagnostic',
      diagnostic: {
        category: 'ambiguous-note-tweets',
        status: 'skipped',
        files: states['note-tweets'].files,
        count: ambiguous,
        message:
          'Ambiguous note matches left the original post text unchanged.',
      },
    };
}

export const xAdapter: PlatformAdapter = {
  platform: PLATFORM,
  name: 'socialprune-x',
  version: '0.1.0',
  clickListOrder: 'risk',
  async detect(archive) {
    const selected = files(archive);
    if (
      !selected.length ||
      selected.every((file) => file.category === 'manifest')
    )
      return {
        result: 'no-match',
        variant: null,
        reason: 'No recognized X export paths were found.',
      };
    const main = selected.find((file) => file.category === 'tweets');
    let variant: string = main?.format ?? 'ytd-tweets';
    if (main?.format === 'ytd-tweet') {
      // The historical wrapped and flat layouts use the same filename.
      // Inspect one streamed element only; parsing will read the file anew.
      const iterator = readArray(archive, main, {
        limits: { ...DEFAULT_IMPORT_LIMITS },
        now: () => new Date(),
      })[Symbol.asyncIterator]();
      try {
        const first = await iterator.next();
        if (
          !first.done &&
          object(first.value) &&
          !('tweet' in object(first.value)!)
        )
          variant = 'ytd-tweet-unwrapped';
      } catch {
        /* A recognized but corrupt file is still an X export. */
      } finally {
        await iterator.return(undefined);
      }
    }
    return {
      result: 'match',
      variant,
      reason: 'Recognized X export paths were found.',
    };
  },
  parse,
  deletionHint(item) {
    return {
      action: item.kind === 'repost' ? 'undo-repost' : 'delete',
      url: item.url,
      group: null,
    };
  },
};

# ADR-030: Instagram post context as its own workspace record

- **Status:** Accepted on 2026-10-16 by the maintainer (card IG-4, version 3)
- **Date:** 2026-10-15, amended 2026-10-18 (IG-8: a post confirmed through the comments list, schema version 6)
- **Hard constraints touched:** 2 (the records and their files stay in the workspace; a backup carries the records, not the files), 4 (the journal records every signed-in Instagram read, [ADR-023](ADR-023-acting-in-own-account.md) PA-6), 6 (tests build their workspaces from generated data)
- **Supersedes in part, on acceptance:** [ADR-005](ADR-005-browser-storage.md), [ADR-006](ADR-006-workspace-event-log.md), [ADR-007](ADR-007-review-data-worker.md), [ADR-015](ADR-015-cli-storage-node-baseline.md). The section "Changes to other records" gives the new wording. It builds on the journal of [ADR-027](ADR-027-x-deletion-browser.md), accepted on 2026-10-25, and on schema version 4 of [ADR-029](ADR-029-signed-in-originals-pass.md), accepted on 2026-10-24. If either is built with other numbers, this record takes the next free number for the document, the IndexedDB database and the SQLite layout, and the build notes which.
- **Related:** [ADR-028](ADR-028-instagram-signed-in-session.md), which decides how a comment is found and confirmed and what is kept; [ADR-017](ADR-017-shared-workspace-service.md); [ADR-026](ADR-026-x-originals-fetch.md); spike [S5](../../spikes/S5.md)

**Amended 2026-10-23 by the maintainer's decision IG-OWNER A** (21:28:47Z, "Ja, continue accordingly nach deiner Empfehlung"). This implements his decision of 2026-10-16, IG-4 v3 item 5, to confirm owner-less comments by three checks and mark them owner-unchecked, with the reading checks in [ADR-028](ADR-028-instagram-signed-in-session.md)'s IG-OWNER A amendment. The record gains required `ownerCheck: 'matched-export' | 'not-in-export'`. An owner-less confirmation keeps `confirmedBy: 'post'`, the comment ID and exact permalink time, sets `ownerCheck: 'not-in-export'`, and stores the account actually read from the post in `post.owner`; a reader accepts it only for an item without an exported owner, with nonempty text and a comment time within 60 seconds of its export time. A `list` confirmation always requires `matched-export` and an exported owner equal to `post.owner`, as does an owner-bearing `post` confirmation. These rules supersede section 5's unconditional exported-owner requirement and extend section 1's record without erasing either historical description. The workspace document, SQLite layout and IndexedDB database move from version 7 to 8, writers write 8 and portable readers accept 1 to 8; existing records gain `matched-export` without changing their `post` or `list` kind, and a version-5 record also gains its formerly implicit `post` kind. SQLite acquires `BEGIN EXCLUSIVE`, copies the database file before its first migration write, rewrites the records and recreates both write-once triggers in the same transaction; a read-only open of version 7 projects the new field without modifying the file. IndexedDB rewrites records by cursor in its upgrade transaction and aborts on failure. Both backup readers migrate older evidence, retain version-8 owner-unchecked evidence and reject missing version-8 markers regardless of property order; backups still omit media files. The review keeps its two owner-matched sentences and adds an honest German and English sentence for owner-unchecked post evidence. The maintainer's real workspace migrates only through the parent's package step after a dated backup; the implementation and migration proofs use generated data only.

**Version amendment, 2026-10-24, ADR-DEL A point 3.** The maintainer's version-skew decision supersedes the current-writer and reader-ceiling sentences in the IG-OWNER A amendment above. Workspace documents, SQLite layouts, IndexedDB databases and portable writers now use version 9; portable readers accept versions 1 to 9. Version 8 still names the owner-check migration and its mandatory marker. From 8 to 9 no Instagram record changes and no warning classification is invented. SQLite copies before writing, creates the warning/acknowledgement tables under `BEGIN EXCLUSIVE` and retains the context write-once triggers; IndexedDB changes metadata in its atomic upgrade transaction. A version-8 installed package refuses the migrated workspace and its portable backup, as [ADR-027](ADR-027-x-deletion-browser.md)'s version boundary requires.

## Context

[ADR-028](ADR-028-instagram-signed-in-session.md), as revised on 2026-10-15, keeps for each exported Instagram comment that SocialPrune confirmed on its post the post's owner, caption, date and link, its first image, a small screenshot, and the evidence of the confirmation. The maintainer decided this on 2026-10-15 (card IG-3, point 2). This record decides where those records live and what the shared core has to change for them.

The originals model of ADR-026 and ADR-029 is shaped by X. `OriginalIdSchema` in `packages/core/src/model/original.ts` accepts only digits, while an Instagram post code in `/p/<code>/` holds letters, digits, `_` and `-`. That ID is the primary key of the SQLite table `originals`, the key path of the IndexedDB store `originals`, the parameter of `getOriginals` and `getConversation`, the folder in the review route `/originals/<digits>/`, and `BrowserAttempt.originalId` in the journal. An original is keyed by a post someone else wrote and is shared by every entry that references it. It carries X's answer fields: media variants, alt text, `chainAbove`, `raw` and `signedInRecord`.

An Instagram context is keyed differently. It belongs to one exported comment and carries evidence about that comment, the comment's own ID and time from its permalink, next to facts about the post. The export gives no post ID to key on.

The journal is shaped by X as well. `BrowserRunSchema.platform` in `packages/core/src/model/browser.ts` is the literal `x`, and `validateBrowserJournal` requires every attempt other than `read-post` to name an item whose ID starts with `x:`.

The architecture map says a new platform should need no change in `packages/core`, and that a needed change is a gap that needs its own decision record. Instagram is not new: its adapter imports comments without any change here. The gap is in the records of the acting features of [ADR-023](ADR-023-acting-in-own-account.md), which have lived in core per platform since ADR-026 and ADR-027. This is that record.

## Decision Drivers

- Leave X's originals, their IDs, routes and journal entries unchanged while the ADR-029 build works on them.
- Let a backup carry the Instagram records from the CLI to the browser and back, as it carries originals today.
- Let a reader reject, from the data alone, a record that breaks IG-3's rule.
- Keep one journal, and one daily count per platform and account.
- Make the smallest change to core that does all of this.

## Options

### Option A: Generalize originals to platform-aware IDs

`Original.id` becomes `x:<digits>` or `instagram:<code>`, the record gains a platform field and optional Instagram fields, and the Instagram evidence goes into the same record.

**Pros:**
- One record kind, one store, one route and one protocol request for both platforms.
- The review already loads originals, so the card needs no new request.

**Cons:**
- Every stored X original, every `originalId` in the journal and every media folder changes its key in a migration, while another lane builds on the current keys.
- The evidence is per comment, and one post can carry several of the person's comments, so a second record or a list inside the post is needed anyway.
- X's conversation chain, quoted posts and the fill writer would all have to ignore Instagram records.

**Effort:** not measured
**Risk:** High, because it migrates stored X data and the X journal.

### Option B: One Instagram context record per confirmed comment

A new record keyed by the exported comment's item ID, in its own array, store and table, holds the post's facts and the confirmation evidence together. The journal gains a platform value.

**Pros:**
- X's originals and their build are untouched.
- The reader can check IG-3's rule for each record against its own item.
- The card looks a record up by the item it already shows.

**Cons:**
- The post's facts repeat when the person commented on the same post more than once.
- One more record kind in backups, in both stores and in the protocol, and a version bump for every reader.

**Effort:** not measured
**Risk:** Medium, because the version bump touches every writer and must be coordinated with other lanes.

### Option C: A post record and a link record

`InstagramPost` keyed by post code, and `InstagramCommentLink` keyed by item ID, pointing at the post.

**Pros:**
- No repeated post facts.
- A later read of the same post updates one record.

**Cons:**
- Two arrays, two stores, two tables and two sets of reader checks, and a join in every display.
- The repetition it removes occurs only when the person commented on one post several times.

**Effort:** not measured
**Risk:** Medium.

### Option D: Keep the records in the CLI only

A SQLite table outside the workspace document, as ADR-029 keeps its written-order audit.

**Pros:**
- No change to the core records and no version bump.
- Nothing new for the browser to store.

**Cons:**
- A backup loses every confirmed context, which X's originals do not.
- The journal's platform literal and the review protocol live in core, so core changes anyway.

**Effort:** not measured
**Risk:** Medium, because a restore drops data without saying so.

## Decision

We chose **Option B: one Instagram context record per confirmed comment**, because it leaves X's data and its build untouched, keeps backups whole in both directions, and lets the reader check IG-3 on every record. The repetition costs a few fields for each extra comment on the same post, and the files are stored once per post.

### 1. The record

```ts
InstagramContext = {
  itemId: string,                    // the exported comment, 'instagram:<id>'
  accountKey: string,                // that item's account
  post: {
    kind: 'p' | 'reel',              // the path the post opened at
    code: string,                    // [A-Za-z0-9_-]{1,64}
    owner: string,                   // first account named in the post header, without '@'
    ownerCount: number,              // accounts named in the header, 1 or more
    createdAt: UtcTimestamp | null,  // the post's own time element
    caption: string | null,          // as the page showed it, at most 10,000 characters
    captionComplete: boolean         // false when the page offered a control to show more
  },
  confirmedBy: 'post' | 'list',      // ADR-028 section 4; 'list' since IG-8, 2026-10-18
  comment: {
    id: string | null,               // the digits of the permalink /c/<id>/; null for 'list'
    createdAt: UtcTimestamp | null,  // the permalink's time element; null for 'list'
    expandClicks: number             // expansion clicks it needed, 0 to 10
  },
  image: {
    file: 'image.jpg' | 'image.png' | 'image.webp' | null,
    host: string | null,             // the host it came from, never the address
    status: 'stored' | 'not-captured' | 'not-image' | 'too-large'
  },
  screenshot: {
    file: 'shot.jpg' | null,
    bytes: number | null,
    status: 'stored' | 'too-large' | 'failed'
  },
  confirmedAt: UtcTimestamp,
  runId: string,
  attemptId: string                  // the sending record of its confirm-comment attempt
}
```

- Only a confirmed comment gets a record. Every other result is a journal attempt, so a comment without a record is simply not confirmed.
- Links are built, not stored: the post is `https://www.instagram.com/<kind>/<code>/`, the comment `https://www.instagram.com/<kind>/<code>/c/<id>/`. A record confirmed through the list has no comment link. No address string from a page enters the workspace.
- Files sit under `<workspace>/context/instagram/<hex>/`, where `<hex>` is the post code's bytes in lowercase hexadecimal. Instagram's codes differ by letter case and Windows folder names do not, so the code itself cannot name the folder. Files are written once per post, and a second record for the same post names the same files.
- A record is written once. A later run leaves out every item that has one. Item IDs survive a re-import ([ADR-006](ADR-006-workspace-event-log.md)), so the records stay linked.
- What each field is read from, and the limits on the files, are in ADR-028, section 5.

### 2. The journal

- `BrowserRun.platform` becomes `'x' | 'instagram'`. `mode` gains `'context'`, allowed only with `instagram`; `delete`, `verify` and `fill` stay allowed only with `x`. `canaryAcceptedAt` is allowed on a run in mode `fill` or `context` that ended with `canary`.
- `BrowserAttempt.action` gains `'confirm-comment'`. Its `itemId` names an existing Instagram comment of the run's account, `originalId` is absent, and its run has platform `instagram` and mode `context`. Every other action that names an item still names an `x:` item.
- `BrowserAttempt.state` gains `confirmed`, `unconfirmed` and `not-listed`. A `confirm-comment` attempt is one `sending` record, appended and committed before the first navigation of that comment's first step, and exactly one settling record: `confirmed`, `unconfirmed`, `not-listed`, `unavailable` or `failed`. Reading changes nothing on Instagram, so it is never `ambiguous`; a run that starts and finds a `sending` record without a settling record first appends `failed` with the code `INTERRUPTED`, as ADR-029 does for reads.
- The `code` of an `unconfirmed` attempt names the check that failed: `text`, `time`, `owner`, `several` or `not-shown`. A `not-listed` attempt carries `no-row` or `window-full`. A `failed` attempt carries `INTERRUPTED` or the run's stop code.
- On an Instagram run, `pageOpens` counts the steps of ADR-028, section 3, each one load of the comments list with at most one post opened from it. The daily count of an Instagram run is the sum of `pageOpens` over runs with platform `instagram` and the same account whose start falls on the same calendar day in the workspace time zone. X's count stays as ADR-029 defines it. Account keys already begin with their platform (`x:` or `instagram:`), so the two counts never add up (IG-3, point 3), and the Instagram count also checks the platform.
- `BrowserRequest` gains an optional `operation`, the value of the `x-fb-friendly-name` request header, at most 256 characters of `[A-Za-z0-9_]`, or `null`. Instagram's page reads through `POST` requests to one path, so the operation name is what tells the person in the read-back what a request was. No other header and no body is stored.

### 3. The narrow writer

`InstagramContextWriter` in `packages/core/src/workspace/` starts a run, closing an unfinished `context` run of the same account as ADR-029's fill writer does; appends `sending`; counts a step; settles an attempt; confirms, which writes the `confirmed` settling record and the context record in one transaction; ends a run; and records a canary acceptance. It has no method for decision or outcome events, and only the Instagram runner constructs it ([ADR-023](ADR-023-acting-in-own-account.md) PA-16).

### 4. Versions and migration

- The workspace document goes to `schemaVersion: 5`. Readers accept versions 1 to 5 and writers write 5. A reader built for version 4 refuses a version 5 file as unsupported, as the backup reader does today for any version above its own.
- One exported constant in core names the current version. Every writer that now writes the literal 4 reads it instead: `packages/core/src/workspace/backup.ts`, `packages/core/src/workspace/originals-fill-writer.ts`, `apps/cli/src/workspace/sqlite-store.ts`, `apps/cli/src/workspace/browser-journal.ts`, `apps/cli/src/originals/fetch.ts` and `apps/web/src/workspace/idb-store.ts`. The checks that name 4 accept 5: the metadata schema in `packages/core/src/model/index.ts`, the gates in `backup.ts`, `restore.ts` and `validation.ts`, and the version check in `sqlite-store.ts`. A gate that admits a later array, such as `originals` or the journal, only from a given version admits it in 5 as well; `instagramContext` is admitted only in 5.
- From 4 to 5 no record changes. The version in the metadata rises, the new store or table starts empty, and every journal run keeps `platform: 'x'`. Versions 1 to 3 migrate by way of 4, as today.
- IndexedDB database version 5 adds the store `instagramContext` with key path `itemId`. SQLite layout 5 adds the `STRICT` table `instagram_context` with `item_id` as primary key and the record as JSON checked with `json_valid`, in a migration that copies the database file first, as the earlier layout migrations do.
- A version 4 backup restores into a version 5 workspace in both the CLI and the browser, with no context records.
- **Version 6 (IG-8, 2026-10-18).** The document goes to `schemaVersion: 6`; readers accept 1 to 6, writers write 6, and a reader built for version 5 refuses a version 6 file as unsupported. From 5 to 6 every context record gains `confirmedBy: 'post'` and nothing else changes. IndexedDB database version 6 and SQLite layout 6 rewrite the stored records that way, SQLite after copying the database file first, as the earlier layout migrations do. A version 5 backup restores into a version 6 workspace in both the CLI and the browser, each of its records as `post`; versions 1 to 4 migrate by way of 5.

### 5. Backup and reader checks

- The document gains an optional `instagramContext` array after `browserAttempts`, and `counts.instagramContext`, both left out when empty. A backup carries the records, not the files, as with ADR-026's photos. `backup export` prints how many context files with how many bytes stay in `<workspace>/context/instagram/` and have to be copied with that folder; after a restore without it, the review says "Not in this copy" for each file.
- The reader checks:
  - unique `itemId`, each naming an existing item with platform `instagram`, kind `comment` and the record's `accountKey`;
  - that item has nonempty text and a post owner, and `post.owner` equals the item's owner, compared in lower case without a leading `@`;
    The unconditional owner requirement in this historical line is superseded for owner-less comments by the IG-OWNER A amendment above.
  - for `confirmedBy: 'post'`, `comment.id` and `comment.createdAt` are set and `comment.createdAt` lies within 60 seconds of the item's `createdAt`; for `'list'`, both are `null` (IG-8, 2026-10-18);
  - `post.code` matches `[A-Za-z0-9_-]{1,64}`, a set `comment.id` matches `[0-9]{1,40}`, `ownerCount` is at least 1, and no two records name the same `comment.id`;
  - each `file` is one of the names above and is set exactly when its status is `stored`, and `bytes` is set exactly when the screenshot is stored;
  - `runId` names a run with platform `instagram` and mode `context`, and `attemptId` names a `confirm-comment` attempt of that run for this item whose settling record is `confirmed`;
  - every `confirmed` settling record belongs to an item that has a record.

The text rule of IG-3 cannot be checked again from the record, because the record does not keep the page's text, and neither can IG-8's row check. The `confirmed` attempt stands for both, and ADR-028 says how the run decides them.

### 6. Protocol and stores

- The workspace protocol of [ADR-007](ADR-007-review-data-worker.md) gains `getInstagramContext { itemIds }`, with 1 to 200 unique Instagram item IDs, answered by `instagramContext { records }` with at most 200 records.
- The CLI review runtime answers from SQLite. The browser worker answers `{ records: [] }`, as it answers `getOriginals` today, until a later record decides how the Pages app shows them. Its IndexedDB store still keeps the records, so a backup that passes through the browser loses none.
- The review server takes its API list from the protocol schema, so the request is served without a change to that list. The media route for the files is in ADR-028, section 9.

### 7. How this fits the rule for new platforms

Importing Instagram still needs no core change. The acting features are not platform-neutral and this record does not pretend they are: X has `Original` and Instagram has `InstagramContext`, and each runner writes through its own narrow writer. The one shared part that becomes platform-aware is the journal, because pace, daily counts and interrupted runs are counted there. A third platform with a reading pass would get its own record, or a generalization decided then with two real cases to compare.

### 8. Changes to other records

| Record | New wording |
|---|---|
| ADR-005 | The IndexedDB database of a workspace is at version 5 and gains the store `instagramContext`, keyed by `itemId`. |
| ADR-006 | The document is at version 5 and gains the optional `instagramContext` array and count. Readers accept 1 to 5. |
| ADR-007 | The protocol table gains `getInstagramContext { itemIds ≤ 200 }`, answered by `instagramContext { records }`. The browser worker answers with an empty list. |
| ADR-015 | The workspace gains the `STRICT` table `instagram_context` in layout 5, and the folder `context/instagram/`. |
| ADR-027, accepted 2026-10-25 | A run carries `platform: 'x' \| 'instagram'`; mode `context`, action `confirm-comment` and the states `confirmed`, `unconfirmed` and `not-listed` belong to Instagram. A recorded request may name its `operation`. |
| ADR-005, ADR-006, ADR-015 | Since IG-8 (2026-10-18) at version 6: the database, the document and the layout of the rows above, with `confirmedBy` in each context record. |

**Decision made by:** maintainer
**Approved on:** 2026-10-16

## Consequences

### Positive
- X's originals, routes and journal entries stay exactly as ADR-029 builds them.
- A backup carries every confirmed context between the CLI and the browser in both directions.
- A restore rejects a context whose comment time or post owner breaks IG-3.

### Negative
- Every reader and writer moves to version 5, and a workspace written by this version cannot be opened by an older SocialPrune. IG-8 moves them to version 6 again, for one field.
- The post's facts repeat for each of the person's comments on the same post.
- The browser stores records it does not show yet.

### Risks
- **Another lane claims version 5 first.** Mitigation: this record takes the next free number, and the single version constant makes the change one line in each writer.
- **A post owner shown differently from the export's owner, for example in a collaboration post.** Mitigation: the record keeps the first header account and the count; such a comment stays unconfirmed, and the canary of ADR-028 counts collaboration headers so the maintainer can decide with numbers.
- **Files and records drift apart after a copy without the folder.** Mitigation: the review route checks that a record lists the file, and the review says "Not in this copy" when the file is missing.

## Evidence

- `packages/core/src/model/original.ts` at commit `77c60bc`: `OriginalIdSchema` is `^[0-9]{1,40}$`.
- `packages/core/src/model/browser.ts` at `77c60bc`: `platform: z.literal('x')`, and attempts other than `read-post` must name an `x:` item.
- The literal schema version 4 is written in the six files listed in section 4 and checked in the five places listed there, found by searching the tree at `77c60bc`. IndexedDB opens at version 4 in `apps/web/src/workspace/idb-store.ts`. The backup reader refuses a version above 4 with `BACKUP_SCHEMA_UNSUPPORTED`.
- `apps/cli/src/review/server.ts` at `77c60bc` builds its API list from `HttpReviewRequestSchema`.
- [Spike S5](../../spikes/S5.md): the post's code appears on the post page, and the comment's permalink holds its ID and exact time.
- The limits of section 1 (10,000 characters, up to 10 expansion clicks) are this record's and ADR-028's choices, not measurements.

## Superseded on 2026-10-18

IG-8 replaced these lines. They are kept here unchanged:

- Section 1: `id: string,                      // the digits of the permalink /c/<id>/`
- Section 1: `createdAt: UtcTimestamp,         // the permalink's time element`
- Section 5: `comment.createdAt` lies within 60 seconds of the item's `createdAt`;
- Section 5: `post.code` matches `[A-Za-z0-9_-]{1,64}`, `comment.id` matches `[0-9]{1,40}`, `ownerCount` is at least 1, and no two records name the same `comment.id`;
- Section 5: The text rule of IG-3 cannot be checked again from the record, because the record does not keep the page's text. The `confirmed` attempt stands for it, and ADR-028 says how the run decides it.

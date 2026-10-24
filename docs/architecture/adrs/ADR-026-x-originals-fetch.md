# ADR-026: Fetching the originals of the person's replies and quotes on X

- **Status:** Accepted
- Rule Command changed by [ADR-029](ADR-029-signed-in-originals-pass.md) on 2026-10-24 (anonymous parent and quoted-post handling and the notice for their IDs and media).
- Rule What is requested and how changed by [ADR-029](ADR-029-signed-in-originals-pass.md) on 2026-10-24 (video and GIF handling and both truncation signs).
- Rule What is stored changed by [ADR-029](ADR-029-signed-in-originals-pass.md) on 2026-10-24 (the replacement original and media model and temporary-file writes).
- Rule What the person sees changed by [ADR-029](ADR-029-signed-in-originals-pass.md) on 2026-10-24 (per-media states replace the former no-video sentence).
- **Date:** 2026-10-11
- **Hard constraints touched:** 4 (one of the two actions [ADR-023](ADR-023-acting-in-own-account.md) allows), 2 (post IDs from the export reach X, which already holds them; the person is told at that point), 1 (no account, no key, no cost), 6 (tests use a local fake, never X)
- **Supersedes in part:** [ADR-006](ADR-006-workspace-event-log.md), [ADR-007](ADR-007-review-data-worker.md), [ADR-013](ADR-013-cli-framework-output.md), [ADR-014](ADR-014-agent-interface.md), [ADR-015](ADR-015-cli-storage-node-baseline.md), [ADR-016](ADR-016-local-review-server.md), [ADR-018](ADR-018-cli-distribution.md). The section "Changes to accepted records" names the rules and gives the new wording. The maintainer chose ADR-001's partial-supersession form on card ADR-TEIL v1 A, 2026-10-24 at 19:28:04Z.
- **Related:** [ADR-005](ADR-005-browser-storage.md), [ADR-021](ADR-021-archive-media.md), [ADR-023](ADR-023-acting-in-own-account.md), [ADR-027](ADR-027-x-deletion-browser.md), [ADR-029](ADR-029-signed-in-originals-pass.md)

Revision of 2026-10-24, based on `bf8843f` and the D6 corrections. The maintainer chose ADR-DEL v2 A at 10:31:43Z, accepting its behavior and code alignment, not this record at that time. The dated `209c895` checks remain historical evidence; the current model pointer below uses schema 8. At 19:28:04Z he separately accepted this record as written at `c4700552ea56648780baf2bc1f2daccb33b82db2` on card ADR-026 v1 A. Acceptance authorizes no platform run by itself.

Decided by the maintainer on 2026-10-11: fetch the originals ("Ja, hole die originale accordingly").

The local review has shown stored photos through its authenticated same-origin route since the build of 2026-10-11. It uses `img-src 'self'`, not `img-src blob:`. The former photo-display question was resolved in the implementation before this record's separate acceptance on 2026-10-24.

## Context

The X export holds the person's own posts. A reply carries the ID of the post it answered (`reference.replyToId`), and a quote the ID of the post it quoted (`reference.quotedId`), but not their text, author or images. Since commit `5fb9c54`, the review and the archive link a reply or quote to its original on X, opened only by the person's click. Once the person deletes their reply, or the other person deletes their post, that context is gone for good. The maintainer wants it kept locally before anything is deleted.

What X offers without a login, observed on 2026-10-11 by the research, with the architect's own check of the `react-tweet` package on the same day:

- `react-tweet` 3.3.1 (Vercel, MIT, published 2026-06-03) fetches a post from `https://cdn.syndication.twimg.com/tweet-result` with the post ID and a `token` that its function `getToken` derives from the ID alone (`dist/api/fetch-tweet.js`). It needs no login, cookie or key, and it rejects IDs that are not 1 to 40 digits.
- The response gives the text, the author's name and handle, photos with their URLs on `pbs.twimg.com`, the quoted post, and the ID of the post it replied to.
- A deleted or protected post comes back as not found or as a "tombstone" without its content.
- Long posts may come back cut off, with no reliable sign that they are.
- Video files on `video.twimg.com` often answer 403 to anonymous requests.
- X's oEmbed endpoint needs no login either, but returns the text only inside an HTML snippet, without photos.
- X's paid developer API was rejected by the maintainer on 2026-10-11 because it can cost money.

## Decision Drivers

- Keep the text, author and photos of every original before the person deletes their reply or quote.
- No login, no key, no cost; nothing that involves the person's account.
- X learns as little as possible, and the person knows what X learns before the first request.
- Slow and stopping early, as [ADR-023](ADR-023-acting-in-own-account.md) PA-7 and PA-8 require.
- Works from the CLI with the workspace in SQLite; the Pages web app stays without network access.

## Options

### Option 1: The syndication endpoint `react-tweet` uses

**Pros:**
- One request per post returns text, author, photo URLs, the quoted post and the parent ID as JSON, without login or key.
- The token function is a few lines of MIT code that can be copied with a notice, so no dependency is added.

**Cons:**
- Undocumented by X; it can change or close without notice, and long posts may be cut off.
- Videos usually cannot be fetched anonymously.

**Effort:** not measured
**Risk:** Medium, because the endpoint is undocumented.

### Option 2: X's oEmbed endpoint

**Pros:**
- A long-standing public endpoint for embedding.
- No login.

**Cons:**
- Text only inside an HTML snippet that would have to be parsed; no photos, no author handle as data.
- Built for embedding, not for keeping a copy.

**Effort:** not measured
**Risk:** Medium.

### Option 3: Read each original through the person's signed-in browser profile

**Pros:**
- Shows what the person would see, including posts only their account can see.
- Same tooling as deletion ([ADR-027](ADR-027-x-deletion-browser.md)).

**Cons:**
- Every read happens as the person's account, adding to the account risk for something that works without the account.
- Much slower: one page load per post.

**Effort:** not measured
**Risk:** High for the account.

### Option 4: X's paid developer API

**Pros:**
- Documented.
- Complete text for long posts.

**Cons:**
- Costs money per read; rejected by the maintainer.
- Needs a developer account.

**Effort:** not measured
**Risk:** Medium.

### Option 5: Keep only the links

**Pros:**
- No request to X at all.
- Nothing to maintain.

**Cons:**
- The context is lost once a post is deleted, which is what the maintainer wants to prevent.
- The person has to open each link by hand.

**Effort:** none
**Risk:** Low.

## Decision

We chose **Option 1: the syndication endpoint `react-tweet` uses**, because it is the only option that returns text, author and photos as data without a login, a key or the person's account. When it fails for a post, that post is recorded as `failed`; there is no fallback to another endpoint.

### Command

```text
socialprune originals fetch --workspace <dir> [--account <key>] [--limit <n>] [--dry-run] [--json]
```

- **Which posts.** The built command, checked on 2026-10-23, collects `replyToId` and `quotedId` references from complete X imports, for the selected account or all X accounts when `--account` is absent. Human delete decisions do not filter it. Duplicates are fetched once. The parent walk and the quoted-post pass follow ADR-029 section 1. Missing records and anonymous `failed` results are fetched; existing anonymous answers are reused for links and media. A row with a signed-in result is not replaced or edited by this command. `--limit` bounds new post fetches, not downloads from stored answers. There is no `--only-marked` or `--refresh` flag.
- **Dry run.** `--dry-run` reads the workspace only and prints referenced, stored and planned counts. It sends nothing and writes no files. It does not print a host list or a duration estimate.
- **The order.** Running this command without `--dry-run` is the person's order under ADR-023 PA-1. There is no `--allow-network` flag or `NETWORK_NOT_ALLOWED` branch. An agent first asks whether X may see the person's IP address and the referenced, parent and quoted post IDs, and runs it only after a yes in the conversation (ADR-014). The CLI cannot verify that conversation.
- **The notice.** `fetch.ts` prints counts, then this English sentence to stderr before requests in a non-dry run, as checked on 2026-10-23:

  > This command sends referenced, parent and quoted post IDs to the anonymous X embed host and downloads their media without sign-in. Long-post text may still be incomplete.

  The hosts are `cdn.syndication.twimg.com`, `pbs.twimg.com` and `video.twimg.com`. They see the person's IP address and the requested IDs or media paths. The current notice does not spell out those host names or the IP disclosure, and this command has no `--lang` flag or German notice. Those are differences from the original draft, not claims that the longer bilingual notice ships.

### Pace and stopping

- Code limits checked on 2026-10-23: one request at a time; post fetches have a one-second wait clock, and media requests share a separate one-second clock across image and video hosts. They are not one clock across all three hosts.
- The syndication client applies a 30-second timeout to a request, not the draft's 15 seconds. Video files use ADR-029 section 3's separate 15-second header deadline and 30-second idle deadline. These are chosen code limits, not measured response times.
- No failed post is retried within a run. A later run can try an anonymous `failed` result again. Choosing a smaller video variant after a declared size exceeds the limit follows ADR-029, not a retry of a failed deletion.
- Five consecutive failed post fetches end the loop; the command reports `ORIGINALS_FAILED` (exit 1). Media failures use their separate consecutive-failure counter. Not-found and tombstone answers are results, not failures.
- An embed-host HTTP 429 stops immediately with `PLATFORM_CHECK` and `Stop detail: http-429`; D2 added this propagation on 2026-10-23. Photo and video HTTP 429 responses stop with `MEDIA_RATE_LIMIT`. None is converted into one of five ordinary failures or retried.
- Cancellation aborts the in-flight request through its signal; it does not promise to finish that request first.

### What is requested and how

- The post ID must match `^[0-9]{1,40}$` before any URL is built. URLs are built with the `URL` API from the pinned host, never by string concatenation with export data.
- The request carries the ID, `lang=en` and the `token` derived from the ID. It sends no `features` value. It carries no cookie and no referrer. Its user agent is `SocialPrune/<version>`, so X can tell what is asking (ADR-023 PA-9).
- A photo is downloaded only from `https` on `pbs.twimg.com`, with a JPEG, PNG, GIF or WebP type and at most 20 MiB. Videos, GIF MP4 files and posters follow ADR-029 section 3, including its host, file, size and disk-space checks. These code bounds were checked on 2026-10-23; the anonymous-video 403 observation of 2026-10-11 is not a rule that all such files are refused.
- Responses larger than 2 MiB are not parsed and count as failed, the code bound checked on 2026-10-23. The JSON is parsed as data; no part of it is executed or rendered as HTML.

### What is stored

A SQLite table `originals` in the workspace (ADR-015), one row per original post. The following table describes the initial layout built on 2026-10-11, not the current record shape. ADR-029 section 5 owns the replacement `Original` and `OriginalMedia` model, introduced in schema 4 on 2026-10-12; writers use schema 8 at `bf8843f`, checked on 2026-10-24. Its parent walk, quoted records, media, anonymous and signed-in provenance replace the old `photos` and `video` fields below.

| Field | Meaning |
|---|---|
| `id` | the original post's ID, primary key |
| `status` | `fetched`, `not-found`, `tombstone` or `failed` |
| `fetchedAt` | when the answer arrived |
| `text` | the text as returned, or `null` |
| `authorName`, `authorHandle` | as returned, or `null` |
| `photos` | up to 4 entries `{ url, file, status }`, where `file` is `1.jpg` to `4.webp` and `status` is `stored` or `failed` |
| `quotedId` | the ID of the post the original quoted, if any; its text and author stay in `raw` and are not fetched again |
| `parentId` | the ID of the post the original replied to, if any; it is not fetched |
| `textCompleteness` | `unknown`, or `truncated` when the response marks the text as cut off |
| `video` | `not-stored` when the post had a video, else `null` |
| `raw` | the parsed response, kept as data for later readers |

The table is not append-only: a later anonymous run may replace an anonymous `failed` row without a signed-in result, and may store missing media from a retained anonymous answer. There is no refresh option. Files go to `<workspace>/originals/<id>/<n>.<ext>`, under temporary names before rename as ADR-029 specifies. File names come only from the record, never from the response.

### What the person sees

- The workspace protocol ([ADR-007](ADR-007-review-data-worker.md)) gains `getOriginals { ids }` with at most 200 IDs, answered by `originals { originals }`. The local review's HTTP API carries it ([ADR-016](ADR-016-local-review-server.md)).
- The local review and archive show stored text and authenticated local media. ADR-029 section 4 replaces the initial photo counts and "Videos are not stored" sentence with per-media states, videos and conversation context. Neither stored media nor a post link triggers a remote fetch while reviewing.
- All of it renders as React text nodes, like the person's own text.
- In the Pages web app, the browser store keeps originals that arrive through a restore, so a backup survives the round trip, but `getOriginals` answers with an empty list. Showing them there is left to a later record, because the Pages app cannot fetch and its policy has no room for stored photos.

### Backup and restore

- The initial version 2 addition was the optional `originals` array and `counts.originals`. ADR-029 section 5 replaces its record shape in version 4. At `bf8843f`, checked on 2026-10-24, writers use schema 8 and readers accept backups from versions 1 to 8; no claim of version 2 compatibility applies to a current backup.
- Backups carry records, not photo, poster or video files. The `originals/` folder must be copied separately to keep those files; the review names media missing from the restored copy. ADR-029 governs their counts and file checks.
- The reader checks unique IDs, valid current records, matching counts and the per-kind file patterns of ADR-029 section 5, not only the initial photo pattern above.

### Licensing

The token derivation is copied from `react-tweet` 3.3.1 under its MIT license, with an entry in `THIRD_PARTY_NOTICES` naming Vercel, the package, the version and the license text. The built request sends no `features` value. No package is added to the dependency graph ([ADR-002](ADR-002-dependency-licenses.md)).

### Tests

- The command takes the base URL of each host from its handler context. Production uses the pinned constants; tests point them at a local fake server that answers with generated payloads, including not found, tombstone, a cut-off text, a video, a 429, a slow answer and an oversized body.
- Tests assert the pinned production embed, image and video hosts, and that fake hosts cannot be selected from the production entry.
- The zero-network boundary of ADR-013 covers `originals fetch --dry-run`, not a real `originals fetch` invocation. D2's generated embed-429 case checks immediate propagation and no later request, as checked on 2026-10-23.
- No test contacts X.

### Changes to accepted records

| Record | Rules or sections changed | New wording |
|---|---|---|
| ADR-006 | Workspace document, version 2; Backup and restore | The workspace document gains the optional `originals: Original[]` after `outcomeEvents` and the optional `counts.originals`, both left out when empty. The reader checks unique IDs, valid records and the count. |
| ADR-007 | Protocol | The protocol table gains `getOriginals { ids ≤ 200 }` → `originals { originals }`. The browser worker answers with an empty list until a later record. |
| ADR-013 | Command tree for Phase 2; Execution adapter; Exit codes | The command tree gains `originals fetch`; running it without `--dry-run` permits its anonymous requests. Other network exceptions are the signed-in runs named in ADR-027 to ADR-029. The zero-network test covers other commands and these commands' dry runs. The built failure codes include `ORIGINALS_FAILED`, `PLATFORM_CHECK` for an embed 429 and `MEDIA_RATE_LIMIT`; there is no network-consent flag. |
| ADR-014 | Agent Skill | Agents may run `originals fetch --dry-run`, and `originals fetch` only after the person agreed in the conversation. The skill asks whether X may see their IP address and the referenced, parent and quoted post IDs. The prohibition on platform requests gains this exact anonymous-command exception. |
| ADR-015 | Workspace folder; Database settings; Migration, backup and restore | The workspace gains the `STRICT` table `originals` (not append-only) and the folder `originals/` next to `socialprune.sqlite`. A layout migration adds the table. |
| ADR-016 | API | The HTTP API gains `getOriginals` and the authenticated same-origin media route; ADR-029 extends that route for videos and ranges. |
| ADR-018 | Checks; Package contents | The packed smoke test runs `originals fetch --dry-run` on generated data and asserts zero network calls; it never runs the network mode. `THIRD_PARTY_NOTICES` gains the `react-tweet` entry. |

[ADR-021](ADR-021-archive-media.md) stays as it is: it is about media inside the export, and the review still loads nothing from a post's link.

**Decision made by:** maintainer
**Approved on:** 2026-10-24 (card ADR-026 v1 A; 19:28:04Z, "überall kannst du continue nach deiner Empfehlung accordingly"; record at `c4700552ea56648780baf2bc1f2daccb33b82db2`).

## Consequences

### Positive
- The text, author and photos of the posts the person answered stay on their computer after either side deletes, without login, key or cost.
- Nothing in the run involves the person's account, so it adds no account risk.

### Negative
- X learns the person's IP address and which posts they answered. X knows the second already, but the requests tie it to that address on that day.
- The workspace now holds other people's public posts and photos. They stay local and travel in backups, and they are as private as the rest of the workspace.
- Photos are not in the backup file; the person has to copy a folder as well.

### Risks
- **X changes or closes the endpoint, or the token function.** Mitigation: a changed answer fails validation and stops the run after five failures; the links from `5fb9c54` keep working; the fake server's payloads are updated from the new shape, never from a real post.
- **X blocks the person's address after many requests.** Mitigation: the separate post and media clocks and failure stops in "Pace and stopping", immediate propagation of a 429, and no failed-post retry within the run. Anonymous requests carry no account session.
- **Cut-off text looks complete.** Mitigation: the review says that long posts may be cut off on every fetched original.

## Questions resolved in the implementation

- 2026-10-11, build `133a226`: stored photos are shown through the session-checked same-origin route, under `img-src 'self'`. No blob policy change is needed.
- 2026-10-11, build `133a226`: the default is all referenced originals, not only human-marked entries. The command has no marked-only flag. These implementation answers preceded the maintainer's separate acceptance on 2026-10-24 at 19:28:04Z, card ADR-026 v1 A.

## Evidence

- Vercel, `react-tweet` 3.3.1: npm registry entry (MIT, published 2026-06-03T17:55:07Z, repository `github.com/vercel/react-tweet`), and the published file [`dist/api/fetch-tweet.js`](https://cdn.jsdelivr.net/npm/react-tweet@3.3.1/dist/api/fetch-tweet.js) with `SYNDICATION_URL = 'https://cdn.syndication.twimg.com'`, the 1 to 40 digit ID check and `getToken`. Read by the architect on 2026-10-11.
- The response contents, the not-found and tombstone answers, cut-off long posts, anonymous 403s from `video.twimg.com`, and X's oEmbed returning text only inside HTML: observed 2026-10-11 by the research, without any request to X from this lane; the maintainer's reading pending.
- `packages/core/src/model/v1.ts` at commit `5fb9c54`: `reference` holds `replyToId` and `quotedId`.
- Pace, time and size figures in this record are chosen limits and arithmetic, not measurements.
- Code checked on 2026-10-23 at `209c895`: `apps/cli/src/commands/originals-fetch.ts` (flags and failure output), `originals/fetch.ts` (planning, reuse, notice and embed-429 propagation), `originals/syndication.ts` (30-second timeout, request fields and HTTP status handling), `originals/store-media.ts` and `video.ts` (separate media clock and failure rules), `review/static.ts` (same-origin image and media policy), and `packages/core/src/model/index.ts` (schema 7). No request to a platform was made for this revision.
- Rechecked on 2026-10-24 against `bf8843f`: command flags, notice, timeout and immediate embed-429 propagation retain those branches, while the workspace writer is schema 8. D6's signed-in warning gate belongs to ADR-027 and does not turn this anonymous command into a signed-in action. No request to a platform was made.

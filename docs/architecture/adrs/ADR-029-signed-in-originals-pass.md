# ADR-029: The signed-in originals pass on X

- **Status:** Proposed
- **Date:** 2026-10-11
- **Hard constraints touched:** 4 (reading through the person's own signed-in session, on the person's order, what the anonymous fetch of [ADR-026](ADR-026-x-originals-fetch.md) cannot get; whether the posts above an original count as "the original posts" needs the maintainer's yes), 2 (post IDs reach X, which already holds them; nothing else from the export leaves), 1 (no developer account, no key, the browser already installed), 3 (the pass writes no decision), 5 (the warning promises nothing, and the review says what X did not show), 6 (tests use a local fake X and fake media hosts, never X)
- **Supersedes in part, on acceptance:** [ADR-005](ADR-005-browser-storage.md), [ADR-006](ADR-006-workspace-event-log.md), [ADR-007](ADR-007-review-data-worker.md), [ADR-011](ADR-011-internationalization.md), [ADR-013](ADR-013-cli-framework-output.md), [ADR-014](ADR-014-agent-interface.md), [ADR-015](ADR-015-cli-storage-node-baseline.md), [ADR-016](ADR-016-local-review-server.md), [ADR-017](ADR-017-shared-workspace-service.md), [ADR-018](ADR-018-cli-distribution.md). It also changes the proposed records [ADR-023](ADR-023-acting-in-own-account.md), [ADR-026](ADR-026-x-originals-fetch.md) and [ADR-027](ADR-027-x-deletion-browser.md). The section "Changes to other records" gives the new wording. How a partial change is recorded is an open question in ADR-023.
- **Builds on:** the browser driver, the dedicated profile, the confirmation page, the journal and the fake X site of [ADR-027](ADR-027-x-deletion-browser.md), which must be built first.
- **Related:** [ADR-005](ADR-005-browser-storage.md), [ADR-012](ADR-012-time-zone-grouping.md), [ADR-017](ADR-017-shared-workspace-service.md), [ADR-021](ADR-021-archive-media.md), [ADR-028](ADR-028-instagram-signed-in-session.md)

Decided by the maintainer on 2026-10-11, in the English rendering of his German words by that day's orchestration task: "I want as much as possible: the videos and the posts and everything that belongs to them. If the problem is that I am not signed in, sign in, that is no problem. The main thing is that it is as complete as it can be." He had been told that he signs in himself, in a dedicated profile the tool opens, so his password never passes through the chat; that X counts signed-in automated reading as automation its rules forbid and may limit or suspend the account for it; and that what works without a login stays anonymous.

Needs the maintainer's decision: the questions under "Open questions for the maintainer". The first one touches hard constraint 4.

## Context

`originals fetch` (built at commit `133a226`, `apps/cli/src/originals/`) asks X's public embed service for each post an X reply or quote of the person answered. Per post it keeps one row in the SQLite table `originals`: the status (`fetched`, `not-found`, `tombstone` or `failed`), the text, the author's name and handle, up to four photos stored under `<workspace>/originals/<id>/`, the IDs of the posts it quoted and replied to, `textCompleteness` (`unknown` or `truncated`), `video: 'not-stored'` when the post had a video, and the parsed answer as `raw`. The local review shows these rows and photos through the authenticated review server, on the route `/originals/<id>/<n>.<ext>` under the page policy `img-src 'self'`, and `PostCard` says that long posts may be cut off and that videos are not stored. Backups carry the rows, not the photo files.

Four gaps remain: (a) the videos and animated GIFs of the originals; (b) the full text of long posts that arrive cut off; (c) posts of protected accounts the person follows, which the anonymous service does not return; (d) the conversation above an original, meaning the chain of posts it answered up to the first one, and the media of the posts the originals quote.

Two details of the built code matter here. The parser marks a text as cut off when the answer has a `truncated` key, while the `react-tweet` types name a `note_tweet` member as that sign. And photo files are written straight to their final name, while ADR-026 asks for a temporary name first; for files of several hundred megabytes that difference counts. ADR-026 also records that the research of 2026-10-11 saw `video.twimg.com` answer 403 to anonymous requests, which the sources below contradict in part, so the first real run has to settle it.

The facts this record rests on, sorted by how far they can be trusted. No request to x.com, twitter.com or twimg.com was made for this record, and no browser profile was used.

| Kind | Facts |
|---|---|
| Documented by X | Accounts without Premium can post videos of up to 140 seconds and 512 MB; Premium accounts up to 4 hours and 16 GB, at 1080p below 2 hours and at 720p above. These come from X's help pages as a web search index returned them on 2026-10-11, not from x.com, and wait for the maintainer's reading; a news site reported in April 2025 that accounts without Premium could already post longer videos on the web and on iOS. X's Automation rules forbid scripting the website, as ADR-023 and ADR-027 record. No X documentation of the answers X's own web pages receive was found. |
| From open-source projects under MIT, which may be reused with a notice | `react-tweet` 3.3.1 (Vercel): the embed service lists media in `mediaDetails`, each with `type` `photo`, `video` or `animated_gif`, the last two with `video_info.variants`, each with `content_type` `video/mp4` or `application/x-mpegURL`, a `url` and an optional `bitrate`; a photo can carry `ext_alt_text`; a quoted post carries its own `mediaDetails`; "if present, the tweet's text is truncated" is the comment on `note_tweet`; `parent` carries the parent's text and author but no media; and `react-tweet` sorts the MP4 variants by `bitrate` and sets the first one's URL as the source of a `<video>` element on whatever page embeds the post. `twikit` (d60): X's web app reads a post with `GET /i/api/graphql/<queryId>/TweetDetail`, whose `variables` name the post as `focalTweetId`; the entries named `tweet-<id>` that come before the post's own entry are the posts above it; a result is a `Tweet`, a `TweetTombstone`, or a wrapper holding the post under `tweet`, and the author sits under `core.user_results.result`; the full text of a long post is `note_tweet.note_tweet_results.result.text`; a quoted post sits under `quoted_status_result`; videos carry `video_info.variants` and `duration_millis`; and `twikit`, which sends this request itself, computes an `X-Client-Transaction-Id` header before each request, as X's own page code does. `firedown` (solarizeddev), pull request 285 of 2026-05-31: X moved a user's `screen_name` and `name` from `legacy` to `core`; its author notes that this was not checked against a live signed-in feed. |
| From open-source projects, ideas only | `yt-dlp` (Unlicense, which is not on the reuse list in `AGENTS.md`): a result can also be `TweetUnavailable` with a `reason` such as `Protected`, `NsfwLoggedOut` or `NsfwViewerHasNoStatedAge`; a tombstone's notice is `tombstone.text.text`; all media of a post sit in `legacy.extended_entities.media`, while `twikit` reads `legacy.entities.media`; X's MP4 variants carry bitrate labels of 288, 832, 2,176 and 10,368 kbit/s for 270p, 360p, 720p and 1080p (issues 7255 and 9202); the labels lie far above the files' real rate, a 720p file labelled 2,176 measured about 436 kbit/s (issue 7255); X's HLS streams keep the audio apart from the video (issue 9202); and a 403 from `video.twimg.com` reported in March 2026 was traced to a `Referer` of another site that the user had configured, after two maintainers could not reproduce it (issue 16321). `twitter-openapi` (fa0311, an MIT text with an added clause against spam uses, so not the plain MIT license): the `TweetDetail` answer sits under `data.threaded_conversation_with_injections_v2.instructions`, entries come in `TimelineAddEntries`, cursor types are `Top`, `Bottom`, `ShowMore`, `ShowMoreThreads` and `ShowMoreThreadsPrompt`, and a fifth result type `TweetPreviewDisplay` exists. |
| Unobserved until the first real canary | whether X's signed-in page for `https://x.com/i/web/status/<id>` sends `TweetDetail` or another operation; whether Playwright sees that answer with a readable body while X's service worker runs, since the Playwright 1.63 documentation names service workers as a cause of missing network events; where the fields sit today; whether the posts above come complete in one answer; whether this answer carries alt text as `ext_alt_text`, as the embed service does; how X answers a signed-in viewer for a deleted post, a suspended account, an author who blocked the viewer, and a protected account the viewer does not follow; whether `video.twimg.com` hands out the MP4 files without a sign-in; how often a video has no MP4 variant; and how large the files really are. |

## Decision Drivers

- As complete as it can be: every video, GIF, full text, protected post, post above and quoted post's media that X shows the person.
- What works without a sign-in stays without it. Each signed-in page adds to the account risk the maintainer accepted, so the signed-in pass opens a page only for what the anonymous route cannot get.
- In the signed-in window SocialPrune only opens addresses, as a person would type them, and X's page code sends every data request, as in [ADR-027](ADR-027-x-deletion-browser.md).
- A change on X's side stops the run instead of filling the workspace with wrong or empty records.
- Every rule of [ADR-023](ADR-023-acting-in-own-account.md) holds: the person's order, the own account, the full list first, a first run the person watches, a journal, a stop at the first error, a slow pace, nothing hidden, a dedicated profile that is read back afterwards.
- Videos play in the local review with one added policy directive and nothing else.

## Options

### Option A: Open each post's page in the dedicated profile and read the answer X's page code receives

SocialPrune opens `https://x.com/i/web/status/<id>` in the window of the dedicated profile, waits for the `TweetDetail` answer that X's own page code receives, keeps the fields it needs, and downloads the media files that answer names from X's media hosts, without the session. Before that, the anonymous fetch does everything it can.

**Pros:**
- SocialPrune only opens the post's address; X's page code sends the data request, so no header has to be copied or computed.
- One page gives the post, its full text, its media variants, its quoted post and the posts above it.

**Cons:**
- The answer is undocumented; field names move with X's web releases, and each move stops the run until the reader is updated.
- One page load per post as the person's account, which adds to the account risk.

**Effort:** not measured
**Risk:** High for the account; Medium for maintenance.

### Option B: Send X's internal `TweetDetail` request from SocialPrune

As `twikit` does: build the request with the profile's cookies and send it from the tool.

**Pros:**
- No page load: one request per post, faster and lighter.
- The answer is the same JSON as in option A.

**Cons:**
- SocialPrune would have to compute `X-Client-Transaction-Id` and the other headers X's page code adds, which is the disguise [ADR-023](ADR-023-acting-in-own-account.md) PA-9 forbids.
- The query ID and the feature flags change with X's web releases.

**Effort:** not measured
**Risk:** High.

### Option C: Read only the rendered page

Read text, author and media from the page's markup.

**Pros:**
- No network answer is read.
- The person sees exactly what is read.

**Cons:**
- It finds no video file URLs, because X's player streams into the video element and the markup names no MP4 file. This is an inference from how such players work, not an observation.
- Labels and structure change more often than the data, and long texts, quoted posts and posts above are harder to tell apart.

**Effort:** not measured
**Risk:** Medium.

### Option D: Keep what X's own video player downloads

Let the page play each video and keep the stream segments the player loads.

**Pros:**
- Uses exactly the bytes X's page fetched.
- Also works for videos that X offers only as a stream.

**Cons:**
- The player picks a quality by bandwidth, loads audio as a separate stream and fetches only what it plays, so each video would have to play to its end and its parts would need a muxer SocialPrune does not have.
- Hours of playback for long videos, all of it as the person's account.

**Effort:** not measured
**Risk:** High.

### Option E: Stay anonymous only

Widen the anonymous fetch as far as it goes and stop there.

**Pros:**
- No account risk at all.
- Nothing new to maintain in the browser.

**Cons:**
- Long texts stay cut off and protected posts stay missing, so gaps (b) and (c) stay open.
- Misses the maintainer's stated goal.

**Effort:** not measured
**Risk:** Low.

## Decision

We chose **Option A: open each post's page in the dedicated profile and read the answer X's page code receives**, preceded by option E's widening of the anonymous fetch, because it is the only option that closes all four gaps while every data request in the signed-in window comes from X's own page code. Option B is rejected for PA-9, option C because it finds no video files, option D for the playback it needs. Third-party archives are not part of this record; a lookup there needs the maintainer's own yes in a record of its own.

### 1. Which pass gets what

| Gap | `originals fetch`, anonymous | `originals fill x`, signed in, only for the rest |
|---|---|---|
| (a) videos and GIFs | when the answer lists an MP4 variant in `mediaDetails` | posts whose anonymous answer listed none, or that the anonymous pass could not see |
| (b) full text of long posts | no; it learns only that the text is cut off (`note_tweet`) | `note_tweet.note_tweet_results.result.text` |
| (c) protected posts the person follows | no | as X shows them to the account |
| (d) posts above an original | public posts: follows the parent link upward, one request per post, at most 20 above each original | the posts above the opened post, from the same answer |
| (d) media of quoted posts | from the quoted post's `mediaDetails` in the same answer; the quoted post becomes its own record, fetched by ID when the answer does not embed it, one level deep | from `quoted_status_result` in the same answer |

The person's own posts in a chain are not copied. When a post above has the ID of an entry in the person's export, the chain links to that entry, and the walk goes on from the entry's own reply link. The person's other replies below an original are not read: they are in the export, and reading them would need scrolling.

A post enters the plan of `originals fill x` only for one of three reasons:

- `unseen`: the anonymous answer was `not-found` or `tombstone`, so the post may be protected, age-restricted, deleted or withheld;
- `long-text`: the anonymous answer marked the text as cut off;
- `media`: the anonymous answer named a video or GIF without an MP4 variant, or without any variant.

A post whose last anonymous answer is `failed` enters no plan until `originals fetch` has tried it again. A post with a signed-in result other than `failed` enters no plan unless the person names it in a file passed with `--include`, one ID per line, to the dry run and to the run. English anonymous tombstone notices can distinguish an author-deleted post, a post from a suspended account and a post from an account that no longer exists from a protected post. The plan leaves these three known notices out of `unseen`, because signing in shows the same notice rather than the post. The match is case-insensitive but accepts only the known sentence, with its optional final period and "Learn more" suffix; missing, empty or changed wording stays planned. `--include` restores `unseen` for any listed referenced ID. A separate `long-text` or `media` reason still keeps a row planned. Neither the original record nor its journal changes.

The maintainer reported aggregate counts on 2026-10-12 after the anonymous pass: 1,629 planned pages, with 1,623 carrying `unseen` and 6 carrying `long-text`. Of the `unseen` results, 1,032 notices said author-deleted, 268 suspended and 4 account no longer existing. Those 1,304 page opens would consume 6.52 daily-cap equivalents at 200 pages per day without adding content. The remaining anonymous results were 247 protected, 56 tombstones without notice text, 15 not-found and 1 unavailable. At unchanged records, excluding the three known notices leaves 325 planned pages. These are maintainer-reported counts only, not agent access to the workspace or proof of a signed-in run.

The generated notice fixtures quote X's public English wording documented in [twitter-web-exporter's tombstone type](https://github.com/prinsss/twitter-web-exporter/blob/ddf2b0c823680b904daae166f3eb05b81950ce7e/src/types/tweet.ts#L44-L47), read on 2026-10-12. Only the notice sentences are used, not that project's code or user records. [react-tweet's anonymous fetcher](https://github.com/vercel/react-tweet/blob/main/packages/react-tweet/src/api/fetch-tweet.ts), also cited by ADR-026, requests English and identifies `TweetTombstone`; SocialPrune retains the raw answer so planning can inspect its notice locally.

The run opens the plan newest first, by descending ID, because a reply's page also carries the posts above it. A planned post that an earlier page of the same run already stored as `read`, as a post above or as a quoted post, is skipped without a page and without an attempt.

### 2. What the signed-in run reads

**Navigation.** The run opens `https://x.com/i/web/status/<id>`, built by ADR-027's URL builder from the pinned origin and the post's digits. That navigation is the only thing it does in X's tab.

**Which answer.** Before navigating, the run listens to the page's responses and reads the body of exactly one: method `GET`; origin exactly `https://x.com`; path matching `^/i/api/graphql/[A-Za-z0-9_-]{1,64}/TweetDetail$`; a `variables` query parameter that parses as a JSON object whose `focalTweetId` equals the opened ID; status 200; a `Content-Type` starting with `application/json`; at most 8 MiB. The body is decoded as strict UTF-8 and parsed as data, never run or rendered. No other body is read, and no request or response header is stored, because headers carry the session.

**When nothing comes.** Within 30 seconds of the navigation, either that answer arrives or ADR-027's selectors module recognizes a known page state: X's "post does not exist" page, a login page, a challenge, a lock or limit notice, or an error page. Anything else stops the run with `PLATFORM_CHECK`.

**What counts.** In the answer's `TimelineAddEntries` instruction, the entry `tweet-<focalId>` is the post, and the `tweet-<id>` entries before it are the posts above it, the first post first. Entries after it, which hold replies, related posts and cursors, are never read. When the topmost post above still names a parent, the chain is `partial`; otherwise it is `complete`. Each result is one of:

| Result type | Recorded as |
|---|---|
| `Tweet`, or `TweetWithVisibilityResults` with the post under `tweet` | `read`, with the fields below |
| `TweetTombstone` | `tombstone`, with `tombstone.text.text`, at most 500 characters |
| `TweetUnavailable` | `unavailable`, with `reason`, at most 64 characters |
| no entry for the post, and the selectors module shows X's "post does not exist" page | `not-found` |

Any other result type, `TweetPreviewDisplay` included until the canary has seen it, stops the run with `SHAPE_CHANGED`.

From each post the run keeps exactly these fields and drops the rest of the answer:

| Field | Path | Required |
|---|---|---|
| ID | `rest_id`, 1 to 40 digits, equal to the entry's ID | yes |
| text | `legacy.full_text`; for a long post `note_tweet.note_tweet_results.result.text` | yes |
| author | `core.user_results.result.core.screen_name` and `.name`, or the same two under `.legacy` | one of the two |
| date | `legacy.created_at` | no |
| links | `legacy.conversation_id_str`, `legacy.in_reply_to_status_id_str`, `legacy.quoted_status_id_str` | no |
| media | `legacy.extended_entities.media[]` with `type`, `media_url_https`, `ext_alt_text`, `video_info.duration_millis` and `video_info.variants[]` with `content_type`, `bitrate` and `url` | no |
| quoted post | `quoted_status_result.result`, with the fields of this table, one level | no |

Nothing about the person's own view is kept: no liked, reposted or bookmarked flags, no follow relationship, no view counts, no replies below, no promoted entries. The kept fields are stored as `signedInRecord`, never the whole answer.

**Shape lock, failing closed.** The run stops with `SHAPE_CHANGED`, and the window stays open, when:

1. a required field of the opened post is missing or has another type;
2. a media `type` is not `photo`, `video` or `animated_gif`, a variant's `content_type` is not `video/mp4` or `application/x-mpegURL`, or a media or variant URL is not `https` on `pbs.twimg.com` or `video.twimg.com`;
3. the instruction path or the pattern of the entry IDs differs from the one the last accepted canary recorded in its run's `bodyShapes['read-post']`, which holds key paths as ADR-027's delete shapes do; a canary records them from its first read and compares the later ones; the author may sit under `core` in one post and under `legacy` in the next, because the sources show both;
4. the answer has an `errors` member and no entry for the post, while the selectors module does not show X's "post does not exist" page.

`tombstone`, `unavailable` and `not-found` are results, not errors. The run records them and moves on.

### 3. Videos and GIFs

**Where the bytes come from.** Always from X's media hosts, through the anonymous client of ADR-026: `https://video.twimg.com` for video files, `https://pbs.twimg.com` for photos and poster images. As ADR-026 says, the client sends no cookie and no referrer and uses the user agent `SocialPrune/<version>`. For media it also refuses redirects, and a URL must be `https` on the pinned host, without user name or port. The signed-in session never downloads a file for SocialPrune. If the canary shows that `video.twimg.com` refuses files without a sign-in, they are recorded as `refused` and the question goes back to the maintainer; no fallback through the session is built.

**Which file.** Among the `video/mp4` variants, the one with the highest `bitrate` label whose response declares a `Content-Length` within the per-video limit. When the declared length is larger, the request is cancelled and the next lower variant is tried. A GIF usually has one MP4 variant. A video without any MP4 variant is `hls-only`: stream playlists are never fetched, because their audio sits in a separate stream that SocialPrune would have to mux. The poster image named in `media_url_https` is stored with the video.

**How large.** The labels give an upper bound, not a size. A 140-second video at the 1080p label of 10,368 kbit/s takes at most 181 MB, at the 720p label of 2,176 kbit/s at most 38 MB; a 2-hour Premium video at 1080p takes at most 9.3 GB. The one file measured in the sources had about a fifth of its label's rate. All of this is arithmetic and one third-party measurement.

| Limit | Default | Flag and range |
|---|---|---|
| one video file | 1 GiB | `--max-video-mb`, 1 to 16,384 |
| new media in one run | 20 GiB | `--max-run-gb`, 1 to 500 |
| free space left on the workspace's drive | 5 GiB, read with `fs.statfs` before each file | none; below it the run stops with `DISK_LOW` |

A file over the per-video limit is `too-large`. When the run's limit is reached, the media still missing get `run-cap`, the run ends with the reason `size-cap` and no error, and the next run goes on.

**Writing.** Into `<workspace>/originals/<id>/<n>.mp4.part`, opened exclusively, streamed, synced, then renamed to `<n>.mp4`. The response must have the content type `video/mp4`, and the file the box name `ftyp` at bytes 4 to 8. Leftover `.part` files in `originals/<id>/` are removed when the next run starts. Posters go to `<n>-poster.jpg`, `.png` or `.webp`, checked like photos. The headers must arrive within 15 seconds, and 30 seconds without a byte fail the file. Five failed files in a row stop the run; a 429 from a media host stops it at once.

**Pace of the files.** At most one request per second across the media hosts, one at a time, as in ADR-026. In `originals fill x` the files of a post are fetched after its page was read and before the next page opens; they do not count as page opens.

The same rules apply in `originals fetch` to the videos its anonymous answers name.

### 4. Serving and showing them

**Route.** The review server's media route accepts `^/originals/([0-9]{1,40})/([1-4](?:\.(?:jpg|png|gif|webp|mp4)|-poster\.(?:jpg|png|webp)))$`, with the checks photos have today: exact Host and Origin; the session cookie, else 401; `Sec-Fetch-Site: same-origin` when the header is present, else 403; the record lists the file as stored, else 404; a regular file inside the workspace and no link; and the file's first bytes match its type.

**Ranges.** Every media response carries `Accept-Ranges: bytes`. A `GET` with one range, `bytes=a-b`, `bytes=a-` or `bytes=-n`, answers 206 with `Content-Range` and `Content-Length`. A range that starts at or after the end answers 416 with `Content-Range: bytes */<size>`. Several ranges, a malformed value or an `If-Range` header make the server ignore the range and send the whole file with 200, which RFC 9110 allows. `HEAD` answers with headers only. Files are streamed from disk between start and end offsets, never read whole. Apple's Safari guide requires byte ranges for media on iOS, and the other browsers use them to seek.

**Page policy.** The local-review header and meta policy of [ADR-016](ADR-016-local-review-server.md) gains `media-src 'self'` and nothing else. Without it the policy's `default-src 'none'` blocks every video. The Pages app's policy does not change, because its workspace still answers with no originals.

**PostCard.** The stored media show in their order: a photo as `<img>`, with X's alt text when the answer had one; a video as `<video controls preload="metadata" playsInline>` with its poster; a GIF as `<video controls loop muted playsInline preload="metadata">`. Nothing plays by itself. A media entry that is not stored says why, in one line from the catalog. Under the original, a collapsed "Conversation above (n posts)" lists the chain from the first post down, each post with author, text and media. The person's own posts appear as their export entries, labelled "Your post", with their review state; a chain that ends early says "X did not show the posts above this one." The line about the source reads either "Fetched from X without sign-in on 11 October 2026" or "Read through your signed-in X account on 11 October 2026". A full text adds "Full text as X showed it to your account."; a text still cut off says "X sent only the beginning of this long post." Everything renders as React text nodes.

**Protocol.** The workspace protocol of [ADR-007](ADR-007-review-data-worker.md) gains `getConversation { originalId }`, answered by `conversation { chain, state }`: at most 21 links, the first post first, each `{ id, original: Original | null, ownItemId: string | null }`. `state` is `complete` when the chain reaches a post without a parent, `partial` when it stops at a missing, unseen or unread post or after 20 posts, and `not-read` when nothing above is stored. The browser worker answers `{ chain: [], state: 'not-read' }`.

### 5. Data model, schema version 4

The workspace document goes to `schemaVersion: 4`, the version after ADR-027's 3. A post record changes shape, and version 3 readers check records strictly, so only a new version tells an older reader honestly that it cannot read the file. Readers accept versions 1 to 4, writers write 4, and a version 3 reader meets a version 4 file with `WORKSPACE_SCHEMA_UNSUPPORTED`. If ADR-027 is built with other version numbers, this record takes the next free number for the document and for the SQLite layout, and the build notes which.

```ts
OriginalMedia = {
  n: 1 | 2 | 3 | 4,
  kind: 'photo' | 'video' | 'gif',
  source: 'anonymous' | 'signed-in',            // which answer named the file
  url: string | null,                             // the chosen file, on pbs or video.twimg.com
  file: string | null,                            // '1.jpg' to '4.webp', or '1.mp4' to '4.mp4'
  poster: string | null,                          // '1-poster.jpg' and so on, video and gif only
  status: 'stored' | 'failed' | 'refused' | 'too-large' | 'hls-only'
        | 'no-variant' | 'run-cap' | 'not-stored',
  bytes: number | null, durationMs: number | null, bitrateLabel: number | null,
  altText: string | null                          // X's alt text, at most 1,000 characters
}
Original = {
  id,
  anonymous: { status: 'fetched' | 'not-found' | 'tombstone' | 'failed', at } | null,
  signedIn: { status: 'read' | 'not-found' | 'tombstone' | 'unavailable', at,
              runId, attemptId, reason: string | null } | null,
  text, authorName, authorHandle, createdAt,      // the best version known
  textSource: 'anonymous' | 'signed-in' | null,
  textCompleteness: 'unknown' | 'truncated' | 'full',
  media: OriginalMedia[],                         // at most 4, n rising
  quotedId, parentId, conversationId,
  chainAbove: 'complete' | 'partial' | null,      // set by a signed-in read
  raw: Record<string, Json> | null,               // the anonymous answer, as today
  signedInRecord: Record<string, Json> | null     // the fields of section 2, never the whole answer
}
```

- A signed-in `read` replaces `text`, the author and `createdAt`, and sets `textSource: 'signed-in'`; the anonymous text stays in `raw`. `textCompleteness` becomes `full` after a signed-in read carrying `note_tweet` text, or complete legacy text with no note or an explicitly non-expandable note and no `legacy.truncated` flag. An expandable note without text stays `truncated`. This distinction follows the 2026-10-13 path-only diagnosis; anonymous `note_tweet` still marks its answer as cut off.
- `not-stored` occurs only in migrated records. `no-variant` means the answer named a video or GIF without variants.
- Posts above and quoted posts are records of the same kind. One post can be referenced, sit above another and be quoted at once; the record does not say why it is stored, the items and links do.

**Migration from 3, and from 2 by way of 3.** `anonymous` takes the old `status` and `fetchedAt`; `signedIn`, `createdAt`, `conversationId`, `chainAbove` and `signedInRecord` start as `null`; `textSource` is `anonymous` for `fetched` rows and `null` for the others; `photos` become media of kind `photo` with source `anonymous`; and `video: 'not-stored'` becomes one more media entry of kind `video` with status `not-stored` when a slot is free. Nothing else changes.

**Backup.** The document keeps the `originals` array and `counts.originals` where ADR-026 put them, and carries the records, not the files, as today. `backup export` prints how many photo, poster and video files with how many bytes stay in `<workspace>/originals/` and have to be copied with that folder; after a restore without it, the review says "Not in this copy" for each file. The reader checks: unique IDs; `n` unique and rising; each `file` name matching its kind's pattern; a `file` exactly when the status is `stored`; a `poster` only for a video or GIF; `signedInRecord` exactly when the signed-in status is `read`, and `textSource: 'signed-in'` only then; and every `signedIn` naming an existing fill run and one of its `read-post` attempts.

**Journal.** ADR-027's records gain:

- `BrowserRun.mode` gains `'fill'`; `endReason` gains `'canary'`, `'size-cap'` and `'shape-changed'`, next to ADR-027's `'daily-cap'`, `'stopped-by-person'`, `'error'` and `'platform-check'`; and `canaryAcceptedAt: UtcTimestamp | null` is written once, by the person's click, and only on a run that ended with `'canary'`.
- `BrowserAttempt.originalId: string | null`, with `itemId` now nullable and exactly one of the two set; `action` gains `'read-post'`, and `state` gains `read`, `tombstone` and `unavailable`.
- A `read-post` attempt is one `sending` record, appended and committed before the navigation, followed by exactly one settling record: `read`, `not-found`, `tombstone`, `unavailable` or `failed`. It is never `ambiguous`: reading changes nothing on X, so an unsettled read counts as `failed`, and the post may enter a later plan. A run that starts and finds a `read-post` record without a settling record first appends `failed` with the code `INTERRUPTED`. Within a run there are no retries.
- The reader checks gain: every `read-post` attempt names an existing original and a run in mode `fill`; every other attempt still names an item.

**Narrow writer.** `OriginalsFillWriter` in `packages/core/src/workspace/` appends fill runs and read attempts and writes original records. It has no method for decision or outcome events, and only the fill runner constructs it ([ADR-023](ADR-023-acting-in-own-account.md) PA-16).

**SQLite.** The `originals` table gets the new columns in a layout migration that copies the database file first, as the migration that added the table does; JSON columns are checked with `json_valid` and enums with `CHECK`. `browser_attempts` gains `originalId`.

### 6. Command

```text
socialprune originals fill x --workspace <dir> --account <key> --dry-run [--include <file>] [--list <file>] [--json]
socialprune originals fill x --workspace <dir> --account <key> --profile <dir> --plan <hash>
    [--include <file>] [--limit <n>] [--max-video-mb <n>] [--max-run-gb <n>] [--browser chrome|edge]
```

It is a command of its own, not a flag on `originals fetch`, because it is another kind of action. It runs signed in, in a browser window. Without a written order it starts with a click and refuses pipes. AUTO-1 on 2026-10-13 adds the narrowly scoped written-order path below; a flag on the anonymous command would still mix two different action boundaries.

**Dry run.** It reads the workspace only: no browser, no profile, no network, and no writes except the list file the person names, which it refuses to overwrite. One row per post: its ID, its reasons, the date and first line of the person's own entry that references it, or "above <id>" for a post in a chain, and the anonymous result. Above the rows: counts per reason, how many posts are in the plan only for `unseen`, excluded notices as `finalNotices: { deleted, suspended, accountGone }`, the page opens, the time at the pace below, the upper bound for media from the stored answers that name variants and a duration, and "size unknown, at most 1 GiB each" for the rest. The human output explains in one sentence that X shows the excluded posts the same way to a signed-in account. These counters count only rows left out by the notices, not rows already excluded after a signed-in read or explicitly restored by `--include`. `--json` gives counts, the plan hash, the estimates and the warning, never text, and refuses `--list`. The plan hash is SHA-256 over the canonical JSON of the planned rows sorted by ID, each `{ id, reasons, anonymousAt }`; excluded notices and their counters are not hashed.

**A run** follows ADR-027's steps 1 to 5. It refuses pipes and `--json` (`NOT_INTERACTIVE`), refuses a changed plan (`STALE_PLAN`), checks the profile marker (`PROFILE_INVALID`) and the browser (`BROWSER_NOT_FOUND`), takes the profile snapshot, and shows the confirmation page on `127.0.0.1` with its page token in the fragment. That page shows the counts per reason, the first 20 rows with the path of the full list, the estimates, what the run can change and the warning, with **Start**. Nothing is opened on X before that click. After it, a second tab opens X and the run compares the signed-in account with the export's (`ACCOUNT_MISMATCH`). Then come the canary or the paced run, and at the end the read-back.

**AUTO-1, written order, decided on 2026-10-13.** `originals fill x ... --order <file>` accepts a UTF-8 JSON file with no extra properties: `{ scope: 'originals-fill-x', account: '<expected-name>', givenAt: '<ISO-8601>', words: '<the person's own order>', maxPages?: 1..200 }`. Scope is exact, account matches the effective export or `--handle` name case-insensitively, the date is valid, words are nonempty, and the unchanged `--plan` hash remains mandatory. The file is limited to 64 KiB and its exact bytes are hashed with SHA-256. Invalid scope/account refuses before browser or profile access; a changed plan refuses before launch. The order can run with piped stdout or `--json`, prints the warning to stderr, and opens the confirmation page as a status view with Stop but no Start wait. It never applies to `delete x`.

In an ordered run, every page's stored focal result is compared with its exactly selected article, without clicks or scripts on X: text, photo count and video/GIF count. Known `https://t.co/<token>` URLs in the text may be replaced only by that article's rendered link text before comparing; there is no general tolerance. Quoted posts and reply articles are excluded from the counts. Missing full text, missing focal text, any unequal count or unrecognized notice stops with `CANARY_MISMATCH` and accepts nothing. The terminal and audit expose only counts, not post text. All sampled entries matching records the usual canary acceptance plus `acceptedBy: 'automatic-check'`; the order runner closes its browser context itself at the end. Manual window closure or Stop still cancels it. Without `--order`, Start/Continue/Matches/Does not match are unchanged.

Real pages on 2026-10-13 showed how X renders a post, and the comparison follows that. X shows only the part of `legacy.full_text` inside `display_text_range`, counted in Unicode code points, so leading reply mentions are not shown. It decodes HTML entities, leaves out the media link and the URL of a link card, and leaves out the permalink of a quoted post. It renders emoji as `<img alt>`, which `innerText` drops. A quoted post sits inside the focal article as a `div[role="link"]` card with its own text and photos, while the post's own photos sit in `a[role="link"]` anchors. So the comparison builds a display text from the answer for that one page and never stores it: the range slice, entities decoded, media links removed, and the card URL and quote permalink removed only when the focal text does not render them as links. It reads the focal text, photos and players outside any nested `div[role="link"]` card, removes each image alt from the display text once and in order, and then compares the rest with the shown text as whole strings after whitespace normalization. A post without its own text matches only when its display text is empty. The stored full text stays as X sent it. The parent ran this comparison on five real pages of posts already stored anonymously: a quote with media, a link card, a video quoting a post, a reply with emoji and a post with an HTML entity and two photos. All five matched.

The additional audit is CLI-local: an additive `browser_order_audit` table linked to the run records `startedBy: 'agent-on-order'`, `orderSha256`, automatic acceptance and count-only comparisons. On a mismatch it records `displayEndReason: 'canary-mismatch'`, while the shared v4 run keeps its existing `error` end reason. Core schemas and portable backups are unchanged; the order audit does not travel in them. This boundary is explicit rather than adding fields that a backup would silently discard.

On 2026-10-14 X rendered a note tweet's photo after its text, so the comparison reads focal locators for up to 10 seconds, observes at least two seconds even for zero expected media and requires the expected text and media counts to remain unchanged for one second before comparing them.

On 2026-10-14 X showed a protected account's post, signed in, as a text notice in an unlabelled article, so the comparison now matches that notice by the answer's own full tombstone text.

On 2026-10-14 X listed a reply in a conversation module without its content, so the projector skips such an empty item outside the focal post and still stops on every other unknown shape.

On 2026-10-14 X's layout made innerText add spaces around a mention inside a post, so the comparison also accepts an exact match of the focal text's textContent.

On 2026-10-14 a protected post's parent was itself a notice, so the comparison aligns the page's notices with the answer's notices in order and checks each one's own text.

On 2026-10-14 the post above a read reply was a notice in a direct entry, so a notice parent now ends the chain as partial and a stop names its check instead of `other`.

On 2026-10-14 X answered a signed-in post request with an empty result for the post itself and showed no post or notice, so the tool records it as unavailable with the reason EmptyResult when both sides agree, and a shape stop is no longer reported as a platform check.

2026-10-13: An export without the account file supports `--handle`, compared with the signed-in account before reading a post, because the account file also holds private fields.

**The warning**, in the terminal, on the confirmation page above **Start** and in the documentation. It keeps ADR-023's sentences that apply to reading and adds one about what the run does:

> X's rules do not allow this kind of automation. X can lock or suspend your account for it, even though SocialPrune goes slowly and stops at the first problem. This run only reads: it opens posts in your signed-in X window and keeps what X shows. SocialPrune does not hide that a program is acting in your browser. Use it only for your own account, and only if you accept this.

> Die Regeln von X erlauben diese Art von Automatisierung nicht. X kann dein Konto dafür sperren oder einschränken, auch wenn SocialPrune langsam vorgeht und beim ersten Problem anhält. Dieser Lauf liest nur: Er öffnet Beiträge in deinem angemeldeten X-Fenster und speichert, was X anzeigt. SocialPrune verbirgt nicht, dass ein Programm in deinem Browser handelt. Nutze es nur für dein eigenes Konto und nur, wenn du das in Kauf nimmst.

Both texts fall under `pnpm copy:check`.

**Agents** may run `originals fill x --dry-run --json` and report counts, the hash and the warning. Only the person's explicit written order for exactly AUTO-1's `originals-fill-x` scope permits `--order`; it does not permit deletion or setup, reading profile contents, or editing journals. Other agents remain dry-run-only without that order.

### 7. Pace and stopping

| Setting | Default and maximum |
|---|---|
| time between the starts of two page opens | at least 30 seconds |
| page opens per batch | 20 |
| pause after each batch | 15 minutes |
| page opens per calendar day and account, in the workspace time zone, counted over every signed-in run (fill, delete and verify) | 200; `--limit` lowers it for one run, nothing raises it |
| posts above one original, both passes together | 20 |

At this pace 200 posts take about four hours, and 1,000 posts five days. The numbers are ADR-027's chosen limits for deletion, not measured ones. Waits are fixed, never randomized.

The run stops at once, leaves the window open and writes its end reason on: a login page, a challenge or captcha, a lock or limit notice, an error page, a `TweetDetail` answer with a status other than 200, or neither an answer nor a known page state within 30 seconds (`PLATFORM_CHECK`); `SHAPE_CHANGED`; `UNEXPECTED_ACTION` (section 8); `ACCOUNT_MISMATCH`; an extension ID absent from the before set (`PLATFORM_CHECK`), including the new side of a replacement; a closed browser; `DISK_LOW`; a 429 from a media host; five failed media files in a row; and **Stop** or Ctrl+C, which let the current file finish first. It ends without an error at the daily budget, at the run's media limit and at the end of the plan. Edge was observed on 2026-10-13 to remove default extension folders when started with `--disable-extensions`, after installing them on its first plain start. Such removals are recorded without stopping. Fill keeps extension disabling, compares IDs through the shared added-ID helper at every checkpoint, and reads only directory names. The CLI profile report records before/after IDs and the removed/added differences. The sandbox and every automation mark stay enabled.

Every end reason is printed in the terminal before waiting for the person to close the X window, and remains visible on the confirmation page until closure. The confirmation server closes only after that wait. With `--lang de`, the full page, Start/Weiter/Passt/Passt nicht/Stopp controls and status lines are German; English remains the default. The stylesheet is served from the loopback origin under the existing strict policy. This replaces the silent terminal wait and already-closed confirmation session observed during the 2026-10-13 canary; it does not retry the read or advance the journal after ending.

### 8. What the run does in the profile

The shared 20-second render wait and focal-article selection of ADR-027 apply to fill too. The 2026-10-13 path-only comparison found direct `itemContent` entries alongside cursors and `content.items[].item.itemContent` conversation modules, plus `note_tweet.is_expandable` and `note_tweet.note_tweet_results.result` metadata with optional text. The projector accepts only those known containers, skips cursors, selects the exact focal ID, and follows `in_reply_to_status_id_str` for up to 20 preceding parent posts rather than copying unrelated timeline entries. An explicitly non-expandable note without text uses complete `legacy.full_text` unless `legacy.truncated` says otherwise. Core author paths were already supported. Unknown result types, duplicate IDs and unknown non-cursor containers still stop with `SHAPE_CHANGED`; viewer fields, richtext metadata and unrelated replies are not stored.

The first ordered canary on real X, on 2026-10-13, stopped on its first page because a conversation module held a "show more" cursor item. The projector now skips cursor items inside modules as it does at entry level, and every other unknown item type still stops. A shape stop writes a sanitized failure token into the value-free report, so the next stop names its check without another page. At the end of an ordered run the CLI brings the status tab of the confirmation origin to the front and waits up to three seconds for the exact final text with a locator. Generated runs showed that the page's strict CSP can reject the earlier string predicate. Why the status page stayed without its final text in that real Edge run is not observed yet.

On 2026-10-13 X answered with a visibility wrapper whose inner post had no type name, and showed its video only behind an age-verification overlay. The projector accepts that wrapper only when the inner post has an ID and a `legacy` object. The tool stores the shown text, never clicks the overlay, never states an age and does not download media behind it. Such media is recorded as `not-stored` without a URL, and a later anonymous `originals fetch` leaves every row with a signed-in result unchanged, so it cannot fetch that media either.

The browser still aborts every host outside `x.com`, `api.x.com`, `abs.twimg.com`, `pbs.twimg.com` and `video.twimg.com`; neither the diagnosis's `grok.com` nor `ton.twimg.com` requests are admitted. Aborted-host counts are recorded without setting `UNEXPECTED_ACTION`. The exact mutation operation list on the allowed X origin still stops; allowed background telemetry is recorded separately. `/home` is opened only for the initial account check, because its timeline can autoplay media. Account read-back uses the current status page.

It may navigate X's tab to the status URLs it builds, wait, read the one answer per post that section 2 describes, and read the page's markup through the selectors module to recognize its state. It may not click, type, scroll, hover, focus, press keys, close dialogs, play or pause media, like, repost, reply, bookmark, follow, mute, block, ask for access, state an age or change a setting. It adds no request routing, no scripts and no functions to X's page, and does nothing from ADR-023's forbidden list: no changed user agent, no stealth plugin, no solving, no proxy, no hidden window.

**What a run can change**, printed before it: ADR-023's text for step 3 of the profile procedure, then the steps of this run: "Open each listed post's page by its address and keep what X sends for it. No clicks, typing or scrolling in X's tab. Download the photos and videos named in X's answer from X's media servers, without your sign-in." and "Each opened post goes into this profile's history. X's pages fill its cache, including parts of videos X's player loads on its own, and X may change its cookies and site data."

**Snapshot and read-back:** ADR-023's steps 4 to 6. The fill run expects no request that changes anything, so every request ADR-023's step 5 records, any method other than `GET` to X's hosts, goes into `profileReport.unexpectedRequests` with method, host, path and status, and the person sees them grouped with counts. The report says that X's page can send such requests on its own and that the tool cannot tell all of them apart. One group stops the run at once with `UNEXPECTED_ACTION`, because the run never clicks and so something else is acting: a request whose path is `/i/api/graphql/<queryId>/<name>` with `<name>` exactly `CreateTweet`, `CreateNoteTweet`, `DeleteTweet`, `FavoriteTweet`, `UnfavoriteTweet`, `CreateRetweet`, `DeleteRetweet`, `CreateBookmark` or `DeleteBookmark`, or whose path is exactly `/i/api/1.1/friendships/create.json`, `/i/api/1.1/friendships/destroy.json`, `/i/api/1.1/blocks/create.json` or `/i/api/1.1/mutes/users/create.json`. The names come from `twikit`'s list of X's operations, and the list does not claim to be complete.

### 9. What stays impossible, and what the review says

Known anonymous notices of author deletion, suspension or an account that no longer exists do not need another page open: X shows these the same way signed in. Only an explicit `--include` restores their `unseen` reason. Unknown, missing or empty notices remain planned. The signed-in expectations below still apply to those reads and to explicit overrides; no real signed-in run has been observed for this candidate.

| Case | Expected answer to the signed-in account, unobserved until the canary | Recorded as | The review says |
|---|---|---|---|
| deleted post | X's "post does not exist" page and no entry | `not-found` | "X does not show this post to your account either. It was probably deleted." |
| suspended account | a tombstone with X's notice | `tombstone`, with X's words | "X shows only a notice instead of this post:" and X's words |
| author blocked the person | a tombstone or `TweetUnavailable` | `tombstone` or `unavailable` | X's words, or "X does not show this post to your account." |
| protected account the person does not follow | `TweetUnavailable` with `Protected` | `unavailable` | "This account shows its posts only to the people it approved. X does not show this post to your account." |
| post X shows only to accounts with a stated age | `TweetUnavailable` with `NsfwViewerHasNoStatedAge` | `unavailable` | "X shows this post only to accounts that stated their age. SocialPrune does not change your account settings." |
| video without an MP4 file | stream variants only | media `hls-only` | "X offers this video only as a stream. SocialPrune stores only video files." |

Under every such case the review adds: "SocialPrune does not follow, unblock, ask for access or change settings to get a post." X's notice text is shown as text, never as markup. ADR-026's sentence "X did not return this post. It may have been deleted or made private." stays for anonymous results the signed-in pass has not read.

### 10. Order, and what the first run must show

1. `originals fetch`, anonymous, now with video files, quoted posts and posts above, until no post is `failed` or the person accepts the rest.
2. `originals fill x --dry-run`, then a run. The first run on a workspace, and the first after a `SHAPE_CHANGED` stop, is the **canary**: up to five posts, one for each reason the plan has, then filled up in plan order, each opened alone. After each one, the confirmation page shows what was read, with **Continue** and **Stop**: the text length before and after, the media found per kind with their status, the posts above and whether the first post was reached, and the field positions found. The run ends with the reason `canary` and writes a structure report to `<workspace>/originals/canary-<runId>.json`: key paths, value types, result types, entry ID prefixes with the digits removed, and counts, without a single value, in the manner of the `structure` command.
3. The person compares the posts in the window with the review and clicks **Matches** or **Does not match**. Only **Matches** writes `canaryAcceptedAt`. A full run needs it, and a new dry run.
4. `delete x` ([ADR-027](ADR-027-x-deletion-browser.md)) comes last. Its dry run and confirmation page say how many marked replies and quotes have no settled anonymous original, and how many could still gain from `originals fill x`. While the first number is above zero, the run refuses with `ORIGINALS_PENDING` (exit 2) unless the person passes `--without-originals`.

Before a full run, the canary must show:

1. for every opened post, the `TweetDetail` answer was seen, with a readable body, on the path pattern above, whether or not X's service worker answered it;
2. the field positions the reader expects, recorded in the structure report;
3. for the long post, a stored text longer than the anonymous one and equal to what the window shows;
4. for the video, a file from `video.twimg.com` fetched without the session, of the expected type, that plays in the review in the person's Chrome or Edge;
5. for a reply, the posts above stored as far as X showed them, and whether the first post was reached;
6. for an `unseen` post, what X answered the account, recorded as one of the four results;
7. the read-back: the same account, no added extension ID with extensions disabled, removed IDs recorded, the changed profile files listed, X's own background requests listed, and no `UNEXPECTED_ACTION`;
8. no lock or limit notice during the run, and the account working normally afterwards, which only the person can check.

When a point fails, the next run stays a canary, the person decides, and the fake X and the reader are updated from the structure report, never from a real post.

### 11. Tests

- **Fake X.** ADR-027's fake site in `apps/cli/e2e/fake-x/` gains post pages whose own script fetches a fake `/i/api/graphql/<queryId>/TweetDetail` with `focalTweetId`, so that the request comes from the page, as on X. Generated answers cover a plain post; a long post with `note_tweet`; a video with four MP4 variants and a stream variant; a GIF; a video with stream variants only; four mixed media; a quoted post with a video; a reply with three posts above; a reply whose topmost post above still names a parent; the person's own export post inside a chain; `TweetWithVisibilityResults`; author fields under `core` and under `legacy`; `TweetTombstone`; `TweetUnavailable` with `Protected`; the "post does not exist" page with an `errors` answer; and, for the lock, an unknown result type, a missing `rest_id`, a media URL on another host, an unknown media type, and an answer whose instruction path differs from the accepted canary's. Author fields under `core` in one post and under `legacy` in the next must pass. Further pages answer with a 429, never answer, show a login page, a challenge or a limit notice, send a background `POST`, or send `FavoriteTweet` without a click.
- **Fake media host.** A local server that stands in for both media hosts: an MP4 file, a file whose `Content-Length` is over the limit, a 403, a 429, a stall after the headers, a wrong content type, and a file without `ftyp`.
- **Required proofs.** Nothing is opened on X before **Start**; only the `TweetDetail` body with the right `focalTweetId` is read; every lock case stops with `SHAPE_CHANGED`; viewer fields and replies planted in the fake answers never reach the workspace, with the forbidden values taken from the fixture data (LL-2026-10-002); the canary report holds none of the fixture's IDs, texts or handles; `UNEXPECTED_ACTION` stops; the daily budget counts delete and fill pages together; `run-cap`, `too-large`, `hls-only`, `refused`, and `DISK_LOW` with a fake `statfs`; leftover `.part` files are removed; the person's export post is linked, not copied.
- **Review server.** The range matrix over real sockets: no range; `bytes=0-1`; `bytes=100-`; `bytes=-50`; a range at the end (416); several ranges and a malformed one (200); `If-Range` (200); `HEAD`; 401 without session; 403 with a foreign `Sec-Fetch-Site`; 404 for traversal, for a file the record does not list, for an MP4 without `ftyp` and for a link; and a file larger than the photo limit streams without being read whole.
- **Browser.** In Chromium, Firefox and WebKit against the real review server: the header and meta policy carry `media-src 'self'`; a `<video>` on `/originals/<id>/1.mp4` receives a 206; and, as the positive control, a `<video>` pointing at a second origin is blocked by the policy. Playback is not asserted, because Playwright's Chromium lacks some codecs that Chrome and Edge bundle and the other engines' codecs vary by system; the canary in the person's Chrome or Edge covers it.
- **Data.** Migration from 3 to 4 with photos and `not-stored` videos; backup round trips from the CLI to the browser and back with version 4 originals; and the reader rejecting each broken rule of section 5.
- **No network.** ADR-013's zero-network test adds `originals fill x --dry-run` with and without `--json`, its `--help` and a bad flag, and keeps covering every other command. A test asserts the host constants exactly (`https://x.com`, `https://video.twimg.com`, `https://pbs.twimg.com`, `https://cdn.syndication.twimg.com`) and that the fakes cannot be selected from the production entry. An import-graph test keeps the fill code out of every command except `originals fill`.
- No test contacts X.

### 12. Changes to other records

| Record | New wording |
|---|---|
| ADR-005 | The IndexedDB store `originals` keeps version 4 records verbatim from restores, and a restore of a version 2 or 3 backup migrates its originals as section 5 says. The browser still fetches nothing. |
| ADR-006 | Schema version 4: `Original` and `OriginalMedia` as in section 5, the migration from version 3, the reader checks; `BrowserRun` and `BrowserAttempt` gain the fill fields. |
| ADR-007 | The protocol table gains `getConversation { originalId }` → `conversation { chain ≤ 21, state }`. The browser worker answers with an empty chain. |
| ADR-011 | Catalog keys for the media states, the conversation, the source lines, the cases of section 9, the confirmation page and the warning of section 6, in both languages, under the catalog and copy checks. |
| ADR-013 | The command tree gains `originals fill x`. The network rule reads: "No network access in any command except `originals fetch` as [ADR-026](ADR-026-x-originals-fetch.md) allows it, the run mode of `originals fill x` ([ADR-029](ADR-029-signed-in-originals-pass.md)), and the run and verify modes of `delete x` and of the commands of [ADR-028](ADR-028-instagram-signed-in-session.md)". New codes: `SHAPE_CHANGED`, `UNEXPECTED_ACTION` and `DISK_LOW` (exit 1), `ORIGINALS_PENDING` (exit 2). A run that ends at the daily budget or at the media limit exits 0 and names the reason. |
| ADR-014 | Agents may run `originals fill x --dry-run --json`, nothing else of this record. The MCP server in 0.2 gets no tool for it. |
| ADR-015 | The `originals` columns of section 5 and `browser_attempts.originalId`, in a layout migration that copies the database first. |
| ADR-016 | The HTTP API gains `getConversation`; the media route of section 4 with byte ranges; the local-review policy gains `media-src 'self'`. |
| ADR-017 | Next to `ReviewService` and ADR-027's `BrowserOutcomeWriter`: `OriginalsFillWriter` appends fill runs and read attempts and writes original records, never a decision or outcome event, and only the fill runner constructs it. |
| ADR-018 | The packed smoke test runs `originals fill x --dry-run --json` on the demo export and asserts zero network calls. No new dependency. |
| ADR-023, proposed | The table "What is allowed" gains the row: Read, in the dedicated profile, the originals and the posts above them that the anonymous fetch could not get; X; the dedicated browser profile (ADR-029); the person's own account. PA-1 treats `originals fill x` like a deletion: it starts only with the person's click on **Start**, and an agent never starts it. PA-5's first watched entry is the canary of section 10. PA-6 applies to reads with the rule of section 5 that an unsettled read is `failed`. PA-8 names this record's defaults next to those of ADR-026 to ADR-028. PA-10's warning appears before every fill run, in the reading form of section 6. |
| ADR-026, proposed | The fetch stores the video and GIF files named in `mediaDetails` under the rules of section 3; marks a text as cut off when `note_tweet` is present; stores quoted posts as records of their own, fetched by ID when not embedded, one level deep; follows the parent link upward, at most 20 posts above each original, linking the person's own export posts instead of fetching them; and writes every file under a temporary name first. The notice names `video.twimg.com` as well. The review line "Videos are not stored." gives way to the media states of section 4. |
| ADR-027, proposed | The journal types of section 5; the daily cap counts the page opens of every signed-in run of the account, and ADR-027's lower caps for verify stay; the selectors module's page states serve the fill run as well; the fake X site gains the pages of section 11; and `delete x` shows pending originals and refuses with `ORIGINALS_PENDING` unless `--without-originals` is given. |

[ADR-021](ADR-021-archive-media.md) stays as it is: it covers media inside the export.

**Decision made by:** maintainer
**Approved on:** pending

## Build spec

Build observation on 2026-10-12: the Windows Playwright WebKit build rejects the generated H.264 MP4 with media error 4 even while `canPlayType` reports support. Chromium and Firefox decode and play the same authenticated file. The UI therefore distinguishes a missing local file from a stored file this browser cannot decode. This does not change the reader's media format or its CSP.

For one code lane, after ADR-027's browser module is integrated. Effort not measured.

**Write set.**

- `packages/core/src/model/original.ts` and `packages/core/src/model/index.ts`: the version 4 types and schemas.
- `packages/core/src/workspace/`: `migrate.ts`, `backup.ts`, `restore.ts`, `store.ts`, `memory-store.ts`, `protocol.ts` (`getConversation`), a new `conversation.ts` (the chain walk over records and export items) and a new `originals-fill-writer.ts`; `packages/core/src/node/schemas.ts` and the generated schema files.
- `apps/cli/src/originals/`: `syndication.ts` (`mediaDetails`, `note_tweet`, quoted posts, the parent walk), `fetch.ts`, `media.ts` (`.part` writes, posters, `statfs`), a new `video.ts` (variant choice and streamed download), and the tests and fakes under `test/`.
- `apps/cli/src/browser/x/fill/`: `plan.ts`, `read.ts` (the response filter), `extract.ts` (the zod projection of section 2), `lock.ts`, `run.ts` and `report.ts` (the canary structure report); the host constants next to ADR-027's.
- `apps/cli/src/commands/originals-fill.ts`, `apps/cli/src/cli/registry.ts`, `apps/cli/src/cli/errors.ts`; ADR-027's delete command for `ORIGINALS_PENDING`.
- `apps/cli/src/workspace/sqlite-store.ts`: the layout migration.
- `apps/cli/src/review/`: `original-media.ts` (route grammar, ranges, streaming), `server.ts`, `static.ts` (policy) and `runtime.ts` (`getConversation`), with `server.test.ts` and `originals.test.ts`; the zero-network test `apps/cli/src/workspace/network.test.ts`.
- `apps/web/src/local-review/policy.ts`; `apps/web/src/workspace/idb-store.ts`, `worker-runtime.ts` and `client.ts` (version 4 records, the empty conversation); `apps/web/src/social/PostCard.tsx` with a new `Conversation.tsx`, `Social.module.css`; both catalogs and their generated types.
- `apps/cli/e2e/fake-x/`, a new `apps/cli/e2e/originals-fill.spec.ts` and `apps/cli/e2e/review-media.spec.ts`, `apps/cli/e2e/review-session.spec.ts` and the web policy specs.
- `skills/socialprune/SKILL.md`, and the factual sections of `AGENTS.md`. `THIRD_PARTY_NOTICES` only if the lane copies MIT code; this record copies none.

**Contracts.** Types not spelled out here follow section 5 and ADR-027's records.

```ts
// packages/core/src/workspace/originals-fill-writer.ts
interface OriginalsFillWriter {
  startRun(run: { runId: string; accountKey: string; planHash: string; canary: boolean; startedAt: string }): Promise<void>;
  sending(attempt: { attemptId: string; runId: string; originalId: string; at: string }): Promise<number>; // seq
  settle(result: { attemptId: string; state: 'read' | 'not-found' | 'tombstone' | 'unavailable' | 'failed';
                   at: string; code: string | null }, originals: Original[]): Promise<void>;     // one transaction
  endRun(end: { runId: string; endedAt: string; endReason: EndReason;
                bodyShapes: Record<string, string[]>; profileReport: ProfileReport }): Promise<void>;
  acceptCanary(runId: string, at: string): Promise<void>;
}
// apps/cli/src/browser/x/fill/read.ts
function isPostAnswer(response: { method: string; url: string; status: number; contentType: string | null },
                      focalId: string): boolean;
// apps/cli/src/browser/x/fill/extract.ts
function extract(body: unknown, focalId: string, lock: ShapeLock):
  | { kind: 'read'; post: SignedInPost; above: SignedInPost[]; quoted: SignedInPost[];
      chainAbove: 'complete' | 'partial' }
  | { kind: 'tombstone' | 'unavailable'; reason: string }
  | { kind: 'no-entry' }
  | { kind: 'shape-changed'; path: string };
// apps/cli/src/originals/video.ts
function chooseVariants(variants: Variant[]): Variant[];      // MP4 only, highest label first
function downloadMedia(url: URL, target: MediaTarget, limits: MediaLimits, signal: AbortSignal):
  Promise<{ status: OriginalMedia['status']; bytes: number | null }>;
// packages/core/src/workspace/conversation.ts
function conversation(tx: ReadTransaction, originalId: string, accountKey: string):
  Promise<{ chain: ConversationLink[]; state: 'complete' | 'partial' | 'not-read' }>;
```

**Tests.** Section 11, each proof as a named test that fails against the code it is meant to catch before it counts.

**Proof commands.**

```text
pnpm exec vitest run --project core
pnpm exec vitest run --project cli
pnpm exec vitest run --project web
pnpm --filter socialprune test:e2e
pnpm test:e2e:all
pnpm schemas:check
pnpm i18n:check
pnpm copy:check
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter socialprune build:release
pnpm --filter socialprune pack:check
pnpm --filter socialprune smoke:package
```

The build is done when these pass on Windows and in CI's Linux jobs (LL-2026-10-004). The first real canary is the maintainer's own run, under his explicit scope naming the profile folder; no development agent runs anything against a signed-in profile.

## Consequences

### Positive
- Wherever X shows it to the person, the workspace keeps the videos, GIFs, full long texts, protected posts and the conversation above each reply, before anything is deleted.
- Most of it comes without the account: public videos, posts above and quoted posts go through the anonymous fetch, and the signed-in pass opens only the pages that need the session.
- A change on X's side stops the run at the first page and leaves a structure report from which the reader can be updated.

### Negative
- Videos take disk space, up to 20 GiB per run by default, and the backup file does not carry them, so the person has to copy the `originals` folder as well.
- The reader depends on undocumented answers whose author fields moved at least once, as two projects reported in May 2026; each move stops runs until the reader is updated.
- The person runs each signed-in run in their own terminal and clicks **Start**; an agent can prepare the dry run and name the command, nothing more.
- Missing or changed anonymous notices still cost a signed-in page; known author-deletion, suspension and account-gone notices do not, unless the person explicitly includes them.
- Schema version 4, and changes to ten accepted and three proposed records.

### Risks
- **X limits or suspends the account for the reading.** Mitigation: the anonymous route first, one shared budget of 200 signed-in pages a day, the slow pace, the canary and the stop at the first notice. This lowers the chance; it cannot settle X's judgment, and the warning says so.
- **X's media server refuses files without the session.** Mitigation: the canary tests it before any full run; refused files are recorded as `refused`, and the question goes back to the maintainer instead of a quiet switch to the session.
- **X's service worker hides the answer from the reader.** Mitigation: the canary's first point; ADR-027's deletion reader depends on the same mechanism, so a fix lands once, in the shared driver.
- **A wrong field is read as right.** Mitigation: the exact field table, the shape lock, the person's comparison during the canary, and fake answers written from the structure report.
- **The workspace fills the drive.** Mitigation: the per-video and per-run limits and the 5 GiB floor.

## Open questions for the maintainer

- Do "the original posts" of hard constraint 4 include the posts above an original, up to the first post of the conversation, and the media of the posts it quotes? Answer yes, or name the limit.
- Should videos of public posts come from X's media server without sign-in, so that the signed-in pass opens only the rest? Answer yes or no.
- If X's media server refuses a video without sign-in, should it stay unstored rather than be fetched through your signed-in session? Answer "unstored" or "session".
- Limits of 1 GiB per video and 20 GiB per run, and a stop when less than 5 GiB stay free: accept, or name others? Answer "accept" or the numbers.
- Pace of one page every 30 seconds at most, 20 pages and then 15 minutes pause, at most 200 signed-in pages a day for reading and deleting together: accept, or name a slower one? Answer "accept" or the numbers.
- A first run of five posts that you watch and confirm before the rest runs: agreed? Answer yes or no.
- Deletion waits until every marked reply and quote has its original, unless you pass a flag: agreed? Answer yes or no.

## Evidence

- Code at commit `133a226`: `apps/cli/src/originals/syndication.ts` (the `truncated` key, the size limits, the origin check that admits only the production host or loopback), `apps/cli/src/originals/media.ts` (files opened with `wx` under their final name), `apps/cli/src/originals/fetch.ts`, `packages/core/src/model/original.ts`, `apps/cli/src/review/original-media.ts` and `server.ts` (the media route and its checks), `apps/cli/src/review/static.ts` (the local-review policy), `apps/web/src/social/PostCard.tsx`, and `apps/cli/src/workspace/sqlite-store.ts` (layout 2 with the `originals` table). Read by the architect on 2026-10-11.
- Vercel, `react-tweet` 3.3.1 (MIT), published files on jsDelivr: `dist/api/types/tweet.d.ts`, `media.d.ts` and `video.d.ts`; `dist/utils.js` (`getMp4Videos` sorts MP4 variants by `bitrate`); `dist/twitter-theme/tweet-media-video.js` (plays the variant URL in a `<video>`). Read 2026-10-11.
- d60, [twikit](https://github.com/d60/twikit) (MIT, last push 2026-03-10): `twikit/tweet.py` (last change 2025-04-14: `note_tweet`, `quoted_status_result`, `TweetTombstone`, the `tweet` wrapper, the author under `core.user_results.result`), `twikit/user.py` (last change 2024-12-01: `legacy.screen_name`, `legacy.name`, `legacy.protected`), `twikit/media.py` (`video_info`, `variants`, `duration_millis`, media types), `twikit/client/client.py` (last change 2025-02-07: `get_tweet_by_id` reads the `tweet-<id>` entries before the post's own entry as the posts above; `X-Client-Transaction-Id`), `twikit/client/gql.py` (`/i/api/graphql/<queryId>/TweetDetail` with `focalTweetId`; the GraphQL operation names in section 8) and `twikit/client/v11.py` (the 1.1 paths in section 8). Read 2026-10-11; ideas taken, no code copied.
- fa0311, [twitter-openapi](https://github.com/fa0311/twitter-openapi) (an MIT text with a clause against spam uses; last commit 2026-05-20): `src/openapi/paths/tweet.yaml`, `src/openapi/schemas/tweet.yaml` and `src/openapi/schemas/content.yaml`. Read 2026-10-11; ideas only.
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) (Unlicense): `yt_dlp/extractor/twitter.py` at its change `2bbfb99` of 2026-08-19 (`_graphql_to_legacy` with the four result types and the `TweetUnavailable` reasons, `tombstone.text.text`, `extended_entities`, `_extract_variant_formats`); issues [7255](https://github.com/yt-dlp/yt-dlp/issues/7255) (2023-06-07, format lists and a mediainfo measurement), [9202](https://github.com/yt-dlp/yt-dlp/issues/9202) (2024-02-14, separate HLS audio) and [16321](https://github.com/yt-dlp/yt-dlp/issues/16321) (2026-03-23, a 403 from `video.twimg.com`, closed by a maintainer as a user error caused by a configured `Referer` of another site after two maintainers could not reproduce it). Read 2026-10-11; ideas only.
- solarizeddev, [firedown pull request 285](https://github.com/solarizeddev/firedown/pull/285) (MIT, 2026-05-31), and d4n1elchen, oshikatsu issue 3 (2026-05-15, no license): a user's `screen_name` and `name` under `core`. Read 2026-10-11.
- Microsoft, Playwright 1.63.0 documentation at the tag `v1.63.0`: `docs/src/api/class-response.md` (`body`, `fromServiceWorker`) and `docs/src/network.md` ("Missing Network Events and Service Workers"); [Browsers](https://playwright.dev/docs/browsers), section "Media codecs". Read 2026-10-11.
- IETF, [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110) (June 2022), section 14.2: a server may ignore `Range`, and range handling is defined for `GET` only. MDN, [CSP media-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/media-src) (last changed 2025-07-04): it falls back to `default-src`. Apple, Safari Web Content Guide, [Creating Video](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/CreatingVideoforSafarioniPhone/CreatingVideoforSafarioniPhone.html) (2016-12-12): servers of media for iOS must support byte ranges. Read 2026-10-11.
- X Help Center, "About longer videos for X Premium subscribers" (`help.x.com/en/using-x/premium-longer-videos`) and "How to share and watch videos on X" (`help.x.com/en/using-x/x-videos`): text returned by a web search index on 2026-10-11, without a request to x.com; the maintainer's reading pending. RouteNote, "X quietly increases the maximum video length for free users" (2025-04-15), a news report.
- The maintainer's words of 2026-10-11 as rendered in English by that day's orchestration task; the German original is in that conversation.
- Every pace, limit, size and time figure in this record is a chosen limit or arithmetic. No request to x.com, twitter.com or twimg.com was made for this record, and no browser profile was used.

# ADR-029: The signed-in originals pass on X

- **Status:** Accepted
- **Date:** 2026-10-11
- **Hard constraints touched:** 4 (reading through the person's own signed-in session, on the person's order, what the anonymous fetch of [ADR-026](ADR-026-x-originals-fetch.md) cannot get; the maintainer included posts above a reply and quoted posts' media on 2026-10-12), 2 (post IDs reach X, which already holds them; nothing else from the export leaves), 1 (no developer account, no key, the browser already installed), 3 (the pass writes no decision), 5 (the warning promises nothing, and the review says what X did not show), 6 (tests use a local fake X and fake media hosts, never X)
- **Supersedes in part:** [ADR-005](ADR-005-browser-storage.md), [ADR-006](ADR-006-workspace-event-log.md), [ADR-007](ADR-007-review-data-worker.md), [ADR-011](ADR-011-internationalization.md), [ADR-013](ADR-013-cli-framework-output.md), [ADR-014](ADR-014-agent-interface.md), [ADR-015](ADR-015-cli-storage-node-baseline.md), [ADR-016](ADR-016-local-review-server.md), [ADR-017](ADR-017-shared-workspace-service.md), [ADR-018](ADR-018-cli-distribution.md). It also changes [ADR-023](ADR-023-acting-in-own-account.md) and [ADR-026](ADR-026-x-originals-fetch.md), accepted on 2026-10-24, and the still-Proposed [ADR-027](ADR-027-x-deletion-browser.md). The section "Changes to other records" names the rules and gives the new wording. The maintainer chose ADR-001's partial-supersession form on card ADR-TEIL v1 A, 2026-10-24 at 19:28:04Z.
- **Builds on:** the browser driver, the dedicated profile, the confirmation page, the journal and the fake X site of [ADR-027](ADR-027-x-deletion-browser.md), which must be built first.
- **Related:** [ADR-005](ADR-005-browser-storage.md), [ADR-012](ADR-012-time-zone-grouping.md), [ADR-017](ADR-017-shared-workspace-service.md), [ADR-021](ADR-021-archive-media.md), [ADR-028](ADR-028-instagram-signed-in-session.md)

Revision of 2026-10-24. It folds the dated implementation notes into the sections they qualify and uses `bf8843f` plus D6 and D7 as the current source. The maintainer chose ADR-DEL v2 A at 10:31:43Z, including workspace-zone counting and code alignment; v2 supersedes v1. That behavior decision did not accept this record. At 19:28:04Z he separately accepted it as written at `c4700552ea56648780baf2bc1f2daccb33b82db2` on card ADR-029 v1 A. Acceptance authorizes no platform run.

Decided by the maintainer on 2026-10-11, in the English rendering of his German words by that day's orchestration task: "I want as much as possible: the videos and the posts and everything that belongs to them. If the problem is that I am not signed in, sign in, that is no problem. The main thing is that it is as complete as it can be." He had been told that he signs in himself, in a dedicated profile the tool opens, so his password never passes through the chat; that X counts signed-in automated reading as automation its rules forbid and may limit or suspend the account for it; and that what works without a login stays anonymous.

Decided by the maintainer on 2026-10-24: this record is accepted on card ADR-029 v1 A at 19:28:04Z. The dated answers near its end distinguish the earlier decisions from behavior built before acceptance.

## Context

The initial `originals fetch` build at `133a226` on 2026-10-11 asked X's public embed service for each post an X reply or quote answered. It kept text, author, photos, reply and quote IDs and the anonymous answer, but no video files. The local review served the photos through an authenticated same-origin route. Backups carried rows, not files. That is the starting point of this record, not the current model: section 5 describes its replacement, built on 2026-10-12 and retained in schema 8 at `bf8843f`, checked on 2026-10-24.

Four gaps motivated the record on 2026-10-11: (a) videos and animated GIFs; (b) full text of long posts; (c) posts of protected accounts the person follows; (d) the conversation above an original and the media of quoted posts. The anonymous extensions and signed-in reader described below are built at `209c895`, checked on 2026-10-23. That source check does not prove completeness on real X pages.

The initial parser checked `truncated`, not `note_tweet`, and wrote photos under their final names. The implementation of this record now checks both truncation signs and uses temporary media files before rename. ADR-026's anonymous-video 403 observation of 2026-10-11 was not a universal refusal; the client tries the available anonymous MP4 variants and records a refusal rather than switching to the signed-in session.

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

**Which answer.** Before navigating, the run listens to the page's responses and reads the body of exactly one: method `GET`; origin exactly `https://x.com`; path matching `^/i/api/graphql/[A-Za-z0-9_-]{1,64}/TweetDetail$`; a `variables` query parameter that parses as a JSON object whose `focalTweetId` equals the opened ID; status 200; a `Content-Type` starting with `application/json`; at most 8 MiB. The body is decoded as strict UTF-8 and parsed as data, never run or rendered. No other body is read. Session headers are never stored; only the bounded numeric rate-window summaries of section 7 leave the live header reader.

**When nothing comes.** The production response window is 30 seconds, a chosen code limit checked on 2026-10-23. Either the answer arrives or ADR-027's selectors recognize a known page state. A `render-timeout` before an answer completes may use section 6's one delayed reopening in a main run. A canary, a repeated timeout, a login, challenge, lock, limit or other failure stops at once.

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

The 2026-10-13 structure-only diagnosis found direct `itemContent` entries and `content.items[].item.itemContent` conversation modules, including cursors and a visibility wrapper without its inner type name. The projector now accepts these known containers, skips cursors, and permits that wrapper only with an inner ID and `legacy` object. It follows the exact focal post's parent links rather than copying unrelated entries. On 2026-10-14, empty non-focal conversation items and a notice parent were added as known shapes; a notice parent ends the chain as partial. On 2026-10-16, empty `SelfThread` results joined the same exact check. An empty focal result becomes `unavailable` with `EmptyResult` only when the page also shows neither the post nor a notice. Unknown shapes and duplicate IDs still stop. These dated observations explain the narrow accepted shapes; they do not admit arbitrary missing fields.

### 3. Videos and GIFs

**Where the bytes come from.** Always from X's media hosts, through the anonymous client of ADR-026: `https://video.twimg.com` for video files, `https://pbs.twimg.com` for photos and poster images. As ADR-026 says, the client sends no cookie and no referrer and uses the user agent `SocialPrune/<version>`. For media it also refuses redirects, and a URL must be `https` on the pinned host, without user name or port. The signed-in session never downloads a file for SocialPrune. If the canary shows that `video.twimg.com` refuses files without a sign-in, they are recorded as `refused` and the question goes back to the maintainer; no fallback through the session is built.

**Which file.** Among the `video/mp4` variants, the one with the highest `bitrate` label whose response declares a `Content-Length` within the per-video limit. When the declared length is larger, the request is cancelled and the next lower variant is tried. A GIF usually has one MP4 variant. A video without any MP4 variant is `hls-only`: stream playlists are never fetched, because their audio sits in a separate stream that SocialPrune would have to mux. The poster image named in `media_url_https` is stored with the video.

**How large.** Multiplying the bitrate labels by duration gives estimates, not measured file bounds. Calculated on 2026-10-11, a 140-second video at the 1080p label of 10,368 kbit/s gives about 181 MB, at the 720p label of 2,176 kbit/s about 38 MB; two hours at that 1080p label gives about 9.3 GB. The third-party example in yt-dlp issue 7255, dated 2023-06-07 and read on 2026-10-11, measured about 436 kbit/s for one file labelled 2,176 kbit/s. Actual admission uses declared and streamed byte counts, not those estimates.

| Limit | Default | Flag and range |
|---|---|---|
| one video file | 1 GiB | `--max-video-mb`, 1 to 16,384 |
| new media in one run | 20 GiB | `--max-run-gb`, 1 to 500 |
| free space left on the workspace's drive | 5 GiB, read with `fs.statfs` before each file | none; below it the run stops with `DISK_LOW` |

A file over the per-video limit is `too-large`. When the run's limit is reached, the media still missing get `run-cap`, the run ends with the reason `size-cap` and no error, and the next run goes on.

**Writing.** Into `<workspace>/originals/<id>/<n>.mp4.part`, opened exclusively, streamed, synced, then renamed to `<n>.mp4`. The response must have the content type `video/mp4`, and the file the box name `ftyp` at bytes 4 to 8. Leftover `.part` files in `originals/<id>/` are removed when the next run starts. Posters go to `<n>-poster.jpg`, `.png` or `.webp`, checked like photos. The headers must arrive within 15 seconds, and 30 seconds without a byte fail the file. Five failed files in a row stop the run; a 429 from a media host stops it at once.

**Pace of the files.** At most one request per second across the media hosts, one at a time, as in ADR-026. In `originals fill x` the files of a post are fetched after its page was read and before the next page opens; they do not count as page opens.

The same rules apply in `originals fetch` to the videos its anonymous answers name. On 2026-10-13 X showed media behind an age-verification overlay. The reader never clicks it or states an age; it keeps the shown text and marks the gated media `not-stored` without a URL. A later anonymous fetch leaves every row with a signed-in result unchanged, so it cannot fetch that gated media either.

### 4. Serving and showing them

**Route.** The review server's media route accepts `^/originals/([0-9]{1,40})/([1-4](?:\.(?:jpg|png|gif|webp|mp4)|-poster\.(?:jpg|png|webp)))$`, with the checks photos have today: exact Host and Origin; the session cookie, else 401; `Sec-Fetch-Site: same-origin` when the header is present, else 403; the record lists the file as stored, else 404; a regular file inside the workspace and no link; and the file's first bytes match its type.

**Ranges.** Every media response carries `Accept-Ranges: bytes`. A `GET` with one range, `bytes=a-b`, `bytes=a-` or `bytes=-n`, answers 206 with `Content-Range` and `Content-Length`. A range that starts at or after the end answers 416 with `Content-Range: bytes */<size>`. Several ranges, a malformed value or an `If-Range` header make the server ignore the range and send the whole file with 200, which RFC 9110 allows. `HEAD` answers with headers only. Files are streamed from disk between start and end offsets, never read whole. Apple's Safari guide requires byte ranges for media on iOS, and the other browsers use them to seek.

**Page policy.** The local-review header and meta policy of [ADR-016](ADR-016-local-review-server.md) gains `media-src 'self'` and nothing else. Without it the policy's `default-src 'none'` blocks every video. The Pages app's policy does not change, because its workspace still answers with no originals.

On 2026-10-12 the Windows Playwright WebKit build rejected a generated H.264 MP4 with media error 4 while `canPlayType` reported support. Chromium and Firefox played the same authenticated file. The UI therefore distinguishes a missing local file from a stored file the browser cannot decode; this does not change the media format or the page policy.

**PostCard.** The stored media show in their order: a photo as `<img>`, with X's alt text when the answer had one; a video as `<video controls preload="metadata" playsInline>` with its poster; a GIF as `<video controls loop muted playsInline preload="metadata">`. Nothing plays by itself. A media entry that is not stored says why, in one line from the catalog. Under the original, a collapsed "Conversation above (n posts)" lists the chain from the first post down, each post with author, text and media. The person's own posts appear as their export entries, labelled "Your post", with their review state; a chain that ends early says "X did not show the posts above this one." The line about the source reads either "Fetched from X without sign-in on 11 October 2026" or "Read through your signed-in X account on 11 October 2026". A full text adds "Full text as X showed it to your account."; a text still cut off says "X sent only the beginning of this long post." Everything renders as React text nodes.

**Protocol.** The workspace protocol of [ADR-007](ADR-007-review-data-worker.md) gains `getConversation { originalId }`, answered by `conversation { chain, state }`: at most 21 links, the first post first, each `{ id, original: Original | null, ownItemId: string | null }`. `state` is `complete` when the chain reaches a post without a parent, `partial` when it stops at a missing, unseen or unread post or after 20 posts, and `not-read` when nothing above is stored. The browser worker answers `{ chain: [], state: 'not-read' }`.

### 5. Data model, schema version 4

Schema 4 introduced these records on 2026-10-12, after ADR-027's schema 3. Version 3 readers cannot read the changed original shape. At `bf8843f`, checked on 2026-10-24, the records remain in current schema 8: writers read `WORKSPACE_SCHEMA_VERSION`, readers accept backups from versions 1 to 8, and the later Instagram and review-feed migrations retain originals and their journal links. Version 4 here names this migration, not the version a current writer emits.

Version follow-up, 2026-10-24: ADR-027's version-skew decision supersedes the current-writer ceiling above. Current workspace, SQLite, IndexedDB and portable writers use version 9; portable readers accept versions 1 to 9. Originals and the CLI-local written-order audit do not change. The optional `warningKind` of a browser run is admitted only in version 9, and a version-8 installed package refuses the migrated workspace and its backup rather than omit the warning gate.

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
- `not-stored` can occur in migrated records, pending anonymous MP4 downloads, and media behind the age overlay described in section 3. `no-variant` means the answer named a video or GIF without variants. These states match the model checked on 2026-10-23, rather than the initial draft's migrated-only claim.
- Posts above and quoted posts are records of the same kind. One post can be referenced, sit above another and be quoted at once; the record does not say why it is stored, the items and links do.

**Migration from 3, and from 2 by way of 3.** `anonymous` takes the old `status` and `fetchedAt`; `signedIn`, `createdAt`, `conversationId`, `chainAbove` and `signedInRecord` start as `null`; `textSource` is `anonymous` for `fetched` rows and `null` for the others; `photos` become media of kind `photo` with source `anonymous`; and `video: 'not-stored'` becomes one more media entry of kind `video` with status `not-stored` when a slot is free. Nothing else changes.

**Backup.** The document keeps the `originals` array and `counts.originals` where ADR-026 put them, and carries the records, not the files, as today. `backup export` prints how many photo, poster and video files with how many bytes stay in `<workspace>/originals/` and have to be copied with that folder; after a restore without it, the review says "Not in this copy" for each file. The reader checks: unique IDs; `n` unique and rising; each `file` name matching its kind's pattern; a `file` exactly when the status is `stored`; a `poster` only for a video or GIF; `signedInRecord` exactly when the signed-in status is `read`, and `textSource: 'signed-in'` only then; and every `signedIn` naming an existing fill run and one of its `read-post` attempts.

**Journal.** ADR-027's records gain:

- `BrowserRun.mode` gains `'fill'`; `endReason` gains `'canary'`, `'size-cap'` and `'shape-changed'`, next to ADR-027's `'daily-cap'`, `'stopped-by-person'`, `'error'` and `'platform-check'`; and `canaryAcceptedAt: UtcTimestamp | null` is written once, by the person's click, and only on a run that ended with `'canary'`.
- `BrowserAttempt.originalId: string | null`, with `itemId` now nullable and exactly one of the two set; `action` gains `'read-post'`, and `state` gains `read`, `tombstone` and `unavailable`.
- A `read-post` attempt is one `sending` record committed before navigation, followed by one settlement: `read`, `not-found`, `tombstone`, `unavailable` or `failed`. It is never `ambiguous`: an unsettled read is recovered as `failed` with `INTERRUPTED` only after its owner is proved dead. D2's mode-specific recovery, added on 2026-10-23, keeps `originalId` and `itemId: null`; a live, absent or unproven owner blocks with `WORKSPACE_BUSY`. A permitted reopening under section 6 creates a new attempt after the failed one is settled; it does not erase or reuse that attempt.
- The reader checks gain: every `read-post` attempt names an existing original and a run in mode `fill`; every other attempt still names an item.

**Narrow writer.** `OriginalsFillWriter` in `packages/core/src/workspace/` appends fill runs and read attempts and writes original records. It has no method for decision or outcome events, and only the fill runner constructs it ([ADR-023](ADR-023-acting-in-own-account.md) PA-16).

**SQLite.** The `originals` table gets the new columns in a layout migration that copies the database file first, as the migration that added the table does; JSON columns are checked with `json_valid` and enums with `CHECK`. `browser_attempts` gains `originalId`.

### 6. Command

```text
socialprune originals fill x --workspace <dir> --account <key> --dry-run [--handle <name>] [--include <file>] [--list <file>] [--order <file>] [--json] [--lang en|de]
socialprune originals fill x --workspace <dir> --account <key> --profile <dir> --plan <hash>
    [--handle <name>] [--include <file>] [--limit <n>] [--order <file>] [--json]
    [--max-video-mb <n>] [--max-run-gb <n>] [--browser chrome|edge] [--lang en|de]
```

It is a command of its own, not a flag on `originals fetch`, because it is another kind of action. It runs signed in, in a browser window. Without a written order it starts with a click and refuses pipes. AUTO-1 on 2026-10-13 adds the narrowly scoped written-order path below; a flag on the anonymous command would still mix two different action boundaries.

**Dry run.** It reads the workspace only: no browser, no profile, no network, and no writes except the list file the person names, which it refuses to overwrite. One row per post: its ID, its reasons, the date and first line of the person's own entry that references it, or "above <id>" for a post in a chain, and the anonymous result. Above the rows: counts per reason, how many posts are in the plan only for `unseen`, excluded notices as `finalNotices: { deleted, suspended, accountGone }`, the page opens, the time at the pace below, the upper bound for media from the stored answers that name variants and a duration, and "size unknown, at most 1 GiB each" for the rest. The human output explains in one sentence that X shows the excluded posts the same way to a signed-in account. These counters count only rows left out by the notices, not rows already excluded after a signed-in read or explicitly restored by `--include`. `--json` gives counts, the plan hash, the estimates and the warning, never text, and refuses `--list`. The plan hash is SHA-256 over the canonical JSON of the planned rows sorted by ID, each `{ id, reasons, anonymousAt }`; excluded notices and their counters are not hashed.

**A manual run** follows ADR-027's steps 1 to 5. It refuses pipes and `--json` (`NOT_INTERACTIVE`), refuses a changed plan (`STALE_PLAN`), checks the profile marker (`PROFILE_INVALID`) and browser (`BROWSER_NOT_FOUND`), takes the profile snapshot, and shows the loopback confirmation page with its page token in the fragment. The page shows counts, the first 20 rows and full-list path, estimates, profile effects and warning. Nothing opens on X before **Start**. Then the run compares the signed-in account with the export's, runs the canary or main plan, and reads the profile back. ADR-031's desktop entry uses the same confirmation state in the app window instead of the loopback page; a desktop run still starts with the person's click. Since 2026-10-13, an export without its account file may use `--handle`, checked against the signed-in account.

**AUTO-1, written order, decided on 2026-10-13.** `originals fill x ... --order <file>` accepts a UTF-8 JSON file with no extra properties: `{ scope: 'originals-fill-x', account: '<expected-name>', givenAt: '<ISO-8601>', words: '<the person's own order>', maxPages?: 1..300, secondsPerPage?: 10..30, pagesPerDay?: 1..300, batchPause?: boolean }`. The pace fields were added on 2026-10-16; their code bounds were checked on 2026-10-23. Scope is exact, account matches the export or `--handle` name case-insensitively, the date is valid, words are nonempty, and the unchanged plan hash is mandatory. The file is at most 64 KiB and its exact bytes are hashed with SHA-256. Invalid scope or account refuses before profile access, and a changed plan before launch. The order allows pipes and `--json`, prints the warning, and starts without waiting for **Start**. Its confirmation page is a status view with Stop. It never permits deletion or setup, and written orders remain a CLI feature, not a desktop confirmation mode.

**Automatic comparison.** An ordered run compares each stored focal result with its exactly selected article: whole display text, photo count and video/GIF count, excluding quoted cards and other replies. A canary stops at its first difference and accepts nothing. In a main run the first two text or media differences retain their settled records, write only counts and position to the structure report, and continue at the normal pace; the third stops with `CANARY_MISMATCH`. A comparison after a reopening also stops at its first difference. These are the branches at `209c895`, checked on 2026-10-23. When every sampled entry matches, the canary gets `acceptedBy: 'automatic-check'`. The ordered runner closes its context at the end; Stop or manual closure cancels it. Without an order, the person's Start, Continue, Matches and Does not match remain.

The display projection follows dated page observations, not a general text tolerance. On 2026-10-13 five parent-run comparisons matched: quote media, a link card, a video quoting a post, reply emoji, and an HTML entity with two photos. The projection uses Unicode `display_text_range`, decodes entities, leaves out only media and card links proved by the answer, and handles emoji image alt text. On 2026-10-14, markup stabilization was added: read for up to 10 seconds, observe at least two seconds even with zero expected media, and require one second of unchanged expected counts. Exact `textContent` is an alternate basis when `innerText` adds mention spacing. Notices align in order with their own answer text; a visibility wrapper may take zero or one notice slot. On 2026-10-15, an unavailable quote's inline link and expanded status-link text gained exact metadata-bound handling; on 2026-10-16, known status paths also admitted a photo or video suffix with a one or two digit index. An unmatched expanded path falls back only to exact t.co handling. These transformations are comparison-only and never replace the stored full text.

The additional audit is CLI-local: `browser_order_audit` records `startedBy: 'agent-on-order'`, `orderSha256`, automatic acceptance and count-only comparisons. A stopping mismatch records `displayEndReason: 'canary-mismatch'`; the portable run keeps its existing `error` end reason. This audit does not travel in backups, including schema 8. Source checked on 2026-10-24.

**Reopening a timed-out page.** Since the 2026-10-16 reading change, a main run may reopen one post once after a cancellable 60-second wait, at most three reopens in the run. The failed attempt must already be settled, the answer must not have completed, the cause must be exactly `PLATFORM_CHECK` / `render-timeout`, and page capacity must remain. Before and after the wait, stop, page and extension checks still apply. The new attempt goes through the normal interval, batch, daily cap and rate-window checks, and counts as another page open. A canary, a second failure for that post, a difference after reopening or any other check failure stops at once. These are the code branches checked on 2026-10-23; no deletion retry is admitted.

**The warning**, in the terminal, on the confirmation page above **Start** and in the documentation. It keeps ADR-023's sentences that apply to reading and adds one about what the run does:

> X's rules do not allow this kind of automation. X can lock or suspend your account for it, even though SocialPrune goes slowly and stops at the first problem. This run only reads: it opens posts in your signed-in X window and keeps what X shows. SocialPrune does not hide that a program is acting in your browser. Use it only for your own account, and only if you accept this.

> Die Regeln von X erlauben diese Art von Automatisierung nicht. X kann dein Konto dafür sperren oder einschränken, auch wenn SocialPrune langsam vorgeht und beim ersten Problem anhält. Dieser Lauf liest nur: Er öffnet Beiträge in deinem angemeldeten X-Fenster und speichert, was X anzeigt. SocialPrune verbirgt nicht, dass ein Programm in deinem Browser handelt. Nutze es nur für dein eigenes Konto und nur, wenn du das in Kauf nimmst.

Both texts fall under `pnpm copy:check`.

**Agents** may run `originals fill x --dry-run --json` and report counts, the hash and the warning. Only the person's explicit written order for exactly AUTO-1's `originals-fill-x` scope permits `--order`; it does not permit deletion or setup, reading profile contents, or editing journals. Other agents remain dry-run-only without that order.

### 7. Pace and stopping

These are chosen code limits checked on 2026-10-23 at `209c895`, not measured platform limits. The written-order fields were added on 2026-10-16. All waits are fixed, never randomized.

| Setting | Default, without a written order | Written `originals-fill-x` order |
|---|---|---|
| minimum interval between page starts | 30 seconds | `secondsPerPage`, integer 10 to 30; omitted means 30 |
| page opens per batch | 20 | 20 |
| pause after each batch | 15 minutes | `batchPause: true` by default; `false` omits the fixed batch pause, not rate-window waits |
| page opens per account and workspace calendar day, counted across X fill, delete and verify history | 200 | `pagesPerDay`, integer 1 to 300; omitted means 200 |
| page opens in one run | `--limit` defaults to 200 and can only lower the effective default cap | `maxPages`, integer 1 to 300, further bounded by `--limit` and the day's remaining capacity; when omitted, the run bound is 200 unless `pagesPerDay` is present, then 300 |
| posts above one original, both passes together | 20 | 20 |

Every reopening under section 6 counts as another page. Already stored posts skipped without navigation do not. The day counter includes all of this account's signed-in X run modes. D6 implements ADR-DEL v2 A point 4, accepted on 2026-10-24: fill, deletion, verification, the pace notice and the desktop projection all use the workspace's effective zone, falling back to the system zone when none is saved. This replaces fill's former hardcoded `Europe/Berlin` and leaves Berlin workspaces unchanged. Fill's batch carry still reads prior same-day `sending` records; the separate deletion batch counts only confirmed deletions, as ADR-027 describes.

The other three accepted v2 A points concern deletion, not a relaxation of this read-only pass: a pause after 20 direct confirmed deletions; reset rules for deletion promotion; and a durable warning gate. A normal fill canary end is neutral to the clean hundred, like `done`. Only a classified warning sign in fill gates the next deletion, not further reading or verification. ADR-027 describes its next-day and typed-card step, database and profile copies, warning-only staging restore and the new-profile gap. A media download's `MEDIA_RATE_LIMIT` ends as `platform-check` with `warningKind: 'http-429'`; an ordinary render-timeout canary does not create that gate. V2 A accepted behavior, not either record; the separate approval of 2026-10-24 at 19:28:04Z accepted ADR-029, while ADR-027 remains Proposed.

**Rate windows.** The shared reader observes numeric limit, remaining and reset headers per operation on `x.com` and `api.x.com`. Below half remaining, it waits to reset plus five seconds when the reset is at most 16 minutes away; a longer low window ends as `daily-cap` with `x-window-long`. HTTP 429 on any response except the local confirmation origin stops immediately, including a media-host response and an answer not selected as the focal `TweetDetail`. Host filtering applies only to rate-window parsing, not the 429 stop. A written order cannot disable these waits. Reports keep operation names and bounded numeric summaries, never session headers or response contents.

**Stops.** A login, challenge, captcha, lock, limit notice, error page, unexpected answer, `SHAPE_CHANGED`, `UNEXPECTED_ACTION`, `ACCOUNT_MISMATCH`, added extension ID, closed browser, `DISK_LOW`, media-host 429 or five consecutive failed media files stops the run. Only section 6's render-timeout reopening and first two main-run differences are exceptions. Stop and Ctrl+C cancel the in-flight work through its signal; they do not promise to finish the current file first. Daily capacity, the run's media bound and the end of the plan end without an error. A manual or desktop run leaves the visible window for the person, while an ordered CLI run closes its own context.

**Read-back and diagnostics.** Edge was observed on 2026-10-13 to remove default extension folders when launched with extensions disabled. Removed IDs are recorded, added IDs stop; only directory names are read. The sandbox and all automation marks remain. The post-run account and extension check takes priority over a preceding timeout in the final message, and unchanged state is claimed only after that check succeeds. Since the 2026-10-15 diagnostic change, every error stop records a closed cause in the structure report and terminal alongside the available read-back outcome; main-run differences name their position rather than calling every entry a canary sample.

In a manual CLI run, every end reason is printed before waiting for the person to close the X window and remains on the confirmation page until closure; the server closes afterwards. An ordered run shows its final status, then closes its own context. With `--lang de`, the full loopback page and its controls are German; English remains the default. The same-origin stylesheet keeps the strict policy. This replaces the silent wait and early page closure observed during the 2026-10-13 canary; ending does not retry a read or advance the journal.

### 8. What the run does in the profile

The shared 20-second render wait and exact timestamp-link focal selection of ADR-027 apply to fill too. Section 2 owns the accepted result containers and section 5 the completeness rules. Viewer fields, richtext metadata and unrelated replies are not stored.

The first ordered canary on real X, on 2026-10-13, stopped on its first page because a conversation module held a "show more" cursor item. The projector now skips cursor items inside modules as it does at entry level, and every other unknown item type still stops. A shape stop writes a sanitized failure token into the value-free report, so the next stop names its check without another page. At the end of an ordered run the CLI brings the status tab of the confirmation origin to the front and waits up to three seconds for the exact final text with a locator. Generated runs showed that the page's strict CSP can reject the earlier string predicate. Why the status page stayed without its final text in that real Edge run is not observed yet.

The browser still aborts every host outside `x.com`, `api.x.com`, `abs.twimg.com`, `pbs.twimg.com` and `video.twimg.com`; neither the diagnosis's `grok.com` nor `ton.twimg.com` requests are admitted. Aborted-host counts are recorded without setting `UNEXPECTED_ACTION`. The exact mutation operation list on the allowed X origin still stops; allowed background telemetry is recorded separately. `/home` is opened only for the initial account check, because its timeline can autoplay media. Account read-back uses the current status page.

It may navigate X's tab to the status URLs it builds, wait, read the one answer per post that section 2 describes, and read markup through the selectors module. It may not click, type, scroll, hover, focus, press keys, close dialogs, play or pause media, like, repost, reply, bookmark, follow, mute, block, ask for access, state an age or change a setting. Browser-level routing enforces the pinned-host restriction; no scripts or functions are added to X's page. ADR-023's forbidden list still applies.

**What a run can change**, printed before it: ADR-023's text for step 3 of the profile procedure, then the steps of this run: "Open each listed post's page by its address and keep what X sends for it. No clicks, typing or scrolling in X's tab. Download the photos and videos named in X's answer from X's media servers, without your sign-in." and "Each opened post goes into this profile's history. X's pages fill its cache, including parts of videos X's player loads on its own, and X may change its cookies and site data."

**Snapshot and read-back:** ADR-023's steps 4 to 6. The fill run expects no request that changes anything, so every request ADR-023's step 5 records, any method other than `GET` to X's hosts, goes into `profileReport.unexpectedRequests` with method, host, path and status, and the person sees them grouped with counts. The report says that X's page can send such requests on its own and that the tool cannot tell all of them apart. One group stops the run at once with `UNEXPECTED_ACTION`, because the run never clicks and so something else is acting: a request whose path is `/i/api/graphql/<queryId>/<name>` with `<name>` exactly `CreateTweet`, `CreateNoteTweet`, `DeleteTweet`, `FavoriteTweet`, `UnfavoriteTweet`, `CreateRetweet`, `DeleteRetweet`, `CreateBookmark` or `DeleteBookmark`, or whose path is exactly `/i/api/1.1/friendships/create.json`, `/i/api/1.1/friendships/destroy.json`, `/i/api/1.1/blocks/create.json` or `/i/api/1.1/mutes/users/create.json`. The names come from `twikit`'s list of X's operations, and the list does not claim to be complete.

### 9. What stays impossible, and what the review says

Known anonymous notices of author deletion, suspension or an account that no longer exists are excluded from ordinary planning; only explicit `--include` restores their `unseen` reason. Unknown, missing or empty notices remain planned. The table preserves the initial signed-in expectations of 2026-10-11; the dated observations in sections 2 and 6 cover only their named cases, not every case in this table. No real-account run was made for the 2026-10-23 candidate revision.

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
2. `originals fill x --dry-run`, then a run. The first run for the account, and the first after a `SHAPE_CHANGED` stop, is the **canary**: up to five posts, one for each planned reason, then filled up in plan order, each alone. The manual or desktop confirmation shows what was read and waits for **Continue** or **Stop** after each; an ordered run performs section 6's comparison without that Continue wait. The canary ends as `canary` and writes `<workspace>/originals/canary-<runId>.json`: key paths, types, closed result classes and counts, without post IDs, text, handles or session data. Numeric rate-window summaries and comparison counts are diagnostic values, not export contents.
3. In a manual or desktop run, the person compares the posts and clicks **Matches** or **Does not match**; only **Matches** accepts that canary. Under AUTO-1, all automatic checks of section 6 must match instead, and the order audit records automatic acceptance. A full run needs an accepted canary and a new dry run. Neither path accepts a canary with a difference.
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
- **Required proofs.** Nothing opens on X before manual or desktop **Start**, except the exact validated AUTO-1 written-order path; only the matching focal `TweetDetail` body is read; lock cases stop; planted viewer fields and replies never reach the workspace, with forbidden values taken from fixture inputs (LL-2026-10-002); reports omit IDs, texts and handles; unexpected actions stop; shared daily counts, media states, disk floor, temporary-file handling and own-post linking hold. Generated cases cover main-run differences one to three, a canary's first difference, one delayed reopening per post, three per main run, a failed reopening, low short and long windows, and side-response 429s. The browser suites use their `SP_*_TEST_PORT` variables, added on 2026-10-16, rather than assuming two worktrees can share fixed ports.
- **Review server.** The range matrix over real sockets: no range; `bytes=0-1`; `bytes=100-`; `bytes=-50`; a range at the end (416); several ranges and a malformed one (200); `If-Range` (200); `HEAD`; 401 without session; 403 with a foreign `Sec-Fetch-Site`; 404 for traversal, for a file the record does not list, for an MP4 without `ftyp` and for a link; and a file larger than the photo limit streams without being read whole.
- **Browser.** In Chromium, Firefox and WebKit against the real review server: the header and meta policy carry `media-src 'self'`; a `<video>` on `/originals/<id>/1.mp4` receives a 206; and, as the positive control, a `<video>` pointing at a second origin is blocked by the policy. Playback is not asserted, because Playwright's Chromium lacks some codecs that Chrome and Edge bundle and the other engines' codecs vary by system; the canary in the person's Chrome or Edge covers it.
- **Data.** Migration from 3 to 4 with photos and `not-stored` videos; backup round trips from the CLI to the browser and back with version 4 originals; and the reader rejecting each broken rule of section 5.
- **No network.** ADR-013's zero-network test covers `originals fill x --dry-run`, its help and invalid flags. Host and import-boundary tests keep production hosts pinned, fakes out of production entrypoints and fill control out of unrelated commands and renderers. ADR-031's internal engine entry is an explicit consumer of the same fill runner.
- No test contacts X.

### 12. Changes to other records

| Record | Rules or sections changed | New wording |
|---|---|---|
| ADR-005 | Rules 1 and 2 | The IndexedDB store `originals` keeps version 4 records verbatim from restores, and a restore of a version 2 or 3 backup migrates its originals as section 5 says. The browser still fetches nothing. |
| ADR-006 | Workspace document, version 2; Backup and restore | Schema version 4: `Original` and `OriginalMedia` as in section 5, the migration from version 3, the reader checks; `BrowserRun` and `BrowserAttempt` gain the fill fields. |
| ADR-007 | Protocol | The protocol table gains `getConversation { originalId }` → `conversation { chain ≤ 21, state }`. The browser worker answers with an empty chain. |
| ADR-011 | Catalogs and types | Catalog keys for the media states, the conversation, the source lines, the cases of section 9, the confirmation page and the warning of section 6, in both languages, under the catalog and copy checks. |
| ADR-013 | Command tree for Phase 2; Execution adapter; Exit codes | The command tree gains `originals fill x`. The network rule reads: "No network access in any command except `originals fetch` as [ADR-026](ADR-026-x-originals-fetch.md) allows it, the run mode of `originals fill x` ([ADR-029](ADR-029-signed-in-originals-pass.md)), and the run and verify modes of `delete x` and of the commands of [ADR-028](ADR-028-instagram-signed-in-session.md)". New codes: `SHAPE_CHANGED`, `UNEXPECTED_ACTION` and `DISK_LOW` (exit 1), `ORIGINALS_PENDING` (exit 2). A run that ends at the daily budget or at the media limit exits 0 and names the reason. |
| ADR-014 | Agent Skill; MCP in 0.2 | Agents may run dry runs, or the exact validated AUTO-1 `originals-fill-x` written-order path of section 6. No order permits deletion, setup or reading profile contents. The MCP server in 0.2 gets no tool for this pass. |
| ADR-015 | Database settings; Migration, backup and restore | The `originals` columns of section 5 and `browser_attempts.originalId`, in a layout migration that copies the database first. |
| ADR-016 | API; The local-review document | The HTTP API gains `getConversation`; the media route of section 4 with byte ranges; the local-review policy gains `media-src 'self'`. |
| ADR-017 | Capability split | Next to `ReviewService` and ADR-027's `BrowserOutcomeWriter`: `OriginalsFillWriter` appends fill runs and read attempts and writes original records, never a decision or outcome event, and only the fill runner constructs it. |
| ADR-018 | Checks | The packed smoke test runs `originals fill x --dry-run --json` on the demo export and asserts zero network calls. No new dependency. |
| ADR-023, accepted 2026-10-24 | What is allowed; PA-1, PA-5, PA-6, PA-7, PA-8; The warning | The allowed table includes missing X original content and posts above it. PA-1 allows manual or desktop Start, or the exact AUTO-1 written order and automatic canary comparison. PA-5 uses section 10's canary, PA-6 the read-only settlement and recovery of section 5, PA-7 section 6's bounded main-run exceptions, PA-8 the default and order bounds of section 7, and the warning uses section 6's reading form. Deletion is excluded from AUTO-1. |
| ADR-026, accepted 2026-10-24 | Command; What is requested and how; What is stored; What the person sees | The anonymous fetch gains the video, GIF, parent and quoted-post handling of sections 1 and 3, the current original model, both truncation signs and temporary-file writes. Its notice describes parent and quoted IDs and anonymous media; the actual sentence and the missing host/IP wording are recorded in ADR-026, not presented as a shipped longer notice. The earlier "Videos are not stored" review line gives way to per-media states. |
| ADR-027, proposed | Journal and outcomes; Pace, DEL-1 stages; A run; Tests; Which entries | The journal types of section 5; the daily cap counts the page opens of every signed-in run of the account, and ADR-027's lower caps for verify stay; the selectors module's page states serve the fill run as well; the fake X site gains the pages of section 11; and `delete x` shows pending originals and refuses with `ORIGINALS_PENDING` unless `--without-originals` is given. |

[ADR-021](ADR-021-archive-media.md) stays as it is: it covers media inside the export.

**Decision made by:** maintainer
**Approved on:** 2026-10-24 (card ADR-029 v1 A; 19:28:04Z, "überall kannst du continue nach deiner Empfehlung accordingly"; record at `c4700552ea56648780baf2bc1f2daccb33b82db2`).

## Build spec

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
- Without an order, the person starts the run in their terminal or desktop app and confirms Start. An agent can use only the exact AUTO-1 written-order exception, whose provenance stays CLI-local.
- Missing or changed anonymous notices still cost a signed-in page; known author-deletion, suspension and account-gone notices do not, unless the person explicitly includes them.
- Schema version 4, and changes to ten older accepted records, ADR-023 and ADR-026 (accepted on 2026-10-24), and the still-Proposed ADR-027.

### Risks
- **X limits or suspends the account for the reading.** Mitigation: the anonymous route first, section 7's default or explicit order bounds, live window waits, the canary and immediate warning stops. None is a measured bound against account restrictions, and the warning says X can act regardless.
- **X's media server refuses files without the session.** Mitigation: the canary tests it before any full run; refused files are recorded as `refused`, and the question goes back to the maintainer instead of a quiet switch to the session.
- **X's service worker hides the answer from the reader.** Mitigation: the canary's first point; ADR-027's deletion reader depends on the same mechanism, so a fix lands once, in the shared driver.
- **A wrong field is read as right.** Mitigation: the exact field table, the shape lock, the person's comparison during the canary, and fake answers written from the structure report.
- **The workspace fills the drive.** Mitigation: the per-video and per-run limits and the 5 GiB floor.

## Dated answers to the original questions

- 2026-10-12: the maintainer widened hard constraint 4 to posts above a reply and quoted posts' media. The implementation bounds the parent walk at 20; it does not promise to reach every conversation's first post.
- 2026-10-12, build `b7b8c02`: public MP4 files use anonymous media requests; refused files stay `refused`, with no signed-in fallback. This is the implementation answer to the anonymous-video and refusal questions.
- 2026-10-12, build `b7b8c02`: media defaults are 1 GiB per video, 20 GiB per run and a 5 GiB free-space floor, with the flag ranges in section 3. These are chosen limits, not measured platform or machine capacity.
- 2026-10-16: written orders gained the pace fields in section 7. They replace the original question's claim that nothing could raise the default 200-page bound. On 2026-10-24 at 10:31:43Z the maintainer chose ADR-DEL v2 A, including the shared workspace-zone boundary implemented by D6. That behavior choice did not accept this record; he separately accepted it at 19:28:04Z on card ADR-029 v1 A.
- 2026-10-13, AUTO-1: a canary of up to five posts can be accepted through its automatic stored-versus-shown checks under the exact written order; otherwise the person watches and confirms. Later main-run difference and reopening rules do not relax canary acceptance.
- 2026-10-12, build `b7b8c02`: deletion refuses unsettled anonymous originals unless `--without-originals` is explicit; fillable gaps are counted separately and do not impose that refusal.

These dated decisions and implementation answers preceded the separate maintainer acceptance of this record on 2026-10-24 at 19:28:04Z, card ADR-029 v1 A.

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
- Pace, timeout, size and disk figures are chosen limits or labelled arithmetic; the third-party media measurement and parent-run page observations carry their dates above. No platform request or browser profile was used for the 2026-10-23 revision.
- Code checked on 2026-10-23 at `209c895`: `apps/cli/src/commands/originals-fill.ts` (flags and effective page bound), `browser/x/fill/order.ts` (strict order and pace), `run.ts` (order start, canary, differences, reopens, windows, counters and report), `compare.ts` and `extract.ts` (dated display and result shapes), `originals/syndication.ts`, `media.ts` and `video.ts` (anonymous truncation and file handling), `workspace/browser-journal.ts` (mode-specific recovery), `engine/facade.ts` (desktop Start), and `packages/core/src/model/index.ts` (schema 7). Source reading verifies the document's description of the code, not a new real-account acceptance result.
- D6 source at `bf8843f` plus this revision, checked on 2026-10-24: workspace-zone day checks and notices replace hardcoded Berlin, the desktop uses the same zone, and X reading warnings persist the deletion admission gate described in ADR-027. Generated UTC-boundary and warning cases exercise these paths. Schema 8 remains unchanged, and no real-account run was made.
- D7, 2026-10-24: every non-confirmation response is checked for HTTP 429 before API-host filtering; `MEDIA_RATE_LIMIT` persists an ended warning-classified run; an ordinary canary/render-timeout does not create a day gate. Generated media-origin and downloaded-media failures, including backup restore, exercise those branches. The run shape gains the optional closed classification under schema 8 with ADR-027's earlier-reader caveat; no real account was used.

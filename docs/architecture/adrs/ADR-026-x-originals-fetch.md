# ADR-026: Fetching the originals of the person's replies and quotes on X

- **Status:** Proposed
- **Date:** 2026-10-11
- **Hard constraints touched:** 4 (one of the two actions [ADR-023](ADR-023-acting-in-own-account.md) allows), 2 (post IDs from the export reach X, which already holds them; the person is told at that point), 1 (no account, no key, no cost), 6 (tests use a local fake, never X)
- **Supersedes in part, on acceptance:** [ADR-006](ADR-006-workspace-event-log.md), [ADR-007](ADR-007-review-data-worker.md), [ADR-013](ADR-013-cli-framework-output.md), [ADR-014](ADR-014-agent-interface.md), [ADR-015](ADR-015-cli-storage-node-baseline.md), [ADR-016](ADR-016-local-review-server.md), [ADR-018](ADR-018-cli-distribution.md). The section "Changes to accepted records" gives the new wording. How a partial change is recorded is an open question in ADR-023.
- **Related:** [ADR-005](ADR-005-browser-storage.md), [ADR-021](ADR-021-archive-media.md), [ADR-023](ADR-023-acting-in-own-account.md), [ADR-027](ADR-027-x-deletion-browser.md)

Decided by the maintainer on 2026-10-11: fetch the originals ("Ja, hole die originale accordingly").

Needs the maintainer's decision: whether stored photos of the original posts are shown in the local review, which needs `img-src blob:` in the local-review policy. Until he decides, the review shows the text and the number of stored photos.

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
socialprune originals fetch --workspace <dir> --account <key> [--only-marked] [--refresh] [--dry-run] [--allow-network] [--json]
```

- **Which posts.** For every item of the account whose kind is `reply` with a `replyToId`, or `quote` with a `quotedId`, that ID. Duplicates are fetched once. With `--only-marked`, only items whose current decision is `delete`. Posts already stored as `fetched`, `not-found` or `tombstone` are skipped unless `--refresh` is given; `failed` posts are tried again on the next run.
- **Dry run.** `--dry-run` reads the workspace only and prints the number of posts, the hosts it would contact, the estimated time at the pace below, and the notice. It sends nothing.
- **The network flag.** Without `--allow-network`, the command sends nothing, prints what it would send, and exits 2 with `NETWORK_NOT_ALLOWED`. The flag is the person's order in the sense of [ADR-023](ADR-023-acting-in-own-account.md) PA-1. An agent passes it only after asking the person in the conversation and getting a yes, as with `--share-with-agent` ([ADR-014](ADR-014-agent-interface.md)). The flag records that answer; it cannot check it.
- **The notice**, printed to stderr before the first request of every run, with the real counts:

  > This contacts X's public embed service at cdn.syndication.twimg.com and X's image server at pbs.twimg.com. X sees your IP address and the IDs of the 412 posts your replies and quotes answered. No sign-in is used, and nothing changes in your account.

  German, in the documentation and in `--lang de` output: "Das kontaktiert den öffentlichen Einbettungsdienst von X unter cdn.syndication.twimg.com und den Bildserver von X unter pbs.twimg.com. X sieht deine IP-Adresse und die IDs der 412 Beiträge, auf die deine Antworten und Zitate antworten. Es wird keine Anmeldung genutzt, und an deinem Konto ändert sich nichts."

### Pace and stopping

- At most one request per second, counted across both hosts, so each photo download counts as one request.
- One request at a time. A request that gets no complete answer within 15 seconds counts as failed.
- No retries within a run.
- Five failed requests in a row stop the run with `ORIGINALS_STOPPED` (exit 1). An HTTP 429 stops it at once. Not-found and tombstone answers are results, not failures.
- Ctrl+C finishes the request in flight, records it and stops.
- At this pace, 1,000 posts with on average one photo each take about 35 minutes. This is arithmetic, not a measurement.

### What is requested and how

- The post ID must match `^[0-9]{1,40}$` before any URL is built. URLs are built with the `URL` API from the pinned host, never by string concatenation with export data.
- The request carries the ID, the `token` from `getToken`, and the `features` value `react-tweet` sends. It carries no cookie and no referrer. Its user agent is `SocialPrune/<version>`, so X can tell what is asking ([ADR-023](ADR-023-acting-in-own-account.md), PA-9).
- A photo is downloaded only if its URL is `https` on `pbs.twimg.com`, its type is JPEG, PNG, GIF or WebP, and it is at most 15 MB. Videos are not downloaded; the record notes that a video was not stored.
- Responses larger than 1 MB are not parsed and count as failed. The JSON is parsed as data; no part of it is executed or rendered as HTML.

### What is stored

A SQLite table `originals` in the workspace ([ADR-015](ADR-015-cli-storage-node-baseline.md)), one row per original post, with these fields:

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

The table is not append-only: a later run may replace a `failed` row, and `--refresh` may replace any row. Photo files go to `<workspace>/originals/<id>/<n>.<ext>`, written to a temporary name first and renamed when complete. File names come only from the record, never from the response.

### What the person sees

- The workspace protocol ([ADR-007](ADR-007-review-data-worker.md)) gains `getOriginals { ids }` with at most 200 IDs, answered by `originals { originals }`. The local review's HTTP API carries it ([ADR-016](ADR-016-local-review-server.md)).
- The card review and the archive show, under a reply or quote, the stored original: author, text, the quoted post's text when the response had it, and "2 photos stored". A line says "Fetched from X on 11 October 2026. Long posts may be cut off. Videos are not stored." (German: "Am 11. Oktober 2026 von X geholt. Lange Beiträge können gekürzt sein. Videos werden nicht gespeichert.") `not-found` and `tombstone` read "X did not return this post. It may have been deleted or made private."
- All of it renders as React text nodes, like the person's own text.
- In the Pages web app, the browser store keeps originals that arrive through a restore, so a backup survives the round trip, but `getOriginals` answers with an empty list. Showing them there is left to a later record, because the Pages app cannot fetch and its policy has no room for stored photos.

### Backup and restore

- The workspace document gains an optional `originals` array after `outcomeEvents` and an optional `counts.originals`. Both are left out when there are no originals, so a backup without originals stays readable by every version 2 reader. A file with originals is rejected by readers older than this record, which do not know the key.
- The backup carries the rows, not the photo files. `backup export` prints how many photo files stay in `<workspace>/originals/` and that the folder has to be copied separately to keep them. After a restore without the folder, the review shows "Photo not in this copy".
- The reader checks: `id` values unique, each record valid, `counts.originals` equal to the array length, every `file` name matching the pattern above.

### Licensing

`getToken` and the `features` value are copied from `react-tweet` 3.3.1 under its MIT license, with an entry in `THIRD_PARTY_NOTICES` naming Vercel, the package, the version and the license text. No package is added to the dependency graph ([ADR-002](ADR-002-dependency-licenses.md)).

### Tests

- The command takes the base URL of each host from its handler context. Production uses the pinned constants; tests point them at a local fake server that answers with generated payloads, including not found, tombstone, a cut-off text, a video, a 429, a slow answer and an oversized body.
- A test asserts that the production constants are exactly `https://cdn.syndication.twimg.com` and `https://pbs.twimg.com`, and that the fake cannot be selected from the production entry.
- The zero-network test of ADR-013 runs `originals fetch --dry-run` and `originals fetch` without `--allow-network` and asserts zero calls.
- No test contacts X.

### Changes to accepted records

| Record | New wording |
|---|---|
| ADR-006 | The workspace document gains the optional `originals: Original[]` after `outcomeEvents` and the optional `counts.originals`, both left out when empty. The reader checks unique IDs, valid records and the count. |
| ADR-007 | The protocol table gains `getOriginals { ids ≤ 200 }` → `originals { originals }`. The browser worker answers with an empty list until a later record. |
| ADR-013 | The command tree gains `originals fetch`. "No network access in any Phase 2 command" becomes "No network access in any command except `originals fetch` with `--allow-network` ([ADR-026](ADR-026-x-originals-fetch.md)) and the deletion runs of [ADR-027](ADR-027-x-deletion-browser.md) and [ADR-028](ADR-028-instagram-signed-in-session.md)". The zero-network test covers every other command and these commands' dry runs. New codes: `NETWORK_NOT_ALLOWED` (exit 2), `ORIGINALS_STOPPED` (exit 1). |
| ADR-014 | Agents may run `originals fetch --dry-run`, and `originals fetch --allow-network` only after the person agreed in the conversation. The skill asks: "Fetching the originals means X sees your IP address and which posts you replied to. No sign-in is used. Shall I fetch them?" The prohibition "no requests on X or Instagram" gains the exception for this command. |
| ADR-015 | The workspace gains the `STRICT` table `originals` (not append-only) and the folder `originals/` next to `socialprune.sqlite`. A layout migration adds the table. |
| ADR-016 | The HTTP API list gains `getOriginals`. If [ADR-025](README.md) is accepted first, the same change applies to it. |
| ADR-018 | The packed smoke test runs `originals fetch --dry-run` on the generated demo export and asserts zero network calls; it never passes `--allow-network`. `THIRD_PARTY_NOTICES` gains the `react-tweet` entry. |

[ADR-021](ADR-021-archive-media.md) stays as it is: it is about media inside the export, and the review still loads nothing from a post's link.

**Decision made by:** maintainer
**Approved on:** pending

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
- **X blocks the person's address after many requests.** Mitigation: one request per second, a stop on 429 and on five failures, and no retries. The block would concern this anonymous service, not the account.
- **Cut-off text looks complete.** Mitigation: the review says that long posts may be cut off on every fetched original.

## Open questions for the maintainer

- Should the local review show the stored photos, which needs one change to its page policy? Answer yes or no.
- Should the fetch take all replies and quotes by default, or only the ones you marked for deletion? Answer "all" or "marked".

## Evidence

- Vercel, `react-tweet` 3.3.1: npm registry entry (MIT, published 2026-06-03T17:55:07Z, repository `github.com/vercel/react-tweet`), and the published file [`dist/api/fetch-tweet.js`](https://cdn.jsdelivr.net/npm/react-tweet@3.3.1/dist/api/fetch-tweet.js) with `SYNDICATION_URL = 'https://cdn.syndication.twimg.com'`, the 1 to 40 digit ID check and `getToken`. Read by the architect on 2026-10-11.
- The response contents, the not-found and tombstone answers, cut-off long posts, anonymous 403s from `video.twimg.com`, and X's oEmbed returning text only inside HTML: observed 2026-10-11 by the research, without any request to X from this lane; the maintainer's reading pending.
- `packages/core/src/model/v1.ts` at commit `5fb9c54`: `reference` holds `replyToId` and `quotedId`.
- Pace, time and size figures in this record are chosen limits and arithmetic, not measurements.

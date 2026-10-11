# ADR-028: Instagram: context and deletion through the person's signed-in session

- **Status:** Proposed
- **Date:** 2026-10-11
- **Hard constraints touched:** 4 (both actions [ADR-023](ADR-023-acting-in-own-account.md) allows, on Instagram), 3 (only the person's own delete decisions), 1 (no developer account, no key, the installed browser), 5 (the warning and the "matched, not confirmed" label make no promise), 6 (tests use a local fake page, never Instagram)
- **Supersedes in part, on acceptance:** [ADR-006](ADR-006-workspace-event-log.md), [ADR-007](ADR-007-review-data-worker.md), [ADR-013](ADR-013-cli-framework-output.md), [ADR-014](ADR-014-agent-interface.md), [ADR-015](ADR-015-cli-storage-node-baseline.md), [ADR-016](ADR-016-local-review-server.md). The section "Changes to accepted records" gives the new wording. It builds on the schema version 3, the journal and the narrow writer of [ADR-027](ADR-027-x-deletion-browser.md), which must be accepted first.
- **Related:** [ADR-012](ADR-012-time-zone-grouping.md), [ADR-023](ADR-023-acting-in-own-account.md), [ADR-026](ADR-026-x-originals-fetch.md)

Decided by the maintainer on 2026-10-11: he signs in to a browser, and SocialPrune may use that session to read the posts his comments belong to, keep them, and delete the comments he marked ("Ich melde mich an in irgendeinem Browser und den kannst du dann nutzen ... auch da die Originale zu holen ... und das dann auch zu löschen").

Needs the maintainer's decision: the scope for spike S5 on his own account, and the three questions under "Open questions for the maintainer". No deletion code is written before S5 passes.

## Context

An Instagram comment in the export has three fields: the comment text (`Comment`), the time (`Time`) and the owner of the post it was written on (`Media Owner`). It has no link to the post and no post ID (`packages/adapter-instagram/src`). The click list therefore groups comments by day and tells the person to find them with Instagram's own date filter.

What the research of 2026-10-11 found, without any request to Instagram from this lane:

- Meta's Instagram Graph API works only for professional accounts, and deleting a comment through it works only for the owner of the post, even when the person deleting wrote the comment. The Basic Display API ended on 2024-12-04.
- Instagram's oEmbed works without a token since 2026-06-15, but its terms forbid keeping what it returns.
- Instagram's Terms of Use forbid automated access, also when signed in.
- Instagram's web app lists the person's own comments at `https://www.instagram.com/your_activity/interactions/comments`, with a "Select" mode and a "Delete" button that removes several selected comments after a confirmation. Instagram's own bulk delete in that view works by hand.
- Free MIT-licensed scripts automate that view: `instagram-bulk-comment-deleter` by iamceeso, and its fork by batuhd, which selects 10 comments per cycle and waits 20 seconds between cycles. sbolel's `instagram-comment-activity-deleter` starts in a dry run with batches of 3. A gist by braunglasrakete warns that larger batches make Instagram show "Something went wrong" and that the page language must be English for its selectors.
- Reports collected by the research describe temporary action limits after about 100 deletions. No source measured a limit.

Whether the "Your Activity" view shows, for each comment, the post it belongs to, and in what form, was not observed by anyone in this project.

## Decision Drivers

- Keep the context of each comment, the post it answered, before the comment is deleted, where the page shows it.
- Never delete a comment that is not the one the person marked: the export has no ID to match by, so every match must be checked and labelled as a match.
- Follow every rule of [ADR-023](ADR-023-acting-in-own-account.md): own account, human decisions only, one entry first, journal, stop at the first error, slow, nothing hidden.
- Prove the page's behavior on the person's account, read only, before writing any deletion code.

## Options

### Option A: Drive the "Your Activity" comments view in the dedicated profile

SocialPrune opens the view in the dedicated profile ([ADR-023](ADR-023-acting-in-own-account.md)), reads each row (comment text, date, post owner, and the post's link and thumbnail where shown), matches rows to export comments, keeps the context, and deletes marked, matched rows with the view's own Select and Delete controls in small batches.

**Pros:**
- One view gives both the context and the deletion, without visiting each post.
- Uses Instagram's own bulk controls, as the free scripts do; nothing is sent that Instagram's page code does not send.

**Cons:**
- Matching rows to export comments by text, time and owner can be wrong or ambiguous; a wrong match deletes the wrong comment.
- Depends on the view's structure and language, which changes without notice.

**Effort:** not measured
**Risk:** High for the account; Medium for wrong matches, bounded by the rules below.

### Option B: Open each post and delete the comment there

**Pros:**
- The comment is checked in place, under the post, before deletion.
- The post's full caption and image are visible.

**Cons:**
- Needs the post's link, which only option A's view may provide; without it, there is no way to find the post.
- One page load per comment, so many more requests as the person's account.

**Effort:** not measured
**Risk:** High.

### Option C: A script the person pastes into their own Instagram tab

**Pros:**
- Proven by the scripts above.
- No browser automation in SocialPrune.

**Cons:**
- No journal SocialPrune can trust and no match against the person's decisions; the scripts delete whatever is selectable.
- Pasting scripts into the console is what scams ask people to do.

**Effort:** not measured
**Risk:** High.

### Option D: Stay with the click list and Instagram's own bulk delete by hand

**Pros:**
- No automation risk; Instagram's own feature.
- Already supported by the click list's day groups.

**Cons:**
- No stored context for the comments.
- The person selects each comment by hand.

**Effort:** none
**Risk:** Low.

## Decision

We chose **Option A: drive the "Your Activity" comments view in the dedicated profile**, gated by spike S5. Until S5 passes and its report is accepted, Option D stays the only way, and no Instagram deletion code is written. If S5 shows that the view does not let a row be matched to an export comment reliably, this record is withdrawn and Option D stays.

### Spike S5: what must pass first

S5 is a read-only run on the maintainer's own account, in a dedicated profile he signs in to, under his explicit scope in the conversation naming the profile folder (`.kilo/rules/protected-surface-boundary.md`). It clicks nothing that changes anything: no Select, no Delete. It reports only counts and page structure, never comment text, handles or links. Its write-up goes to `docs/spikes/S5.md`.

S5 answers:

1. **Does the view show the post for each comment?** For each row: is there a link to the post, a thumbnail, the post owner's handle, a caption excerpt? Reported as counts per field over all rows.
2. **How far back does the list go, and in what order?** Does scrolling reach the oldest comment in the export? How many rows load per scroll?
3. **What date does a row show?** An exact time, a day, or a relative age such as "3y"? This decides how precise the time part of a match can be.
4. **Can a match be proven?** For a sample of 20 rows that match exactly one export comment, open the linked post (read only) and look for the person's comment text there under their handle. Report how many of the 20 were confirmed.
5. **What do Select and Delete look like?** The structure of the selection mode, the controls and the confirmation, from the page markup, without using them; which signals the page gives for success, limits and challenges, as far as visible without acting.
6. **What does the page change in the profile?** The ADR-023 read-back, with no state-changing request expected.

**S5 passes** when: (1) at least 90 percent of rows carry a post link and the post owner; (3) the date shown narrows a match to a day or better; (4) at least 19 of the 20 sampled matches are confirmed on the post; and (5) the delete controls can be found without relying on text in one language only. The thresholds are this record's choice, not measurements. A failed criterion is reported with its numbers, and the maintainer decides.

### Matching

The export does not link a comment to its post, so every link SocialPrune stores is a match, and it says so.

- **Rule.** A row and an export comment match when the comment texts are equal after Unicode NFC normalization and collapsing whitespace, the post owner's handle equals the export's `Media Owner`, and the row's date agrees with the export's `Time` at the precision S5 found, compared in UTC ([ADR-012](ADR-012-time-zone-grouping.md) applies only to display).
- **States.** `matched` when exactly one row and exactly one export comment agree with each other; `ambiguous` when more than one row or more than one comment agrees (for example the same short text twice on the same day under the same owner); `unmatched` when no row agrees.
- **Label.** The review and the archive say "Matched by text, date and post owner. Instagram did not confirm this link." (German: "Zugeordnet über Text, Datum und Konto des Beitrags. Instagram hat diese Zuordnung nicht bestätigt.")

### Context: what is stored

```text
socialprune context instagram --workspace <dir> --account <key> --profile <dir> [--dry-run]
```

The command reads the view, scrolling at most one screen every 5 seconds, and stores one record per export comment:

```ts
InstagramContext = {
  itemId,                                   // the export comment
  status: 'matched' | 'ambiguous' | 'unmatched' | 'failed',
  matchedBy: 'text+date+owner',
  postUrl: string | null,                   // only https://www.instagram.com/p/<code>/ or /reel/<code>/
  postOwner: string | null,
  caption: string | null,                   // as the row shows it, often cut off
  thumbnail: string | null,                 // file name under <workspace>/context/instagram/<itemId>/
  readAt: UtcTimestamp
}
```

- The thumbnail is a screenshot of the row's thumbnail element as the page shows it, taken by `playwright-core`. SocialPrune sends no extra request for it.
- Only `matched` records keep a post link, owner, caption and thumbnail. `ambiguous` and `unmatched` keep the status only.
- It is a read of the person's own activity through their own session, so it follows ADR-023: the account check, the profile snapshot and read-back, stop on the first login prompt, challenge or limit notice, and no state-changing request expected. Its pace is set by scrolling, not by requests.

### Deletion

```text
socialprune delete instagram --workspace <dir> --account <key> --dry-run [--list <file>] [--json]
socialprune delete instagram --workspace <dir> --account <key> --profile <dir> --plan <hash> [--per-day <n>]
socialprune delete instagram --workspace <dir> --account <key> --profile <dir> --verify
```

It follows [ADR-027](ADR-027-x-deletion-browser.md) in everything not stated here: the dry run and its list, the plan hash, the confirmation page with **Start**, **Continue** and **Stop**, the account check, the journal, the outcome `deleted-via-browser` through `BrowserOutcomeWriter`, schema version 3, verify, the narrow imports and the tests against a fake page.

- **Which entries.** Instagram comments of the account whose current decision is `delete` from a human decision event, whose outcome is `unknown`, and whose context status is `matched`. `ambiguous` and `unmatched` comments stay on the click list, with the reason shown.
- **One comment first.** The first run deletes one comment alone, which the person watches, before **Continue**.
- **A batch.** Select at most 10 rows. Before each selection, read the row again and check that it still matches its export comment. After selecting, read the selected rows once more; any difference stops the run. Append a `sending` attempt for each of the selected comments and commit. Click "Delete" and confirm. Then wait up to 30 seconds for the view to remove the rows.
- **Settling.** A row that is gone from the view after the confirmation is `deleted`. One that is still there is `failed`, and the run stops. A timeout or a reloaded view makes the whole batch `ambiguous`, never sent again on its own. `delete instagram --verify` settles ambiguous comments by reading whether they are still listed, without clicking.
- **Stop at the first error.** "Something went wrong", a limit or "try again later" notice, a login prompt, a challenge, an unknown page state: the run stops and the window stays open.
- **The page's language.** The selectors prefer structure and accessible roles; where they rely on labels, they know English and German. A profile set to another language stops the run with a message.
- **Expected state-changing requests** for the read-back: the request Instagram's page sends when "Delete" is confirmed. S5 names it from the markup; until then, every non-GET request is listed.

| Pace setting | Default and maximum |
|---|---|
| comments per batch | 10 |
| time between batches | at least 15 minutes |
| comments per calendar day, in the workspace time zone | 50; `--per-day` can lower it, not raise it |

At this pace, 100 comments take two days. The free scripts wait 20 seconds between batches of 10; these defaults are much slower on purpose, because of the reports of limits after about 100 deletions. They are chosen, not measured.

### What the person sees

- The workspace protocol gains `getInstagramContext { itemIds }` with at most 200 IDs, answered by `instagramContext { records }`. The browser worker answers with an empty list until a later record decides how the Pages app shows them.
- The card review and the archive show, for a matched comment, the post owner, the caption as stored, the thumbnail as stored and the "Matched by" label. Showing the stored thumbnail in the local review needs the same policy change as ADR-026's photos and waits for the same decision; until then the review says "Thumbnail stored".
- The badge "Deleted by SocialPrune in your browser" is shared with X.

### Storage and backup

- SQLite: a `STRICT` table `instagram_context`, keyed by `item_id`, not append-only, because a later read may move a record from `unmatched` to `matched`. Thumbnails under `<workspace>/context/instagram/<itemId>/thumb.png`.
- The workspace document version 3 gains an optional `instagramContext` array after `browserAttempts`, and an optional count, both left out when empty. The backup carries the records, not the thumbnail files, as with ADR-026's photos.
- Reader checks: unique `itemId`, each naming an existing Instagram comment item; `postUrl` matching the allowed pattern; only `matched` records carry context fields.

### Changes to accepted records

| Record | New wording |
|---|---|
| ADR-006 | Version 3 gains the optional `instagramContext` array and count. A `delete-comment` attempt and its `deleted-via-browser` outcome follow the rules of [ADR-027](ADR-027-x-deletion-browser.md). |
| ADR-007 | The protocol table gains `getInstagramContext { itemIds ≤ 200 }` → `instagramContext { records }`. The browser worker answers with an empty list until a later record. |
| ADR-013 | The command tree gains `context instagram` and `delete instagram`. Their dry runs make no network calls; their run, read and verify modes are covered by the network rule of [ADR-026](ADR-026-x-originals-fetch.md) and the run rules of ADR-027. |
| ADR-014 | Agents may run `delete instagram --dry-run --json` and `context instagram --dry-run`, nothing else of this record. |
| ADR-015 | The `STRICT` table `instagram_context` and the folder `context/instagram/` in the workspace. |
| ADR-016 | The HTTP API list gains `getInstagramContext`. If ADR-025 is accepted first, the same change applies to it. |

**Decision made by:** maintainer
**Approved on:** pending

## Consequences

### Positive
- Where the view shows it, the person keeps the post each comment answered, and deletes the comments they marked without selecting each one by hand.
- Every link between a comment and a post says that it is a match, and only unique matches are ever deleted.

### Negative
- Comments that are ambiguous or unmatched stay manual, possibly many of the short ones.
- At 50 a day, a few hundred comments take a week or more.
- Everything rests on one Instagram view whose structure nobody in this project has looked at yet.

### Risks
- **Instagram limits or locks the account.** Mitigation: ADR-023's rules, batches of 10, 15-minute gaps, 50 a day and a stop at the first notice. This lowers the chance; it cannot settle Instagram's judgment.
- **A wrong comment is deleted.** Mitigation: only unique matches qualify; each row is re-read before selecting and after selecting; any difference stops the run; S5 must confirm 19 of 20 sampled matches on the post itself.
- **The view changes.** Mitigation: unknown page states stop the run; S5's markup notes and the fake page are updated together.

## Open questions for the maintainer

- May S5 run read-only on your Instagram account, in a profile folder you name, reporting only counts? Answer yes and name the folder, or no.
- Default pace: 10 comments per batch, at least 15 minutes between batches, at most 50 a day. Accept, or name slower numbers? Answer "accept" or the numbers.
- Comments the tool cannot match to exactly one row stay for you to delete by hand with the click list. Agreed? Answer yes or no.
- Keep the thumbnail screenshot of each matched post? Answer yes or no.

## Evidence

- `packages/adapter-instagram/src` at commit `5fb9c54`: comments carry `Comment`, `Time` and `Media Owner`, and no post link.
- Meta, Instagram Graph API and Basic Display API documentation; Instagram oEmbed documentation; Instagram, [Terms of Use](https://help.instagram.com/581066165581870). Observed 2026-10-11 by the research; the maintainer's reading pending.
- Scripts for the comments view, observed by the architect in search results on 2026-10-11: iamceeso, [instagram-bulk-comment-deleter](https://github.com/iamceeso/instagram-bulk-comment-deleter) (MIT); batuhd, [instagram-bulk-comment-deleter](https://github.com/batuhd/instagram-bulk-comment-deleter) (MIT, 10 comments per cycle, 20 seconds between cycles); sbolel, [instagram-comment-activity-deleter](https://github.com/sbolel/instagram-comment-activity-deleter) (dry run by default, batches of 3); braunglasrakete, [Instagram Comment Activity Deleter gist](https://gist.github.com/braunglasrakete/837a136af79b43f1de8af41170849601) (smaller batches against "Something went wrong", English page language). All name the view `https://www.instagram.com/your_activity/interactions/comments`. The maintainer's reading pending.
- The reports of temporary limits after about 100 deletions were collected by the research on 2026-10-11; none states a measured limit, and their sources are added to S5's write-up when the maintainer reads them.
- The S5 thresholds, the pace and the time figures are this record's choices and arithmetic, not measurements. No request to Instagram was made for this record.

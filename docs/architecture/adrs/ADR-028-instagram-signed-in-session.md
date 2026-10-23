# ADR-028: Instagram: reading the post of each comment through the person's signed-in session

- **Status:** Accepted on 2026-10-16 by the maintainer (card IG-4, version 3: "Ja, du kannst continue accordingly nach deiner Empfehlung"), with the pace as a ramp from 30 seconds and 200 steps a day up to 10 seconds and 600, one step after each clean run of 100 steps and one step back after the first warning sign
- **Date:** 2026-10-11, revised 2026-10-15, amended 2026-10-16 (IG-5), 2026-10-17 (post page shape, IG-6, IG-7), 2026-10-18 (IG-8, the settled post read) and 2026-10-19 (IG-9, the account check)
- **Title until 2026-10-15:** "Instagram: context and deletion through the person's signed-in session"
- **Hard constraints touched:** 4 (reading in the person's own account through a session they signed in to, [ADR-023](ADR-023-acting-in-own-account.md)), 2 (what the run keeps stays in the workspace; backups carry records, not files), 1 (no developer account, no key, the installed browser), 5 (the warning and the review's wording make no promise), 6 (tests use a generated fake Instagram, never Instagram). Hard constraint 3 returns with the deletion record.
- **Supersedes in part, on acceptance:** [ADR-013](ADR-013-cli-framework-output.md), [ADR-014](ADR-014-agent-interface.md), [ADR-016](ADR-016-local-review-server.md), [ADR-018](ADR-018-cli-distribution.md). It also changes the proposed records [ADR-023](ADR-023-acting-in-own-account.md) and [ADR-027](ADR-027-x-deletion-browser.md). The data model, its versions and the changes to [ADR-005](ADR-005-browser-storage.md), [ADR-006](ADR-006-workspace-event-log.md), [ADR-007](ADR-007-review-data-worker.md) and [ADR-015](ADR-015-cli-storage-node-baseline.md) are in [ADR-030](ADR-030-instagram-context-record.md). Section 13 gives the new wording.
- **Related:** [ADR-012](ADR-012-time-zone-grouping.md), [ADR-021](ADR-021-archive-media.md), [ADR-026](ADR-026-x-originals-fetch.md), [ADR-029](ADR-029-signed-in-originals-pass.md), [ADR-030](ADR-030-instagram-context-record.md)
- **Evidence:** [spike S5](../../spikes/S5.md)

Decided by the maintainer on 2026-10-11: he signs in to a browser, and SocialPrune may use that session to read the posts his comments belong to, keep them, and delete the comments he marked ("Ich melde mich an in irgendeinem Browser und den kannst du dann nutzen ... auch da die Originale zu holen ... und das dann auch zu löschen").

Decided by the maintainer after that, on cards he answered in the conversation:

- **IG-1, 2026-10-14.** Later deletion goes at 10 comments per batch, at least 15 minutes between batches and at most 50 a day. Comments that are not matched, or matched ambiguously, stay manual. A small screenshot of each matched post is kept. He also scoped spike S5 on his own account, read only with scrolling.
- **IG-2, option B, 2026-10-14.** In Instagram SocialPrune may sort, use the date filter, open posts and expand a post's comments ("Load more comments", "View replies"). It never selects, deletes, likes, replies, follows, types, or runs a script in Instagram's page.
- **IG-3, 2026-10-15, read as confirmed while his veto stays open.** (1) This record changes to "find in the list, confirm on the post", and a comment counts as found only when its text appears under his username on the post, the time of the comment's permalink lies within one minute of the export's time, and the post's owner equals the export's owner; anything not confirmed stays manual. (2) For each confirmed comment SocialPrune keeps the post's account, caption, date and link, its first image and a small screenshot. (3) The run reads in the dedicated profile at X's pace: 30 seconds per post, a 15-minute pause after 20, at most 200 posts a day counted apart from X, X's stop rules, and no likes, comments, follows or deletions; he expects about ten days for his whole export. (4) Deletion comes later, with its own card.
- **IG-5, option A, 2026-10-16** ("passt dann continue bitte nach deiner empfehlung"). The date filter is six dropdown lists, not a calendar (third canary, below). The run may choose the entry it needs in each list from the entries the list offers, the way Playwright chooses an option: Playwright sets the entry and then fires the list's `input` and `change` events itself, so the page can see that they did not come from a device. The run never opens a list, types or presses a key for it. Whether Instagram treats this differently from a choice with the mouse is not known.
- **IG-6, option A, 2026-10-17** ("Continue, ... deine Empfehlung", spoken; read as his earlier approvals "nach deiner Empfehlung"). The post page no longer has "Load more comments"; it loads further comments when its comment column is scrolled. The run may scroll that column with the mouse wheel, as it scrolls the comments list, within the limits the buttons had: at most 10 loads per post, at least 3 seconds apart, and it stops once the comment is found. The canary takes the planned comments in order, beginning with the oldest, until 5 are confirmed; a comment that stays unshown after the expansion, or whose post is unavailable, stays manual and the canary takes the next one, at most 15 in all; every other result that is not a confirmation still ends the canary.
- **IG-7, option A, 2026-10-17** ("Ja, klingt gut. Continue nach deiner Empfehlung"). Every canary comment that is not confirmed stays manual and the canary takes the next one, whatever its code: `owner`, `time`, `text`, `several`, `not-shown`, `not-listed` or `unavailable`, as the full run already does. The canary still takes at most 15 comments and stops at 5 confirmations, and acceptance and the stop rules do not change: 5 confirmed comments that pass every automatic check, and an immediate stop on a warning sign, an HTTP 429, a changed account, page language or extension list, an unexpected action, or any failed automatic check of a confirmed comment. The canary's structure report records, as yes or no, which part of the owner check failed.
- **IG-8, option A, 2026-10-18** ("ok ja continue nach deiner empfehlung accoridngly"). In the sixth and seventh canaries six posts opened and none confirmed a comment: four belonged to the export's owner but did not show the comment within the 10 loads, on posts with up to 4,193 comments. When a comment ends `not-shown`, its post now counts as confirmed through the person's comments list, when exactly one row of the filtered list shows the person's username and the export's text, the row's own link opened the post, and the post passes the owner check of section 4. The record keeps the post's account, caption, date, link, first image and screenshot, is marked as confirmed through the comments list, and holds no comment ID or permalink time. Where the comment shows on the post, the four checks of IG-3 still decide. The canary still needs 5 confirmations that pass every automatic check, and both kinds count. With it came one structure-only probe of the post at which the seventh canary stopped.
- **IG-9, option A, 2026-10-19** ("Ja, continue accordingly nach deiner Empfehlung"). The eighth canary stopped at the account check before its first comment, because a row of the newest-first comments list showed another name than his. One structure-only probe opened the list as the run does, without a click or scroll: of 45 rows, 37 showed his username, 3 another name and 5 were empty while loading; each row with another name had the shape of a comment row, its own `aria-label` began with that name as well, and the page's own navigation linked his profile once, outside `main`. The names of those rows went only into a file on his computer. Section 7's account check changes accordingly: the signed-in account is the one the navigation's profile link names, and a row that shows another name is never a candidate, so his username stays required for every comment the run takes.
- **IG-13, version 2, option A, 2026-10-21 at 10:27:13Z** ("Continue accordingly nach deiner Empfehlung ... überall"). The person may leave a comment out of the next CLI plan through a written `--exclude <ids-file>`, the counterpart of `--include`. A repeated ambiguous notice is not reclassified as an unavailable post, and every notice still stops the current run. The planning amendment below records the flag's scope and the later automatic and desktop work. The per-step diagnostic now distinguishes media-comments, media-info and other API paths and closed 4xx body classes, without contents or IDs, with at most 20 classifications per step, no body read above a declared 1,048,576 bytes and at most 512 bytes inspected otherwise, because a bare `Not Found` on a comments read can be a masked challenge ([instagrapi #2433](https://github.com/subzeroid/instagrapi/pull/2433)), so a later card can weigh an item-specific failure against a session-level one without these classes changing the run or later planning.

**Diagnostic amendment, 2026-10-21 (C20).** An `account-changed` stop now records the failed read's profile-link result, outside-path and row counts, own-row count, elapsed time, read count and whether its last read started at or after the deadline, while readback records `expected`, `absent` or `other` account classes without names or paths; these fields are diagnostic only and leave IG-9 A, the guard's decision and its deadline unchanged.

**Amended 2026-10-22 by the maintainer's decision IG-15 A** (09:25:58Z, "Continue ... nach deiner Empfehlung"). The matching outside-main profile link and at least one row under the expected name now suffice; this supersedes IG-9 A's strict-majority clause, whose accepted wording remains below, while missing or different profile links, no own row, the deadline and all other guards stay unchanged. Unexpected stops also retain a closed error class from exact error type or name and counts of owned-page crashes, unexpected page closes and browser disconnections by step and stage, without messages, names, URLs or stacks; those fields are diagnostic only and do not identify which Edge process produced a Crashpad report.

**Amended 2026-10-22 by the maintainer's decision IG-16 A: one reopen after 60 s for a post page not ready in time, at most three per run, as the X fill does** (20:34:38Z, "Continue accordingly nach deiner Empfehlung"). The candidate applies to main runs only, as X fill does, and only to a browser timeout while opening a post; canaries and every other stop keep their present behavior. Each target gets at most one reopen, after the fixed wait and the existing pace, batch, account and daily-cap checks, and the reopened page consumes another journaled step; a second timeout of that target or an exhausted retry allowance stops with `browser-timeout`. The reopen target comes from the main-frame navigation request, or from Playwright's current page URL at the timeout when a client-side route changed it without a document request, and must be an exact same-origin `/p/<code>` or `/reel/<code>` address, with an optional closing slash and no query or fragment, without executing a page script (C26, 2026-10-23). The report keeps retry counts, the original and retried step numbers, the closed stage, waited milliseconds and `ready` or `timeout`, with a null outcome when a wait or another guard interrupts it, and each step keeps `ready.postMs`; the candidate does not record post addresses or change the notice, HTTP 429, account or crash stop boundaries.

**Diagnostic amendment, 2026-10-23 (C24).** Unexpected-error causes and stop details also record a closed error-name class, a fixed Playwright message-prefix class and the first own-code stack function only when it is allow-listed, without messages, paths, selectors, texts, URLs or IDs, and these diagnostic fields change no stop, retry or plan.

**Amended 2026-10-23 by the maintainer's decision IG-17 A.** If the filtered comments list contains no readable row by its existing deadline, a main run waits 60 seconds and repeats the same list navigation, sort, dropdown date filter and row read once for that comment, counting the reopen as another step against pace, the daily cap and the run limit; canaries, initial-list emptiness and every other stop remain unchanged. Posts and filtered lists share IG-16 A's budget of at most three reopens per run, and each comment gets at most one reopen across both stages. A second filtered-list timeout for that comment keeps `PLATFORM_CHECK` with `list-timeout`; the maintainer then adds the comment to his skip file. The closed retry entry uses stage `list`, original and retried step numbers, waited milliseconds and `ready`, `timeout` or null if another guard interrupts it. Generated policy and driver units pass; this behavior is tested on generated pages only, not yet on the maintainer's account.

**Revision of 2026-10-15.** Spike S5 answered the questions this record set, and the answers changed the design. The record now decides the reading pass only. Deletion moves to a later record of its own, as IG-3 point 4 says. The text decided on 2026-10-11 that this revision replaces is kept, unchanged, under "Superseded on 2026-10-15" at the end. The Options keep their wording of 2026-10-11, and each carries a marked note on what S5 changed.

## Context

An Instagram comment in the export has three fields: the comment text (`Comment`), the time (`Time`) and the owner of the post it was written on (`Media Owner`). It has no link to the post and no post ID (`packages/adapter-instagram/src`). Some records have no post owner, and some have empty text, for example comments that were only a GIF. The click list therefore groups comments by day and tells the person to find them with Instagram's own date filter.

What the research of 2026-10-11 found, without any request to Instagram from this lane:

- Meta's Instagram Graph API works only for professional accounts, and deleting a comment through it works only for the owner of the post, even when the person deleting wrote the comment. The Basic Display API ended on 2024-12-04.
- Instagram's oEmbed works without a token since 2026-06-15, but its terms forbid keeping what it returns.
- Instagram's Terms of Use forbid automated access, also when signed in.
- Instagram's web app lists the person's own comments at `https://www.instagram.com/your_activity/interactions/comments`, with a "Select" mode and a "Delete" button that removes several selected comments after a confirmation. Instagram's own bulk delete in that view works by hand.
- Free MIT-licensed scripts automate that view: `instagram-bulk-comment-deleter` by iamceeso, and its fork by batuhd, which selects 10 comments per cycle and waits 20 seconds between cycles. sbolel's `instagram-comment-activity-deleter` starts in a dry run with batches of 3. A gist by braunglasrakete warns that larger batches make Instagram show "Something went wrong" and that the page language must be English for its selectors.
- Reports collected by the research describe temporary action limits after about 100 deletions. No source measured a limit.

What spike S5 observed on the maintainer's account on 2026-10-14 and 2026-10-15, in English, read only ([S5](../../spikes/S5.md)):

- A row of the comments view is a `role="button"` element with an `aria-label` and an image. Its text is the person's username, the comment and a relative age in weeks, days or hours. It has no `href`. A click on a row opened the post at `/p/<code>/` for 20 of 20 rows.
- Going back from a post resets the list to newest first.
- "Sort & filter" offers "Oldest to newest", "Newest to oldest", "Start date", "End date" and "Apply". In the default order neither the mouse wheel nor the End key loaded more rows. After "Oldest to newest" and Apply, scrolling loaded further batches. Reaching the last row was not tried, and the date filter was not tried.
- On the post, the comment's permalink `a[href*="/c/"]` holds a `time[datetime]` with the exact time, next to a link to the person's username. Five of the 20 comments appeared only after one click on "Load more comments" or "View replies", and those controls had to be found again after each click.
- Of 20 rows whose text equals exactly one exported comment, the text appeared under the person's username on all 20 posts. On 18 the time lay within 60 seconds of the export's and the post belonged to the exported owner. The other 2 had a different time and a different owner, so they were other comments with the same text. A match by text alone would have linked them wrongly.
- Post codes appeared in the list's network answers from `/async/wbloks/fetch/`, but which row a code belonged to was not established. Comment IDs are not time-encoded.
- The probes allowed only `instagram.com`, its subdomains, `*.cdninstagram.com` and `*.fbcdn.net`. The browser aborted requests to `www.facebook.com` and to `media0.giphy.com`, which serves GIF comments. A request whose `x-fb-friendly-name` header named a state change would have been aborted and counted; none occurred.
- Select mode, the Delete control, the date filter, Instagram's limits for reading many posts in a row, and other page languages were not examined.

Against the pass criteria of 2026-10-11 (kept below), S5 failed criterion 1, because no row carries a post link or owner, and criterion 3 for the list, because a row shows only a relative age. It met criterion 4 when the post is the place of the check: 20 of 20 by text under the username, 18 of 20 with time and owner, and the 2 others were correctly rejected. Criterion 5 was not examined. That is why IG-3 moved the match from the list to the post.

## First real canary, 2026-10-16

The first real canary stopped as `request-journal` before its run row existed, because restored profile pages could send Instagram requests during launch.

The runner now creates its journal row before launching the context and keeps every guarded startup request under that run identity, while each planned comment still commits its sending record before navigation.

The context launches offline until the network guards are installed and every startup page except the confirmation page is closed, and its structure report records only the number of closed pages.

A later page outside the confirmation and reading pages is closed without navigation or clicks and stops the run as `unexpected-page`.

Existing extension folder IDs form the before set and do not count as additions, while any added ID still stops the run and extensions remain disabled at launch.

The second real canary on 2026-10-16 showed empty image buttons among the comments and ages in years after sorting oldest first, so empty buttons are now skipped and counted without values and both abbreviated and written year ages are parsed while nonempty unknown row shapes still stop the run.

The third real canary on 2026-10-16 read the rows and stopped at the date filter as `filter-control`, before its first step. "Sort & filter", both orders and "Apply" are buttons by role, and "Apply" stays disabled until an order is chosen. The start and the end date are six native dropdown lists in the filter dialog, month, day and year for each, without labels, names or IDs, under headings whose text matches "Start date" and "End date" only without regard to letter case. The end date's lists ended at the current day. Two structure-only diagnosis runs that chose an order and never clicked "Apply" found this; no state change was sent. IG-5 decides how the run sets the lists (section 1).

The fourth real canary on 2026-10-16 stopped as `filter-control` too, before its first step. On the canary's first step the run sorts oldest first and applies it for the oldest-row check of section 11, then opens "Sort & filter" again for the date filter. Three structure-only diagnosis runs with the run's own code found that after an applied sort that second click opens no dialog, not even 15 seconds later, while on a freshly loaded comments view the dialog opens at once, all six dropdown choices read back and "Apply" is enabled. The canary therefore loads the comments view again after the oldest-row check (section 11).

The fifth real canary on 2026-10-17 set the date filter, found the comment's row and opened its post, then stopped as `post-timeout` after 30 seconds. Four structure-only diagnosis runs with the run's own code, which never clicked on the post, found the post page at `/p/<code>` without the closing slash, inside one `main` element without `article`, `header`, `ul` or `li`. The post's own link is `/<owner>/p/<code>/` with a `time[datetime]` and named the export's owner, as did the first profile link; each comment's permalink `/p/<code>/c/<id>/` held a `time[datetime]`. There was no "Load more comments" or "View replies" control on that post. Three further probes on the same day, through the devtools protocol and without a click or scroll on the post, corrected and completed this (corrected 2026-10-17): each comment's block is the element three levels above its permalink, with one row holding the profile link, whose text is the username, and the permalink, and a second row holding the comment text in one `dir="auto"` span, which may hold hashtag links; the caption's block holds the owner's profile link and a `time[datetime]` outside any link in one row, the caption as a plain `span` beside that row, with line breaks and hashtag links, and a separate "See translation" button. The comment column is a scroll container; the page's own answer gave this post 4,193 comments with further pages, and the person's comment was not among the 10 shown. Sections 4 and 5 now name these elements; the four checks of IG-3 are unchanged.

## Decision Drivers

- Keep the context of each comment, the post it answered, before the comment is deleted. (2026-10-11)
- Never link a comment to a post that is not its own. The export has no ID to match by, and S5 showed that text alone links some rows wrongly. (2026-10-11, sharpened 2026-10-15)
- Follow every rule of [ADR-023](ADR-023-acting-in-own-account.md): own account, the person's order, journal, stop at the first error, slow, nothing hidden. (2026-10-11)
- Use only the controls IG-2 B allows, and read at the pace IG-3 sets, counted apart from X. (2026-10-15)
- Give the later deletion record what it needs to find each comment again, without designing deletion here. (2026-10-15)

On 2026-10-15 the maintainer permitted successive written orders to set a faster Instagram reading pace, with every run recording limit signals and stopping at the platform's first warning.

## Options

### Options weighed on 2026-10-11

The wording of options A to D is as decided on 2026-10-11. The notes marked "After S5" were added on 2026-10-15.

#### Option A: Drive the "Your Activity" comments view in the dedicated profile

SocialPrune opens the view in the dedicated profile ([ADR-023](ADR-023-acting-in-own-account.md)), reads each row (comment text, date, post owner, and the post's link and thumbnail where shown), matches rows to export comments, keeps the context, and deletes marked, matched rows with the view's own Select and Delete controls in small batches.

**Pros:**
- One view gives both the context and the deletion, without visiting each post.
- Uses Instagram's own bulk controls, as the free scripts do; nothing is sent that Instagram's page code does not send.

**Cons:**
- Matching rows to export comments by text, time and owner can be wrong or ambiguous; a wrong match deletes the wrong comment.
- Depends on the view's structure and language, which changes without notice.

**Effort:** not measured
**Risk:** High for the account; Medium for wrong matches, bounded by the rules below.

**After S5.** The rows carry no link, no owner and only a relative age, so the view alone gives neither the context nor a reliable match. Its sorting, its date filter and the click that opens a post remain useful, and option E below builds on them.

#### Option B: Open each post and delete the comment there

**Pros:**
- The comment is checked in place, under the post, before deletion.
- The post's full caption and image are visible.

**Cons:**
- Needs the post's link, which only option A's view may provide; without it, there is no way to find the post.
- One page load per comment, so many more requests as the person's account.

**Effort:** not measured
**Risk:** High.

**After S5.** A click on a row opens its post, so the first con no longer holds for reading. Option E checks on the post as this option proposed, and leaves deletion to its own record.

#### Option C: A script the person pastes into their own Instagram tab

**Pros:**
- Proven by the scripts above.
- No browser automation in SocialPrune.

**Cons:**
- No journal SocialPrune can trust and no match against the person's decisions; the scripts delete whatever is selectable.
- Pasting scripts into the console is what scams ask people to do.

**Effort:** not measured
**Risk:** High.

**After S5.** IG-2 B rules out scripts in Instagram's page.

#### Option D: Stay with the click list and Instagram's own bulk delete by hand

**Pros:**
- No automation risk; Instagram's own feature.
- Already supported by the click list's day groups.

**Cons:**
- No stored context for the comments.
- The person selects each comment by hand.

**Effort:** none
**Risk:** Low.

**After S5.** This stays the way for every comment the reading pass does not confirm (IG-1, IG-3 point 1).

### Options weighed on 2026-10-15, for the reading pass

#### Option E: Find in the list, confirm on the post

For each exported comment, filter the comments view to the comment's dates, pick the rows whose text equals the export's, open the post from such a row, and accept the link only when the post shows the text under the person's username, with a permalink time within one minute of the export's, on a post whose owner equals the export's owner. Keep the post's context from the post page.

**Pros:**
- The checks rejected both wrong text matches in S5's sample of 20.
- The post page is where the caption, the owner, the post's time, its image and the comment's permalink are.
- It uses only the controls IG-2 B allows.

**Cons:**
- One list load and at least one post open per comment, so the reading takes days.
- The date filter was not tried in S5, and the whole walk depends on it (section 3).
- Comments without a post owner or without text cannot pass the checks and stay manual.

**Effort:** not measured
**Risk:** High for the account, as every signed-in action; Low for wrong links, because all four checks must pass.

#### Option F: Match in the list alone, as decided on 2026-10-11

Match rows to export comments by text, date and owner in the list, and label every link "Matched, not confirmed".

**Pros:**
- No post opens, so far fewer page loads.
- Already written down, in the superseded text below.

**Cons:**
- The list has no owner and no exact date, so the match is by text alone.
- S5 found 2 wrong links in 20 that way.

**Effort:** not measured
**Risk:** High for wrong links, which later deletion would act on.

#### Option G: Read post codes from the list's own network answers

Read the answers from `/async/wbloks/fetch/` that the list loads, as [ADR-029](ADR-029-signed-in-originals-pass.md) reads X's answers, and open posts by their address instead of clicking rows.

**Pros:**
- No click on a row, and no need to filter again after each post.
- Could pair a code with a comment without the date filter.

**Cons:**
- S5 did not establish which row a code belongs to, so the pairing is unknown.
- Instagram's `wbloks` answers are an internal format nobody in this project has examined beyond a count.

**Effort:** not measured
**Risk:** Medium, until the pairing is known.

## Decision

On 2026-10-11 this record chose option A, gated by spike S5; that text is under "Superseded on 2026-10-15". On 2026-10-15, after S5 and IG-3, it chooses **Option E: find in the list, confirm on the post**, for reading only. Its checks rejected the wrong links that option F would have made, and it needs no format nobody has examined, as option G would. The canary records, as structure only, whether the list's answers pair codes with comments, so option G can be weighed again with evidence. Option D stays the way for every comment option E does not confirm. Deletion gets its own record (section 10).

### 1. What the run may do in Instagram's tab

It may navigate to `https://www.instagram.com/your_activity/interactions/comments`, click "Sort & filter", "Oldest to newest", "Newest to oldest" and "Apply", choose an entry in each of the filter dialog's six dropdown lists for the start and the end date from the entries the list offers, without opening the list (IG-5, amended 2026-10-16), scroll the list, click a comment row to open its post, and on a post click "Load more comments" and "View replies" where the page shows them, and move the pointer over the post's comment column and scroll it with the mouse wheel (IG-6, 2026-10-17). It reads the page's markup through a selectors module, the address the page shows, and the body of the image response named in section 5. During a canary step it also reads, as data, the JSON answers the page itself received from Instagram's hosts in that step, for the comparison of section 11. It sends no request for them and keeps nothing from them except what section 11's structure report records.

It never clicks Select (the list's mode for choosing comments to delete, which has nothing to do with the filter's dropdown lists), Delete, a like, a reply, a follow, save, share, report, a "more" link or any other control; never types, fills a field, presses a key or hovers to reveal a control; never closes a dialog other than the filter it opened; never runs a script in Instagram's page; adds no init script and no exposed function; and routes requests only to let them through or to abort them (section 8). It does nothing from [ADR-023](ADR-023-acting-in-own-account.md)'s forbidden list: no changed user agent, no stealth plugin, no solving, no proxy, no hidden window.

The click helper accepts only a locator built from the list above, by role and exact accessible name or by the row structure of section 3. Anything else is refused in code before a click. A separate choice helper accepts only the six dropdown lists of the open filter dialog, found by their place under its start and end headings, and only an entry the list offers at that moment; anything else is refused in code before the choice, and a list is never clicked. The names are English. The headings are matched without regard to letter case, as the third canary found them, and the fake page mirrors the dialog as found (amended 2026-10-16).

### 2. Which comments the pass reads

The plan holds the Instagram comments of the account that:

- have text after Unicode NFC normalization and collapsing whitespace, and a post owner;
- have no other comment of the same account with the same text and owner within 120 seconds, because one permalink time could then lie within a minute of both;
- have no context record yet;
- have no settled `unconfirmed`, `not-listed` or `unavailable` result from an earlier run, unless `--include <file>` names them.

Comments without text or without a post owner stay manual, counted as `emptyText` and `noOwner`; so do close pairs, counted as `closeTwin`. IG-3 requires the owner check, so a comment without an owner cannot pass it, and nothing in S5 suggests asking the maintainer for an exception. `--include` cannot plan a manual comment.

The plan lists the comments whose current human decision is `delete` first, then the rest, each from the oldest to the newest by export time, then by item ID. Marked comments are read first because the later deletion needs their records first.

**Amended 2026-10-21 by the maintainer's decision IG-13 A.** This extends the planning rules of section 2 and the comments passed to section 3. It supersedes the earlier assumption that only the settled results named above can leave an otherwise planned comment out. The original rules remain above unchanged; their manual and confirmed-entry checks still apply.

The CLI accepts `context instagram --exclude <ids-file>` in a dry run and in a run. The person writes one Instagram entry ID per line, in the same format as `--include`: surrounding whitespace and blank lines are ignored, repeated IDs form one set, and a malformed ID is an argument error. An ID in both files is an argument error before the workspace is opened, even if it matches no entry. Neither that error nor an unmatched ID echoes the ID or any entry text.

An excluded entry never enters the plan rows, the canary selection, the click list for the reading run or the run itself. Entries that would otherwise be planned or manual count once in `personExcluded`; a manual reason is not counted again. Already-confirmed and earlier-result entries keep their existing buckets. Each supplied exclusion ID outside the planned or manual set counts once in `excludeUnmatched`, including an ID belonging to another account. The dry-run text and JSON show those counts without listing the excluded IDs. Exclusion changes neither review decisions nor stored attempts or context records. Removing the ID from a later skip file makes it eligible again only if the other planning rules permit it; `--include` still cannot restore a confirmed or manual entry.

The hash binds the sorted unique exclusion set as well as the remaining ordered rows and their marked status. Reordering or repeating file lines leaves the hash unchanged; adding or removing an ID changes it even when that ID matches no planned entry. An empty exclusion set keeps the previous hash calculation. Both checks before reading recompute the same plan with the same include and exclude sets.

`--order` may accompany `--exclude`. Exclusion only reduces the work, and the run still needs the fresh hash for that reduced plan. A changed exclusion set therefore requires another dry run and the new hash before the order can run. `--order` with `--include` remains refused because include restores work rather than only narrowing it. Without an order, the existing interactive Start, Continue and Matches boundaries remain.

This decision supersedes the proposed automatic repeated-notice rule for the present implementation. Automatic exclusion based on two failed post opens in separate runs at least six hours apart is later product work, after `packages/core/src/model/browser.ts` and `packages/core/src/workspace/instagram-context-writer.ts` carry typed terminal stop-token and phase evidence. A generic `PLATFORM_CHECK` is not evidence of `notice-error`. Historical attempts are not changed or inferred from that code. The desktop engine's plan request gains no exclude field in this round; a corresponding person-controlled desktop selection and its protocol are later work, not a shipped capability.

Section 8 is unchanged. Every notice still stops the current run immediately, with no retry or continuation after it. The step's closed path/status counts are diagnostic only; a 404 does not turn a notice into `unavailable`. ADR-029 section 8 treats unavailable X posts as results that a run can move past, but that precedent does not give Instagram's ambiguous notice that meaning.

### 3. Finding a comment in the list

A **step** is one load of the comments view with its filter and at most one post opened from it. For each planned comment:

1. **Navigate** to the comments view by its address, a fresh load for every step, because going back resets the list anyway. Wait up to 30 seconds for rows or a known page state (section 7).
2. **Filter.** Open "Sort & filter", choose "Oldest to newest", set the start date to the day before the export's time and the end date to the day after, both as UTC calendar days, and click "Apply". Each date is set in its dropdown lists in the order year, month, day, because a list's entries can depend on the lists before it; after each choice the run reads the list's value back. An entry the list does not offer, a value that does not read back, or a dialog without exactly these six lists stops the run with `INSTAGRAM_SHAPE_CHANGED` and `filter-control` (amended 2026-10-16, IG-5). The filter's own time zone is not known, and a day on either side covers every zone. Oldest first, because S5 saw the default order load nothing more on scroll.
3. **Read the rows.** Scroll at most 10 times, at least 2 seconds apart, until no new row loads. If rows still load after 10 scrolls, the comment settles `not-listed` with the code `window-full`.
4. **Candidates.** From each row's text, remove the leading username and the trailing relative age. A row is a candidate when the rest equals the export's text after NFC normalization and collapsing whitespace. When the row's text ends in an ellipsis, a row whose text before it, at least 20 characters, starts the export's text is a candidate too. A candidate is never a match, because only the post confirms (section 4).
5. **Open.** Without a candidate the comment settles `not-listed` with the code `no-row`. Otherwise click the first candidate in list order. When its post does not confirm and another candidate remains, the next step filters again and opens the next one, up to 3 candidates per comment, each step counted. A fourth candidate settles the comment `unconfirmed` with the code `several`.

**Why the date filter and not one walk down the oldest-first list.** After every post the list returns to newest first, so reaching the k-th oldest row again takes about k/b scroll loads, where b is the number of rows a scroll loads, which S5 did not measure. That cost grows with every comment, and over a whole export it would load the list far more often than it opens posts. With the date filter each step costs one filtered list, a few scrolls and one post. The third canary showed that the filter cannot be set with clicks alone, because its dates are dropdown lists, and IG-5 lets the run choose their entries (section 1).

### 4. Confirming it on the post

After the click, the run waits up to 30 seconds for an address `https://www.instagram.com/p/<code>/` or `/reel/<code>/`, with or without the closing slash (the fifth canary found the page at `/p/<code>` without it), with `<code>` of 1 to 64 characters from `[A-Za-z0-9_-]`, and for the post's markup, whether Instagram shows it as a page or as a dialog over the list, or for a known page state. The post's markup is the one `main` element that holds the post's own link, `/<owner>/p/<code>/` or `/<owner>/reel/<code>/` with the same code, carrying a `time[datetime]`; the fifth canary found no `article`, `header` or list elements on the post page (amended 2026-10-17). The run reads the post only after two reads at least half a second apart both found that markup, and a read during the 30 seconds that misses it, after the post opened or after a load, is repeated rather than taken as a new shape; only markup still missing at the end of the 30 seconds stops the run with `post-structure`. The seventh canary stopped that way on a post whose own link disappeared right after the post first showed it; probe 5 opened the same post on 2026-10-18 and found the own link missing at the first read and present at every read from half a second to 12 seconds (amended 2026-10-18). Instagram's notice that a post is not available settles the comment `unavailable`.

It looks for a comment block that holds a link to the person's profile, `/<username>/`, whose text is the username; the comment text; and a permalink `a[href*="/c/"]` whose path names the same post code and holds a `time[datetime]`. The block is the element three levels above the permalink: its first row holds exactly one such profile link and the permalink, and its second row holds exactly one `dir="auto"` span with the comment text, which may hold hashtag and profile links but no time, image, button or permalink; any other shape is skipped, never guessed (corrected 2026-10-17). If no such block has the export's text, the run clicks "Load more comments" until it is gone, then each "View replies" in document order, finding the controls again after every click, at least 3 seconds apart and at most 10 clicks per post, and stops clicking once the block is found. Where the page shows neither control, the run scrolls the post's comment column instead: the pointer over that scroll container, the mouse wheel as on the comments list, each scroll one of the same 10, at least 3 seconds apart; it stops once the block is found, after the tenth, or when two scrolls in a row add no comment block (IG-6, 2026-10-17).

A comment is **confirmed** when exactly one block passes all four checks of IG-3:

| Check | Passes when |
|---|---|
| author | the block's profile link names the person's username, the one the account check of section 7 read from the list |
| text | the block's comment text equals the export's text after NFC normalization and collapsing whitespace, with no prefix rule |
| time | the permalink's `datetime` lies within 60 seconds of the export's `Time`, both in UTC |
| owner | the account named in the post's own link equals the export's `Media Owner`, compared in lower case without a leading `@`; every own link with the post's code must name the same account, and the first profile link in the post's markup must name it too (amended 2026-10-17) |

Otherwise the comment settles `unconfirmed` with a code: `owner` when the post's owner differs; `time` when blocks with the text exist but none lies within a minute; `text` when a block of the person lies within a minute but its text differs, for example an edited comment or a cut one; `several` when more than one block passes; and `not-shown` when none of these appears after the expansion clicks, which includes the text appearing only under another account. Own links that name different accounts for the same code, or a first profile link that names another account, settle `owner`, and the canary counts how often that happens; the fifth canary found one own link, naming the export's owner, and a first profile link naming the same account (amended 2026-10-17).

**Confirmed through the comments list (IG-8, 2026-10-18).** A comment that would settle `not-shown` confirms its post instead when all of these hold: the step's filtered list had exactly one candidate row, that row names the person's username and its text equals the export's text after NFC normalization and collapsing whitespace, with no prefix rule, so a row that Instagram cut stays `not-shown`; the post opened from that row's own link in the same step; and the post passes the owner check above, its own links naming one account, that account equal to the export's `Media Owner`, and the first profile link naming it. The comment settles `confirmed`, and its record says `confirmedBy: 'list'` and holds no comment ID and no permalink time ([ADR-030](ADR-030-instagram-context-record.md)). A comment confirmed by the four checks says `confirmedBy: 'post'`. `owner`, `time`, `text` and `several` never confirm through the list, because each means the post showed something that disagrees.

The comment settles one journal attempt as section 2 of [ADR-030](ADR-030-instagram-context-record.md) describes, either `confirmed` with the context record in one transaction, or one of `unconfirmed`, `not-listed`, `unavailable` and `failed`. The pass never confirms a comment it did not see in this step.

### 5. What is kept

For each confirmed comment, the record of [ADR-030](ADR-030-instagram-context-record.md), read from the post page:

- **The post's account.** The account named in the post's own link, which the first profile link also names, and how many different accounts the post's own links name (amended 2026-10-17).
- **The caption.** The text of the caption block, authored by the post's owner, as the page shows it, at most 10,000 characters. The caption block holds the owner's profile link and a `time[datetime]` outside any link in one row and the caption as a plain `span` beside that row; "See translation" is not part of it. A caption block whose shape is not recognized gives no caption and `captionComplete: false` (corrected 2026-10-17). The run never clicks "more". When the page offers more, the record says the caption is not complete.
- **The post's date.** The `time[datetime]` inside the post's own link, `/<owner>/p/<code>/` or `/<owner>/reel/<code>/` (amended 2026-10-17), never one inside a `/c/` link.
- **The link.** Built from the path kind and the code, `https://www.instagram.com/<p|reel>/<code>/`, and for the comment `.../c/<id>/`. No address string from the page is stored.
- **The confirmation.** How the comment was confirmed, `post` or `list` (IG-8, 2026-10-18), and how many expansion clicks it needed; for `post` also the comment's ID from its permalink and its time. A post confirmed through the list has no comment link.
- **The first image.** The bytes of the first image in the post's media, taken from the response the page already received for that image's `currentSrc`, matched by exact address. SocialPrune sends no request of its own for it. The response must come over `https` from a host ending in `.cdninstagram.com` or `.fbcdn.net`, have the type `image/jpeg`, `image/png` or `image/webp`, be at most 5 MiB and start with that type's bytes. It is written to `image.jpg`, `image.png` or `image.webp` through a `.part` file and a rename. When the page took the image from its cache, or the post shows a video without an image, the record says `not-captured`; a wrong type `not-image`; a larger file `too-large`. The record keeps the host, never the address, which carries signed parameters.
- **The screenshot.** One JPEG of the post's element, the `main` element of section 4 (amended 2026-10-17), as Instagram shows it right after the confirmation, quality 60, at CSS pixel size, with Playwright's `caret: 'initial'` and `animations: 'allow'`, so that Playwright adds no style to the page. At most 400 KB; a larger one is discarded as `too-large`. It shows what that element shows at that moment: the image, the post's header, the caption and the comments loaded, including other people's names and words. It stays on the person's computer and goes into no backup, test, report or log.

Files go to `<workspace>/context/instagram/<hex>/`, with the code in hexadecimal as [ADR-030](ADR-030-instagram-context-record.md) explains, once per post. The run does not keep other people's comments as text, like counts, the page's markup, addresses, request or response headers, or anything from a post the run did not confirm. Backups carry the records and not the files, as they do for X's photos ([ADR-030](ADR-030-instagram-context-record.md), section 5). All of this stays in the workspace (hard constraint 2).

### 6. Command

```text
socialprune context instagram --workspace <dir> --account <key> --dry-run
    [--handle <name>] [--include <file>] [--list <file>] [--json]
socialprune context instagram --workspace <dir> --account <key> --profile <dir> --plan <hash>
    [--handle <name>] [--include <file>] [--order <file>] [--limit <n>] [--browser chrome|edge] [--lang de]
socialprune browser setup --platform instagram --profile <dir> [--browser chrome|edge]
socialprune browser setup --platform instagram --profile <dir> --adopt
socialprune browser forget --profile <dir>
```

**Dry run.** It reads only the workspace, with no browser, no profile, no network, and no writes except the list file the person names, which it refuses to overwrite. Above the rows it prints the planned count and how many of them are marked for deletion, the manual comments per reason (`emptyText`, `noOwner`, `closeTwin`), the comments already confirmed, the comments left out after an earlier result per state, the steps at one per comment, the days at 200 steps a day, and the warning. Each planned comment gets one row with its item ID, date, the first line of the person's comment, the post owner, and whether it is marked. `--json` gives counts, the plan hash, the estimate and the warning, never text, and refuses `--list`. The plan hash is SHA-256 over the canonical JSON of the planned rows in plan order, each `{ itemId, marked }`.

**A run** follows [ADR-027](ADR-027-x-deletion-browser.md)'s steps 1 to 5 as `originals fill x` does. It refuses pipes and `--json` without an order (`NOT_INTERACTIVE`), a changed plan (`STALE_PLAN`), a profile whose marker does not name `instagram` (`PROFILE_INVALID`) and a missing browser (`BROWSER_NOT_FOUND`). It takes the profile snapshot and shows the confirmation page on `127.0.0.1` with its page token in the fragment: the counts, the first 20 rows with the path of the full list, the estimate, what the run can change and the warning, with **Start**. Nothing is opened on Instagram before that click. The first step checks the account (section 7).

**Written order.** IG-3 point 3 has the agent do the reading. `--order <file>` accepts a UTF-8 JSON file of at most 64 KiB with no extra properties: `{ scope: 'context-instagram', account: '<expected username>', givenAt: '<ISO-8601>', words: '<the person's own order>', maxSteps?: 1..200, acceptCanary?: boolean }`, where `acceptCanary` is `false` when absent. The scope is exact, the account matches the export's username or `--handle` case-insensitively, the date is valid, the words are not empty, and the unchanged `--plan` hash stays mandatory. A bad file refuses before any browser or profile access (`CONTEXT_ORDER_INVALID`).

The later pace order adds optional integer `secondsPerStep` from 10 to 30, optional integer `stepsPerDay` from 1 to 600 and boolean `batchPause` defaulting to true, and widens `maxSteps` to 1 through 600.

An order with `--limit` accepts up to 600 steps but cannot exceed that Instagram day's remainder, while a run without an order keeps the 200 step ceiling.

A dry run may preview the exact order with its unchanged plan hash without a profile or browser, and both the dry run and confirmation state the pace in force.

The order decides how the canary is accepted, as AUTO-1 does on X. Without `acceptCanary: true`, an order runs only on a workspace whose canary the person accepted with **Matches** (section 11), else it refuses with `CANARY_REQUIRED` before any browser or profile access. With it, an order on a workspace without an accepted canary runs the canary itself and accepts it only when every automatic check of section 11 passes; on a workspace with an accepted canary the field changes nothing. Pace, stop rules and the read-back are the same in both modes. A wrong automatic acceptance can make the local records worse, but it does not change what the run does on Instagram. The order card the person confirms names the mode in their words.

With an order the run may print to a pipe or `--json`, prints the warning to stderr, opens the confirmation page as a status view with **Stop** and without a **Start** wait, and closes its browser at the end. The exact bytes of the file are hashed with SHA-256 and recorded in the CLI-local `browser_order_audit` table with `startedBy: 'agent-on-order'` and the scope in its data, as for `originals-fill-x`. The order never covers `--include`, setup, deletion, a different account or reading the profile's contents, and it covers a canary only with `acceptCanary: true`.

**Agents** may run `context instagram --dry-run --json` and report counts, the hash and the warning. Only the person's written order for exactly `context-instagram` permits `--order`. Without it, agents stay dry-run-only, apart from the adoption below on the person's own confirmation.

**Profiles.** `browser setup --platform instagram` creates a dedicated profile whose marker names `instagram` and opens Instagram's sign-in page in an ordinary browser window with no program attached, as setup does for X. One profile serves one platform, so an X profile is refused for this command, and an Instagram profile for X's commands. `browser forget` works as for X; the person signs out first.

**Adopting a profile.** The maintainer's Instagram profile was created for spike S5 by a plain browser launch, before this command existed, so it has no marker. `browser setup --platform instagram --profile <dir> --adopt` adopts such a profile. It accepts only an existing directory that holds a Chromium profile, recognized by its `Local State` file, has no marker, is not in use, is neither a symbolic link nor a junction, and does not lie inside the browser's default user-data location. It writes only the marker, naming `instagram` with the time of adoption, launches and opens nothing, reads the content of no other file, and prints what it wrote. Without `--adopt`, setup still refuses an existing directory. A written order never covers adoption, because adoption is setup. An agent runs it only after the person's own confirmation that names it.

### 7. Pace and stopping

The later pace order supersedes the fixed values below only where it explicitly changes them, and a canary always keeps 30 seconds between step starts.

With no pace fields a run keeps the original 30 seconds, 20 steps per batch, 15 minute pause and 200 steps per Instagram day, while `batchPause: false` removes only the fixed batch pause.

| Setting | Default and maximum |
|---|---|
| time between the starts of two steps | at least 30 seconds |
| steps per batch | 20 |
| pause after each batch | 15 minutes |
| steps per calendar day and Instagram account, in the workspace time zone, counted over Instagram runs only | 200; `--limit` lowers it for one run, nothing raises it |
| expansion clicks per post | 10, at least 3 seconds apart |
| scroll loads per step | 10, at least 2 seconds apart |
| candidate rows tried per comment | 3, each its own step |

Every step counts toward the batch and the day, whether it opened a post or ended in the list, so the run never opens more than 200 posts a day and never loads the list more often than that either. X's 200 page opens a day are counted apart (IG-3 point 3; [ADR-030](ADR-030-instagram-context-record.md), section 2). At this pace 200 steps take about four hours, as on X. A comment that needs a second candidate takes a second step, so the dry run's estimate is a lower bound. The numbers are IG-3's choices and this record's, not measurements. Waits are fixed, never randomized.

**Account check.** Each time the run loads the comments list, the page outside `main` must hold a link to the expected account's profile, `/<username>/`, as the navigation's profile entry does, and more than half of the rows that are not empty must show the expected username; otherwise the run stops with `ACCOUNT_MISMATCH`. A row that shows another name is counted in the structure report and is never a candidate, neither for the post confirmation nor through the list (IG-9, 2026-10-19). The eighth canary's list showed 3 such rows among 45, each shaped like a comment row with its `aria-label` beginning with that name; why Instagram shows them in the person's own comments list is not known. A list without rows within 30 seconds stops with `PLATFORM_CHECK`.

**IG-15 A supersession, 2026-10-22.** The preceding paragraph's "more than half" condition is superseded: the same outside-main link must match the expected account, and at least one non-empty row must show that name; the remaining checks, other-name diagnostic and exclusion of other-name candidates remain in force.

**Language.** The labels above are English. A page whose `<html lang>` does not start with `en` stops the run with `PAGE_LANGUAGE` before the first click, with the message to switch Instagram to English for the run.

The run stops at once, leaves the window open and writes its end reason on: Instagram's sign-in page, a challenge or checkpoint page, a lock, suspension or limit notice such as "Try again later", the error "Something went wrong", a 429 from an Instagram host, or neither the expected markup nor a known state within 30 seconds (`PLATFORM_CHECK`); a missing control or an unknown structure where the selectors expect one (`INSTAGRAM_SHAPE_CHANGED`); `UNEXPECTED_ACTION` (section 8); `ACCOUNT_MISMATCH`; `PAGE_LANGUAGE`; an extension ID absent from the before set; a closed browser; `DISK_LOW`; and **Stop** or Ctrl+C, which let the current step finish reading without another click. A canary under an order also stops at the first failed automatic check, with the codes of section 11. It ends without an error at the day's budget, at `--limit` or `maxSteps`, and at the end of the plan. S5 saw none of these notices, so their exact texts and addresses in the selectors module are expectations, and the fake page tests them as written there. Every end reason is printed in the terminal and stays on the confirmation page until the window closes.

### 8. What the run does in the profile

Every run writes a structure report containing response counts per closed host and path class, counts of each 4xx code and of 5xx responses, median and maximum navigation readiness time per list or post step, and rate limit or Retry After header names without their values.

Any HTTP 429 on an allowed Instagram response stops immediately as `http-429`, and any page JSON answer with `feedback_required`, `please_wait`, `checkpoint_required` or `spam` as the exact value of a `status` or `message` key stops as `rate-signal`, without waiting or retrying.

**Hosts.** The browser lets a request through only over `https` to a host that equals `instagram.com` or ends in `.instagram.com`, `.cdninstagram.com` or `.fbcdn.net`, compared on the parsed host with the leading dot, never as a substring. Every other request and WebSocket is aborted and counted by host without stopping the run, as on X; S5 saw `www.facebook.com` and `media0.giphy.com` there. A test asserts the host rules exactly.

**Unexpected action.** Instagram's page reads through `POST` requests, so a method alone says nothing. The run aborts, before it leaves the browser, and stops with `UNEXPECTED_ACTION` on a request whose `x-fb-friendly-name` ends in `Mutation`, the name Instagram's page code gives to a write; and on a request other than `GET` to `/api/v1/` whose path holds one of the segments `like`, `unlike`, `follow`, `unfollow`, `delete`, `add`, `create`, `save`, `unsave`, `block`, `mute` or `report`. Every other request other than `GET` goes into `profileReport.unexpectedRequests` with method, host, path, status and its operation name ([ADR-030](ADR-030-instagram-context-record.md), section 2), and the person sees them grouped with counts. The report says that Instagram's page sends many such requests while reading and that the rule does not claim to know every write. A write the page sends on its own while the run clicks nothing that changes anything still stops the run; the canary lists such names, and a later revision may list one as background only after the maintainer's decision.

**Extensions and marks.** As on X: started with extensions disabled, extension IDs compared at every checkpoint by directory name only, removed IDs recorded without stopping, an added ID stops the run. The Chromium sandbox and every automation mark stay on.

**What a run can change**, printed before it: [ADR-023](ADR-023-acting-in-own-account.md)'s text for step 3 of the profile procedure, then "Open your comments list in Instagram's Your activity, sort and filter it by date, open the posts your comments are on and expand their comments. No typing, likes, replies, follows, selection or deletion. Keep each confirmed post's account, caption, date, first image and a screenshot." and "Each opened page goes into this profile's history. Instagram's pages fill its cache, and Instagram may change its cookies and site data."

**Snapshot and read-back.** [ADR-023](ADR-023-acting-in-own-account.md)'s steps 4 to 6. The account after the run is the username on the rows of the last list the run loaded, so the read-back costs no extra page.

**The warning**, in the terminal, on the confirmation page above **Start** and in the documentation:

> Instagram's rules do not allow this kind of automation. Instagram can lock or suspend your account for it, even though SocialPrune goes slowly and stops at the first problem. This run only reads. It sorts and filters your comments list, opens the posts and expands their comments in your signed-in Instagram window, and keeps what Instagram shows. SocialPrune does not hide that a program is acting in your browser. Use it only for your own account, and only if you accept this.

> Die Regeln von Instagram erlauben diese Art von Automatisierung nicht. Instagram kann dein Konto dafür sperren oder einschränken, auch wenn SocialPrune langsam vorgeht und beim ersten Problem anhält. Dieser Lauf liest nur. Er sortiert und filtert deine Kommentarliste, öffnet die Beiträge und klappt ihre Kommentare auf, in deinem angemeldeten Instagram-Fenster, und speichert, was Instagram anzeigt. SocialPrune verbirgt nicht, dass ein Programm in deinem Browser handelt. Nutze es nur für dein eigenes Konto und nur, wenn du das in Kauf nimmst.

Both texts fall under `pnpm copy:check`.

### 9. What the person sees

- The workspace protocol gains `getInstagramContext` ([ADR-030](ADR-030-instagram-context-record.md), section 6). The CLI's review answers it from the workspace; the browser-only app answers with an empty list.
- In the card review, the list view's detail, the archive and deletion mode, an Instagram comment with a record shows the post it is on: the owner, the post's date, the caption as text with `dir="auto"` and, when cut, "Instagram showed only the beginning of this caption."; the first image; **Show screenshot**, which reveals the screenshot; **Open on Instagram**, a link built from the code that opens a new tab only on the person's click, with `rel="noopener noreferrer"`; and the line "SocialPrune found this comment on the post in your signed-in Instagram on 15 October 2026. Its text, time and the post's account match your export." An image the run did not keep says "SocialPrune did not keep the first image of this post.", and a file missing from a copied workspace says "Not in this copy". Everything renders as React text nodes.
- An Instagram comment without a record keeps the sentence its surface shows today. The card review with its "All" mode, the archive and deletion mode show "Instagram does not include the post." (`proto.instagramMissingPost`, German "Instagram liefert den Beitrag nicht mit."), and the list view's detail shows "The post this comment is on is not part of your export." (`review.commentReference`, German "Der Beitrag, zu dem dieser Kommentar gehört, ist nicht Teil deines Exports."). With a record, each of these surfaces shows the post instead. The review does not show why a comment was not confirmed; the dry run's counts and list do.
- **Route.** The review server serves `^/context/instagram/([A-Za-z0-9_-]{1,64})/(image\.(?:jpg|png|webp)|shot\.jpg)$` with the checks X's photos have: exact Host and Origin; the session cookie, else 401; `Sec-Fetch-Site: same-origin` when the header is present, else 403; a record with that code lists the file as stored, else 404; a regular file inside the workspace, at the hexadecimal folder, and no link, else 404; and the file's first bytes match its type. The local-review policy already allows `img-src 'self'`, so it does not change, and the Pages app's policy does not change either.
- [ADR-021](ADR-021-archive-media.md) stays as it is, because it covers media inside the export.

### 10. What later deletion gets from this pass

For each confirmed comment the pass leaves the post's path kind and code, so the post's address; the comment's ID, so its permalink `/<p|reel>/<code>/c/<id>/`; its exact time; the post's owner; and the run and attempt that confirmed it. Under IG-1 and IG-3, SocialPrune never deletes an Instagram comment without such a record; every other comment stays on the click list. The deletion record decides where it deletes, whether on the post or through the list's Select mode, which S5 did not examine and which needs its own scope; how it checks the comment again right before acting; its pace, which IG-1 sets at 10 per batch, at least 15 minutes between batches and at most 50 a day; and its warning. The journal's platform field and the record's IDs are in place for it.

### 11. Order, the canary and the first real run

1. `browser setup --platform instagram`, signed in by hand.
2. `context instagram --dry-run`.
3. The first run on a workspace, and the first after an `INSTAGRAM_SHAPE_CHANGED` stop, is the **canary**. The person starts it with **Start**, or an order with `acceptCanary: true` starts it (section 6). It takes the planned comments in plan order, first the oldest, one step at a time, until 5 are confirmed; a comment that is not confirmed, with any code, stays manual and the canary takes the next one, at most 15 comments in all, and a canary that reaches 15 without 5 confirmations ends with `CANARY_CHECK_FAILED` (IG-6 and IG-7, 2026-10-17). For a comment that ends `owner`, the report records as yes or no whether the post's own links named one account, whether that account equals the export's owner, and whether the first profile link named it. After each, the confirmation page shows, as counts and yes or no: whether the filter was set through its dropdown lists (amended 2026-10-16), the rows in the window, the candidates, the scroll loads, the expansion clicks, the result with its code, which fields were read, whether each stored field had a second source on the page and agreed with it, and the image's and the screenshot's status and size. Without an order it waits for **Continue** or **Stop**; under an order it shows **Stop** only and goes on by itself. For the oldest comment it also shows whether the first row of the oldest-first list, unfiltered, has the relative age of the export's oldest comment within a week; after that check the step loads the comments view again before it sets the date filter, because after an applied sort Instagram's "Sort & filter" opens no dialog until the view is loaded again (fourth canary, amended 2026-10-16). That load belongs to the same step and is not counted as a step of its own. The run ends with the reason `canary` and writes a structure report to `<workspace>/context/instagram/canary-<runId>.json`. The report holds element roles and key paths, counts, the yes and no answers, the operation names of the requests other than `GET`, the aborted hosts, how many post headers named several accounts, and, for the list's network answers, whether a post code sits next to a comment ID or text in the same object. For each stored field and for the first image it also records whether a second source was found and whether it agreed, the key paths at which the selectors module's keys were found, and, when those keys found nothing, the key paths at which a value equal to the post's code, owner, time or caption occurs in any answer of the step, so the module can be updated from structure alone. Key paths have array positions and digits removed. The report holds no comment text, username, code, address or time.
4. **Accepting by hand.** Without an order, the person compares the posts in the window with the review and clicks **Matches** or **Does not match**. Only **Matches** writes `canaryAcceptedAt`.
5. **Accepting under an order** with `acceptCanary: true` follows the automatic checks below and needs no click.
6. Either way, the run that accepts ends there. A full run needs a new dry run and a new start, so the structure report is read before any full run, as on X, by the person or the session that holds the order. From then on a written order may start the paced runs.

**Second source.** During each canary step the run looks among the JSON answers the page itself received from an allowed Instagram host after the post opened. It parses their bodies as data, never runs them, skips answers over 5 MiB, and takes the objects that carry the post's code under a key the selectors module names. In such an object the module names the keys for the owner's username, the post's time in seconds, the caption and the image candidates of the first media item. Each stored field is compared exactly, after the normalization it was stored with:

| Field | Agrees when |
|---|---|
| owner | the account of the post's own link (section 4) equals the answer's owner username, both in lower case without a leading `@` |
| post time | the post's `time[datetime]` and the answer's time are the same whole second in UTC |
| caption | after NFC normalization and collapsing whitespace, a complete caption equals the answer's caption, and a caption the page cut equals the start of the answer's caption, without the "more" control and a trailing ellipsis; a post without a caption agrees only with an answer without one |
| first image | the address of the response the image was taken from equals one of the candidate addresses the answer lists for the first media item |

A field has no second source when no answer names the code or the object lacks the field's key. Two answers that name the code with different values for a field make that field disagree. The comparison runs in memory, sends no request, and never stores or prints a value or an address.

**Automatic acceptance.** An order with `acceptCanary: true` accepts its canary only when 5 canary comments are confirmed and each of them passes all of these; a comment skipped because it is not confirmed (IG-6 and IG-7) is not a confirmation and counts toward neither the 5 nor a failure:

1. the comment is confirmed by the four checks of section 4, or its post through the comments list (IG-8, 2026-10-18);
2. the page showed the owner and the post time, and owner, post time and caption each agree with their second source;
3. the first image is stored, and its response address is one of the answer's candidates;
4. the screenshot is stored within its 400 KB limit;

and when the whole run had no unexpected action and its read-back shows the same account and the same extension IDs, none added and none removed. The run checks after each canary comment and stops at the first failure, accepting nothing. A field without a second source ends it with `CANARY_NO_SECOND_SOURCE`, a field or image address that disagrees with `CANARY_MISMATCH`, and every other failed check with `CANARY_CHECK_FAILED`. As on X, the shared run then ends with `error`, and the CLI-local audit keeps the code as its display end reason. From there only a canary the person accepts with **Matches**, or a new order card, moves the workspace on.

When every check passes, the run writes `canaryAcceptedAt` and sets `accepted_by` in `browser_order_audit` to `'automatic-check'`, as on X. The audit's data holds only counts: comments confirmed, fields compared and agreed per field, images matched, screenshots stored, unexpected actions, and extension IDs added and removed. The table's check on `accepted_by` stays as it is.

Before a full run, the first canary on real Instagram must show:

1. the date filter set through its dropdown lists with every value read back, and a filtered list with rows for a day years back (amended 2026-10-16, IG-5);
2. for the oldest planned comment, the oldest-first list beginning within a week of it, and that comment confirmed, on its post or through the comments list (IG-8, 2026-10-18), which shows the list reaches the oldest comments;
3. at least one comment confirmed, by all four checks or through the comments list, how many of each, and each other result with its code;
4. expansion controls found again and clicked within the limit when the comment was hidden;
5. owner, caption and post date read; the first image taken from the page's own response with no request of SocialPrune's; a screenshot of at most 400 KB that shows the post;
6. the account check from the rows;
7. a read-back with the same account, no added extension ID, removed IDs recorded, the changed profile files listed, Instagram's requests other than `GET` listed with their operation names, no `UNEXPECTED_ACTION`, and aborted hosts counted;
8. no lock or limit notice during the run, and the account working normally afterwards, which only the person can check;
9. for each stored field and the first image, whether a second source was found and whether it agreed, in the structure report.

An automatic acceptance covers points 3, 5 and 7 and the agreement of point 9 for every canary comment. Points 1, 2, 4 and 6 are read from the report and the end reason by whoever reviews the report before the first full run, and point 8 stays with the person. When a point fails, the next run stays a canary and the maintainer decides. The fake page and the selectors are updated from the structure report, never from a real page's content.

### 12. Tests

- **Fake Instagram.** A local site in `apps/cli/e2e/fake-instagram/`, built from a generated Instagram export under `fixtures/synthetic/instagram/`, never from a real page or export. Each post page also receives a generated JSON answer from the fake's Instagram host that names the post's code with its owner, time, caption and image candidates; per case the answer can be left out, lack one key, or carry a different value for one field or a different image address. Its comments view has rows as S5 describes them, with no `href`; the default order loads nothing on scroll, oldest first loads batches; "Sort & filter" with both orders, the six dropdown lists of the start and the end date as the third canary found them (no labels, headings matched without regard to letter case, the end date's lists ending at the fake's current day, entries that depend on the lists before them) and "Apply", disabled until an order is chosen (amended 2026-10-16), filtering in a zone the test chooses, including UTC+14 and UTC-12; a fresh load and a row click reset the order as on Instagram. Its post pages mirror the fifth canary's page (amended 2026-10-17): an address without the closing slash, one `main` without `article`, `header` or lists, the post's own link `/<owner>/p/<code>/` with the post's time, a case whose own links name two accounts, a caption with and without "more", comments whose block three levels above the permalink holds a row with the profile link and the permalink with `time` and a row with the text in a `dir="auto"` span (corrected 2026-10-17), a caption block with an unlinked time, a plain text span and "See translation", and "Load more comments" and "View replies" that replace their nodes, so a stale handle fails. Generated cases cover a confirmed comment; one hidden behind several clicks; equal text with the time two minutes off; a different owner; the person's equal text twice within a minute; an edited comment; a reel; a video post without an image; a post that is not available; and a window with more rows than 10 scrolls load. Further pages show the sign-in page, a challenge, a checkpoint, "Try again later", "Something went wrong", a German page, a 429 and a list that never answers. The page sends a `POST` whose operation name ends in `Query` (recorded, no stop), one ending in `Mutation` without a click (aborted, `UNEXPECTED_ACTION`), a request to a foreign host (aborted and counted) and a WebSocket.
- **Required proofs**, each as a named test that fails against code without the guard before it counts: without an order, nothing opens on Instagram before **Start**; the fake records every input event, and a key or text event, or an `input` or `change` event on anything but the six filter lists, fails the test; the fake records every clicked element, and one outside section 1's list fails it, a click on a dropdown list included; a choice of an entry a list does not offer is refused before the choice, and a value that does not read back stops the run with `filter-control` (amended 2026-10-16); the fake watches its document, and a node or style added by SocialPrune fails it; each failed check settles `unconfirmed` with its code and writes no record; manual comments are never planned, `--include` cannot plan them, and the plan hash changes when a marked comment changes; a `sending` record is committed before the step's first navigation, an interrupted attempt becomes `failed` with `INTERRUPTED`, and nothing is `ambiguous`; the day's count includes Instagram steps only, and an X run on the same day leaves it unchanged, and the other way round; the first image is taken without a second request for its address, which the fake CDN counts; the screenshot stays within its limit; comments of other people planted in the fake never reach the workspace, with the forbidden values taken from the fixture data (LL-2026-10-002); the canary report holds none of the fixture's texts, usernames, codes or times; an X profile is refused and an Instagram profile is refused by X's commands.
- **Required proofs for adoption**, held to the same rule: `--adopt` refuses a missing directory, a directory without a `Local State` file, a directory that already has a marker for either platform, a profile in use, a symbolic link or junction, and a directory inside the browser's default user-data location, and after each refusal every file in the directory has the bytes and modification time it had before; a successful adoption writes the marker naming `instagram` with its time and prints it, while every other file keeps its bytes and modification time and the browser launcher, replaced by a recorder in the test, is never called; setup without `--adopt` still refuses an existing directory; and `browser setup` refuses an `--order` flag.
- **Required proofs for the canary under an order**, held to the same rule: an order without `acceptCanary` and without an accepted canary refuses with `CANARY_REQUIRED` before the browser starts; an order with it accepts only when every automatic check passes, and then writes `canaryAcceptedAt` and `accepted_by` `'automatic-check'` with counts only; a missing second source for any one field refuses with `CANARY_NO_SECOND_SOURCE`; a different value for any one field, or an image address not among the candidates, refuses with `CANARY_MISMATCH`; 15 canary comments without 5 confirmations (IG-6 and IG-7, 2026-10-17), a screenshot over its limit, an unexpected action, or an added or removed extension ID refuses with `CANARY_CHECK_FAILED`; in every refusal `canaryAcceptedAt` stays empty and no full run starts; and the canary report and the audit hold none of the fixture's values or addresses.
- **Required proofs for IG-8 and the settled read (2026-10-18)**, held to the same rule: a comment of the person's that the fake post keeps beyond 10 loads, with one equal row in the filtered list and the export's owner on the post, confirms with `confirmedBy: 'list'`, no comment ID and no permalink time, and the canary accepts it under an order when its other checks pass; the same comment with a row Instagram cut, with two equal rows, with a post of another owner, with own links naming two accounts, or with a first profile link naming another account stays unconfirmed with its code and writes no record; a block with the export's text two minutes off settles `time` and never confirms through the list; a post whose own link disappears for a moment right after it first appears is read again and confirms, and a post whose markup stays missing for the 30 seconds stops with `post-structure`; the review shows the mark on a post confirmed through the list and no comment link for it.
- **Required proofs for IG-9 (2026-10-19)**, held to the same rule: a fake list whose newest rows include rows shaped like comment rows under another name, with the navigation linking the person's profile and most rows under the person's name, runs on, counts those rows in the structure report and never takes one as a candidate, also when such a row carries the export's text exactly; a list whose navigation links another account's profile and no link to the person's, a list without that link, and a list where half or more of the non-empty rows show another name each stop with `ACCOUNT_MISMATCH` before the first click, both in the first load of a step and after the date filter; the red control of the old rule, every row under the person's name, fails on the first of these fakes.
- **IG-15 A proof amendment, 2026-10-22.** The preceding IG-9 proof's half-or-more refusal is superseded by a refusal when no row shows the expected name; a matching profile with two rows, one own and one under another name, now passes, including after the date filter, while missing or different profile links still stop.
- **Review server.** Over real sockets, the context route returns 200 for a listed file, 401 without the session, 403 with a foreign `Sec-Fetch-Site`, and 404 for traversal, a file no record lists, a link and a file whose first bytes do not match. In Chromium, Firefox and WebKit against the real review server, the card shows owner, caption, image, the screenshot after **Show screenshot** and the link; the Pages app keeps each surface's sentence of section 9.
- **No network.** ADR-013's zero-network test adds `context instagram --dry-run` with and without `--json`, its `--help` and a bad flag. A test asserts the host rules and the view address exactly, and that the fakes cannot be selected from the production entry. An import-graph test keeps the context code out of every command except `context instagram`. The packed package's smoke test runs the dry run.
- No test contacts Instagram ([ADR-023](ADR-023-acting-in-own-account.md) PA-15).

### 13. Changes to other records

| Record | New wording |
|---|---|
| ADR-013 | The command tree gains `context instagram`. Its dry run makes no network call; its run follows the run rules of ADR-027. |
| ADR-014 | Agents may run `context instagram --dry-run --json`. With the person's written order for exactly `context-instagram` they may start its `--order` run, which runs the canary and accepts it by the automatic checks of section 11 only when the order says `acceptCanary: true`. Only after the person's own confirmation that names it they may run `browser setup --platform instagram --adopt`. Nothing else of this record. |
| ADR-016 | The HTTP API gains `getInstagramContext`, and the server gains the context route of section 9. The page policy does not change. If ADR-025 is accepted first, the same change applies to it. |
| ADR-018 | The packed package's smoke test runs `context instagram --dry-run --json`. |
| ADR-023, proposed | PA-1 gains a second written-order scope, `context-instagram`, for reading only (IG-3 point 3). It needs a canary the person accepted, unless the order says `acceptCanary: true`; then the order runs the canary and accepts it only when every automatic check of section 11 passes, as AUTO-1 does on X. PA-8 gains this record's pace for Instagram reading, counted apart from X, the same in both modes. |
| ADR-027, proposed | `browser setup` takes `--platform instagram`; the profile marker names its platform and a profile serves one platform. `--adopt` writes the marker into an unmarked Instagram profile under the conditions of section 6. |
| ADR-030, proposed | The record, the journal changes and schema version 5. |

**Decision made by:** maintainer
**Approved on:** 2026-10-16

## Consequences

### Positive
- A comment is linked to a post only when the post shows the person's text under their name, at the exported time and owner, so the wrong links S5 found by text alone cannot be kept. Since IG-8 (2026-10-18) a post the comment does not show on can also be confirmed through the person's own comments list, by an exact row, the row's own link and the owner check; such a record is marked and holds no comment ID, and a post that shows anything that disagrees is never confirmed that way.
- The person keeps, for each confirmed comment, the post it answered, with its image and a screenshot, before anything is deleted.
- The later deletion record starts from a post code and a permalink for each confirmed comment.

### Negative
- Comments without text or owner, close pairs and every unconfirmed comment stay manual, and the dry run shows how many.
- At 200 steps a day the pass takes days, and a comment with several candidates takes more steps.
- The walk depends on the date filter, whose dropdown lists the third canary found but which nobody in this project has applied yet, and on English labels.
- The screenshot holds other people's names and words as Instagram showed them; it stays local, but it is in the workspace folder.

### Risks
- **Instagram limits or locks the account.** Mitigation: ADR-023's rules, IG-3's pace, a stop at the first notice, the canary first. This lowers the chance; it cannot settle Instagram's judgment.
- **Instagram treats the dropdown choice differently from a person's.** Playwright fires the lists' `input` and `change` events itself, and the page can see that they did not come from a device. Mitigation: the run hides nothing about it, reads every value back and stops with `filter-control` when one does not hold, the canary comes first, and IG-3's pace and stop rules apply. This lowers the chance; it cannot settle Instagram's judgment (amended 2026-10-16).
- **A write Instagram's page sends on its own stops every run.** Mitigation: the canary lists the operation names; only the maintainer can mark one as background.
- **The view or the post page changes.** Mitigation: unknown states stop the run, the next run is a canary, and the fake follows the structure report.
- **An automatic acceptance passes a canary a person would have rejected.** Mitigation: every stored field must agree exactly with a second source on the same page, a field without one refuses, the structure report is read before any full run, and the order must say `acceptCanary: true`. What remains is a risk to the local records, not to the account, because the pace and the stop rules are the same in both modes.
- **Instagram's answers carry none of the fields under the keys the selectors module names.** Mitigation: the canary stops with `CANARY_NO_SECOND_SOURCE`, the structure report names the key paths where equal values were found, and until the module is updated only the person's **Matches** accepts a canary.

## Open questions for the maintainer

- **Your veto on IG-3** is still open. This revision follows IG-3 as confirmed.

Answered on 2026-10-16: the date filter needs no typed dates; its dates are dropdown lists, and the run chooses their entries (IG-5, option A).

Answered since 2026-10-11: S5 ran read only on your account (IG-1, then IG-2 B); the deletion pace is 10 per batch, at least 15 minutes, at most 50 a day (IG-1); comments not confirmed stay manual (IG-1, IG-3 point 1); a small screenshot of each confirmed post is kept (IG-1, IG-3 point 2).

Not asked separately, by the parent session's decision of 2026-10-15: whether you accept the canary by hand or the order accepts it by the automatic checks. Both are built, and the order card you confirm before any reading names which one, in your words.

## Superseded on 2026-10-19

IG-9 replaced this sentence of section 7. It is kept here unchanged:

- **Account check.** The rows of the first list a run loads show the username of the signed-in account. Every row must show the expected username, else the run stops with `ACCOUNT_MISMATCH`.

## Superseded on 2026-10-18

IG-8 replaced these sentences. They are kept here unchanged:

- Section 5: **The confirmation.** The comment's ID from its permalink, its time, and how many expansion clicks it needed.
- Section 11, automatic acceptance: 1. the comment is confirmed by the four checks of section 4;
- Section 11, first real canary: 2. for the oldest planned comment, the oldest-first list beginning within a week of it, and that comment confirmed on its post, which shows the list reaches the oldest comments;
- Section 11, first real canary: 3. at least one comment confirmed by all four checks, and each other result with its code;

## Superseded on 2026-10-17

The fifth canary's page shape replaced these sentences of the decision of 2026-10-16. They are kept here unchanged.

- Section 4: After the click, the run waits up to 30 seconds for an address `https://www.instagram.com/p/<code>/` or `/reel/<code>/`, with `<code>` of 1 to 64 characters from `[A-Za-z0-9_-]`, and for the post's markup, whether Instagram shows it as a page or as a dialog over the list, or for a known page state.
- Section 4, owner check: the first account named in the post's header equals the export's `Media Owner`, compared in lower case without a leading `@`
- Section 4: A collaboration post names more than one account in its header; the first one must be the export's owner, and the canary counts how often the header names several accounts.
- Section 5: **The post's account.** The text of the first profile link in the post's header, and how many accounts the header names.
- Section 5: **The post's date.** The `time[datetime]` inside the link to the post itself, never one inside a `/c/` link.
- Section 11, owner comparison: the header's first account equals the answer's owner username, both in lower case without a leading `@`

Later the same day, structure probes showed that the comment block sentence written that morning was wrong; the text row lies one level higher. These sentences of the 2026-10-17 amendment were corrected, and are kept here unchanged:

- Fifth-canary paragraph: each comment's permalink `/p/<code>/c/<id>/` held a `time[datetime]`, and its block two levels up held one profile link whose text is the username.
- Section 4: On the fifth canary each permalink's block was the element two levels above it, holding exactly one such profile link, and the comment text was the outermost `dir="auto"` span outside any link that is not the relative age (amended 2026-10-17).
- Section 12: comments whose block two levels above the permalink holds the profile link, the text in a `dir="auto"` span and the permalink with `time`,

IG-6 replaced these sentences the same day. They are kept here unchanged:

- Section 1: click a comment row to open its post, and on a post click "Load more comments" and "View replies".
- Section 11, the canary: It reads up to 5 comments, first the oldest planned comment, then the next four in plan order, one step at a time.
- Section 11, automatic acceptance: An order with `acceptCanary: true` accepts its canary only when every canary comment passes all of these:
- Section 12, required proofs for the canary under an order: an unconfirmed canary comment, a screenshot over its limit,

IG-7 replaced these IG-6 sentences the same evening. They are kept here unchanged:

- Section 11, the canary: until 5 are confirmed; a comment that ends `not-shown` after the expansion, or `unavailable`, stays manual and the canary takes the next one, at most 15 comments in all, and a canary that reaches 15 without 5 confirmations ends with `CANARY_CHECK_FAILED` (IG-6, 2026-10-17).
- Section 11, automatic acceptance: a comment skipped as `not-shown` or `unavailable` under IG-6 is not a confirmation and counts toward neither the 5 nor a failure:
- Section 12, required proofs: an unconfirmed canary comment other than one skipped as `not-shown` or `unavailable`, 15 canary comments without 5 confirmations (IG-6, 2026-10-17),

## Superseded on 2026-10-16

IG-5 replaced these sentences of the decision of 2026-10-15. They are kept here unchanged, in the order they stood.

- Section 1: It may navigate to `https://www.instagram.com/your_activity/interactions/comments`, click "Sort & filter", "Oldest to newest", "Newest to oldest", "Start date", "End date", the date filter's own controls for choosing a month, a year and a day, and "Apply", scroll the list,
- Section 1: The names are English; their exact form for the date filter's own controls comes from the canary's structure report (section 11), and the fake page mirrors a plain calendar until then.
- Section 3, step 2: Open "Sort & filter", choose "Oldest to newest", set "Start date" to the day before the export's time and "End date" to the day after, both as UTC calendar days, and click "Apply".
- Section 3: If the canary shows that the filter cannot be set with clicks alone, the run stops with `INSTAGRAM_SHAPE_CHANGED`, because IG-2 B excludes typing, and the maintainer decides (Open questions).
- Section 11, the canary: the confirmation page shows, as counts and yes or no: whether the filter was set by clicks alone, the rows in the window,
- Section 11, point 1: the date filter set with clicks only, and a filtered list with rows for a day years back;
- Section 12: "Sort & filter" with both orders, a calendar set by clicks and "Apply",
- Section 12: the fake records every input event, and a key, input or text event fails the test; the fake records every clicked element, and one outside section 1's list fails it;
- Negative: The walk depends on the date filter, which nobody in this project has used yet, and on English labels.
- Risk: **The date filter cannot be set by clicks.** Mitigation: the run stops with `INSTAGRAM_SHAPE_CHANGED` instead of typing, and the maintainer decides.
- Open question: **Only if the canary shows the date filter needs typed dates:** may the run type the two dates into the filter, and nothing else? IG-2 B excludes typing. Until you answer, the run stops there.

## Superseded on 2026-10-15

The text below is the decision of 2026-10-11, unchanged. It is kept so the path can be traced. Sections 1 to 13 above replace it, and a later record replaces its deletion part. Where a heading below says "Decision" or "We chose", it means the decision of 2026-10-11. The options A to D above keep their text of that day; only their headings moved one level down.

### Header, context and drivers of 2026-10-11

These lines stood at the top of the record until the revision and were reworded there.

- **Date:** 2026-10-11
- **Hard constraints touched:** 4 (both actions [ADR-023](ADR-023-acting-in-own-account.md) allows, on Instagram), 3 (only the person's own delete decisions), 1 (no developer account, no key, the installed browser), 5 (the warning and the "matched, not confirmed" label make no promise), 6 (tests use a local fake page, never Instagram)
- **Supersedes in part, on acceptance:** [ADR-006](ADR-006-workspace-event-log.md), [ADR-007](ADR-007-review-data-worker.md), [ADR-013](ADR-013-cli-framework-output.md), [ADR-014](ADR-014-agent-interface.md), [ADR-015](ADR-015-cli-storage-node-baseline.md), [ADR-016](ADR-016-local-review-server.md). The section "Changes to accepted records" gives the new wording. It builds on the schema version 3, the journal and the narrow writer of [ADR-027](ADR-027-x-deletion-browser.md), which must be accepted first.
- **Related:** [ADR-012](ADR-012-time-zone-grouping.md), [ADR-023](ADR-023-acting-in-own-account.md), [ADR-026](ADR-026-x-originals-fetch.md)

From the context: "An Instagram comment in the export has three fields: the comment text (`Comment`), the time (`Time`) and the owner of the post it was written on (`Media Owner`). It has no link to the post and no post ID (`packages/adapter-instagram/src`). The click list therefore groups comments by day and tells the person to find them with Instagram's own date filter." And, after the research list: "Whether the "Your Activity" view shows, for each comment, the post it belongs to, and in what form, was not observed by anyone in this project."

The decision drivers:

- Keep the context of each comment, the post it answered, before the comment is deleted, where the page shows it.
- Never delete a comment that is not the one the person marked: the export has no ID to match by, so every match must be checked and labelled as a match.
- Follow every rule of [ADR-023](ADR-023-acting-in-own-account.md): own account, human decisions only, one entry first, journal, stop at the first error, slow, nothing hidden.
- Prove the page's behavior on the person's account, read only, before writing any deletion code.

From the evidence:

- `packages/adapter-instagram/src` at commit `5fb9c54`: comments carry `Comment`, `Time` and `Media Owner`, and no post link.
- The reports of temporary limits after about 100 deletions were collected by the research on 2026-10-11; none states a measured limit, and their sources are added to S5's write-up when the maintainer reads them.
- The S5 thresholds, the pace and the time figures are this record's choices and arithmetic, not measurements. No request to Instagram was made for this record.

### Decision of 2026-10-11

We chose **Option A: drive the "Your Activity" comments view in the dedicated profile**, gated by spike S5. Until S5 passes and its report is accepted, Option D stays the only way, and no Instagram deletion code is written. If S5 shows that the view does not let a row be matched to an export comment reliably, this record is withdrawn and Option D stays.

Needs the maintainer's decision: the scope for spike S5 on his own account, and the three questions under "Open questions for the maintainer". No deletion code is written before S5 passes.

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

### Consequences of 2026-10-11

#### Positive
- Where the view shows it, the person keeps the post each comment answered, and deletes the comments they marked without selecting each one by hand.
- Every link between a comment and a post says that it is a match, and only unique matches are ever deleted.

#### Negative
- Comments that are ambiguous or unmatched stay manual, possibly many of the short ones.
- At 50 a day, a few hundred comments take a week or more.
- Everything rests on one Instagram view whose structure nobody in this project has looked at yet.

#### Risks
- **Instagram limits or locks the account.** Mitigation: ADR-023's rules, batches of 10, 15-minute gaps, 50 a day and a stop at the first notice. This lowers the chance; it cannot settle Instagram's judgment.
- **A wrong comment is deleted.** Mitigation: only unique matches qualify; each row is re-read before selecting and after selecting; any difference stops the run; S5 must confirm 19 of 20 sampled matches on the post itself.
- **The view changes.** Mitigation: unknown page states stop the run; S5's markup notes and the fake page are updated together.

### Open questions of 2026-10-11

- May S5 run read-only on your Instagram account, in a profile folder you name, reporting only counts? Answer yes and name the folder, or no.
- Default pace: 10 comments per batch, at least 15 minutes between batches, at most 50 a day. Accept, or name slower numbers? Answer "accept" or the numbers.
- Comments the tool cannot match to exactly one row stay for you to delete by hand with the click list. Agreed? Answer yes or no.
- Keep the thumbnail screenshot of each matched post? Answer yes or no.

## Evidence

- [Spike S5](../../spikes/S5.md), run by the maintainer's parent session on 2026-10-14 and 2026-10-15: the row structure, the click that opens a post, the reset after going back, the sort and its loading, the permalink with its time, the 20 of 20 and 18 of 20 results, the expansion clicks and the aborted hosts. The facts S5's write-up does not list (the row's `aria-label` and image, the exact labels of "Sort & filter", the re-query after each expansion click, the `wbloks` answers, the aborted hosts and the probe's host list) were reported by the parent session from the same probes on 2026-10-15.
- `packages/adapter-instagram/src` at commit `5fb9c54`: comments carry `Comment`, `Time` and `Media Owner`, and no post link. At commit `77c60bc` the item keeps `ownerHandle` as `null` when the record has none, and the item's text can be empty.
- Account keys begin with their platform, `x:` or `instagram:`, in `packages/adapter-x/src/index.ts` and `packages/adapter-instagram/src/index.ts` at `77c60bc`.
- Meta, Instagram Graph API and Basic Display API documentation; Instagram oEmbed documentation; Instagram, [Terms of Use](https://help.instagram.com/581066165581870). Observed 2026-10-11 by the research; the maintainer's reading pending.
- Scripts for the comments view, observed by the architect in search results on 2026-10-11: iamceeso, [instagram-bulk-comment-deleter](https://github.com/iamceeso/instagram-bulk-comment-deleter) (MIT); batuhd, [instagram-bulk-comment-deleter](https://github.com/batuhd/instagram-bulk-comment-deleter) (MIT, 10 comments per cycle, 20 seconds between cycles); sbolel, [instagram-comment-activity-deleter](https://github.com/sbolel/instagram-comment-activity-deleter) (dry run by default, batches of 3); braunglasrakete, [Instagram Comment Activity Deleter gist](https://gist.github.com/braunglasrakete/837a136af79b43f1de8af41170849601) (smaller batches against "Something went wrong", English page language). All name the view `https://www.instagram.com/your_activity/interactions/comments`. The maintainer's reading pending.
- The reports of temporary limits after about 100 deletions were collected by the research on 2026-10-11; none states a measured limit.
- The pace is IG-3's. The window of a day on either side, the limits on scrolls, clicks, candidates, caption length, image and screenshot size, and the time figures are this record's choices and arithmetic, not measurements. No request to Instagram was made for this record.

# ADR-027: Deleting the person's own X entries through their signed-in browser session

- **Status:** Proposed
- **Date:** 2026-10-11
- **Hard constraints touched:** 4 (the second action [ADR-023](ADR-023-acting-in-own-account.md) allows), 3 (only the person's own delete decisions; outcomes record their source), 1 (no developer account, no key; the installed browser), 5 (the warning makes no promise), 6 (tests use a local fake site, never X)
- **Supersedes in part, on acceptance:** [ADR-005](ADR-005-browser-storage.md), [ADR-006](ADR-006-workspace-event-log.md), [ADR-007](ADR-007-review-data-worker.md), [ADR-011](ADR-011-internationalization.md), [ADR-013](ADR-013-cli-framework-output.md), [ADR-014](ADR-014-agent-interface.md), [ADR-015](ADR-015-cli-storage-node-baseline.md), [ADR-016](ADR-016-local-review-server.md), [ADR-017](ADR-017-shared-workspace-service.md), [ADR-018](ADR-018-cli-distribution.md). The section "Changes to accepted records" gives the new wording. How a partial change is recorded is an open question in ADR-023.
- **Related:** [ADR-002](ADR-002-dependency-licenses.md), [ADR-012](ADR-012-time-zone-grouping.md), [ADR-023](ADR-023-acting-in-own-account.md), [ADR-026](ADR-026-x-originals-fetch.md), [ADR-028](ADR-028-instagram-signed-in-session.md), [ADR-029](ADR-029-signed-in-originals-pass.md), [ADR-031](ADR-031-desktop-app.md)

Revision candidate of 2026-10-24. The maintainer chose ADR-DEL v2 A at 10:31:43Z, accepting the four points and code alignment below. V2 supersedes v1. The source baseline is `bf8843f`, including DEL-1, D2 and D5, plus D6 and D7's one targeted warning/restore revision. This behavior decision does not accept the record or authorize a platform run; a separate acceptance card is still required.

Decided by the maintainer on 2026-10-11: automated deletion of his own X entries, with the risk of a locked or suspended account accepted ("Probier's auch dann ... das mit den automatischen ... auch mit dem Risiko, das ist mir klar"), and without X's paid developer API.

Needs the maintainer's decision: this record's separate acceptance and the remaining questions below. ADR-DEL v2 A's behavior is decided; the record stays Proposed.

## Context

The person marks entries for deletion in the review. Today the X click list and its delete mode open one entry at a time on X, and the person deletes it there by hand. Each entry costs at least one page and two clicks, and nobody has measured how long a few hundred take.

The export gives for each entry its ID and kind: `post`, `reply`, `quote` or `repost` (`packages/adapter-x/src/tweet.ts`). A repost carries its own ID and the original author's handle, not the ID of the original post. The click list already sends the person to `https://x.com/i/web/status/<id>` with the action "Delete post" or "Undo repost" (`packages/adapter-x/src/index.ts`).

What the research of 2026-10-11 found about free deletion on X, without any request to X from this lane:

- **Cyd** 1.2.4 (Lockdown Systems, GPL-3.0) runs a browser the person signs in to and calls X's internal requests from that session. Its free tier removes all posts at once; choosing which posts to delete is a paid feature. Its maintainers report accounts suspended even when the tool stayed within rate limits.
- **TweetXer** 0.10.3 (a "Do No Harm" license, which GitHub lists as unrecognized) runs as a script in the person's own X tab and calls X's internal requests.
- **tweetdelete** (backzso, MIT, last push 2026-09-30) runs in the person's signed-in tab, takes the post IDs from the archive, calls X's internal `DeleteTweet` request with at least 400 ms between calls, and stops on 403 or 404.
- One report found by the research describes deleted posts appearing again days later.
- X's Automation rules, as of April 2026, forbid scripting the website and allow permanent suspension.
- No source gives a pace that was measured to keep an account free of limits.

`AGENTS.md` allows GPL and "Do No Harm" projects as sources of ideas only. MIT code may be reused with a notice.

## Decision Drivers

- Delete exactly the entries the person marked, verify each one, and record what happened.
- Follow every rule of [ADR-023](ADR-023-acting-in-own-account.md), in particular: nothing hidden or spoofed (PA-9), stop at the first error (PA-7), slow (PA-8), the person watches the first entry (PA-5).
- Handle posts, replies, quotes and reposts with the data the export has.
- Keep working when X changes small things, and fail loudly when it changes big things.
- No new paid or downloaded component; the web app stays without network access.

## Options

### Option A: Call X's internal delete requests from the page

As tweetdelete, Cyd and TweetXer do: in the signed-in tab, build the `DeleteTweet` and `DeleteRetweet` requests and send them with the page's cookies.

**Pros:**
- One request per entry, precise by ID, fast; the response body tells whether X deleted the post.
- Proven by the existing tools; tweetdelete's MIT code could be read and reused with a notice.

**Cons:**
- The tool builds requests that X's own code did not send. To look like X's client it has to copy or recompute the headers X's code adds; recomputing a header X uses to tell its own client from others is the kind of disguise ADR-023 PA-9 forbids. Whether X requires such a header for these requests today was not checked; this is an inference.
- Undoing a repost needs the original post's ID, which the export does not have, and the request names change when X ships a new web build.

**Effort:** not measured
**Risk:** High for the account and for maintenance.

### Option B: Drive X's own pages in the dedicated profile, and read X's answers

SocialPrune drives the installed Chrome or Edge through `playwright-core` with the dedicated profile ([ADR-023](ADR-023-acting-in-own-account.md)). For each entry it opens the post's page and does the clicks a person would do: "More", "Delete", confirm; or for a repost the repost button and "Undo repost". X's own code sends the request. SocialPrune only reads X's answer to it and the page that follows.

**Pros:**
- SocialPrune sends nothing of its own to X: every request comes from X's page code, so there is nothing to copy or recompute, and the person can watch every click.
- Reposts work through the same page the click list already uses, without the original's ID.

**Cons:**
- Slower: one page load per entry, so more requests to X in total than option A.
- Breaks when X changes its page structure or labels; each such change stops the run until the selectors module is updated.

**Effort:** not measured
**Risk:** High for the account; Medium for maintenance.

### Option C: A script the person pastes into their own X tab

**Pros:**
- No browser automation and no profile to manage.
- Runs in the person's normal browser.

**Cons:**
- The journal would live in the X tab, and X's page policy limits what the script can send to SocialPrune; a crash loses the record of what was sent.
- Pasting scripts into the console is what scams ask people to do; teaching it is harmful.

**Effort:** not measured
**Risk:** High.

### Option D: Stay with the click list

**Pros:**
- No automation risk.
- Already built.

**Cons:**
- Does not meet the maintainer's decision.
- Each entry stays a manual task.

**Effort:** none
**Risk:** Low.

## Decision

We chose **Option B: drive X's own pages in the dedicated profile and read X's answers**, because it is the only automated option that sends nothing X's own code did not send, handles reposts with the export's data, and lets the person watch. Option A is faster and is what the known tools do; it is rejected because it requires imitating X's client, which ADR-023 PA-9 rules out.

### Commands

```text
socialprune browser setup  --platform x --profile <dir> [--browser chrome|edge]
socialprune delete x --workspace <dir> --account <key> --dry-run [--handle <name>] [--list <file>] [--include <file>] [--json] [--lang en|de]
socialprune delete x --workspace <dir> --account <key> --profile <dir> --plan <hash> [--handle <name>] [--list <file>] [--include <file>] [--per-day <n>] [--without-originals] [--browser chrome|edge] [--lang en|de]
socialprune delete x --workspace <dir> --account <key> --profile <dir> --verify [--handle <name>] [--per-day <n>] [--browser chrome|edge] [--lang en|de]
socialprune delete x --workspace <dir> --account <key> --profile <dir> --acknowledge-warning <runId> [--handle <name>] [--lang en|de]
socialprune browser forget --profile <dir>
```

`browser setup` and `browser forget` follow ADR-023, "The dedicated browser profile".

Setup opens an ordinary installed browser as a child process, with the dedicated folder and sign-in URL but without Playwright, a debugging connection or an automation flag. The person signs in by hand. On 2026-10-12 the maintainer's earlier Playwright-driven Edge setup displayed an unsupported `--no-sandbox` warning, X would not progress through sign-in, and Google sign-in refused the browser. He closed it without signing in. No real sign-in was attempted by a development agent. This separation removes the driver only from manual setup, not from any platform run.

A local launch inspection on 2026-10-12 found that the installed Playwright 1.63.0 omitted `--enable-automation` from its default Chromium arguments and added `--disable-infobars`. Program-driven runs therefore explicitly pass `--enable-automation` and exclude the banner-suppression switch. This makes program control visible; it does not change the user agent, hide `navigator.webdriver` or remove the debugging connection. The same test reads the running fake-site browser's command line and confirms the sandbox flag is not disabled.

### Which entries

An entry enters the plan only when all of these hold (ADR-023 PA-3):

1. platform X, in the account given with `--account`;
2. its current decision is `delete`, from a decision event with `source.kind: 'human'`;
3. its current outcome is `unknown`;
4. no unresolved `sending` or `ambiguous` attempt exists for it; `--include` never overrides this block, and only read-only verification settles it;
5. its latest attempt is neither `not-found` nor `failed`, unless the person names the item in `--include` (one `x:<id>` item ID per line), and it still meets 1 to 4. A verified `not-deleted` result may enter a new plan without that override.

Posts, replies and quotes get the action "delete post"; reposts get "undo repost".

Undo-repost still has a real-page uncertainty. The generated status-page case stops with `focal-count` before any click when the requested repost ID does not match the original post's timestamp link. V's finding of 2026-10-23 did not prove that the real status page exposes the repost entry as the selector requires. The watched first undo-repost canary must settle that before a main run; an unrecognized page stops without becoming a warning-day lock.

### Dry run

`--dry-run` reads the workspace only: no browser, no profile, no network, no writes except the list file the person names.

- **The list.** One row per entry: date in the workspace time zone ([ADR-012](ADR-012-time-zone-grouping.md)), kind, action, the first line of its text with control characters removed, the time of its current delete decision, that decision's `via`, and whether it came from a single or a bulk action. Above the rows: how many entries came from bulk actions. The list goes to the terminal when stdout is a terminal, or into the file named with `--list`; the command refuses to overwrite a file.
- **`--json`** gives counts, the plan hash, the time estimate and the warning, never entry text, and refuses `--list`. Agents may run it ([ADR-014](ADR-014-agent-interface.md)).
- **The plan hash** is SHA-256 over the workspace calendar day, effective zone and displayed rows sorted by item ID, including item and decision-event IDs, date, kind, action, first line, decision time, source and single/bulk origin. D7, checked on 2026-10-24, therefore rejects yesterday's plan with `STALE_PLAN` before navigating X even if the entries did not change. A new day requires a fresh dry run.
- **The estimate** at the default pace below, and the warning of ADR-023.

### A run

1. **Not for pipes.** The run refuses `--json` and refuses unless stdout is a terminal (`NOT_INTERACTIVE`, exit 2).
2. **Plan check.** It recomputes the plan hash; a different hash stops it (`STALE_PLAN`, exit 1).
3. **Profile check.** The folder has the SocialPrune marker for X (`PROFILE_INVALID`, exit 2). The browser is the installed Chrome or Edge, started visible through `playwright-core`, which talks to it over a pipe, not a network port (`BROWSER_NOT_FOUND`, exit 1, when neither is installed). Its launch passes `chromiumSandbox: true`, so Playwright does not add `--no-sandbox`. It retains `--enable-automation`, the remote-debugging pipe, `navigator.webdriver` and all other marks of program control; none is removed or masked. Playwright's `--disable-extensions` stays active; only `--disable-infobars` is ignored. A new Edge profile installs default extensions on first start, as observed on 2026-10-12. On 2026-10-13 the first driven launch was observed to remove those default folders with extensions disabled. A preinstalled set is therefore recorded and allowed; removed IDs do not stop the run. An ID absent from the before set, including the new side of a replacement, stops with `PLATFORM_CHECK` at every checkpoint. Manifests and extension contents are never read. The same launch rule holds for read-only verify and originals-fill. Snapshot, durable before/after and removed/added ID-set read-back and "what a run can change" follow ADR-023.
4. **Confirmation page.** The first tab shows a page the run serves on `127.0.0.1` at a random port. The run opens it through `playwright-core` with a random 256-bit page token in the fragment, so the token never appears on stdout, stderr or in a log. The page shows the counts, the bulk count, the first 20 rows with the path of the full list, the time estimate, what the run can change, and the warning, with a **Start** button. English is the default; `--lang de` translates every page label, button and status. A same-origin stylesheet provides spacing and a visible primary action, without inline styles or scripts. Its requests follow [ADR-016](ADR-016-local-review-server.md): exact `Host` and `Origin`, `Sec-Fetch-Site: same-origin` when present, no CORS, JSON bodies only, the token in a header, the unchanged local-review page policy. A second-origin stylesheet or connection remains blocked. Nothing is sent to X before the person clicks **Start**.
5. **Account check.** A second tab opens X. The run reads the signed-in account from X's page and compares it with the export's account (`ACCOUNT_MISMATCH`, exit 1).

For a desktop run, ADR-031 section 10 replaces the terminal restriction and the loopback confirmation page with the app window and the engine's shared confirmation state. The person's Start, canary Continue and Stop actions stay human actions; the platform remains in the installed browser beside the app. This exception does not give the HTTP review page or an agent a deletion start path.

The 2026-10-13 structure-only diagnosis showed that `domcontentloaded` precedes X's script-rendered navigation. Delete and verify now wait at most 20 seconds for a visible account switcher or a login/challenge/lock/limit marker, then run the block checks and require one account name. The initial account check is the only `/home` navigation; read-back uses the switcher on the current status page. A conversation can contain many tweet articles. The focal article is exactly the `article[data-testid="tweet"]` containing the requested status URL's link and a `time` element; only its More or repost control is used. Ambiguous focal or timestamp matches still stop.

The same diagnosis observed page requests to `grok.com` and `ton.twimg.com`, which the existing allowlist rejected while the post still loaded. The allowlist is unchanged. Every rejected host is still aborted and counted in `abortedHosts` in the CLI-owned profile report; an abort is not a performed account action and no longer triggers a stop by itself. Requests that act on the allowed account origin retain their separate stop rules. This is not permission to contact another host.
6. **One entry first.** The oldest "delete post" entry, then, if the plan has reposts, the oldest "undo repost" entry, each alone. After each, the confirmation page shows the result with a link to the post and the buttons **Continue** and **Stop**.
7. **The paced run.** One entry at a time, then the pauses below. The confirmation page shows progress and keeps **Stop**. The terminal shows counts only.
8. **End.** At the daily cap, at the end of the plan, on **Stop**, on Ctrl+C or at the first error. The run writes its end reason and the profile read-back. Before waiting, the terminal prints a plain end-reason line telling the person to close the X window. The confirmation page continues to show that final state until the person closes the window; the server closes afterwards. Messages are English by default or German with `--lang de`. The first real canary on 2026-10-13 exposed the previous silent wait after early server closure; no further platform steps run during the visible ended state.

2026-10-13: An export without the account file supports `--handle`, compared with the signed-in account before reading or deleting an entry, because the account file also holds private fields.

### One entry

1. **Check before acting.** In one transaction ([ADR-015](ADR-015-cli-storage-node-baseline.md)), re-read the entry: its current delete decision is still the plan's event and its outcome is still `unknown`. If not, append an attempt with state `withdrawn` and move on without opening the post.
2. **Open.** Navigate to `https://x.com/i/web/status/<id>`. If X shows that the post does not exist, record `not-found` and move on. If the page is a login, a challenge, a lock or limit notice, or anything the selectors module does not recognize, stop the run (`PLATFORM_CHECK`, exit 1).
3. **Journal.** Append an attempt with state `sending` and commit, before the first click that can change anything.
4. **Click.** For "delete post": the post's "More" menu, "Delete", then the confirmation. For "undo repost": the post's repost button, then "Undo repost". The selectors live in one module. They prefer the page's stable test attributes, fall back to accessible names in English and German, and are checked against the page before each click; a missing element stops the run.
5. **Read X's answer.** After the last click, the run waits up to 30 seconds for the response to the request X's page sends (`DeleteTweet` or `DeleteRetweet`). It records only the method, path, status and the shape of the body (its keys, not its values).
   - `deleted`: status 200, a JSON body with `data` and without `errors`, and the page shows X's own confirmation.
   - `ambiguous`: every result after the final click that lacks both the accepted response and the page confirmation. This includes a non-200 status, an `errors` member, invalid JSON, a missing confirmation, a page check or warning, no response within 30 seconds, navigation away or browser closure. Any receipt already read is retained, and the run stops. These are D2's implemented rules of 2026-10-23, not a claim that a failed response proves no deletion happened.
6. **Shape lock.** The body shape that the first entry of each action produced is stored with the run. A later answer with a different shape is `ambiguous` with `SHAPE_CHANGED` and stops the run. It never counts as a confirmed deletion.
7. **Outcome.** For `deleted`, the settling transaction also appends an outcome event `deleted-via-browser` (below).

There are no deletion retries. Unresolved `sending` and `ambiguous` records block resending even with `--include` (ADR-023 PA-6); `failed` requires the explicit inclusion described above. On a later run, recovery acts only on a positively dead owner: delete and verify attempts become `ambiguous` with `PROCESS_LOST`; fill attempts become `failed` with `INTERRUPTED`, preserving their original IDs. A live, unknown or unproven owner blocks with `WORKSPACE_BUSY`. D2 added the mode-specific recovery on 2026-10-23.

### Pace, DEL-1 stages

DEL-1 Tempo A, decided on 2026-10-20 and implemented on 2026-10-23, replaces the original single-stage pace. The figures below are chosen bounds, not measured website limits. The research cited by ADR-DEL v2 was read on 2026-10-20: X's developer interface publishes 50 deletions per 15 minutes, and the compared tools stop on a 429 or warning and pause for 50 to 60 minutes. Neither establishes a tested limit for deletion through X's website.

| Stage | Entry condition | Minimum interval between starts | Daily cap |
|---|---|---|---|
| A1 | initial stage, or reset under the rule below | 30 seconds | 200 |
| A2 | 100 consecutive directly confirmed deletions in this account's journal | 15 seconds | 300 |
| A3 | A2's hundred plus a current `DeleteTweet` window whose remaining capacity above half can hold every projected 8-second start until reset | 8 seconds | 500 |

Only direct `deleted` settlements in the sending run with a status-200 response receipt count toward the hundred; later read-only verification does not. When the `DeleteTweet` evidence is absent, expired or insufficient, A3 falls back to A2, not a new promotion by elapsed time. An explicit `--per-day` lowers the active cap; at `209c895` that CLI flag itself accepts only 1 to 200, even when the automatic stage cap is higher. Waits stay fixed, never randomized. Each new day needs a fresh dry run.

#### Four points accepted as ADR-DEL v2 A on 2026-10-24

1. After every 20 deletions, pause for 15 minutes, in all three stages.
2. Every deletion X does not confirm, and every stop except `done`, `daily-cap` or `stopped-by-person`, resets the next stage to A1 and the hundred to zero.
3. Every warning sign, including HTTP 429 or a limit or warning notice, stops the run immediately. The next run starts at the earliest on the next day, at A1, after the person receives a card.
4. Reading and deletion assign their shared daily counter's day using the workspace time zone. For the maintainer's workspace that zone is Berlin. With no saved zone, both use the effective system zone of the plan.

The card says "Nach je 20 Löschungen". The batch therefore counts directly confirmed deletions, not pages opened, not-found results or verification. A later verification settlement is not a new deletion. V2 also says "Wo der Code davon abweicht, passe ich ihn an"; D6 aligns the implementation instead of accepting the earlier differences.

Source comparison and D6 corrections on 2026-10-24, against `bf8843f` plus this revision:

1. Before D6 the batch counted opened entries, including `not-found` and earlier verify starts. It now counts only `deleted` settlements with a status-200 receipt, bound to a sending attempt in that same deletion run. The in-run counter advances only after that settlement. The journal carries confirmations across restarts and midnight; a gap of at least 15 minutes clears the batch, not a day change. The pause precedes another deletion; a completed plan does not idle just to display a pause. All stages use the same 20/15-minute settings.
2. Before D6, `finish(run)` preceded reports and the final view, so a later error could leave a clean stored end. D6 writes the deletion or verification end once after reports, final projection and browser/confirmation cleanup. A failure in any of those paths persists `error`; a crash before that write leaves an active run for dead-owner recovery. Exceptional X endings reset promotion, but D7 treats a normal fill `canary` end like `done`: reading shares the daily counter and does not manufacture or erase clean deletions. Verification never adds to or repairs the hundred.
3. Only warning signs set the day/card gate. D7 classifies HTTP 429, a recognized limit notice or a recognized warning notice at the stop site as `http-429`, `limit-notice` or `warning-notice`, and records `warningKind` with the completed X `platform-check` run. Login, challenge, account mismatch, page language, invalid profile, added extension, unrecognized focal page and render-timeout do not set it merely because they stop. A classified fill or verify warning also gates the next deletion, not reading or verification. A same-day deletion refusal is `X_WARNING_DAY`; missing acknowledgement later is `X_WARNING_CARD_REQUIRED`. Database lookup reads only its gate table, never reinterprets arbitrary historical `platform-check` runs.
4. Fill's day checks, pace text and desktop counter now use the plan's workspace zone, as deletion already did. The generated UTC boundary case reads both pages instead of counting a prior-day deletion as today; a Berlin workspace retains its previous boundary. The day still counts page opens, including retries, not only deletions; the confirmed-deletion batch is a different counter.

#### Warning card acknowledgement

The smallest enforceable card step is a separate terminal command, not an override flag on a deletion run. On or after the next workspace day, the person runs `delete x --workspace <dir> --account <key> --profile <dir> --acknowledge-warning <warnedRunId>` and types exactly `I read the card for <warnedRunId>`, or `Ich habe die Karte zu <warnedRunId> gelesen` with `--lang de`. Input must be a terminal; the latest outstanding database/profile warning's run ID must match. This opens no browser and permits no deletion. The person then makes a fresh dry run and uses the normal Start and canary controls. The lock holds deletion only, not reading or verification.

The warning record retains its original zone and day as well as its timestamp. Admission requires both that original day and the day recomputed in the current workspace zone to have passed, so a zone change cannot shorten the imposed delay. The CLI verifies the typed statement, not delivery or reading of an external card. The parent must present the card first; an agent must not acknowledge it for the person. The desktop currently has no acknowledgement control and refuses until the terminal step is recorded. A newer warning needs its own acknowledgement.

The CLI also writes `socialprune-x-warning.json` next to `socialprune-profile.json`, outside Chromium's own data. Its closed fields are run ID, warning kind, workspace day and zone, and created time, with no post content or account session. It is included in the disclosed profile changes and snapshot comparison. The file is checked together with the database before every deletion start, including a different or newly restored workspace, and removed only by acknowledgement. If the workspace lacks the warned run, acknowledgement imports the marker's closed reset evidence before clearing it. The profile itself is not read by an agent.

`backup restore` refuses to replace a workspace with an unacknowledged warning using `X_WARNING_RESTORE_BLOCKED`, whose message names the acknowledgement command. A backup carrying a classified warning end reconstructs the gate once in the staging database before replacement. Ordinary `platform-check` ends do not reconstruct one. A portable backup carries `warningKind`, not local acknowledgement; old backups lack that classification and cannot infer it. Restoring an older backup or creating a fresh workspace still cannot delete through the same profile until its marker is acknowledged. Remaining gap: `browser forget` removes the dedicated profile, so a newly created profile together with an older or fresh workspace has no retained marker or warning-classified history. The CLI does not claim a cross-profile account lock.

#### Rate windows and reports

At `209c895`, checked on 2026-10-23, deletion and fill share the per-operation reader of numeric `x-rate-limit-limit`, `x-rate-limit-remaining` and `x-rate-limit-reset` on `x.com` and `api.x.com`. Before another deletion, the runner reserves one request so a known window is not crossed below half. A reset at most 16 minutes away yields a cancellable wait to reset plus five seconds; a longer low window ends as `daily-cap` with `x-window-long`. A wait is not a retry, and it cannot permit another attempt at an ambiguous deletion. Any HTTP 429 stops immediately.

The CLI prints a closed `Stop detail` token and writes `socialprune-delete-<runId>.json` or `socialprune-verify-<runId>.json` in its dedicated profile. These reports contain window numbers and the closed stop record, not response contents. D2 added verify reports and the detailed final message on 2026-10-23. Desktop views carry the same stage bounds and rate wait. The implementation proofs use generated data; this candidate starts no real-account run.

#### Shared daily counter, accepted v2 A point 4

The counter includes this account's signed-in fill, delete and verify page opens, with older attempts used when a run has no page count. D6 uses the workspace zone for all three, or the plan's system fallback when no zone is saved. This implements v2 A point 4, accepted on 2026-10-24, and replaces fill's former hardcoded Berlin boundary. It does not change the stage-specific daily cap or turn a page open into a confirmed deletion.

### Verify

`delete x --verify` reads, without clicking anything:

- every unresolved `sending` or `ambiguous` attempt: if X shows the post as gone, the attempt is settled as `deleted` and the outcome is recorded; if the post is still there, it is settled as `not-deleted` and the entry can enter the next plan;
- every entry deleted at least 7 days earlier and not yet checked: `still-gone`, or `reappeared`, which appends an outcome event `unknown` with the browser source, so the entry shows up as not deleted and can enter the next plan.

Verify pace at `209c895`, checked on 2026-10-23: one page every 10 seconds, at most 100 pages per day, with the same warning stops and no deletion clicks or retries. These are chosen code limits, not measured platform limits.

### Journal and outcomes

The deletion journal introduced two record types and one outcome value in schema 3 on 2026-10-11. The shared types at `bf8843f` plus D7, checked on 2026-10-24, are in `packages/core/src/model/browser.ts`. D7 adds the optional closed `warningKind` to completed X warning-classified runs so restore need not guess from `endReason`. Writers retain schema version 8 and readers here accept the field; an earlier strict schema-8 reader may reject a backup containing it. CLI-local gate/acknowledgement tables and the profile mirror are not portable records. In this summary `?` means optional, and IDs and times retain their core schema validation:

```ts
BrowserRun = {
  runId, platform: 'x' | 'instagram', accountKey,
  mode: 'delete' | 'verify' | 'fill' | 'context',
  planHash: string | null, startedAt, endedAt: UtcTimestamp | null,
  endReason: 'done' | 'daily-cap' | 'stopped-by-person' | 'error' | 'platform-check'
           | 'canary' | 'size-cap' | 'shape-changed' | null,
  bodyShapes: Record<string, string[]>,          // per action, the keys of the first success body
  profileReport: {                                 // written once, at the end
    accountBefore, accountAfter, extensionsBefore: number, extensionsAfter: number,
    changedFiles: string[],
    unexpectedRequests: { runId?, requestId, method, host, path, status, operation? }[]
  } | null,
  ownerPid?: number,
  canaryAcceptedAt?: UtcTimestamp | null,
  pageOpens?: number,
  lastPageOpenedAt?: UtcTimestamp | null
  warningKind?: 'http-429' | 'limit-notice' | 'warning-notice'
}
BrowserAttempt = {
  seq, attemptId, runId, itemId: string | null, originalId?: string | null,
  action: 'delete-post' | 'undo-repost' | 'verify' | 'read-post' | 'confirm-comment',
  state: 'withdrawn' | 'sending' | 'deleted' | 'not-found' | 'failed' | 'ambiguous'
       | 'not-deleted' | 'still-gone' | 'reappeared' | 'read' | 'tombstone'
       | 'unavailable' | 'confirmed' | 'unconfirmed' | 'not-listed',
  settles: string | null,                          // the attemptId this record settles, if any
  at, code: string | null,
  receipt?: { method, path, status, shape: string[] }
}
```

- An attempt is one `withdrawn` or `not-found` record, or one `sending` record followed by at most one settling record. A verify attempt is one record; when it settles an ambiguous attempt, it also appends a settling record for that attempt whose `settles` names it.
- The outcome event for a deletion: `value: 'deleted-via-browser'`, `previous` from the entry's current outcome in the same transaction, `source: { kind: 'human', via: 'browser-x' }`, `action: { id: <settling attemptId>, kind: 'single', size: 1, reverts: null }`. The settling attempt names the run. There is no `source.kind: 'browser'` in the built model.
- `deleted-via-browser` is final: the click lists show no outcome buttons for it, and the protocol's `outcome` command rejects a change with `OUTCOME_FINAL`. Only a verify `reappeared` moves it back to `unknown`.
- **Narrow writer.** `BrowserOutcomeWriter` in `apps/cli/src/workspace/browser-journal.ts` appends run and attempt records and only these two outcome values with `via: 'browser-x'`. It has no method for decision events or other outcome values. The CLI and desktop engine use it through the same runners (ADR-023 PA-16).
- **Profile read-back.** The expected state-changing requests for X are the page's `DeleteTweet` and `DeleteRetweet` requests. Every other non-GET request to X's hosts during the run is listed in `unexpectedRequests` and shown to the person.

### Schema history and current version 8

The new outcome value did not fit version 2's enum. Version 3 introduced the journal on 2026-10-11; version 4 added X fill, versions 5 and 6 Instagram context, version 7 the review-feed contract and version 8 Instagram's owner-check migration on 2026-10-23. At `bf8843f`, checked on 2026-10-24:

- `WORKSPACE_SCHEMA_VERSION` is 8. Current backups carry `browserRuns`, `browserAttempts` and their counts, with the shared types above. Readers accept versions 1 to 8; writers write 8. The version 2 to 3 migration added empty journal arrays and counts; later migrations keep them while adding their own records.
- **Both stores carry them.** SQLite has `STRICT` tables `browser_runs` and `browser_attempts`. Run progress may increase its page counter while active; end fields are written once, with the separate one-time canary-acceptance update allowed for fill and context. Attempts are append-only, with triggers against `UPDATE` and `DELETE`. IndexedDB uses `runId` for runs and `attemptId` for attempts, with unique `seq` and `settles` indexes on attempts. The browser carries restored journal records rather than running a platform action. Backup and restore preserve their order and apply the migrations required by the file's version.
- **Reader checks.** Counts match; `seq` increases and never repeats; every attempt names a run and the target its action permits. A fill `read-post` names an original and has `itemId: null`; deletion and verification name X items; `confirm-comment` names an Instagram comment in a context run. Outcome events with `via: 'browser-x'` link through `action.id` to exactly one matching `deleted` settlement or `reappeared` verification. An Instagram context run is not a deletion run, and the current action enum has no `delete-comment`.

### Who reads `deleted-via-browser`

- the web workspace: state derivation, projection, counts and the outcome filter ([ADR-007](ADR-007-review-data-worker.md));
- the review grid and the card review: the badge "Deleted by SocialPrune in your browser" (German "Von SocialPrune in deinem Browser gelöscht"), apart from "Deleted by you";
- the X click list and its delete mode, in the web app and in local review: the entry counts as done and has no outcome buttons;
- `export clicklist` in CSV, JSON and NDJSON: the outcome and its source;
- `summary`: outcome counts per value and source;
- the archive: the badge for entries deleted on the platform;
- the backup writer and reader in both stores;
- the plan selection of this command.

### Isolation in the code

- `apps/cli/src/browser/` holds the driver, profile procedure and confirmation state and page; `browser/x/` holds X's steps and selectors. The named CLI commands and ADR-031's internal engine entry reach the runners; setup launches the installed browser without a driver. Import-boundary tests keep browser control out of unrelated commands, the HTTP review server, `packages/mcp` and the web renderer. The desktop bridge invokes the engine, not browser code in the renderer.
- The runner navigates only to URLs it builds from one pinned origin, `https://x.com`, and an entry's numeric ID; a test checks the constant and the URL builder. The runner itself sends no request to X. The browser loads whatever X's page loads, on that page's behalf.

### Tests

- A fake X site in `apps/cli/e2e/fake-x/`, written for this purpose with generated content, serves a post page, the menu, the confirmation, a repost, a not-found page, a login page, a challenge page, a limit notice, and fake `DeleteTweet` and `DeleteRetweet` endpoints that answer with success, an error body, a changed shape, a slow answer and no answer.
- The tests drive Playwright's bundled Chromium against that site, through the same runner code with the hosts taken from the test context. A test proves that the production entry cannot select the fake hosts.
- Required proofs: `withdrawn` when the decision changed; stop on login, challenge, limit notice, unknown page, error body, changed shape; `ambiguous` on timeout and never resent; verify settles ambiguous both ways; `reappeared` moves the outcome back; daily cap; the token never on stdout or stderr; the confirmation page rejects foreign Host and Origin; nothing is sent to the fake X before **Start**.
- No test contacts X.

### Changes to accepted records

| Record | New wording |
|---|---|
| ADR-005 | Two IndexedDB stores, `browserRuns` and `browserAttempts`, introduced in version 3 and carried from restores through current version 8. |
| ADR-006 | Outcome value `deleted-via-browser`, source `{ kind: 'human', via: 'browser-x' }` linked through `action.id` to the settling attempt, and the journal with its version 3 migration and current version 8 types; the outcome is final except for a verified reappearance. |
| ADR-007 | The outcome enum and filters gain the value; `outcome` rejects a change to a final outcome with `OUTCOME_FINAL`. |
| ADR-011 | Catalog keys for the badge, the confirmation page and the warning of ADR-023 in both languages, under the catalog and copy checks. |
| ADR-013 | The command tree gains `browser setup`, `browser forget` and `delete x`. There is no approve, decide or mark command. Deletion acts only on human delete decisions, starts after human Start on the loopback page or in ADR-031's desktop app, and never writes a decision event. The network rule follows ADR-026. A daily-cap end exits 0 and names the reason. |
| ADR-014 | Agents may run `delete x --dry-run --json`. They never run `delete x` without `--dry-run`, `browser setup` or `browser forget`, never read the profile folder, never edit run or attempt records. The skill says so. The MCP server in 0.2 gets no deletion tool. |
| ADR-015 | `STRICT` tables `browser_runs` and `browser_attempts` as above; the check before each entry in one `BEGIN IMMEDIATE` transaction; a layout migration for schema version 3. |
| ADR-016 | The confirmation page reuses its request controls and page policy. The review server and its opener do not change; the confirmation page is opened by `playwright-core` in the dedicated window. |
| ADR-017 | `ReviewService` appends human review decisions and outcomes; the CLI's `BrowserOutcomeWriter` appends only `deleted-via-browser` and verified-reappearance `unknown` outcomes with `via: 'browser-x'`, plus journal records, never decision events. CLI and desktop runs share it. |
| ADR-018 | The package gains the runtime dependency `playwright-core` 1.63.0 (Apache-2.0, no dependencies of its own), kept outside the bundle and loaded only by the browser commands; the package files gain the confirmation page assets; the packed smoke test runs `delete x --dry-run --json` and never a run. |

[ADR-002](ADR-002-dependency-licenses.md) needs no exception: `playwright-core` is Apache-2.0, and the browser is the one already installed, so rule 6 on downloaded artifacts does not apply.

**Decision made by:** maintainer
**Approved on:** pending

## Consequences

### Positive
- The person's marked posts, replies, quotes and reposts are deleted without a click per entry, each one checked against X's own answer and written down.
- Nothing SocialPrune sends imitates X's client, and the person can watch every step.

### Negative
- Daily caps and batch pauses spread large plans over several runs; the elapsed duration has not been measured on a real deletion run.
- The selectors module breaks with larger changes to X's pages; until it is updated, runs stop at the first entry.
- The npm registry reported `playwright-core` 1.63.0 as 13,453,369 bytes unpacked on 2026-10-11; the person also needs Chrome or Edge.
- The journal began in schema 3; current backups use schema 8 and the accepted records listed above need their stated amendments. Warning admission and acknowledgement stay CLI-local and must be kept with that workspace.

### Risks
- **X locks or suspends the account.** Mitigation: ADR-023's rules, the documented pace and immediate warning stops. No measured relation between this website pace and restrictions is established; X can act regardless.
- **A click hits the wrong element.** Mitigation: the run opens one post per page, checks that the post on the page has the entry's ID before the first click, and checks each element before clicking it; a mismatch stops the run.
- **X reports success but the post comes back.** Mitigation: the verify pass after 7 days, and the outcome moves back to `unknown` when it does.
- **An agent starts the run.** Mitigation: the CLI refuses pipes and desktop confirmation requires the person's Start; neither offers a written-order deletion path. An agent that can control the person's screen is software running as the person, outside what SocialPrune can control.

## Open questions for the maintainer

- Delete by clicking through X's own pages, slower but without imitating X's app, instead of sending X's internal requests directly like the other tools do? Answer "clicks" or "requests".
- Accept this corrected record separately from the behavior already chosen as ADR-DEL v2 A? The warning-card mechanism and its CLI-local storage limits are stated above; choosing A on v2 did not accept the document.
- Undo your reposts the same way, on the original post's page? Answer yes or no.
- Check again 7 days after deleting, because one report says deleted posts can come back? Answer yes or no.

## Evidence

- Lockdown Systems, [Cyd](https://github.com/lockdown-systems/cyd): GPL-3.0, last push 2026-10-08, read through the GitHub API by the architect on 2026-10-11. Version 1.2.4, the free and premium features, and the maintainers' reports of suspensions within rate limits: observed 2026-10-11 by the research; the maintainer's reading pending.
- Luca Hammer, [TweetXer](https://github.com/lucahammer/tweetXer): license not recognized by GitHub ("Do No Harm" per the research), last push 2026-01-10, read through the GitHub API by the architect on 2026-10-11. Version 0.10.3 and its method: observed 2026-10-11 by the research; the maintainer's reading pending.
- backzso, [tweetdelete](https://github.com/backzso/tweetdelete): MIT, last push 2026-09-30, read through the GitHub API by the architect on 2026-10-11. Its method (archive IDs, `DeleteTweet` from the page, at least 400 ms between calls, stop on 403 or 404) and the report of deleted posts appearing again: observed 2026-10-11 by the research; the maintainer's reading pending.
- X, [Automation rules](https://help.x.com/en/rules-and-policies/x-automation), April 2026 version: scripting the website is forbidden and can lead to permanent suspension. Observed 2026-10-11 by the research; the maintainer's reading pending.
- Code at commit `5fb9c54`: `packages/adapter-x/src/tweet.ts` (kinds; reposts keep `repostOfHandle`, not the original's ID) and `packages/adapter-x/src/index.ts` (click-list actions and status URL).
- `playwright-core` 1.63.0 on the npm registry: Apache-2.0, no dependencies, 13,453,369 bytes unpacked; read by the architect on 2026-10-11.
- The pace and time figures are chosen limits and arithmetic. No request to X was made for this record.
- Code checked on 2026-10-23 at `209c895`: `apps/cli/src/browser/x/delete-pace.ts` (hundred and stages), `browser/pace.ts` and `runner.ts` (batch carry, windows, late-error ordering and reports), `browser/plan.ts` (eligibility), `browser/x/driver.ts` (post-click ambiguity), `workspace/browser-journal.ts` (recovery and outcome source), `engine/facade.ts` (desktop confirmation), and `packages/core/src/model/browser.ts` and `index.ts` (journal types and schema 7). No code or real-account state was changed for this candidate.
- D6, 2026-10-24: source at `bf8843f` plus this revision and generated tests cover confirmed-deletion batch carry, report/view/close errors persisted before final finish, HTTP and page-warning admission, next-day typed acknowledgement and the workspace-zone counter. `commands/delete.ts`, `workspace/browser-journal.ts`, `browser/runner.ts`, X fill and `engine/facade.ts` are the enforcement owners. Schema 8 is unchanged. No real account or signed-in profile was used.
- D7, 2026-10-24: `warningKind` is an optional closed addition to the schema-8 run shape, with the strict-reader compatibility caveat above. `workspace/x-warning-file.ts` owns the profile mirror; `services.ts` rebuilds classified gates only in restore staging and refuses replacement of an unacknowledged workspace. Negative generated tests cover ordinary platform-check stops, a fill canary, older/fresh workspaces and the next-day plan hash. Any-response and downloaded-media 429 cases prove the two fill warning paths. No real profile or platform was used.

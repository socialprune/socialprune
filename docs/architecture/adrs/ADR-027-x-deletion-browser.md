# ADR-027: Deleting the person's own X entries through their signed-in browser session

- **Status:** Proposed
- **Date:** 2026-10-11
- **Hard constraints touched:** 4 (the second action [ADR-023](ADR-023-acting-in-own-account.md) allows), 3 (only the person's own delete decisions; outcomes record their source), 1 (no developer account, no key; the installed browser), 5 (the warning makes no promise), 6 (tests use a local fake site, never X)
- **Supersedes in part, on acceptance:** [ADR-005](ADR-005-browser-storage.md), [ADR-006](ADR-006-workspace-event-log.md), [ADR-007](ADR-007-review-data-worker.md), [ADR-011](ADR-011-internationalization.md), [ADR-013](ADR-013-cli-framework-output.md), [ADR-014](ADR-014-agent-interface.md), [ADR-015](ADR-015-cli-storage-node-baseline.md), [ADR-016](ADR-016-local-review-server.md), [ADR-017](ADR-017-shared-workspace-service.md), [ADR-018](ADR-018-cli-distribution.md). The section "Changes to accepted records" gives the new wording. How a partial change is recorded is an open question in ADR-023.
- **Related:** [ADR-002](ADR-002-dependency-licenses.md), [ADR-012](ADR-012-time-zone-grouping.md), [ADR-023](ADR-023-acting-in-own-account.md), [ADR-026](ADR-026-x-originals-fetch.md), [ADR-028](ADR-028-instagram-signed-in-session.md)

Decided by the maintainer on 2026-10-11: automated deletion of his own X entries, with the risk of a locked or suspended account accepted ("Probier's auch dann ... das mit den automatischen ... auch mit dem Risiko, das ist mir klar"), and without X's paid developer API.

Needs the maintainer's decision: the four questions under "Open questions for the maintainer".

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
socialprune delete x --workspace <dir> --account <key> --dry-run [--list <file>] [--include <file>] [--json]
socialprune delete x --workspace <dir> --account <key> --profile <dir> --plan <hash> [--include <file>] [--per-day <n>] [--browser chrome|edge]
socialprune delete x --workspace <dir> --account <key> --profile <dir> --verify
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
4. no earlier attempt for it ended `not-found` or `ambiguous`, unless the person names it in a file passed with `--include` (one item ID per line), and it still meets 1 to 3.

Posts, replies and quotes get the action "delete post"; reposts get "undo repost".

### Dry run

`--dry-run` reads the workspace only: no browser, no profile, no network, no writes except the list file the person names.

- **The list.** One row per entry: date in the workspace time zone ([ADR-012](ADR-012-time-zone-grouping.md)), kind, action, the first line of its text with control characters removed, the time of its current delete decision, that decision's `via`, and whether it came from a single or a bulk action. Above the rows: how many entries came from bulk actions. The list goes to the terminal when stdout is a terminal, or into the file named with `--list`; the command refuses to overwrite a file.
- **`--json`** gives counts, the plan hash, the time estimate and the warning, never entry text, and refuses `--list`. Agents may run it ([ADR-014](ADR-014-agent-interface.md)).
- **The plan hash** is SHA-256 over the canonical JSON of the rows sorted by item ID, each with the item ID and the event ID of its current delete decision.
- **The estimate** at the default pace below, and the warning of ADR-023.

### A run

1. **Not for pipes.** The run refuses `--json` and refuses unless stdout is a terminal (`NOT_INTERACTIVE`, exit 2).
2. **Plan check.** It recomputes the plan hash; a different hash stops it (`STALE_PLAN`, exit 1).
3. **Profile check.** The folder has the SocialPrune marker for X (`PROFILE_INVALID`, exit 2). The browser is the installed Chrome or Edge, started visible through `playwright-core`, which talks to it over a pipe, not a network port (`BROWSER_NOT_FOUND`, exit 1, when neither is installed). Its launch passes `chromiumSandbox: true`, so Playwright does not add `--no-sandbox`. It retains `--enable-automation`, the remote-debugging pipe, `navigator.webdriver` and all other marks of program control; none is removed or masked. Playwright's `--disable-extensions` stays active; only `--disable-infobars` is ignored. A new Edge profile installs default extensions on first start, as observed on 2026-10-12. On 2026-10-13 the first driven launch was observed to remove those default folders with extensions disabled. A preinstalled set is therefore recorded and allowed; removed IDs do not stop the run. An ID absent from the before set, including the new side of a replacement, stops with `PLATFORM_CHECK` at every checkpoint. Manifests and extension contents are never read. The same launch rule holds for read-only verify and originals-fill. Snapshot, durable before/after and removed/added ID-set read-back and "what a run can change" follow ADR-023.
4. **Confirmation page.** The first tab shows a page the run serves on `127.0.0.1` at a random port. The run opens it through `playwright-core` with a random 256-bit page token in the fragment, so the token never appears on stdout, stderr or in a log. The page shows the counts, the bulk count, the first 20 rows with the path of the full list, the time estimate, what the run can change, and the warning, with a **Start** button. English is the default; `--lang de` translates every page label, button and status. A same-origin stylesheet provides spacing and a visible primary action, without inline styles or scripts. Its requests follow [ADR-016](ADR-016-local-review-server.md): exact `Host` and `Origin`, `Sec-Fetch-Site: same-origin` when present, no CORS, JSON bodies only, the token in a header, the unchanged local-review page policy. A second-origin stylesheet or connection remains blocked. Nothing is sent to X before the person clicks **Start**.
5. **Account check.** A second tab opens X. The run reads the signed-in account from X's page and compares it with the export's account (`ACCOUNT_MISMATCH`, exit 1).

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
   - `failed`: a status other than 200, an `errors` member, or a notice on the page. The run stops.
   - `ambiguous`: no response within 30 seconds, the page navigated away, or the browser closed. The run stops.
6. **Shape lock.** The body shape that the first entry of each action produced is stored with the run. A later answer with a different shape counts as `failed` and stops the run, so a change on X's side cannot silently count as success.
7. **Outcome.** For `deleted`, the settling transaction also appends an outcome event `deleted-via-browser` (below).

There are no retries. An `ambiguous` or `failed` entry is never sent again on its own (ADR-023 PA-6).

### Pace

| Setting | Default and maximum |
|---|---|
| time between the start of two entries | at least 30 seconds |
| entries per batch | 20 |
| pause after each batch | 15 minutes |
| entries per calendar day, in the workspace time zone | 200; `--per-day` can lower it, not raise it |

At this pace a day's 200 entries take about four hours, and 3,000 entries take 15 days. These numbers are chosen limits, not measured ones: no source shows what pace X tolerates, and Cyd's maintainers saw suspensions within X's rate limits. Waits are fixed, never randomized (ADR-023 PA-9). Each new day starts with a new dry run, so the person sees the remaining list again.

### Verify

`delete x --verify` reads, without clicking anything:

- every entry whose last attempt is `ambiguous`: if X shows the post as gone, the attempt is settled as `deleted` and the outcome is recorded; if the post is still there, it is settled as `not-deleted` and the entry can enter the next plan;
- every entry deleted at least 7 days earlier and not yet checked: `still-gone`, or `reappeared`, which appends an outcome event `unknown` with the browser source, so the entry shows up as not deleted and can enter the next plan.

Verify pace: one page every 10 seconds, at most 100 pages per day, with the same stop rules.

### Journal and outcomes

The workspace gains two record types and one outcome value:

```ts
BrowserRun = {
  runId, platform: 'x' | 'instagram', accountKey, mode: 'delete' | 'verify',
  planHash: string | null, startedAt, endedAt: UtcTimestamp | null,
  endReason: 'done' | 'daily-cap' | 'stopped-by-person' | 'error' | 'platform-check' | null,
  bodyShapes: Record<string, string[]>,          // per action, the keys of the first success body
  profileReport: {                                 // written once, at the end
    accountBefore, accountAfter, extensionsBefore: number, extensionsAfter: number,
    changedFiles: number, unexpectedRequests: { method, host, path, status }[]
  } | null
}
BrowserAttempt = {
  seq, attemptId, runId, itemId,
  action: 'delete-post' | 'undo-repost' | 'delete-comment' | 'verify',
  state: 'withdrawn' | 'sending' | 'deleted' | 'not-found' | 'failed' | 'ambiguous'
       | 'not-deleted' | 'still-gone' | 'reappeared',
  settles: string | null,                          // the attemptId this record settles, if any
  at, code: string | null
}
```

- An attempt is one `withdrawn` or `not-found` record, or one `sending` record followed by at most one settling record. A verify attempt is one record; when it settles an ambiguous attempt, it also appends a settling record for that attempt whose `settles` names it.
- The outcome event for a deletion: `value: 'deleted-via-browser'`, `previous` from the entry's current outcome in the same transaction, `source: { kind: 'browser', runId, attemptId }`, `action: { kind: 'single', size: 1, reverts: null }`.
- `deleted-via-browser` is final: the click lists show no outcome buttons for it, and the protocol's `outcome` command rejects a change with `OUTCOME_FINAL`. Only a verify `reappeared` moves it back to `unknown`.
- **Narrow writer.** `BrowserOutcomeWriter` in `packages/core/src/workspace/` appends run and attempt records and only these two outcome events with a browser source. It has no method for decision events or other outcome values. Only the browser runner constructs it (ADR-023 PA-16).
- **Profile read-back.** The expected state-changing requests for X are the page's `DeleteTweet` and `DeleteRetweet` requests. Every other non-GET request to X's hosts during the run is listed in `unexpectedRequests` and shown to the person.

### Schema version 3

A new outcome value and a new source kind do not fit version 2's enums, which version 2 readers reject. So:

- `schemaVersion: 3`. `WorkspaceV3` adds `browserRuns` and `browserAttempts` after `outcomeEvents` (and after `originals` when present, [ADR-026](ADR-026-x-originals-fetch.md)), and `counts.browserRuns`, `counts.browserAttempts`.
- Migration from version 2 adds the empty arrays and zero counts and changes nothing else. Readers accept versions 1, 2 and 3; writers write 3. A version 2 reader meets a version 3 file with `WORKSPACE_SCHEMA_UNSUPPORTED` (exit 3).
- **Both stores carry them verbatim.** SQLite: `STRICT` tables `browser_runs` (the end fields may be written once, enforced by a trigger) and `browser_attempts` (append-only, triggers against `UPDATE` and `DELETE`). IndexedDB: stores `browserRuns` (key `runId`) and `browserAttempts` (auto-increment key, unique index on `seq`, indexes on `attemptId`, `itemId`, `runId`). The browser never writes them; it keeps what a restore brings, and backup and restore copy them in order in both directions.
- **Reader checks.** Counts match; `seq` increases and never repeats; every attempt names an existing run and item; the attempt structure above holds; every outcome event with `source.kind: 'browser'` and value `deleted-via-browser` names a `deleted` settling record for the same item, and every `deleted` record has exactly one such event; every browser `unknown` event names a `reappeared` verify attempt.

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

- `apps/cli/src/browser/` holds the `playwright-core` driver, the profile procedure and the confirmation page server; `apps/cli/src/browser/x/` holds the X steps and the selectors module. Only `apps/cli/src/commands/delete.ts` and `apps/cli/src/commands/browser.ts` import them, and they load `playwright-core` with a dynamic import only in run, verify and setup modes. A `no-restricted-imports` rule and an import-graph test keep them out of other commands, the review server, `packages/mcp` and `apps/web`.
- The runner navigates only to URLs it builds from one pinned origin, `https://x.com`, and an entry's numeric ID; a test checks the constant and the URL builder. The runner itself sends no request to X. The browser loads whatever X's page loads, on that page's behalf.

### Tests

- A fake X site in `apps/cli/e2e/fake-x/`, written for this purpose with generated content, serves a post page, the menu, the confirmation, a repost, a not-found page, a login page, a challenge page, a limit notice, and fake `DeleteTweet` and `DeleteRetweet` endpoints that answer with success, an error body, a changed shape, a slow answer and no answer.
- The tests drive Playwright's bundled Chromium against that site, through the same runner code with the hosts taken from the test context. A test proves that the production entry cannot select the fake hosts.
- Required proofs: `withdrawn` when the decision changed; stop on login, challenge, limit notice, unknown page, error body, changed shape; `ambiguous` on timeout and never resent; verify settles ambiguous both ways; `reappeared` moves the outcome back; daily cap; the token never on stdout or stderr; the confirmation page rejects foreign Host and Origin; nothing is sent to the fake X before **Start**.
- No test contacts X.

### Changes to accepted records

| Record | New wording |
|---|---|
| ADR-005 | Two IndexedDB stores, `browserRuns` and `browserAttempts`, carried verbatim from restores; the store reads schema version 3. |
| ADR-006 | Outcome value `deleted-via-browser`, source `{ kind: 'browser', runId, attemptId }`, `BrowserRun` and `BrowserAttempt`, schema version 3 with its migration and reader checks; `deleted-via-browser` is final except for a verified reappearance. |
| ADR-007 | The outcome enum and filters gain the value; `outcome` rejects a change to a final outcome with `OUTCOME_FINAL`. |
| ADR-011 | Catalog keys for the badge, the confirmation page and the warning of ADR-023 in both languages, under the catalog and copy checks. |
| ADR-013 | The command tree gains `browser setup`, `browser forget` and `delete x`. "There is no `approve`, `decide`, `delete` or `mark` command" becomes "There is no `approve`, `decide` or `mark` command. The `delete` commands act only on entries with a human delete decision, start only after the person clicks Start in the browser window, and never write a decision event". The network rule reads as in [ADR-026](ADR-026-x-originals-fetch.md). New codes: `PROFILE_INVALID`, `NOT_INTERACTIVE` (exit 2); `BROWSER_NOT_FOUND`, `STALE_PLAN`, `ACCOUNT_MISMATCH`, `PLATFORM_CHECK`, `RUN_STOPPED` (exit 1). A run that ends at the daily cap exits 0 and names the reason. |
| ADR-014 | Agents may run `delete x --dry-run --json`. They never run `delete x` without `--dry-run`, `browser setup` or `browser forget`, never read the profile folder, never edit run or attempt records. The skill says so. The MCP server in 0.2 gets no deletion tool. |
| ADR-015 | `STRICT` tables `browser_runs` and `browser_attempts` as above; the check before each entry in one `BEGIN IMMEDIATE` transaction; a layout migration for schema version 3. |
| ADR-016 | The confirmation page reuses its request controls and page policy. The review server and its opener do not change; the confirmation page is opened by `playwright-core` in the dedicated window. |
| ADR-017 | "`ReviewService` is the only code that appends decision or outcome events" becomes: `ReviewService` appends human decision and outcome events; `BrowserOutcomeWriter` appends only `deleted-via-browser` and verified-reappearance `unknown` outcome events with a browser source, plus run and attempt records, never decision events, and only the browser runner constructs it. |
| ADR-018 | The package gains the runtime dependency `playwright-core` 1.63.0 (Apache-2.0, no dependencies of its own), kept outside the bundle and loaded only by the browser commands; the package files gain the confirmation page assets; the packed smoke test runs `delete x --dry-run --json` and never a run. |

[ADR-002](ADR-002-dependency-licenses.md) needs no exception: `playwright-core` is Apache-2.0, and the browser is the one already installed, so rule 6 on downloaded artifacts does not apply.

**Decision made by:** maintainer
**Approved on:** pending

## Consequences

### Positive
- The person's marked posts, replies, quotes and reposts are deleted without a click per entry, each one checked against X's own answer and written down.
- Nothing SocialPrune sends imitates X's client, and the person can watch every step.

### Negative
- Slow by design: thousands of entries take weeks of daily runs.
- The selectors module breaks with larger changes to X's pages; until it is updated, runs stop at the first entry.
- `playwright-core` adds about 13 MB to the installed package, and the person needs Chrome or Edge.
- Schema version 3 and changes to ten accepted records.

### Risks
- **X locks or suspends the account.** Mitigation: ADR-023's rules, the slow defaults and the stop at the first sign. This lowers the chance; it cannot settle X's judgment, and the warning says so.
- **A click hits the wrong element.** Mitigation: the run opens one post per page, checks that the post on the page has the entry's ID before the first click, and checks each element before clicking it; a mismatch stops the run.
- **X reports success but the post comes back.** Mitigation: the verify pass after 7 days, and the outcome moves back to `unknown` when it does.
- **An agent starts the run.** Mitigation: the run refuses pipes, and nothing is sent to X before the person clicks Start in the window. An agent that can control the person's screen is software running as the person, outside what SocialPrune can control.

## Open questions for the maintainer

- Delete by clicking through X's own pages, slower but without imitating X's app, instead of sending X's internal requests directly like the other tools do? Answer "clicks" or "requests".
- Default pace: at least 30 seconds per entry, 20 per batch, 15 minutes pause, at most 200 a day. Accept, or name a slower one? Answer "accept" or the numbers.
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

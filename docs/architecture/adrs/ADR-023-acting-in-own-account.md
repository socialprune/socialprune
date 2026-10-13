# ADR-023: The tool acts in the person's own account, on the person's order

- **Status:** Proposed
- **Date:** 2026-10-11
- **Hard constraints touched:** 4 (changed by the maintainer on 2026-10-11; this record writes the change down and sets the rules every platform action follows), 1, 2, 3 and 5 (unchanged; they bound the change)
- **Related:** [ADR-006](ADR-006-workspace-event-log.md), [ADR-013](ADR-013-cli-framework-output.md), [ADR-014](ADR-014-agent-interface.md), [ADR-016](ADR-016-local-review-server.md), [ADR-017](ADR-017-shared-workspace-service.md), [ADR-026](ADR-026-x-originals-fetch.md), [ADR-027](ADR-027-x-deletion-browser.md), [ADR-028](ADR-028-instagram-signed-in-session.md)

Decided by the maintainer on 2026-10-11: hard constraint 4 changes from "Nothing acts on the platform" to "The tool acts on the platform only in the person's own account, only on the person's order". Two actions are allowed: fetching the original posts that the person's replies and quotes answered, and deleting the person's own entries through a browser session the person signed in to. He accepted the risk that X or Instagram locks or suspends the account. He rejected the route through X's paid developer API.

Needs the maintainer's decision: the wording of this record and of the rules below, which build lanes will treat as binding.

Needs the maintainer's decision: [ADR-001](ADR-001-decision-records.md) has no way to change one rule of an accepted record; rule 3 lets a record change only through a new record that supersedes all of it. ADR-026, ADR-027 and ADR-028 each change a few rules in up to eleven accepted records. Either ADR-001 gains a "Supersedes in part" form (the old record keeps its status and gains one line naming the record that changed which rule), or each changed record is restated in full by a new record.

## Context

From 2026-10-06 until 2026-10-11, hard constraint 4 in `AGENTS.md` read: "Nothing acts on the platform. No code clicks, scrolls, types or sends requests on X or Instagram. If a program is ever started against a real browser profile for a spike, it can change that profile on its own, so before the run, list what it can change and read it back afterwards." The accepted records rely on that rule in a few places: no CLI command uses the network ([ADR-013](ADR-013-cli-framework-output.md)), agents never act on the platform ([ADR-014](ADR-014-agent-interface.md)), the review loads nothing from a post's link ([ADR-021](ADR-021-archive-media.md)), and the guide facts are read by a person, not fetched ([ADR-022](ADR-022-export-guide-content.md)). The person deleted by hand with the click lists, and the delete mode opens one entry at a time on the platform for them.

On 2026-10-11 the maintainer stated his goal for the project, at 10:09Z: before anything is deleted, fetch and keep the text and media of the posts his replies answered, on X and on Instagram where possible, as a feature for anyone who wants it; no X developer account, because it could cost money; and deletion that runs on its own, free, and careful enough that the account is not banned, like the free projects that replace the paid ones.

The research of the same day (dated sources in ADR-026, ADR-027 and ADR-028) found:

- X serves the text, author, photos and parent IDs of a public post without a login through the syndication endpoint that the MIT-licensed `react-tweet` package uses.
- The free X deletion tools (Cyd, TweetXer, tweetdelete) act inside the person's own signed-in browser session. X's rules forbid scripting its website and allow permanent suspension, and Cyd's maintainers report suspensions even within the rate limits. No source gives a pace that was measured to keep an account free of limits.
- Instagram's export does not link a comment to its post, Instagram's terms forbid automated access even when signed in, and free MIT-licensed scripts delete comments in small batches on the "Your Activity" page.

At 10:40Z he decided, in his words:

- "Ja, hole die originale accordingly." (Yes, fetch the originals.)
- "Probier's auch dann ... das mit den automatischen. Klick gut, auch mit dem Risiko, das ist mir klar." (Try the automatic deletion too; he knows the risk.)
- On Instagram: "Ich melde mich an in irgendeinem Browser und den kannst du dann nutzen, um das dann halt richtig rauszuziehen ... auch da die Originale zu holen ... und das dann auch zu löschen." (He signs in to a browser, and the tool may use it to read the context, fetch the originals there and delete.)
- Earlier he had rejected the paid route: "Ich will ja keine API nutzen ... weil das dann trotzdem kosten könnte." (He does not want to use an API, because it could cost money after all.)

The new constraint 4 has been in `AGENTS.md` since commit `0d7ff4b` on 2026-10-11. Constraints 1, 2, 3, 5 and 6 stay as they were.

## Decision Drivers

- The person's goal: keep the context of their replies, then delete what they marked, without paying and without clicking each entry.
- Hard constraint 3 stays: only a human action in the review marks an entry for deletion, and no agent decides.
- Hard constraint 1 stays: no developer account, no API key, no paid service, no paid captcha or proxy service.
- Hard constraint 5 stays: the tool never claims the account is out of danger, and it says plainly that the platforms forbid this.
- An action on a real account cannot be undone, so every step must be listable before, visible during and checkable after.
- No measured low-risk pace exists, so the defaults must be slow and the tool must stop at the first sign of trouble.

## Options

### Option 1: Keep "Nothing acts on the platform"

The click lists and the delete mode stay the only way; context stays a link the person opens.

**Pros:**
- No account risk from SocialPrune at all; the project's clearest promise to its users stays intact.
- No new code that talks to X or Instagram, no browser automation to maintain.

**Cons:**
- Does not meet the maintainer's stated goal: no stored originals, and one click per entry for every deletion.
- Context of replies is lost once the other person deletes their post or the person deletes theirs.

**Effort:** none
**Risk:** Low.

### Option 2: Two named actions in the person's own account, on the person's order

Fetch originals anonymously from X's public embed service; delete the person's own marked entries through a browser profile they signed in to for this, under the rules below.

**Pros:**
- Meets the goal with free means: no developer account, no key.
- Every action is bounded: own account, human delete decisions only, canary, journal, stop at first error.

**Cons:**
- X and Instagram forbid this kind of automation and can lock or suspend the account; SocialPrune can lower the chance but cannot settle it.
- Browser automation breaks when the platforms change their pages, and it needs care around a signed-in profile.

**Effort:** not measured
**Risk:** High for the account, accepted by the maintainer; Medium for the code.

### Option 3: X's paid developer API

**Pros:**
- A documented interface with documented responses.
- Rate limits are published.

**Cons:**
- Pay per request and a card on file, against hard constraint 1; the maintainer rejected it on 2026-10-11.
- No route for Instagram comments on personal accounts.

**Effort:** not measured
**Risk:** Medium.

### Option 4: Open the rule wide: any automation the person asks for

**Pros:**
- No further records needed for new actions.
- Agents could do more for the person.

**Cons:**
- No bound: a later feature could post, follow or message without a record that weighed it.
- The rule would stop being checkable in review.

**Effort:** not measured
**Risk:** High.

## Decision

We chose **Option 2: two named actions in the person's own account, on the person's order**, because it is the only option that meets the maintainer's goal while keeping constraints 1, 2, 3 and 5. Every platform action in SocialPrune follows the rules below. [ADR-026](ADR-026-x-originals-fetch.md) applies them to fetching X originals, [ADR-027](ADR-027-x-deletion-browser.md) to deleting on X, [ADR-028](ADR-028-instagram-signed-in-session.md) to Instagram.

### What is allowed

| Action | Platform | How | Account involved |
|---|---|---|---|
| Fetch the original post a reply or quote answered, with its text, author and photos | X | X's public embed service, no login ([ADR-026](ADR-026-x-originals-fetch.md)) | none; X sees the person's IP address and the post IDs |
| Read the post an Instagram comment belongs to, as the "Your Activity" page shows it | Instagram | the dedicated browser profile the person signed in to ([ADR-028](ADR-028-instagram-signed-in-session.md)) | the person's own |
| Delete the person's own posts, replies and quotes, and undo their reposts | X | the dedicated browser profile ([ADR-027](ADR-027-x-deletion-browser.md)) | the person's own |
| Delete the person's own comments | Instagram | the dedicated browser profile ([ADR-028](ADR-028-instagram-signed-in-session.md)) | the person's own |
| Read back whether a deleted entry is gone, to settle an unclear attempt or a report of entries reappearing | X, Instagram | the dedicated browser profile, read only | the person's own |

### What stays forbidden

Everything else. In particular SocialPrune never posts, likes, follows, unfollows, messages, blocks, reports, changes settings, or acts in any account other than the one the export belongs to. It never uses a developer account, an API key, a paid service or another person's session. And it never does anything to avoid being noticed:

- no change of the browser's user agent, and no removal of the marks a browser sets when a program drives it;
- no fingerprint changes and no "stealth" plugins;
- no solving of captchas or challenges, by code or by any service; a challenge stops the run and the person decides;
- no proxies, no rotating IP addresses, no VPN set up by SocialPrune;
- no hidden or headless browser for deletion: the window is visible and the person can watch it;
- no randomized waiting meant to look like a person; waits are fixed and documented;
- no second account and no switching between accounts in one run.

### Rules every platform action follows

| ID | Rule |
|---|---|
| PA-1 | **The person's order.** A deletion starts only with the person's click on a confirmation page shown in the browser window they watch. An originals fetch starts only from a command the person runs, or that an agent runs after the person agreed in the conversation, with an explicit flag. AUTO-1, decided on 2026-10-13, permits an agent-started signed-in `originals fill x --order <file>` only under the person's written order for exactly `originals-fill-x`, bound to the expected account and unchanged plan. It replaces Start and Matches only for this read-only command, with the automatic comparison and CLI audit of ADR-029. It never permits deletion, setup, a different account or a broader action. An agent never starts a deletion. |
| PA-2 | **The person's own account.** Before the first request, the run reads which account is signed in and compares it with the account the export belongs to. A mismatch stops the run. |
| PA-3 | **Human delete decisions only.** Deletion runs only over entries whose current decision is `delete` from a human decision event ([ADR-006](ADR-006-workspace-event-log.md)), checked again right before each entry. Suggestions from agents, rules, models or the demo never put an entry into a run. |
| PA-4 | **The full list first.** A dry run lists every entry the run would touch, with date, kind, first line of text, decision time, how the decision was made and whether it came from a bulk action, and a hash of that list. A run refuses a list that changed since its dry run. |
| PA-5 | **One entry first, watched.** The first deletion of each kind (post, repost, comment) is a single entry the person watches in the window; the run continues only after the person clicks Continue. |
| PA-6 | **A journal before every request.** Each action is written down as `sending` before it happens and settled after. An action whose result is unclear is `ambiguous` and is never sent again on its own; only a read-only check settles it. |
| PA-7 | **Stop at the first error.** Any unexpected response or page state, a login prompt, a challenge, a captcha, a lock or limit notice stops the run at once. There are no automatic retries. The window stays open so the person can see what happened. |
| PA-8 | **Slowly.** A fixed minimum time between entries, small batches, long pauses and a daily cap, with defaults in ADR-026, ADR-027 and ADR-028. The person can make them slower, never faster than the documented maximum. |
| PA-9 | **Nothing hidden.** The forbidden list above. |
| PA-10 | **The warning, every time.** The warning text below appears before every deletion run and on its confirmation page. |
| PA-11 | **A dedicated, checked profile.** The procedure below. |
| PA-12 | **Free.** No developer account, no API key, no paid service. Browser control uses `playwright-core` (Apache-2.0) with the Chrome or Edge already installed on the person's computer; nothing else is downloaded at run time. |
| PA-13 | **Pinned hosts.** Each action names the hosts it may contact, in one constant with a test. Nothing else is contacted. |
| PA-14 | **CLI only.** Platform actions run in the CLI. The web app on GitHub Pages and its policies do not change, and the local review page does not start platform actions. |
| PA-15 | **Tests never reach a platform.** Every test runs against local fakes; no CI job, test or development step sends a request to X or Instagram. |
| PA-16 | **Narrow writers.** Each action records its results through a writer that can append only its own outcome values and records, never a decision event ([ADR-017](ADR-017-shared-workspace-service.md)). |

2026-10-13: X exports without the account file support `--handle`, compared with the signed-in account before acting, because the account file also holds private fields.

### The warning

Shown before every deletion run in the terminal, on the confirmation page above the Start button, and in the documentation:

> X's and Instagram's rules do not allow this kind of automation. They can lock or suspend your account for it, even though SocialPrune goes slowly and stops at the first problem. Deleted posts and comments cannot be recovered. Neither the platform nor SocialPrune can bring them back. SocialPrune does not hide that a program is acting in your browser. Use it only for your own account, and only if you accept this.

> Die Regeln von X und Instagram erlauben diese Art von Automatisierung nicht. Sie können dein Konto dafür sperren oder einschränken, auch wenn SocialPrune langsam vorgeht und beim ersten Problem anhält. Gelöschte Beiträge und Kommentare lassen sich nicht wiederherstellen. Weder die Plattform noch SocialPrune kann sie zurückholen. SocialPrune verbirgt nicht, dass ein Programm in deinem Browser handelt. Nutze es nur für dein eigenes Konto und nur, wenn du das in Kauf nimmst.

Both texts fall under `pnpm copy:check` ([ADR-011](ADR-011-internationalization.md)).

### The dedicated browser profile

A program that drives a signed-in browser profile can change that profile, and can do anything the account can do. So deletion and the Instagram context read never use the person's everyday browser profile.

1. **Setup.** `socialprune browser setup --platform <x|instagram> --profile <dir>` creates the folder the person names and writes a marker file `socialprune-profile.json` with the platform, the creation time and the SocialPrune version. It refuses a non-empty folder without that marker, so it never takes over an existing browser profile, and accepts a matching marked folder again. Setup starts the installed Chrome or Edge as an ordinary visible child process, without Playwright or any other driver. For X its arguments are exactly `--user-data-dir=<dir>`, `--no-first-run`, `--no-default-browser-check`, `--disable-background-mode` and `https://x.com/i/flow/login`. The background-mode switch prevents this dedicated sign-in window from leaving browser background apps running after it closes. Setup adds no automation or remote-debugging flags, leaves the browser's sandbox at its default, and never touches the normal profile. On Windows it spawns detached and unreferences the child immediately, so ending the CLI does not close a window handed off by the launcher. The person signs in by hand and closes the window. Launcher exit alone is not completion: setup first observes the profile lock become active, then waits for it to release and its direct child to end. It waits up to 60 seconds for the first lock; if none appears, it says it cannot confirm a window opened and does not report success. After closing the window, the person can press Enter to confirm a lock released too quickly to be sampled, or to end a lingering direct child after an observed release. Enter cannot override a held lock or stop a child whose window has not yet become active. After an observed release or Enter, exit is checked for up to 30 seconds. Setup never searches for or kills another browser process. SocialPrune never reads the sign-in form, never sees the password and never stores it.
2. **Where it lives.** The person chooses the folder. The documentation advises a folder outside the workspace and outside any synced folder, because it holds the platform's session. The workspace, its backups and the agent never contain or read it.
3. **What a run can change**, printed before every run: "Signed in as @<handle>, a program can do anything the website can: post, like, follow, send messages, change settings and delete. It can also change this browser profile's cookies, site data, cache, history and settings. SocialPrune's code only does the steps listed for this run." The run lists those steps.
4. **Snapshot before the run:** the signed-in account as the website shows it, the sorted set of installed extension IDs from directory names only, and the profile's other file names with sizes and change times, never contents. A new Edge profile installs default extensions on first start, as observed on 2026-10-12. The run therefore keeps Playwright's `--disable-extensions` active rather than requiring an empty extension folder. It never reads extension manifests or descends into their contents; a preinstalled set is allowed because extensions are disabled for the entire driven run. The Chromium sandbox and all automation signs stay enabled.
5. **During the run:** every request the page sends that can change something on the platform (any method other than GET, to the platform's hosts) is recorded with method, host, path and status. No bodies and no headers are recorded, because they carry the session.
6. **Read back after the run:** the same account is still signed in; no extension ID appears that was absent before the run; the profile files that changed are listed by name; the recorded state-changing requests are compared with the ones this run expected (ADR-027 and ADR-028 name them). An added ID or the new side of a replacement stops with `PLATFORM_CHECK`, even when the count stays equal. Disappearing IDs are recorded as removed and do not stop the run. On 2026-10-13 the maintainer's first signed-in canary found that Edge launched with `--disable-extensions` removed its preinstalled default extension folders before X opened. The previous equality rule stopped a read with no attempts or platform requests; removal alone does not mean an extension could run. Every checkpoint now uses the same added-ID comparison and keeps `--disable-extensions` active. A CLI-owned `socialprune-readback-<runId>.json` in the dedicated profile records the before/after sets, `extensionIdsRemoved`, `extensionIdsAdded`, `extensionsDisabled: true` and the journal's profile report, and the terminal prints its path and both sets. This report writes only the tool's own read-back file; it is not a profile backup and never enters a portable workspace backup. The existing journal schema keeps the extension counts. Any other state-changing request is shown to the person. The report says that the website's own code may have sent it, because the tool cannot tell its own clicks' side requests from the website's background requests in every case.
7. **Removal.** `socialprune browser forget --profile <dir>` deletes the folder after the person confirms. The documentation tells people to sign out of the platform in that window first.

A signed-in profile is a protected surface under `.kilo/rules/protected-surface-boundary.md`. Development agents never read it. A run against the maintainer's own account is part of his own cleanup and needs his explicit scope in the conversation, naming the profile folder.

When a driven run ends, the terminal first names the end reason and tells the person to close the X window. The loopback confirmation page keeps the same final message until that window closes; only then does the server close. On 2026-10-13 the earlier ending order closed the page before waiting, leaving only a session-ended message while the terminal was silent. The repaired ending order applies to completion, limits, cancellation and errors alike. The page and end messages use English by default and German with `--lang de`, with same-origin CSS and the unchanged strict page policy.

On 2026-10-12 the maintainer tried the earlier Playwright-driven Edge setup. Edge displayed an unsupported `--no-sandbox` flag warning; X did not accept the username, its Continue button stayed disabled after email entry, and Google sign-in refused that browser. He closed it without signing in. No password or session was read by an agent. This is the reason setup now opens an ordinary browser: sign-in needs no program attached. Delete, verify and originals-fill runs still use the driver, enable the Chromium sandbox and keep every automation sign, including `--enable-automation`, the debugging pipe and `navigator.webdriver`. Separating manual setup does not permit hiding program-driven runs or claiming the platform will accept them.

Later on 2026-10-12, setup's ordinary Edge window closed before sign-in, while the same arguments launched by the parent through PowerShell's ordinary process launcher stayed open and the person signed in. A generated launcher test reproduced setup's premature success when its first process exited before a grandchild acquired the profile lock. A separate Windows process comparison found that a non-detached generated window died when its Node parent exited, while the detached window stayed alive and continued its heartbeat. The fixed setup test also proves that its window survives its own CLI parent ending. These tests confirm both the return race and the child-lifetime mechanism locally, not the maintainer's unobserved Edge process tree. No development agent read or drove the signed-in profile.

### What agents may do

AUTO-1 on 2026-10-13 permits the narrow originals-fill exception in PA-1. The order file is explicit input, not an environment variable or a peer message, and contains the person's own words, account and time. The tool records `startedBy: 'agent-on-order'` and the file hash; acceptance records `acceptedBy: 'automatic-check'` only after stored and displayed counts match. Other agents remain dry-run-only unless the person provides that exact written scope. Deletion is excluded.

- Run every dry run, with `--json`, and report counts, the plan hash and the warning.
- Run the originals fetch with its network flag only after asking the person in the conversation whether X may see their IP address and the post IDs, and after a yes ([ADR-026](ADR-026-x-originals-fetch.md)).
- Explain the setup and tell the person the exact command to type.
- Never: start a deletion run, click anything in the dedicated window, run `browser setup`, read or copy the profile folder, edit journal records, or type the confirmation.

The skill in `skills/socialprune/` states these rules in plain words.

### What this record changes in accepted records

Nothing directly. ADR-026, ADR-027 and ADR-028 each name the rules they change. Four accepted records mention the old constraint: ADR-012 and ADR-014 in their "Hard constraints touched" lines, ADR-013 in its no-network rule, ADR-022 in its evidence. Their statements stay true until ADR-026, ADR-027 or ADR-028 is accepted, because nothing in the code acts on a platform before then.

**Decision made by:** maintainer
**Approved on:** pending

## Consequences

### Positive
- The person can keep the context of their replies and delete what they marked without paying and without clicking each entry.
- The rules are concrete enough for a reviewer to check each action against them, and they are the same for every platform.

### Negative
- SocialPrune loses the simple promise that it never touches the account. People who relied on that need to read the warning, and the README has to say what changed.
- Browser automation is the most fragile part of the project: it breaks with every larger change to X's or Instagram's pages, and the tests can only cover fakes.
- Some people will lose their account to a platform decision, whatever the pace. The tool can say so; it cannot prevent it.

### Risks
- **A platform suspends the account.** Mitigation: the rules above, the warning, and the slow defaults. None of them settles the platform's judgment, and nothing in the copy claims otherwise.
- **A later feature widens the actions without a record.** Mitigation: the "allowed" table is closed; any new action needs its own record, and the pinned-host tests fail on an unlisted host.
- **The profile is misused by other software or by an agent with shell access.** Mitigation: it is a dedicated folder outside the workspace, development agents treat it as protected, and the run's read-back shows unexpected state-changing requests. Software running as the person is outside what SocialPrune can control, as [ADR-016](ADR-016-local-review-server.md) already states.

## Open questions for the maintainer

- Do you approve the wording of this record and its rules PA-1 to PA-16? Answer yes, or name what to change.
- Should a changed accepted record keep its status and get one line "rule changed by ADR-0NN", instead of a full rewrite? Answer yes or no.
- Is a dedicated browser profile you sign in to by hand, in a folder you name, the right setup for you? Answer yes or no.

## Evidence

- `AGENTS.md` at commit `0d7ff4b` (2026-10-11): the new hard constraint 4 and the project sentence; the old wording is quoted above from commit `5fb9c54`.
- The maintainer's words and their times are from the conversation of 2026-10-11 as recorded by the project's orchestration log; quoted verbatim, with English renderings added.
- Research findings of 2026-10-11 with their sources are listed in the Evidence sections of [ADR-026](ADR-026-x-originals-fetch.md), [ADR-027](ADR-027-x-deletion-browser.md) and [ADR-028](ADR-028-instagram-signed-in-session.md). The maintainer has not yet read those sources himself; each record marks them as pending his reading.
- X, [Automation rules](https://help.x.com/en/rules-and-policies/x-automation), and Instagram, [Terms of Use](https://help.instagram.com/581066165581870): both forbid automated access of the kind decided here. Observed 2026-10-11 by the research; the maintainer's reading pending.
- `playwright-core` 1.63.0: license Apache-2.0, no dependencies, 13,453,369 bytes unpacked, `engines.node >=20`. Read from the npm registry by the architect on 2026-10-11.

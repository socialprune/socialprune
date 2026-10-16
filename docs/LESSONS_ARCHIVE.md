# Lessons Archive: SocialPrune

> Lesson authority for this repository, named in `AGENTS.md` and `.kilo/WORKFLOW_BIBLE.md`.
> Started 2026-10-06 at bootstrap. Holds full lesson bodies for work on SocialPrune.

Add a lesson when criticism or a repeated mistake should change how work happens here (`.kilo/rules/continuous-learning.md`). The schema and an example are in `.kilo/skills/continuous-learning/SKILL.md`.

This file is public. Write lessons in English, and keep real export content, personal data and private paths out of them.

Rules carried over from the maintainer's earlier projects already sit in `AGENTS.md` and in the baseline rules under `.kilo/rules/`. They are not repeated here.

## Lessons

### [LL-2026-10-001] 2026-10-06 VERIFICATION: Re-read state someone else owns before reporting it

**ID:** LL-2026-10-001
**Severity:** MEDIUM
**Category:** VERIFICATION
**Expires:** Never (kernel). The commands in rule 2 are dated evidence from 2026-10-06.

**Feedback:** The maintainer said he had already turned on secret protection, after my report told him it was still off.
**Problem:** I read the repository's security settings with `gh api` before the first push and found them disabled. About an hour later my phase report said they were "still" off and listed them as his open task, without reading them again. A fresh readback then showed secret scanning and Dependabot alerts enabled. Only repository-level push protection was still disabled.
**5 Whys Analysis:**
1. Why? -> The report reused a readback from an earlier turn as if it described the present.
2. Why? -> The evidence board kept the readback as a settled fact with no observation time attached.
3. Why? -> Freshness on the board is tracked against source identity such as commits and the lockfile, and remote settings have no source identity, so nothing ever marked them stale.
4. Why? -> The settings belong to the maintainer, the plan listed them as his open item, and a change during the session was therefore likely, yet no step asked who could have changed them since.
5. Why? -> Root cause: no control re-reads externally owned state at the moment of reporting. The freshness law in `verification-before-completion` is framed around completion claims and source identity, not status reports about state another actor can change.
**Rule(s):**
1. Before stating the current state of something another person or system can change, read it again in the same turn. If that is not possible, give the time of the last observation instead of describing it as current.
2. GitHub repository security settings: run `gh api repos/<owner>/<repo> --jq .security_and_analysis` and `gh api -i repos/<owner>/<repo>/vulnerability-alerts` (204 means Dependabot alerts are on) directly before the sentence that reports them.
3. Words like "still" or "weiterhin" about external state need a readback newer than the owner's last chance to change it.
**Detection Pattern:** a report states the current value of a remote setting, CI result or service, and the newest readback of it in the session is older than the previous user message.
**Affected Files:** docs/LESSONS_ARCHIVE.md. Retrieval anchor pending: the always-loaded `.kilo/rules/verification-before-completion.md` requires fresh evidence for completion claims but carries no trigger for status reports on externally owned state. A one-line trigger there needs the maintainer's explicit request under `.kilo/rules/governance-protection.md`, so it is proposed and not applied.
**Related Lessons:** none
**Regression / Verification Note:** applied on 2026-10-06 at 16:16 UTC with a fresh readback before correcting the report.
**Metrics:**
- Prevented: 1 time. On 2026-10-06 the parent re-read CI before each report and wrote "CI for 3cc0c25 not yet listed" at 17:59 UTC instead of reusing the previous readback.
- Violated: 1 time. On 2026-10-15 at about 15:58 UTC the parent told the maintainer that an X run "has been running since 17:55" without reading its state again; the run had already stopped on its fifth post. The status line of a run now comes from a readback in the same turn, or carries the time it was read.

### [LL-2026-10-002] 2026-10-06 VERIFICATION: Take a negative proof's forbidden values from the inputs, not from the code

**ID:** LL-2026-10-002
**Severity:** HIGH
**Category:** VERIFICATION
**Expires:** Never (kernel). The paths, fixture names and line numbers below are dated evidence from 2026-10-06.

**Feedback:** The independent Gate G1 review returned REVISION. The structure privacy sweep passed on all 52 fixtures, yet `pnpm socialprune structure fixtures/synthetic/instagram/two-accounts --json` printed both Instagram handles in folder names.
**Problem:** My R3 spec defined part of the sweep's forbidden list as "every first path segment that was treated as a wrapper". The test helper `wrapperSegment` therefore copied the production wrapper rule and could only confirm what the code already did. The sweep also ran only on single export folders, while users point `structure` at parent folders, at Downloads with other files in it, or at several exports at once. In those shapes the wrapper rule does not fire and the handles stay in the path.
**5 Whys Analysis:**
1. Why did the sweep pass while handles leaked? -> Its forbidden set came from the same rule as the code, and its input was always one export folder, where that rule works.
2. Why did the forbidden set come from the code? -> The spec defined it as the segments the implementation treated as wrappers.
3. Why was it defined that way? -> The oracle was written in the same message as the implementation rule, and the implementation's concept became the test's concept.
4. Why did input coverage not catch it? -> The sweep took the fixture layout, one folder per export, as its whole input space. Nobody listed the shapes a user actually passes.
5. Why? -> Root cause: no control requires a negative-proof oracle to be derived from inputs and fixture metadata independently of the code under test, or requires the realistic input shapes to be listed before a property is claimed for "every fixture".
**Rule(s):**
1. A test that proves something is absent takes its forbidden values from the input data, never from the code under test, and runs over every input shape a user can realistically supply, not only the shape the fixtures happen to have.
2. In SocialPrune the structure sweep's forbidden list comes from fixture metadata: handles and account keys in `expected.json`, and handles and tokens of archive names that match the real export naming patterns. It runs on export folders, on variant folders with sibling files, and on a folder that holds several exports.
3. When specifying a privacy test, list the input shapes first, then the forbidden values, and only then the implementation rule.
4. A new negative test must be shown to fail against the code it is meant to catch before it counts as proof.
**Detection Pattern:** a test helper reimplements a production predicate to compute what is expected or forbidden, or a claim about "every fixture" whose input enumeration equals the fixture directory layout.
**Affected Files:** packages/core/src/structure/structure.test.ts, docs/evidence/G1.md, docs/LESSONS_ARCHIVE.md. Retrieval anchor: the Proof section of AGENTS.md gets the line "Expected values and forbidden lists in these tests come from the fixture data, never from the code under test." in the same commit as the structure revision, because before that revision the line would be false. Until then this anchor is pending.
**Related Lessons:** none. Related rule: `.kilo/rules/verification-before-completion.md` Hard Law 32.
**Regression / Verification Note:** the revised sweep and unit tests must fail when run against `packages/core/src/structure/index.ts` from commit `ad22ff3`.
**Metrics:**
- Prevented: 0 times
- Violated: 0 times

### [LL-2026-10-003] 2026-10-07 ORCHESTRATION: Change a running lane's authority only through its task

**ID:** LL-2026-10-003
**Severity:** MEDIUM
**Category:** ORCHESTRATION
**Expires:** Never (kernel). Lane names, times and tool names below are dated evidence from 2026-10-06 and 2026-10-07.

**Feedback:** On 2026-10-07 the CLI lane returned `needs_context` instead of finishing node C1. Its task said the existing `structure` tests must pass unchanged, and my later board post told it to edit one of them. It declined to treat the post as authority, which is what the runtime requires. It was the third refusal of this kind in two days. On 2026-10-06 the web lane declined a write-set extension to `tools/fixture-gen/src/shared/zip.ts` that I had posted, and the foundation lane did not apply an amended S-1 test rule that I had posted instead of putting it into its task.
**Problem:** Three times I changed a running lane's write set, test rule or constraint through a board post. Each lane kept to its task, as it must, because peer messages, the parent's included, never grant authority or change an assigned scope. Each time the work stopped until I resumed the lane with the change in its task. In the C1 case the conflict was mine from the start: the same task froze the `structure` tests and asked for the ADR-013 JSON envelope, which changes one of their assertions.
**5 Whys Analysis:**
1. Why did the lanes stop? -> They received a change to their authority through a channel that cannot carry authority.
2. Why did I use that channel? -> A running task cannot be resumed until it returns, and the board reaches it at once.
3. Why did a running lane need a change at all? -> Its task named a constraint without saying what to do when the work collides with it.
4. Why was the collision not caught? -> When I write a task, I list constraints and deliverables separately and do not check them against each other or against the records the task implements.
5. Why? -> Root cause: no step in writing a delegated task checks its constraints against its deliverables and governing records, and no rule says how to deliver a scope change found while the lane runs, so I used the nearest fast channel.
**Rule(s):**
1. A change to a delegated lane's authority, write set, constraints or acceptance rules takes effect only through the lane's task: in the task as first written, or in the task that resumes the lane after it returns. A shared message channel can inform a lane, never authorize it.
2. Before dispatching a task, check each of its constraints against each deliverable and against the records it implements. Where they can collide, write the resolution or a conditional permission into the task.
3. When a needed change turns up while the lane runs, post it as information only and deliver it by resuming the lane after it returns. A post to a running lane never reads as a decision or a permission.
4. In this runtime the shared channel is `board_post` and `board_read`, and resuming is the `task` tool with the lane's `task_id`.
**Detection Pattern:** a parent board post to a running lane that says "decision", "you may", "authorized" or "your write set now includes", or that changes a constraint from the lane's task; a lane return saying it did not apply a board instruction.
**Affected Files:** docs/LESSONS_ARCHIVE.md. Retrieval anchor for rules 1 and 3: the runtime's `board_post` tool description, read at the moment of posting, already says that peer messages never change the assigned scope. Rule 2 has no anchor yet. Tasks are written by the orchestrator, whose instructions live in `.kilo/agents/workflow-orchestrator.md`, a governance surface, so a one-line trigger there is proposed and not applied (`.kilo/rules/governance-protection.md`).
**Related Lessons:** none
**Regression / Verification Note:** applied on 2026-10-07 by resuming the CLI lane through its task with the envelope decision and the one test edit it may make.
**Metrics:**
- Prevented: 6 times for rules 1 and 3 (2026-10-08: GD w0 test, GD guide-wiring callsites, C3 schema expectation, C3 e2e TypeScript project, C4 error details; 2026-10-14: the `run.ts` report wiring for the fill lane; each change went through the lane's task, never a board post)
- Violated: 12 times for rule 2 (2026-10-16: the desktop screens task froze the core contract and required the export guide's links to open through the bridge, and the contract had no request for opening a link; I had checked the contract's review and run methods against the screens but not the setup step's links, and the task said to return on any gap instead of stopping only that part, so the lane stopped at pre-flight with nothing built. A task that consumes a frozen contract now names, before dispatch, the request each deliverable uses, and a gap stops only the affected part. 2026-10-15, fifth time that day: the fill task's port rule listed files instead of naming the kind of change, and the fill suite's config also runs `review-media.spec.ts` on its own fixed port; the lane caught it at pre-flight. The note written that morning already said to scope by the kind of change, so a list of files for a cross-cutting rule is the repeat signal. 2026-10-15, fourth time that day: the fill task's reload rule did not say "main runs only", although its neighbouring rule did, and a reload in a canary would leave a failed attempt that both canary acceptance checks reject; the lane caught it at pre-flight. Each new behaviour rule is now checked against the acceptance records of every run mode it can reach. 2026-10-15, third time that day: the Instagram CLI task added error codes, and I checked the consumers of the command list but dismissed the consumers of the error registry without searching, so the two generated CLI schema files that enumerate every code were missing; the lane stopped at pre-flight. A task that adds entries to a registry now also grants regenerating every generated file of that registry through its repository command. 2026-10-15: the schema-5 foundation task listed the files that write the version 4 literal but not four core tests that expect it in other forms, `browser-backup.test.ts`, `originals-fill.test.ts`, `settings.test.ts`, and the exact schema file list in `schemas.test.ts`, because my search matched only the written literals; the lane's pre-flight caught it before writing. Twenty minutes later the same task stopped again: the conditional permission I added named four directories and left out `apps/web/test/probes/store-contract.ts`, which opens the next database version as the literal 5. A permission scoped by directory repeats the gap it was meant to close; scope it by the kind of change, in any tracked test or probe file, and list the files in the return. 2026-10-14, twice on the same day: the fill lane's empty-result task asked for a count in the structure report but left `run.ts`, which builds that report, out of the write set, so the lane stopped before its browser proof; five hours later the notice-parent task repeated the same gap for a second report count, and the lane caught it in its pre-flight check before writing. The repeat shows that recording the first violation did not change how I write the next task; for every requested output, I now name the file that produces it by searching for where the neighbouring field is written. 2026-10-08: the GD, C3 and C4 tasks each missed a file their deliverable had to change, found only when the lane stopped at it: three CLI tests for the guide wiring, `schemas.test.ts` for `review`, `schemas.ts` and `adapter.ts` for `INVALID_LABELS.details`; the C5 task placed its scripts under the git-ignored `apps/cli/build/` although a pending ADR correction already moved that path to `apps/cli/release/`, and granted a copy-check scope list whose predicate also had to change)

### [LL-2026-10-004] 2026-10-07 DELIVERY: Read the remote's last CI result before pushing, and let a local gate stand only for the platforms it ran on

**ID:** LL-2026-10-004
**Severity:** HIGH
**Category:** DELIVERY
**Expires:** Never (kernel). Commit IDs, platforms and commands below are dated evidence from 2026-10-07.

**Feedback:** No user correction. The parent detected a repeat: twice on 2026-10-07 it read the CI result of the remote tip and pushed in the same command, so it saw the red result only after the push (at `54e648e`, then at `ad037d7`). The second time, CI had been red since the push that contained W3: eleven browser tests failed on Ubuntu, a 320 px layout overflow in Firefox and WebKit and one click-list test in Chromium. The local three-engine gate on Windows had passed the same code 399/399.
**Problem:** Two controls were missing. A push went out without anyone having read the previous CI result, so new commits landed on a red branch for an unknown reason. And a green Windows gate was treated as proof for code that CI runs on Linux, where fonts, WebKit builds and timing differ; the WebKit import stall earlier the same day had already shown such a gap.
**5 Whys Analysis:**
1. Why was a red CI result seen only after the push? -> The read and the push ran in one shell command.
2. Why in one command? -> To save a round trip while a gate had just passed.
3. Why did a passing gate seem enough? -> The local gate ran the same suite as CI, so it was treated as equivalent.
4. Why was it not equivalent? -> It ran on Windows only, and layout and engine behaviour depend on the platform.
5. Why? -> Root cause: no step separates reading the remote's last CI result from the push and stops on red, and the gate's proof was never bounded to the platforms it actually ran on.
**Rule(s):**
1. Before pushing, read the last CI result of the remote branch in its own step. If it is red, find out why before anything else is pushed; push only the fix for that cause, or work that is proven not to touch it.
2. A local test run proves behaviour only on the platform it ran on. Do not report a gate as standing for CI's platform unless it ran there too.
3. In this repository, CI runs on `ubuntu-latest` and the local machine is Windows. For commits that change `apps/web` rendering, the import path, or Node path, file-system or process code, run the affected tests on Linux before pushing, in the Playwright Docker image `mcr.microsoft.com/playwright:v1.63.0-noble`, or say plainly that Linux was not covered.
**Detection Pattern:** a shell command that both reads `gh run list` and runs `git push`; a delivery report that cites a Windows-only gate for a web change without a Linux run or a stated gap.
**Affected Files:** docs/LESSONS_ARCHIVE.md. Retrieval anchor: the parent's own pre-push step. A one-line trigger in the Delivery section of AGENTS.md would make it always-loaded, but that section changes only on the maintainer's request (`.kilo/rules/governance-protection.md`), so it is proposed and not applied.
**Related Lessons:** LL-2026-10-001 (re-read externally owned state before reporting it).
**Regression / Verification Note:** applied on 2026-10-07 by stopping further pushes until the Linux-only failures at `ad037d7` are fixed and proven on Linux.
**Metrics:**
- Prevented: 1 time (2026-10-08, `b644d80`: CI was read in its own step before the push, and the red result after it stopped further pushes)
- Violated: 3 times (2026-10-08, `b644d80`: CLI path code went out on a Windows-only gate, because rule 3 names only `apps/web`; one test failed on Linux in CI. 2026-10-08, `e1fa812`: the local gate skipped the package build, pack check and packed smoke that CI's cli-package job runs, so a web change that renamed hashed assets failed the pack check only in CI. 2026-10-17, `cbe3ecd`: a new test read an earlier commit with `git show`; the local gate runs in a worktree with the full history, CI checks out one commit, so the test failed only in CI. The environment a gate stands for includes the checkout's history, not only the platform; a test that reads Git history is checked against a shallow checkout before it ships)

### [LL-2026-10-005] 2026-10-09 COMMUNICATION: Write the maintainer's decisions in his words, one line each

**ID:** LL-2026-10-005
**Severity:** HIGH
**Category:** COMMUNICATION
**Expires:** Never (kernel). The codes and the message below are dated evidence from 2026-10-09.

**Feedback:** The maintainer asked for every pending item with an example, a recommendation and context, concise, so he can decide. The answer used the project's internal codes (G2, S2, I2, ADR, card v8, item numbers) and a multi-bullet layout per item. He replied that it did not say what he had asked for, that he must understand exactly what each item means for the project, and that it must be short, one line per item. His first message of the session had already asked for "knapp und konkret".
**Problem:** The brief was written from the working vocabulary of the orchestration log, not from the reader's. Codes that are precise for the agent are opaque to the person who has to decide, and a structured block per item hid the one thing he needed: what it is, what it changes for us, and what to answer.
**5 Whys Analysis:**
1. Why could he not use the brief? -> It named items by internal codes and spread each over several bullets.
2. Why internal codes? -> They are the names the board, the plan and the lanes use all day.
3. Why did that leak into his brief? -> The brief was assembled from the board entries rather than written for him.
4. Why was it not caught? -> No step checks a maintainer-facing brief against his vocabulary and his stated format before it is sent.
5. Why? -> Root cause: there was no rule that a decision brief is written in the reader's words and in the shape he asked for; the writing rule covers tone, not this.
**Rule(s):**
1. A decision brief for the maintainer is written in his words: each item is one line that says what it is in plain terms, what it means for the project, what I recommend, and the exact reply or action.
2. No internal code (node IDs such as G2, S2, I2, ADR numbers, card or item numbers, D, E or F entries) appears without its plain meaning in the same line, and only if he needs it to answer.
3. The shape he asked for wins over any structure I prefer. When he says one line, it is one line.
**Detection Pattern:** a maintainer-facing message whose items lead with a code instead of a plain description, or that uses headings and several bullets per item after he asked for short.
**Affected Files:** docs/LESSONS_ARCHIVE.md. Retrieval anchor: proposed for `.kilo/rules/human-writing-style.md` section B (always loaded) as one line, "A decision brief for the maintainer: one line per item in his words, what it is, what it means for us, the recommendation and the exact reply (LL-2026-10-005)". That file is a protected governance surface, so the line waits for his approval; until then the parent applies the rule from this archive before every decision brief.
**Related Lessons:** none.
**Regression / Verification Note:** applied on 2026-10-09 by rewriting the pending-items brief as one plain line per item, without unexplained codes.
**Metrics:**
- Prevented: 0 times
- Violated: 1 time (2026-10-11 morning message: ADR-025, card AUTO-v2, S2, "Zitat" and "Export-Anleitung" without plain meaning; see LL-2026-10-009. The proposed anchor line had not been placed, and the rule did not run.)

### [LL-2026-10-006] 2026-10-09 PRIVACY: Prove a guard on a decoy, never on the thing it guards

**ID:** LL-2026-10-006
**Severity:** CRITICAL
**Category:** PRIVACY
**Expires:** Never (kernel). The tool, flags and folder names below are dated evidence from 2026-10-09.

**Feedback:** No user correction; the parent detected it. Before running a headless agent on the maintainer's real export, the parent tested whether the agent folder's shell denials worked by asking a fresh agent to run four commands, one of them a listing of the maintainer's Downloads folder, a protected path. The denials did not hold, so the listing ran, and its file names, including the export file names that carry his Instagram handle, reached the model provider and the session log.
**Problem:** A control that was not yet proven was tested against the real protected surface. When the control failed, the test itself caused the exposure the control was meant to prevent.
**5 Whys Analysis:**
1. Why did the listing reach the model? -> The shell denial in the folder's config did not apply.
2. Why was a protected path in the test at all? -> The test was written to show that the real forbidden target is blocked.
3. Why was that acceptable at the time? -> The test was framed as a check of the guard, not as an access to a protected path.
4. Why did that framing win? -> No step at the moment of writing the probe compared its targets against the protected-path list.
5. Why? -> Root cause: the rule "exercise a protected-content control against synthetic fixtures first" was not applied to permission tests, because a guard test feels like protection rather than access.
**Rule(s):**
1. Prove any guard (deny rule, filter, sandbox, redaction) first against a decoy that stands in for the protected thing, and rely on it only after the decoy test shows it holds.
2. A probe, test command or prompt never names a protected path or protected content, even to show that it is blocked.
3. In this repository, the decoy for a path guard is a generated folder under the task's temp directory whose name the guard's pattern also matches.
**Detection Pattern:** a test command, prompt or script that names the maintainer's download folder, the S4 working-copy folder, a real export name or any other protected path; a guard declared working without a decoy run.
**Affected Files:** docs/LESSONS_ARCHIVE.md. Retrieval anchor: `.kilo/rules/tool-usage-discipline.md`, section "Commands that can surface protected content", already says "Exercise a protected-content control against synthetic fixtures first" and is loaded in every session; this lesson extends its reading to permission and sandbox tests.
**Related Lessons:** LL-2026-10-002 (a negative proof must fail on a planted defect).
**Regression / Verification Note:** applied on 2026-10-09 by stopping the cleanup run, testing the shell guard only on a generated decoy folder, and reporting the exposure to the maintainer.
**Metrics:**
- Prevented: 0 times
- Violated: 0 times

### [LL-2026-10-007] 2026-10-10 PRODUCT: Accept a feature by what the person has to do and see, not only by what the tests prove

**ID:** LL-2026-10-007
**Severity:** HIGH
**Category:** PRODUCT
**Expires:** Never (kernel). The screens and steps below are dated evidence from 2026-10-09 and 2026-10-10.

**Feedback:** On his own cleanup the maintainer first got a PowerShell command to start the review, although the agent is meant to start it and the browser opens by itself, and he asked why he should do that at all. Then he opened the review page, said it looks terrible and is no fun to click through, and marked nothing.
**Problem:** Phase 2 was accepted on function, policy, privacy and accessibility evidence across three browsers and two operating systems, but nobody had looked at the screens as a person who wants the job done quickly, and the handoff text gave the person a step the tool does itself.
**5 Whys Analysis:**
1. Why did he stop at the review page? -> It looked bad and took effort he did not want to spend.
2. Why did that reach him? -> No acceptance step looked at the screens or counted the person's steps.
3. Why not? -> Every gate measured what tests can prove: behaviour, requests, contrast, keyboard paths.
4. Why was that taken as done? -> The design specification existed, so meeting its rules in tests read as meeting its intent.
5. Why? -> Root cause: the acceptance contract had no criterion for the person's effort and the look of the result, and no person or screenshot review before a UI node closed.
**Rule(s):**
1. A user-facing feature is accepted only when the person's path is counted (each step they must take, and which of those the tool could take instead) and the screens have been looked at, by the maintainer or against screenshots compared with the design specification.
2. Before handing the person a step, check whether the tool or agent can take it; hand over only what needs a person.
3. Green functional gates are reported as functional acceptance, never as "the feature is good".
**Detection Pattern:** a handoff that gives the person a command the agent could run; a UI node closed without a screenshot or a person's look; a closure report that calls a screen finished on test evidence alone.
**Affected Files:** docs/LESSONS_ARCHIVE.md. Retrieval anchor: proposed one line for `.kilo/agents/workflow-orchestrator.md` (protected), "A user-facing node closes only after the person's steps are counted and the screens were looked at (LL-2026-10-007)"; until he approves it, the parent applies this before closing any UI node.
**Related Lessons:** LL-2026-10-005 (write for the person in his words).
**Regression / Verification Note:** applied on 2026-10-10 by starting the review for him instead of handing him a command, and by planning the redesign with screenshots for his look before it counts as done. Violated on 2026-10-12: `browser setup` was handed to him on fake-X evidence alone. It opened the sign-in page through the automation driver, so the window showed an unsupported `--no-sandbox` warning, X's sign-in did not continue and Google refused the browser as insecure. Nobody had looked at what that window shows a person. Corrected by starting the installed browser itself for sign-in, with no driver attached, and by checking the window's start flags before handing him the step again. Violated again on 2026-10-13: the first signed-in originals run was handed to him after checking only its plan hash. The run also needs the export's account name, which his workspace does not hold because the account file had been left out of his cleanup copy on purpose, so it refused at once with a message meant for deletion. Before handing a person a run, check every precondition the run's code tests, not only the one the instructions mention. Violated a third time on 2026-10-13: when a run stopped, its page had already closed and showed only "Session ended", and the terminal did not say that the run waited for the window to close. Nobody had looked at the end of a run from the person's side.
**Metrics:**
- Prevented: 0 times
- Violated: 3 times

### [LL-2026-10-008] 2026-10-10 VERIFICATION: Tell the person something is on their screen only after seeing it arrive

**ID:** LL-2026-10-008
**Severity:** HIGH
**Category:** VERIFICATION
**Expires:** Never (kernel). The port check, script paths and the Windows opener behaviour below are dated evidence from 2026-10-10.

**Feedback:** "Du sagst im Browser, aber ich habe keinen Link bekommen von dir." The agent had told him that his browser had just opened the review of his real entries.
**Problem:** The agent started the local review and reported it as open in his browser because the server printed "Your browser opens it now". It gave no address, no browser name and no fallback, although `AGENTS.md` records that opening the browser on Windows is proven only up to the PowerShell call.
**5 Whys Analysis:**
1. Why did he find nothing? -> The page either did not open or opened where he did not look, and the message named no place to look.
2. Why did the agent say it was open? -> It relayed the server's readiness line as a fact about his screen.
3. Why did that pass? -> The start step waited only for the server's own text; nothing observed the browser side.
4. Why not? -> The start script was built to prove that the server runs, not that the person reaches the page.
5. Why? -> Root cause: no step observed the person-side effect before the claim, and the handoff had no fallback for an opener known to be unproven.
**Rule(s):**
1. A claim about what a person now sees needs an observation from the person's side or the person's confirmation. A program announcing that it will show something is not that observation.
2. After starting the local review for someone, check that a browser connected to the review port before saying the page is open. With no connection, say so and give the fallback the product skill names: the person starts `review` in their own terminal.
3. Every such handoff names where to look (which browser, which address) and what to do if nothing is there.
**Detection Pattern:** a message that says a page, file or window "is open" or "has opened" for the person with no observed connection, readback or confirmation; a tool's "opens now" line repeated as done.
**Affected Files:** docs/LESSONS_ARCHIVE.md. Retrieval anchor: the parent's start script `%TEMP%\kilo\cleanup-tools\review.ps1` carries a comment pointing to `browser-check.ps1` and this lesson, at the moment the review is started; the product skill `skills/socialprune/SKILL.md` step 7 already names the own-terminal fallback for agents.
**Related Lessons:** LL-2026-10-007 (accept by what the person does and sees), LL-2026-10-001 (re-read state someone else owns).
**Regression / Verification Note:** applied on 2026-10-10 by restarting the review, checking for a browser connection on its port and telling him the browser, the address and the fallback.
**Metrics:**
- Prevented: 1 time (2026-10-11 08:50Z, the restarted review was reported only after Edge connected on port 51014)
- Violated: 0 times

### [LL-2026-10-009] 2026-10-11 COMMUNICATION: Answer the person's goal before reporting the work

**ID:** LL-2026-10-009
**Severity:** HIGH
**Category:** COMMUNICATION
**Expires:** Never (kernel). The counts, codes and routes below are dated evidence from 2026-10-11.

**Feedback:** "Hast du überhaupt mir zugehört? Ich check das überhaupt nicht. Wir wollen das ja automatisiert haben. Eigentlich sollte dir ja schon klar sein, was wir wollen." He also asked what "kein Zitat" and "Export-Anleitung" mean, and said he does not want to use an API.
**Problem:** After an overnight run the morning message listed commits, draft decision records (ADR-025, ADR-024), a card code (AUTO-v2), "S2", "Zitat" and "Export-Anleitung". It did not say, point by point against what he had asked the evening before (whole thread and context on X, the post, its media and the parent comment on Instagram, deletion without manual work), what was done, what the export cannot give and what needs his choice. It also carried X's paid developer API as the deletion plan although he had never accepted that route.
**5 Whys Analysis:**
1. Why did he not understand it? -> The items were named by internal artefacts and codes, and none was tied to a point of his goal.
2. Why? -> The message was assembled from the overnight log, item by item, in the log's vocabulary.
3. Why did the API route look like his plan? -> His "automatisiert" was mapped to the nearest route inside the hard constraints, and nobody asked whether that route meets what he wants; his silence on the card was read as pending, not as a mismatch.
4. Why was it not caught before sending? -> LL-2026-10-005 covers the wording, but its retrieval anchor was never placed, so nothing at the moment of writing asked whether the message answers his goal in his words.
5. Why? -> Root cause: no step compares a status message for him against his own stated goal points, and a route the agent chose to fit a constraint was carried forward as his plan without his acceptance.
**Rule(s):**
1. A status message to a person starts from their goal as they stated it and says for each point: done, not possible and why, or needs their choice. The work log comes after it, short, or not at all.
2. When a goal has no route inside the constraints, say that plainly with the trade-off, and do not present the nearest permitted route as the plan until the person accepts it as meeting their goal.
3. LL-2026-10-005 applies to every such message: no code without its plain meaning.
**Detection Pattern:** a status or morning message whose first lines are commits, file names or codes; a recommendation that builds on a route the person never confirmed; the person asking what a term in the message means.
**Affected Files:** docs/LESSONS_ARCHIVE.md. Retrieval anchor: proposed together with LL-2026-10-005 as one line in `.kilo/rules/human-writing-style.md` section B, which loads in every session: "A message to the maintainer starts from his stated goal, says per point done, not possible and why, or his choice, and uses his words, one line per item (LL-2026-10-005, LL-2026-10-009)". That file is a protected governance surface, so the line waits for his approval. The repeat on 2026-10-11 shows the rule does not run without it; until then the parent re-reads both lessons before every message to him.
**Related Lessons:** LL-2026-10-005 (his words, one line per item), LL-2026-10-007 (accept by what the person does and sees).
**Regression / Verification Note:** applied on 2026-10-11 by answering his questions point by point against his goal, stating what the exports cannot give, laying out the deletion routes with their trade-offs instead of the API route as the plan, and naming the anchor line for his approval.
**Metrics:**
- Prevented: 0 times
- Violated: 0 times

### [LL-2026-10-010] 2026-10-12 VERIFICATION: A test that shares a fixed resource with a parallel neighbour is a race, not a load flake

**ID:** LL-2026-10-010
**Severity:** MEDIUM
**Category:** VERIFICATION
**Expires:** Never (kernel). Ports, file names, commit hashes and counts below are dated evidence from 2026-10-12.

**Feedback:** none from the maintainer; found when CI turned red. The `checks` and `cli-node-floor` jobs failed for commit `3e68bb7` with `EADDRINUSE 127.0.0.1:4236` and a 5-second timeout, after the local light gate had been green.
**Problem:** Two unit test files, a fake syndication server helper and a new test next to it, both listened on the fixed port 4236. Vitest runs test files in parallel, so whichever started second failed. Locally the same test had failed once under heavy machine load and was then classified as a load flake because it passed on its own.
**5 Whys Analysis:**
1. Why did CI fail? -> Two parallel test files bound the same fixed port.
2. Why was it not caught locally? -> The parallel schedule rarely put both files together, and the one local failure happened while the machine ran at 100 % for other work.
3. Why was the local failure not read as a race? -> Its error text was not captured, and "passes isolated" was taken as proof of load, although isolation removes exactly the neighbour that causes a race.
4. Why did both files use one port? -> The new test copied the port from the existing helper; nothing in the unit tests forbids fixed ports, while the Playwright suites legitimately use assigned ones.
5. Why? -> Root cause: no control separates a shared-resource race from load, and no check stops a unit test from taking a fixed port.
**Rule(s):**
1. Before calling an intermittent test failure environmental, capture its error. A failure that names a shared resource (address in use, file busy, locked database, a fixed path) is a race to fix, whatever the machine load.
2. Passing in isolation does not prove load; it is also what a race between parallel files looks like. Rerun inside the full parallel suite as well.
3. Unit tests and their helpers listen on port 0 and read the assigned port back. Fixed ports stay in the serial browser suites under `e2e/`.
**Detection Pattern:** `EADDRINUSE`, `EBUSY`, `database is locked` or a timeout next to them; a test that fails only in the full suite; two files with the same literal port or temp path.
**Affected Files:** `apps/cli/src/originals/test/server.ts`, `apps/cli/src/originals/complete.test.ts` (fixed in `c5f27fd`). Retrieval anchor: `tools/lint-rules/src/test-ports.test.ts`, which runs in every `pnpm test` and in CI, fails on any fixed-port `listen` in a unit test or test helper, and names this lesson.
**Related Lessons:** LL-2026-10-004 (a local gate proves only what it ran), LL-2026-10-001 (re-read state before reporting it).
**Regression / Verification Note:** the guard failed against the pre-fix helper (`server.ts:105`) and passes on the fixed tree; the CLI unit project passed six times in a row after the fix.
**Metrics:**
- Prevented: 2 times (2026-10-15: the Instagram CLI lane captured `EADDRINUSE` on ports 4231 and 4232 in the fill suite, traced the listener to another lane's process and reported the race instead of calling it load; the foundation lane had moved its deletion test to free ports for the same reason)
- Violated: 1 time (2026-10-15, by the parent: two lanes ran the fixed-port browser suites in separate worktrees at the same time, because rule 3 keeps fixed ports only for suites that run serially within one checkout and nothing made those suites serial across worktrees. Fixed-port suites now run in one lane at a time, or a lane gets its own ports.)

### [LL-2026-10-011] 2026-10-13 ORCHESTRATION: Look up your own record of a state before explaining it or asking the person about it

**ID:** LL-2026-10-011
**Severity:** MEDIUM
**Category:** ORCHESTRATION
**Expires:** Never (kernel). File names, dates and record IDs below are dated evidence from 2026-10-13.

**Feedback:** "Das solltest du eigentlich selber wissen. Aber ja, kann sein, dass du es halt vergessen hast." The maintainer, after being asked for the path of his export.
**Problem:** His first signed-in run refused because the workspace had no account name. The agent read the current state correctly (no account file in the import) and then offered two outside causes, a missing file in his export or an adapter gap, and asked him for the export's path. Its own run record said otherwise: when it prepared his cleanup workspace, it had left the account file out on purpose because that file holds his e-mail address.
**5 Whys Analysis:**
1. Why was the person asked? -> The cause looked unknown.
2. Why did it look unknown? -> The agent explained the state from the code and the current data only.
3. Why not from its own record? -> The step that produced the state lay days back, behind context compaction, and the record sat in the shared board, which nothing prompted it to search.
4. Why did nothing prompt it? -> The existing controls require re-reading live state (LL-2026-10-001), not looking up how that state came about.
5. Why? -> Root cause: no control makes the agent search its own run records for the producing step before it names a cause or asks the person.
**Rule(s):**
1. Before explaining a state that your own earlier work could have produced, or asking the person about it, search your own records (board, handoff, session history) for the step that produced it.
2. Ask the person only for what those records cannot contain: their decision, their knowledge, or an action only they can take.
3. When a record shows the state was your own choice, say so plainly before proposing a fix.
**Detection Pattern:** a diagnosis that says something "was not found", "is missing" or "may be a bug" about data the agent itself copied, filtered or imported; a question to the person about files or steps the agent handled.
**Affected Files:** none in the repository. Retrieval anchor: the first block of section 00 in the maintainer's private handoff file, which the parent reads on every resume and before every step on his workspace, names this lesson. A one-line trigger on an always-loaded surface is proposed to the maintainer and needs his approval.
**Related Lessons:** LL-2026-10-001 (re-read live state), LL-2026-10-007 (check what the person will meet before handing over a step).
**Regression / Verification Note:** applied on 2026-10-13 by finding the producing step (the account file left out when the cleanup copy was extracted), telling him so, and choosing a fix that keeps the e-mail out of the workspace.
**Metrics:**
- Prevented: 0 times
- Violated: 0 times

### [LL-2026-10-012] 2026-10-13 PRODUCT: Before asking the person for one more step on an unproven route, weigh what it can still gain against what it costs them

**ID:** LL-2026-10-012
**Severity:** HIGH
**Category:** PRODUCT
**Expires:** Never (kernel). Counts and dates below are dated evidence from 2026-10-13.

**Feedback:** "Ich bin so verwirrt, was wir machen ... wir wollten ja ein super easy ohne Friction Tool haben und jetzt passiert nur ein Haufen Bullshit ... Keine Ahnung, was du überhaupt vorhast oder was jetzt hier passieren soll, was ich machen soll." The maintainer, after his second signed-in test run stopped.
**Problem:** Over two days the maintainer was handed a chain of manual steps on the signed-in route: sign-in scripts, PowerShell commands, test runs. Each step had passed only against generated fake pages and failed on the real one: an unsupported flag, a window that closed by itself, a missing account name, deleted extensions, then X's bot check. Each failure was answered with a fix and the next step. Nobody stopped to ask whether the route still fit his goal, an easy tool with little friction, or whether its remaining gain was worth his effort: at most 325 posts on top of 1,862 originals and 155 videos already saved without his account.
**5 Whys Analysis:**
1. Why was he confused and angry? -> He kept getting new technical steps that failed, with no picture of where it was going.
2. Why did the steps keep failing? -> The route depends on the real pages of a platform that resists automation, and every proof was against fakes.
3. Why was he handed step after step anyway? -> Each failure was treated as one more bug to fix, inside the plan.
4. Why was the plan not questioned? -> The stop-loss rules weigh extra lanes, reviews and reruns for the agent's work, not the person's effort per step against the route's remaining value.
5. Why? -> Root cause: no control compares, before each new request to the person, what the route can still gain with what it costs them and with a simpler route that reaches the same goal.
**Rule(s):**
1. Before asking the person for another manual step on a route not yet proven on the real platform, state in one line what it can still gain, what it costs them, and the simplest other route to the same goal. Recommend the cheaper one when the gain is small.
2. After a second real-world failure on the same route, stop handing out steps: show the person where the goal stands and let the recommendation decide the next move.
3. Measure friction by what the person must do and understand, not by how many defects the agent fixed.
**Detection Pattern:** a third consecutive message that asks the person to run a command or click through a page on the same route; a fix-and-retry loop on a platform behaviour that only the real site shows; a remaining gain that is a small share of what is already done.
**Affected Files:** none in the repository. Retrieval anchor: the first block of section 00 in the maintainer's private handoff file, read before every step on his workspace, names this lesson. A one-line trigger on an always-loaded surface is proposed to the maintainer and needs his approval.
**Related Lessons:** LL-2026-10-007 (accept a feature by what the person has to do and see), LL-2026-10-009 (answer the person's goal before the work), LL-2026-10-011 (look up your own record first).
**Regression / Verification Note:** applied on 2026-10-13 by pausing the signed-in originals pass and laying out his goal, what is done, and one recommended next move.
**Metrics:**
- Prevented: 0 times
- Violated: 0 times

### [LL-2026-10-013] 2026-10-15 VERIFICATION: A failed route proves that route failed, not that the goal is out of reach

**ID:** LL-2026-10-013
**Severity:** HIGH
**Category:** VERIFICATION
**Expires:** Never (kernel). The platform behaviour below is dated evidence from 2026-10-14.

**Feedback:** "Ich würde eher den Test extenden ... am Handy, wenn ich da auf mein Profil gehe ... deine Aktivitäten ... Kommentare ... Ich kann dort sortieren und extrem lang scrollen ... und dann sehe ich dort auch den gesamten Kontext ... Also gib dir ein bisschen Mühe und schau dir das an, das sollte alles möglich sein." The maintainer, after I recommended dropping the Instagram route.
**Problem:** The read-only Instagram spike opened the comments view six times. One route, a mouse wheel over the page with no filter or sort, loaded no further rows, and the rows carried no link. I wrote that the view "loads only about 45 recent comments", that older comments were reachable only by clicking the filter, and recommended withdrawing the plan, although the person uses that same view on his phone daily to sort, scroll far back and open each post. The conclusion rested on one gesture whose failure had several untested explanations: the wrong scroll container, a blocked loader request, the default sort.
**5 Whys Analysis:**
1. Why did I recommend giving up? -> The spike's numbers failed the record's pass criteria, and I read them as the platform's limits.
2. Why as the platform's limits? -> I treated the absence of new rows after mouse-wheel scrolling as proof that the view cannot load them.
3. Why was one gesture enough? -> The card had allowed only scrolling, and I stopped at its edge instead of first exhausting the routes that edge still allowed, and then asking for the routes a person actually uses.
4. Why did I not compare with how the person uses the view? -> I measured the page without asking what a person sees there, although the person had described the view in the plan's own words.
5. Why? -> Root cause: no control distinguishes "this route failed" from "this goal is not reachable" before a recommendation to abandon. Verification law 42 states the distinction for verification claims, but I did not apply it to a feasibility recommendation.
**Rule(s):**
1. Before telling a person a goal is out of reach, name the routes tried, and try at least the route the person or the platform's own interface would use. A failed route is reported as that route's failure.
2. When a probe stops at the edge of its authority, say which further route would answer the question and ask for that route, instead of turning the edge into a verdict.
3. Read an unexpected negative from a live page as a hypothesis about the probe first: scroll container, blocked request, default sort or filter, viewport.
**Detection Pattern:** a recommendation to withdraw or stop that rests on one gesture, one request type or one default setting; a "loads only" or "not possible" claim that the person's everyday use contradicts.
**Affected Files:** docs/LESSONS_ARCHIVE.md. Retrieval anchor: `.kilo/rules/verification-before-completion.md` law 42 ("A failed verification route proves that the route failed, not that the claim cannot be tested. Try another route before recording something as unverifiable."), which loads in every session; rule 1 applies it to feasibility recommendations, so no new always-loaded line is needed.
**Related Lessons:** LL-2026-10-012 (weigh a route's remaining gain before asking for steps; the opposite error), LL-2026-10-009 (answer the person's goal), LL-2026-10-011 (look up your own record first).
**Regression / Verification Note:** applied on 2026-10-15 by widening spike S5 to the person's own routes: sort, date filter, the list's own scroll container and opening posts read-only.
**Metrics:**
- Prevented: 0 times
- Violated: 1 time (2026-10-14, the S5 recommendation above)

### [LL-2026-10-014] 2026-10-15 RECOMMENDATION: A starting limit is a hypothesis to measure, not a margin to defend

**ID:** LL-2026-10-014
**Severity:** HIGH
**Category:** RECOMMENDATION
**Expires:** Never (kernel). The pace values and X's rate-limit numbers below are dated evidence from 2026-10-15.

**Feedback:** "Du sagst, du bremst das, damit wir kein Risiko eingehen, dass der Account gebannt wird. Okay, verstehe ich. Aber das ist ja das Projekt ... so können wir nicht herausfinden, was genau die Grenzen sind, die andere Leute schon getestet haben anhand von anderen Projekten ... das soll ja optimal laufen, sonst nutzen es die Leute ja nicht ... müssen wir halt auch herausfinden, was die perfekten Grenzen sind, an denen man nicht gebannt wird, damit wir halt wirklich da nicht extrem langsam sind." The maintainer, after I recommended keeping the Instagram pass at 200 posts a day.
**Problem:** The signed-in passes run at 30 seconds per page, a 15 minute pause after 20 pages and 200 pages a day. These were starting values on the cards, and ADR-028 says of them "The numbers are IG-3's choices and this record's, not measurements." When he asked whether the work was fully optimized, I advised staying at 200 a day because a locked account would end everything, with no source or measurement on where the platforms' limits lie. X itself had answered on every signed-in post page that its limit for that request is 300 per 15 minutes, and the runs used about a tenth of it. The advice closed the faster option on an unmeasured risk, in a project whose usefulness depends on that speed.
**5 Whys Analysis:**
1. Why did I advise staying at 200? -> I weighed a possible lock against a few days saved and called the lock the bigger cost.
2. Why without numbers? -> I treated the card values as a margin someone had set on evidence, and the record calling them "not measurements" did not stop me.
3. Why did the platform's own signal not count? -> I read the rate-limit header while diagnosing a stop, not as evidence about pace, so it never reached the advice.
4. Why did I defend the value instead of measuring it? -> Caution about his account felt like the responsible default, and no control asks whether a limit that throttles the product was ever measured.
5. Why? -> Root cause: pre-planning law 22 forbids retiring an option on an unmeasured number, but I applied it to effort and duration estimates in planning, not to a risk estimate in a status message. No control separates a measured limit from a starting value when the limit decides how useful the product is.
**Rule(s):**
1. Before recommending that a limit stay where it is, say whether it was measured. A starting value without measurement is a hypothesis, and a limit that decides how useful the product is gets researched or measured, not defended.
2. For platform pace and daily caps the evidence is, in this order: the platform's published limits and its runtime signals such as rate-limit headers and limit notices; the dated, documented experience of comparable tools; and a bounded ramp on the person's account that stops at the platform's first warning sign.
3. Present the risk together with that evidence and the signal that would stop a faster run, and let the person decide about risk to their own account. Speed comes from evidence, never from hiding, spoofing or randomized waits (hard constraint 4 and the fixed waits of ADR-027 to ADR-029).
**Detection Pattern:** "I recommend staying at" or "better slow than locked" with no source or measurement; a value its own record calls "not measurements" used as the reason to keep it; platform rate-limit numbers known from a diagnosis but missing from a pace discussion.
**Affected Files:** docs/LESSONS_ARCHIVE.md. Retrieval anchor: section 00 of the maintainer's handoff file outside the repository, which the parent reads first after every restart; its line carries rule 1 and points here. Pre-planning law 22 stays the always-loaded backstop for estimates in planning.
**Related Lessons:** LL-2026-10-013 (a failed route is not an unreachable goal; the same overcaution in a feasibility verdict), LL-2026-10-009 (answer from his goal), LL-2026-10-012 (weigh what a route can still gain).
**Regression / Verification Note:** applied on 2026-10-15: a primary-source research lane and a separate deep web research ran before the next pace advice; the X reading card was revised from them so it waits on every rate-limit window X reports instead of one, and the run report is to record those windows without values, so later defaults rest on measurements from the person's own session.
**Metrics:**
- Prevented: 0 times
- Violated: 3 times (2026-10-16 09:45: "noch einmal sage ich das ... Finden wir von denen keine nutzbaren Zahlen ... Das habe ich ja schon sehr oft gefragt ... ich verstehe jetzt noch nicht, warum wir da nicht ... gute Zahlen haben". Two research passes had returned usable numbers from comparable tools, but my messages led with the negative finding, that no source names a daily limit, and never put the positive numbers in one table per platform and action next to what we take from them. Application note: when the person asks what others found, answer first with that table, each number with what it measured and where it came from, then the value we use and why, and only then what nobody knows. 2026-10-15, the Instagram pace advice above; and the same evening: "Ich habe dir ja gesagt ... das perfekte Limit finden ... und du sagst noch immer 200 von 200". After his 16:12 instruction I researched and built toward a faster pace, but held it behind a card that needed an exact reply, kept the runs at the old cap and reported "200 von 200" as plain status without saying what the speed-up waited for. Application note: once the person has said to find the limit, that is his risk decision; a card may fix numbers, but building and measuring go ahead, and every status line about a limit says whether it is measured and what step comes next.)

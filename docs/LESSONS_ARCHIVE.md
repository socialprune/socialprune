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
- Violated: 0 times

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
- Prevented: 5 times for rules 1 and 3 (2026-10-08: GD w0 test, GD guide-wiring callsites, C3 schema expectation, C3 e2e TypeScript project, C4 error details; each change went through the lane's task, never a board post)
- Violated: 4 times for rule 2 (2026-10-08: the GD, C3 and C4 tasks each missed a file their deliverable had to change, found only when the lane stopped at it: three CLI tests for the guide wiring, `schemas.test.ts` for `review`, `schemas.ts` and `adapter.ts` for `INVALID_LABELS.details`; the C5 task placed its scripts under the git-ignored `apps/cli/build/` although a pending ADR correction already moved that path to `apps/cli/release/`, and granted a copy-check scope list whose predicate also had to change)

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
- Violated: 2 times (2026-10-08, `b644d80`: CLI path code went out on a Windows-only gate, because rule 3 names only `apps/web`; one test failed on Linux in CI. 2026-10-08, `e1fa812`: the local gate skipped the package build, pack check and packed smoke that CI's cli-package job runs, so a web change that renamed hashed assets failed the pack check only in CI)

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
- Violated: 0 times

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
**Regression / Verification Note:** applied on 2026-10-10 by starting the review for him instead of handing him a command, and by planning the redesign with screenshots for his look before it counts as done.
**Metrics:**
- Prevented: 0 times
- Violated: 0 times

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
- Prevented: 0 times
- Violated: 0 times

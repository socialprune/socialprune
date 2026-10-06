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

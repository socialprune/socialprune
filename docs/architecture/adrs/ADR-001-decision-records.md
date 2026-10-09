# ADR-001: Decision records and supersession

- **Status:** Accepted
- **Date:** 2026-10-06
- **Hard constraints touched:** none directly. This record governs how every later decision that touches them is written down.
- **Related:** all ADRs in this folder

## Context

Until Phase 1 closed, SocialPrune's project decisions lived in the maintainer's private working plan. Phase 2 adds choices that outlive any single change: the workspace file format, the CLI's machine contract, the browser security policy, the storage engines and the dependency license rule. Contributors, reviewers and coding agents need to find those choices, see why they were made, and know which evidence would reopen them.

The repository already treats documented architecture decisions under `docs/architecture/adrs/` as protected governance surfaces (`.kilo/rules/governance-protection.md`). A protected surface needs a written rule for how it may change, or every correction turns into an argument about whether an edit was allowed.

The decision is needed now, before the first Phase 2 implementation node starts, because those nodes cite these records as their acceptance authority.

## Decision Drivers

- A reader must be able to trace each Phase 2 choice to its measured evidence without access to private notes or temporary research folders.
- A decision may change only through a visible, reviewable step, never by quiet rewording.
- Measured numbers, versions and dates go stale. The record must separate the decision from dated evidence.
- The format must already be known to this repository's tooling: the `adr-creation` skill was activated on 2026-10-06.

## Options

### Option 1: One file per decision under `docs/architecture/adrs/`

Each decision gets a numbered Markdown file in the `adr-creation` format: context, drivers, at least two options with pros, cons, effort and risk, the decision, consequences and evidence.

**Pros:**
- Each record has its own history in Git, so a supersession is a new file plus a one-line status change in the old one.
- Pull requests that touch a decision show up as changes to one small file, which keeps review focused.

**Cons:**
- 22 files at the start of Phase 2 is a lot to read. The overview in `docs/architecture/README.md` has to carry the map.
- Cross-references between records can break when files move.

**Effort:** not measured
**Risk:** Low. The format is established and the skill already prescribes it.

### Option 2: One architecture document with a decisions section

All decisions live as sections of `docs/architecture/README.md`.

**Pros:**
- One file to read and search.
- No numbering scheme to maintain.

**Cons:**
- A change to one decision is an edit in a long shared file, so supersession is hard to see in history.
- Protecting the decisions as governance surfaces would also freeze the descriptive overview, which should follow the code.

**Effort:** not measured
**Risk:** Medium. Silent drift between sections is likely.

### Option 3: Decisions in GitHub Discussions or issues

**Pros:**
- Comment threads keep the debate next to the outcome.
- No files in the repository.

**Cons:**
- Content outside the repository is not versioned with the code it governs, and offline readers and agents working on a checkout cannot see it.
- Editing a discussion leaves a weaker audit trail than a commit.

**Effort:** not measured
**Risk:** High. Agents working from a clone would not see the decisions.

## Decision

We chose **Option 1: one file per decision** because it gives every decision its own reviewable history and fits the protected-surface rule that already names this folder.

The rules for these records:

1. **Files.** `ADR-NNN-slug.md`, three-digit numbers starting at `ADR-001`, never reused. The slug is two to four lowercase words.
2. **Status.** `Proposed`, `Accepted`, `Superseded by ADR-NNN` or `Deprecated`. A record is `Proposed` until the maintainer approves it; then the status becomes `Accepted` and `Approved on` gets the date of that approval. Neither line is written ahead of the approval. The index in [README.md](README.md) lists each record with its status.
3. **Change after commit.** An accepted record changes only through a new record that says `Supersedes ADR-NNN` and explains what changed. The old record then receives exactly one edit: its status line becomes `Superseded by ADR-NNN` with a link. Two editorial exceptions need no new record: a link target that moved, and a typo that changes no meaning. Both still need the maintainer's request under the governance rule.
4. **Evidence inside the record.** Each record states the measured numbers and the sources that decided it, with publisher and observation date. Tables shared by several records live in [evidence-2026-10.md](../evidence-2026-10.md). A record never points to a private file, a temporary path or a research folder.
5. **Dated facts.** Versions, sizes, timings and platform behavior are dated evidence. A newer measurement that contradicts one reopens the decision through a superseding record; it does not silently edit the old numbers.
6. **Hard constraints.** Each record names the `AGENTS.md` hard constraints it touches, or says it touches none.
7. **Replaced defaults and decisions.** Where a record replaces a technology default or a project decision made before Phase 1, it says so in one sentence, such as "This replaces the earlier default X", without linking the private plan. The replacement takes effect only when the maintainer approves the record.
8. **Authorship line.** `Decision made by` is `maintainer`, as the `adr-creation` skill requires. Records written by an agent on the maintainer's request carry the same line, stay `Proposed`, and pass an independent review before the maintainer decides on them.
9. **Open questions.** A record that needs a choice only the maintainer can make says so in one line, "Needs the maintainer's decision: …", and stays `Proposed` until he makes it. Once he has decided, that line reads "Decided by the maintainer on YYYY-MM-DD: …" and states his choice.

**Decision made by:** maintainer
**Approved on:** 2026-10-09

## Consequences

### Positive
- A contributor can answer "why IndexedDB and not Dexie" or "why exit code 3 here" from one file, including the numbers that decided it.
- Supersession leaves both the old and the new reasoning in the tree, so later reviewers can see what evidence changed.

### Negative
- Every decision change costs a new file and a review, even for small corrections of a choice.
- Evidence numbers are copied into records, so the evidence document and an ADR can disagree if someone edits one. Rule 5 forbids that, but only review catches it.

### Risks
- **Records drift from code.** Mitigation: each implementation node in Phase 2 cites the ADR it implements in its acceptance proof, and the architecture overview links every record.
- **Status labels claim more than is true.** Mitigation: rule 2 forbids writing `Accepted` or an approval date before the approval, rule 8 requires the independent review, and the review checks each record's evidence against its sources.

## Evidence

- `.kilo/rules/governance-protection.md` lists `docs/architecture/adrs/` as a protected governance surface and requires explicit supersession (its hard law 5). Read at commit `7263d7d` on 2026-10-06.
- `.kilo/skills/adr-creation/SKILL.md` prescribes the record shape, the numbering `ADR-NNN`, `Decision made by: maintainer`, and effort as measured or `not measured`. Activated in this repository on 2026-10-06 and read at commit `7263d7d`.
- `verification-before-completion` hard law 43 (a state label is a claim that needs proof) is the reason for rule 2. Read at commit `7263d7d` on 2026-10-06.

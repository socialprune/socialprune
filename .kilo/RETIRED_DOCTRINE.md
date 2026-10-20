# Retired Doctrine

> **Generated:** 2026-10-20 from the Workflow Lab at commit `30527ec` by `docs/tasks/law-probes/harness/retired-registry.js`
> **Copies:** the same file sits in every repo shell. Change it in the Workflow Lab and distribute it again; a copy is never edited by itself.

Read this before you add a law, a rule, a skill, an agent or a runtime surface. Everything listed here was taken out on purpose. An item comes back only with evidence that it is needed now, such as a new measurement on the model in use, or a repo that runs a model nobody measured. When one comes back, record it here with that evidence.

## Laws removed after measurement

Between 2026-09-24 and 2026-10-20 the Workflow Lab measured the 200 numbered laws in its 16 rule files on the two models its sessions run, Claude Opus 5.5 and GPT-6.1 Sol. 155 laws were removed, 2 were rewritten and 43 stay as they were.

**How a law was measured.** Probe scenarios put a session in a situation where the law matters. Each scenario ran on both models twice, once with the full rules and once without the candidate laws of that round, and a judge model that did not know which arm it was reading scored every answer against the law. A pair where the full rules complied and the cut rules did not was a flag. Every flag was run six more times per arm and counted as a relapse only at a one-sided Fisher p below 0.05. A round passed on a model only when the one-sided 95 % Clopper-Pearson upper bound for the relapse rate stayed below 5 %, which takes at least 59 clean pairs without a confirmed relapse. The first round, on 2026-09-24, re-ran flags three times and was partly judged by Fable 5.1. The 105 laws removed while GPT-6 Sol was the second model were measured again on GPT-6.1 Sol on 2026-10-12, round `back105`, without a confirmed relapse. The ledger with every round is `docs/SHELL_MEASUREMENTS.md` in the Workflow Lab.

**What removed means.** Both models behaved the same without the text in the tested situations. The duty itself is not dropped. Most removed laws are still covered by sections that stayed, and the notes further down name those sections. The rest describe behaviour both models show without being told.

**What it does not cover.** Other models. GPT-6.1 Sol at `xhigh` for the removals before 2026-10-20, which ran at `max`. And every shell except the Workflow Lab itself: `_template` and the child repos got the removals on 2026-10-20 by matching their wording against the Workflow Lab laws, not by their own measurement. A law there was removed when it says the same as the Workflow Lab law or less; it stayed when it adds a duty of its own, or when the section that carries its content in the Workflow Lab is missing in that repo, and the file says so next to the law. A repo that runs another model should watch for the behaviour and restore a law from the wording below when it slips.

Laws are listed by file with the wording they had last. The numbers are the Workflow Lab numbers; a repo whose copy was renumbered has the same wording under another number.

### `backlog-management` (6)

| Law | Removed | Round | Commit | Probe | Gate result |
|---|---|---|---|---|---|
| 1 | 2026-10-02 | fifteen held laws | `4015b16` | `z01` | fifteen held laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 2 | 2026-09-24 | full versus cut | `056a33f` | `v11` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 3 | 2026-09-24 | full versus cut | `056a33f` | `v04` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 4 | 2026-10-19 | round fourteen (r14-screen, kept5-screen, r14-confirm FAIL, r15-confirm) | `54e0801` | `j01` | r15-confirm PASS, Opus 5.5 91 pairs and GPT-6.1 Sol (max) 92 pairs, 0 confirmed |
| 5 | 2026-10-06 | round twelve | `a4c8531` | `q01 z02` | round twelve gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 6 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r01` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |

The removed wording:

> 1. The backlog is not a same-scope escape hatch.

> 2. Work required to satisfy the current task boundary may not be labeled deferred.

> 3. Deferral is allowed only when value, priority, or prerequisites genuinely support doing the work later.

> 4. Deferred work must be captured as an explicit backlog entry, not a narrative handwave.

> 5. If deferral reasoning is weak, vague, or convenience-driven, the default action is to finish the active task instead.

> 6. Thin constitutional guidance stays here; detailed scoring and evaluation procedure belong in skill space.

### `continuous-learning` (8)

| Law | Removed | Round | Commit | Probe | Gate result |
|---|---|---|---|---|---|
| 1 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r02` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |
| 2 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `y21` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 3 | 2026-10-19 | round fourteen (r14-screen, kept5-screen, r14-confirm FAIL, r15-confirm) | `54e0801` | `u06` | r15-confirm PASS, Opus 5.5 91 pairs and GPT-6.1 Sol (max) 92 pairs, 0 confirmed |
| 4 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r03` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |
| 5 | 2026-10-02 | fifteen held laws | `4015b16` | `z03` | fifteen held laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 6 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r04` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |
| 7 | 2026-09-24 | full versus cut | `056a33f` | `u03` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 9 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `u26` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |

The removed wording:

> 1. Relevant lessons must be retrieved before non-trivial work.

> 2. User criticism or high-signal correction must be converted into durable learning in the same flow, either by adding a new lesson or by explicitly mapping to an existing lesson and applying it.

> 3. Repeated mistakes are constitutional failures.

> 4. Learning must influence the current task rather than being archived and ignored.

> 5. Thin always-on law stays here; detailed lesson workflow belongs in procedural skill space.

> 6. After criticism or a high-signal correction is detected, the workflow must not continue substantive task progress until durable learning has been captured or explicitly mapped to an existing lesson and applied.

> 7. A lesson that mandates a pre-action check is not durably captured until its trigger also exists on a surface the actor reads at the moment of that action.

> 9. A lesson's permanence applies to its rule kernel. Measured thresholds, external behavior, versions, paths, and command names inside it are dated evidence and do not inherit that permanence.

### `cross-reference-hygiene` (6)

| Law | Removed | Round | Commit | Probe | Gate result |
|---|---|---|---|---|---|
| 1 | 2026-09-24 | full versus cut | `056a33f` | `y02` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 1a | 2026-09-24 | full versus cut | `056a33f` | `x01` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 2 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r06` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |
| 3 | 2026-09-24 | full versus cut | `056a33f` | `u02` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 4 | 2026-10-06 | round twelve | `a4c8531` | `q02 z04` | round twelve gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 5 | 2026-09-24 | full versus cut | `056a33f` | `x18` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |

The removed wording:

> 1. Active references must point to real files.

> 1a. Registration is bidirectional. A declared component must exist, and an existing component that the runtime is expected to load must be declared. Check both directions, because an undeclared file is as invisible as a dead reference is broken.

> 2. Source-of-truth references and version-linked references must remain aligned when the source changes.

> 3. Shared doctrine must not silently drift across files.

> 4. Lower-authority or historical references may not override active canonical sources.

> 5. Workflow Bible drift is cross-reference drift when a workflow rule, skill, agent, support doc, or derivation standard changes.

### `cwos-core` (4)

| Law | Removed | Round | Commit | Probe | Gate result |
|---|---|---|---|---|---|
| 1 | 2026-10-20 | round sixteen (r16-screen, r16-confirm) | `d23089d` | `n01` | r16-confirm PASS, Opus 5.5 93 pairs and GPT-6.1 Sol (xhigh) 97 pairs, 0 confirmed |
| 2 | 2026-09-24 | full versus cut | `056a33f` | `v09` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 4 | 2026-10-02 | fifteen held laws | `4015b16` | `z05` | fifteen held laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 5 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `u21` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |

The removed wording:

> 1. Non-trivial delegated work must produce structured protocol or handoff data.

> 2. Knowledge discovered in one lane must be passable to later lanes.

> 4. Fresh-context artifact handoff remains the default posture for delegated work.

> 5. Procedural detail such as exact templates, log mechanics, and audit formatting belongs outside this constitutional rule.

### `fiona-completion-contract` (7)

| Law | Removed | Round | Commit | Probe | Gate result |
|---|---|---|---|---|---|
| 1 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `x19` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 2 | 2026-10-06 | round twelve | `a4c8531` | `q03 z06` | round twelve gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 3 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `y03` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 4 | 2026-09-24 | full versus cut | `056a33f` | `u14` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 5 | 2026-09-24 | full versus cut | `056a33f` | `y23` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 6 | 2026-09-24 | full versus cut | `056a33f` | `v13` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 7 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `x03` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |

The removed wording:

> 1. Operator-facing completion must emit machine-readable closure metadata when Fiona integration applies.

> 2. Closure metadata must distinguish `done`, `blocked`, and `needs_review`.

> 3. Closure artifacts must reflect actual changed files and actual blockers.

> 4. Machine-readable closure may not be replaced by narrative-only completion language.

> 5. Exact schema, filename conventions, and parser examples belong outside the constitutional core.

> 6. When CWOS lane outcomes feed final closure, terminal status must be normalized via the Fiona companion rather than improvised ad hoc.

> 7. Before emitting `done`, apply the accepted end state's Git delivery requirement. Pending expected delivery normalizes to `needs_review`; delivery excluded by the accepted end state may be recorded as `not required` in notes.

### `human-writing-style` (24)

| Law | Removed | Round | Commit | Probe | Gate result |
|---|---|---|---|---|---|
| 1 | 2026-10-02 | fifteen held laws | `4015b16` | `z07` | fifteen held laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 2 | 2026-09-24 | full versus cut | `056a33f` | `x20` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 3 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r09` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |
| 4 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `y04` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 5 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `y24` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 6 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r10` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |
| 7 | 2026-09-24 | full versus cut | `056a33f` | `y25` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 8 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `x04` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 9 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r11` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |
| 10 | 2026-09-24 | full versus cut | `056a33f` | `x21` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 11 | 2026-10-06 | round twelve | `a4c8531` | `q04 z08` | round twelve gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 12 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `x05` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 13 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r12` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |
| 14 | 2026-09-24 | full versus cut | `056a33f` | `y26` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 15 | 2026-10-19 | round fourteen (r14-screen, kept5-screen, r14-confirm FAIL, r15-confirm) | `54e0801` | `j05` | r15-confirm PASS, Opus 5.5 91 pairs and GPT-6.1 Sol (max) 92 pairs, 0 confirmed |
| 16 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `x22` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 17 | 2026-09-24 | full versus cut | `056a33f` | `x06` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 18 | 2026-10-20 | round sixteen (r16-screen, r16-confirm) | `d23089d` | `n02` | r16-confirm PASS, Opus 5.5 93 pairs and GPT-6.1 Sol (xhigh) 97 pairs, 0 confirmed |
| 19 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `x23` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 20 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `v10` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 23 | 2026-10-02 | fifteen held laws | `4015b16` | `z09` | fifteen held laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 24 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `v01` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 26 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r17` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |
| 27 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `y27` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |

The removed wording:

> 1. Prefer concrete statements over vague framing or abstract uplift language.

> 2. Cut assistant-style polish such as empty transitions, hype, or ceremonial reassurance.

> 3. Do not pad doctrine with consultant fog, brand voice, or managerial rhetoric.

> 4. Avoid over-symmetric wording that reads generated instead of written.

> 5. If a shorter, plainer sentence says the same thing, prefer it.

> 6. Keep the actor, action, and condition visible when guidance is operational.

> 7. Match the register to the artifact type instead of treating every output as the same kind of professional prose.

> 8. In technical reports, prefer precise active wording over needless passive or stiff phrasing unless a required format says otherwise.

> 9. Never write em dashes or en dashes in generated prose. Use a comma, a connective, or a new sentence. Reach for a colon last, because swapping one punctuation tell for another only moves the fingerprint. This is the strongest single AI tell and it overrides any density-based tolerance.

> 10. Do not use contraction apostrophes in German prose. Write `gibt es` and `würde es`, not `gibt's` or `würd's`.

> 11. Public contribution artifacts carry the same voice. GitHub issue bodies, pull request titles and bodies, review comments, and commit messages are operator-authored text, not assistant output.

> 12. Do not announce a statement before making it. Delete the framing clause and state the finding.

> 13. Never degrade German umlauts or `ß` to `ae`, `oe`, `ue`, or `ss` in delivered text. A transport that cannot carry them is the thing to fix.

> 14. A reference to the operator's own voice is usable only when a real sample backs it. An abstract reference with no sample is a dangling pointer, and the register becomes a guess.

> 15. Carry the voice markers in this rule, not only behind a pointer. A rule arrives in every session; a skill arrives only in a session started after it existed, and only when something loads it. Measured on 2026-08-19: a pointer to the skill produced no voice change at all, because no agent followed it on its own.

> 16. Public GitHub contribution prose must be proportional to the change. Do not turn a small fix into a complete engineering report.

> 17. A contribution body explains why the change exists, not only what the diff contains. Preserve the real causal thread when it exists, and never invent first-person experience. When no first-person account exists, state the previous behavior's observable effect in third person. Missing personal experience does not remove the reason.

> 18. Evidence stays concrete but selective. Keep what a reviewer needs for the claim, one non-obvious decision when relevant, and one bounded uncertainty when it matters. Cut exhaustive inventory and future plans.

> 19. Headings are earned by reviewer decisions or a required repository template. `Summary`, `Changes`, `Testing`, `Scope`, `Risks`, and `Non-goals` are not an automatic contribution shape.

> 20. Git-hosted text carries the operator voice: issue bodies, pull request bodies, review comments, and conversation replies. Where a repository mandates a template or a commit convention, follow the format and keep the voice inside it. Customer copy, board papers, and formal documents stay outside this allowance. Never manufacture typos, broken grammar, aggressive slang, unreadable punctuation, or emojis.

> 23. Apply the portability test. If a sentence could move unchanged to another person, company, product, or repository, it is filler. Replace it with a fact, mechanism, consequence, or judgment specific to this subject, or cut it.

> 24. Show the point instead of labelling it. Let facts, actions, and consequences carry the emphasis, and delete commentary that tells the reader something is important, surprising, subtle, or obvious.

> 26. Do not use a colon to promote a clause into a label. When the left side only names or summarizes the right side, write a connective or a new sentence instead. Colons stay legitimate for lists, quotes, real tags such as `Note:`, and paired values. Keep at most one explanatory colon per section and never two in one paragraph.

> 27. A reply is not a compliment sandwich. Answer the point and stop. Do not open with praise for the other person, do not justify a decision nobody questioned, and do not pre-apologize for a limit that has not become a problem yet.

### `knowledge-accumulation` (7)

| Law | Removed | Round | Commit | Probe | Gate result |
|---|---|---|---|---|---|
| 1 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r18` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |
| 3 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `x08` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 4 | 2026-10-06 | round twelve | `a4c8531` | `q05 z10` | round twelve gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 5 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `y08` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 6 | 2026-10-02 | fifteen held laws | `4015b16` | `z11` | fifteen held laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 7 | 2026-10-20 | round sixteen (r16-screen, r16-confirm) | `d23089d` | `n03` | r16-confirm PASS, Opus 5.5 93 pairs and GPT-6.1 Sol (xhigh) 97 pairs, 0 confirmed |
| 8 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r19` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |

The removed wording:

> 1. In multi-lane or multi-round work, the next lane must receive the important knowledge from earlier lanes.

> 3. The next lane may receive this as a compact `prior_knowledge` block, a task artifact section, or a clearly equivalent handoff.

> 4. Every non-trivial lane should contribute new knowledge back into the pass-forward set when it learns something material.

> 5. Single-lane trivial work is exempt.

> 6. Reuse unchanged evidence. Invalidate it when its source, schema, generated output, fixtures, runtime identity, or merge resolution changes.

> 7. Fresh context is selective, not universal. Reserve it where independent reconstruction adds value, especially final acceptance and security, recovery, or transaction review.

> 8. Pass forward the active contract, current phase, long-lived domain ownership, foundation-gate state, next ready nodes, and reusable proof when later work depends on them.

### `pre-planning-mandate` (15)

| Law | Removed | Round | Commit | Probe | Gate result |
|---|---|---|---|---|---|
| 3 | 2026-09-24 | full versus cut | `056a33f` | `x25` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 5 | 2026-10-06 | round twelve | `a4c8531` | `q06 z12` | round twelve gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 6 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `u24` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 7 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `u22` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 9 | 2026-10-19 | round fourteen (r14-screen, kept5-screen, r14-confirm FAIL, r15-confirm) | `54e0801` | `u23` | r15-confirm PASS, Opus 5.5 91 pairs and GPT-6.1 Sol (max) 92 pairs, 0 confirmed |
| 10 | 2026-09-24 | full versus cut | `056a33f` | `y09` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 11 | 2026-10-20 | round sixteen (r16-screen, r16-confirm) | `d23089d` | `n04` | r16-confirm PASS, Opus 5.5 93 pairs and GPT-6.1 Sol (xhigh) 97 pairs, 0 confirmed |
| 12 | 2026-10-06 | round twelve | `a4c8531` | `q07 z14` | round twelve gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 13 | 2026-09-24 | full versus cut | `056a33f` | `u16` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 16 | 2026-09-24 | full versus cut | `056a33f` | `x10` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 17 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `u13` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 18 | 2026-09-24 | full versus cut | `056a33f` | `u07` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 19 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `x27` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 22 | 2026-09-24 | full versus cut | `056a33f` | `y10` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 23 | 2026-10-06 | round twelve | `a4c8531` | `q08 z16` | round twelve gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |

The removed wording:

> 3. The analysis may be inline (a brief section in the execution artifact) or use the `pre-planning` skill for deeper work. The obligation is the analysis, not the format.

> 5. "I will figure it out as I go" is not an acceptable substitute for pre-analysis on complex work.

> 6. Security sensitivity determines required safety controls, not orchestration depth by itself. Runtime, gateway, provider, credential, and security vocabulary alone does not make work Complexity 4.

> 7. A known exact change on no more than two authoritative config/runtime surfaces may use inline pre-analysis when it is backupable, atomic, deterministically validatable, directly canary-testable, and has no migration, irreversible external action, open architecture decision, or unknown cause.

> 9. A bounded wave is legal only when its nodes have disjoint write sets and distinct acceptance results. Shared files or semantic contracts require a foundation/integration owner or baton pass.

> 10. A dependent or downstream node may start only after every foundation prerequisite has completed and satisfied its named proof gate. Until then, keep it inactive or use a baton pass.

> 11. Planning exists to expose safe concurrency and stop conditions, not to create ceremony. Inline or existing records are valid when they preserve the contract and proof map.

> 12. Complexity is evaluated inside the accepted plan. A new user restriction can remove a node immediately; a continuation instruction resumes authorized phases and does not authorize an invented deployment, activation, surface, or write domain.

> 13. `100/100` alone is a quality target, not a Complexity-4, convergence, reviewer-wave, or test-writer trigger. It changes topology only with real cross-cutting risk or an explicit adversarial/independent acceptance requirement.

> 16. Before adding any extra lane, reviewer, test-writer, broad rerun, or revision, record remaining acceptance classes, missing/invalidated evidence, owner insufficiency, unique expected evidence, and coordination cost. No new risk class or independent-authority requirement means no extra work.

> 17. Approval boundaries must distinguish human-simple confirmation from machine-bound authorization. Plan one fresh pending card, exact visible terms and selected items, thread/expiry binding, most-recent immediate-presentation binding, explicit supersession plus replacement versioning for any changed term/effect, fail-closed confirmation of superseded cards, and whether approval confirms, queues, or executes.

> 18. When implementation is intended for upstream or the accepted end state includes a normal ready pull request, proportional Contribution Fit must be decided before editing.

> 19. Contribution Fit must connect capability-gap proof to the affected architecture owner and observed design intent, maintainer-intent evidence or an explicit unknown, material alternatives and tradeoffs, contribution type, and implementation admission.

> 22. An effort, cost, or duration estimate that closes an option is a claim and carries the same evidence burden as any other claim. Do not retire an option on an unmeasured number.

> 23. When the cheapest way to learn the cost is to run the thing once, run it. A bounded trial beats an estimate, and its result replaces the guess rather than confirming it.

### `registered-session-lifecycle` (6)

| Law | Removed | Round | Commit | Probe | Gate result |
|---|---|---|---|---|---|
| 1 | 2026-10-19 | round fourteen (r14-screen, kept5-screen, r14-confirm FAIL, r15-confirm) | `54e0801` | `g01` | r15-confirm PASS, Opus 5.5 91 pairs and GPT-6.1 Sol (max) 92 pairs, 0 confirmed |
| 6 | 2026-10-19 | round fourteen (r14-screen, kept5-screen, r14-confirm FAIL, r15-confirm) | `54e0801` | `g02` | r15-confirm PASS, Opus 5.5 91 pairs and GPT-6.1 Sol (max) 92 pairs, 0 confirmed |
| 7 | 2026-10-19 | round fourteen (r14-screen, kept5-screen, r14-confirm FAIL, r15-confirm) | `54e0801` | `g03` | r15-confirm PASS, Opus 5.5 91 pairs and GPT-6.1 Sol (max) 92 pairs, 0 confirmed |
| 8 | 2026-10-19 | round fourteen (r14-screen, kept5-screen, r14-confirm FAIL, r15-confirm) | `54e0801` | `g04` | r15-confirm PASS, Opus 5.5 91 pairs and GPT-6.1 Sol (max) 92 pairs, 0 confirmed |
| 12 | 2026-10-19 | round fourteen (r14-screen, kept5-screen, r14-confirm FAIL, r15-confirm) | `54e0801` | `g05` | r15-confirm PASS, Opus 5.5 91 pairs and GPT-6.1 Sol (max) 92 pairs, 0 confirmed |
| 13 | 2026-10-19 | round fourteen (r14-screen, kept5-screen, r14-confirm FAIL, r15-confirm) | `54e0801` | `g06` | r15-confirm PASS, Opus 5.5 91 pairs and GPT-6.1 Sol (max) 92 pairs, 0 confirmed |

The removed wording:

> 1. Admit visible sessions only with explicit user authorization AND useful independent context or long-lived ownership. Give each writer a disjoint write set and distinct acceptance result. Duration alone, a command, a measurement, or generic orchestration wording is not admission. The 30-minute routing heuristic is not a guessed cost that may close an option.

> 6. Every child-prompt template carries the full compact obligations checklist from Session Steering, filled for that child. A rule link alone is insufficient. A child that becomes a parent repeats the checklist and registration sequence at its own level, without widening authority.

> 7. A parent remains accountable for accepted work, descendant reconciliation, integration and next authorized actions. Idle is an observation, not completion; a delegating lane is not finished because its own turn ended. A wake with open authorized work requires a prompt to the existing owner or a recorded concrete blocker. Report-only handling is insufficient.

> 8. Preserve permission, question, approval, pause, and stop boundaries. A wake does not answer a question, approve a plan, or grant commit/push authority. Do not continue paused/stopped sessions or bypass pending permission/question requests. Preserve pending approval through handoff.

> 12. Closure order is verified task -> compact documentation/evidence -> authorized commit -> authorized push with direct remote SHA equality -> explicit deregistration and readback. Parent acceptance independently checks the exact task state and remote identity; a child PASS is not acceptance. Read-only or local-only delivery exceptions must be explicit in the accepted contract. Missing approval for required delivery leaves pending delivery and registration, not false completion or automatic repeat nudges.

> 13. The current owner stops its own task processes and verifies they stopped before normal closure. Never kill a foreign process or infrastructure carrying the current session. A delegating parent reconciles owned descendants; an ambiguous session/process identity blocks a stop.

### `skill-usage-discipline` (11)

| Law | Removed | Round | Commit | Probe | Gate result |
|---|---|---|---|---|---|
| 2 | 2026-09-24 | full versus cut | `056a33f` | `u04` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 4 | 2026-09-24 | full versus cut | `056a33f` | `y30` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 5 | 2026-09-24 | full versus cut | `056a33f` | `y11` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 6 | 2026-10-02 | fifteen held laws | `4015b16` | `z17` | fifteen held laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 8 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r28` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |
| 9 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `u05` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 10 | 2026-09-24 | full versus cut | `056a33f` | `u12` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 11 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `y31` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 12 | 2026-10-19 | round fourteen (r14-screen, kept5-screen, r14-confirm FAIL, r15-confirm) | `54e0801` | `u08` | r15-confirm PASS, Opus 5.5 91 pairs and GPT-6.1 Sol (max) 92 pairs, 0 confirmed |
| 14 | 2026-10-06 | round twelve | `a4c8531` | `q09 z18` | round twelve gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 15 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `u19` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |

The removed wording:

> 2. Load the primary skill when its trigger and behavior change fit the concrete phase action.

> 4. A trigger keyword, catalog match, typical pairing, or companion hint is not enough to admit another skill.

> 5. Do not invent ad-hoc procedures when the admitted primary skill already covers the capability.

> 6. Do not load skills that clearly do not change the current phase just to appear thorough.

> 8. A skill's typical pairing or companion note is conditional guidance, not an automatic trigger chain.

> 9. Skill loading must not manufacture a larger topology. Topology follows the task's actual uncertainty and risk, not the number of skills named.

> 10. Evaluate skill applicability against the Active Execution Contract. Loading a skill authorizes no phase, lane, artifact, surface, write domain, deployment, or approval-bound action.

> 11. Prefer partial application of the relevant procedure when only part of a skill fits. Do not load or execute unrelated companion machinery.

> 12. Skill checks must not block already-safe parallel-ready nodes. Companion guidance remains conditional and may not serialize work without a real dependency or risk gate.

> 14. `context-management` requires real continuity, handoff, or recovery complexity; `continuous-learning` requires criticism or a lesson signal; `refactoring-safe` requires structural transformation with behavior preservation.

> 15. A skill name, `100/100`, logger wording, or generic orchestration language does not enlarge topology. `complex-implementation-convergence` requires real cross-cutting risk, repeated distinct gap classes, contradictory evidence, migration/recovery/irreversibility, or an explicit adversarial/independent acceptance request.

### `task-documentation` (10)

| Law | Removed | Round | Commit | Probe | Gate result |
|---|---|---|---|---|---|
| 1 | 2026-09-24 | full versus cut | `056a33f` | `u11` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 2 | 2026-09-24 | full versus cut | `056a33f` | `u15` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 4 | 2026-09-24 | full versus cut | `056a33f` | `u20` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 5a | 2026-09-24 | full versus cut | `056a33f` | `y12` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 6 | 2026-10-06 | round twelve | `a4c8531` | `q10 z20` | round twelve gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 7 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `y32` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 8 | 2026-10-20 | round sixteen (r16-screen, r16-confirm) | `d23089d` | `n05` | r16-confirm PASS, Opus 5.5 93 pairs and GPT-6.1 Sol (xhigh) 97 pairs, 0 confirmed |
| 9 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r31` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |
| 10 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r32` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |
| 11 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `u18` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |

The removed wording:

> 1. The newest user request and Active Execution Contract determine write authority. A skill, agent, mode, template, task procedure, tool capability, frontmatter permission, or artifact default never creates it.

> 2. If the task is read-only, inspection-only, explanation-only, planning-only without authorized writes, or has no authorized write domain, render plans, contracts, handoffs, protocols, explanations, and evidence inline. Do not create `.kilo/plans/`, `docs/tasks/`, checkpoints, reports, evidence files, temporary task files, task directories, or any other filesystem artifact, and do not request write permission merely to satisfy a template.

> 4. Temporary storage is not a loophole. Read-only work may not create `%LOCALAPPDATA%\Temp\kilo` task files unless the user or an accepted runtime operation explicitly authorizes temporary output.

> 5a. Temp scratch is reachable by the built-in read, write, and shell tools and is **not** reachable by `semantic_search` or the MCP filesystem tools, which are bounded to the workspace. Retrieve temp scratch by exact path. Do not search it, and do not treat the resulting `path must be within the current workspace` refusal as a fault to work around. Measured 2026-08-19: 55 blocked calls in 30 days came from searching the mandated scratch path.

> 6. Durable task evidence is legal only when the user explicitly requests or authorizes it, the accepted end state requires repository delivery, or it has named lasting recovery, compliance, forensic, irreversible-operation, or explicit cross-session handoff value. Keep it to at most one compact execution/decision artifact, one validation artifact, and one closure artifact when the applicable closure contract requires it.

> 7. Do not create per-lane reports, per-round narratives, duplicate manifests, or committed raw-output warehouses.

> 8. Before commit, classify every changed or untracked path as product/source, durable test, migration, operational documentation, compact task evidence, generated/staging, or unrelated pre-existing work.

> 9. Stage exact task-owned paths only. Generated/staging and unrelated paths remain unstaged; task-owned residue must receive an explicit terminal action rather than being ignored.

> 10. Default execution truth to one inline/shared board containing source identity, active owner, open invariant classes, reusable proof, invalidated proof, next ready node, and execution-budget state.

> 11. Without artifact authority, stay inline or fail closed as `needs_context` / `blocked`; do not take a permission-seeking artifact detour.

### `tool-usage-discipline` (8)

| Law | Removed | Round | Commit | Probe | Gate result |
|---|---|---|---|---|---|
| 1 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `y13` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 2 | 2026-10-02 | fifteen held laws | `4015b16` | `z21` | fifteen held laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 3 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r33` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |
| 4 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `x29` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 6 | 2026-10-19 | round fourteen (r14-screen, kept5-screen, r14-confirm FAIL, r15-confirm) | `54e0801` | `r35` | r15-confirm PASS, Opus 5.5 91 pairs and GPT-6.1 Sol (max) 92 pairs, 0 confirmed |
| 7 | 2026-09-24 | full versus cut | `056a33f` | `v06` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 9 | 2026-09-24 | full versus cut | `056a33f` | `x13` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 11 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r38` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |

The removed wording:

> 1. Shell or command tools must not create, modify, delete, or move files as a general editing path.

> 2. Dedicated file tools remain the default path for file CRUD.

> 3. Controlled shell copy is allowed when no dedicated copy primitive is available and the operation is copy-only, bounded, and verified.

> 4. File-truth discipline is a quality law, not just a convenience preference.

> 6. Thin constitutional guidance stays here; long operational examples belong outside the constitutional core.

> 7. Long commands, development services, watchers, and acceptance runs must use the tracked background-process tool. Inspect lifecycle status and logs with separate calls instead of blocking a lane on a long runner.

> 9. Agent Manager visible sessions, worktrees, and model comparisons may be started only when the user explicitly requests those exact things. Generic requests to orchestrate, parallelize, or reach 100/100 do not authorize Agent Manager. When that authority exists, load `session-steering` before the first dispatch: a sibling session does not inherit this conversation, so its task, deliverable, boundaries, and stop condition must be cut before it is started.

> 11. GitHub mutations and readback must be non-interactive and pager-free. A successful mutation command, URL, or exit code is not effect proof when the accepted claim depends on the hosted object; read the object back with `gh` and compare it to the frozen expected identity.

### `verification-before-completion` (38)

| Law | Removed | Round | Commit | Probe | Gate result |
|---|---|---|---|---|---|
| 1 | 2026-09-24 | full versus cut | `056a33f` | `y34` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 2 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r39` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |
| 3 | 2026-10-02 | fifteen held laws | `4015b16` | `z23` | fifteen held laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 4 | 2026-09-24 | full versus cut | `056a33f` | `u10` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 5 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r40` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |
| 6 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r41` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |
| 7 | 2026-10-06 | round twelve | `a4c8531` | `q12 z24` | round twelve gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 8 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r42` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |
| 9 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r43` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |
| 10 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r44` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |
| 11 | 2026-10-02 | fifteen held laws | `4015b16` | `z25` | fifteen held laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 12 | 2026-09-24 | full versus cut | `056a33f` | `x14` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 13 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r45` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |
| 15 | 2026-10-06 | round twelve | `a4c8531` | `q13 z26` | round twelve gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 16 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r47` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |
| 17 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r48` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |
| 18 | 2026-10-02 | fifteen held laws | `4015b16` | `z27` | fifteen held laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 19 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r49` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |
| 20 | 2026-10-20 | round sixteen (r16-screen, r16-confirm) | `d23089d` | `n06` | r16-confirm PASS, Opus 5.5 93 pairs and GPT-6.1 Sol (xhigh) 97 pairs, 0 confirmed |
| 21 | 2026-10-06 | round twelve | `a4c8531` | `q14 z28` | round twelve gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 22 | 2026-10-02 | fifteen held laws | `4015b16` | `z29` | fifteen held laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 23 | 2026-10-06 | round twelve | `a4c8531` | `q15 z30` | round twelve gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 24 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `y35` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 25 | 2026-10-06 | round twelve | `a4c8531` | `z31` | round twelve gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 26 | 2026-09-24 | full versus cut | `056a33f` | `x32` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 27 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `x16` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 28 | 2026-09-24 | full versus cut | `056a33f` | `v07` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 29 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r51` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |
| 30 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `v05` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 31 | 2026-10-06 | round twelve | `a4c8531` | `q16 z32` | round twelve gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 32 | 2026-09-24 | full versus cut | `056a33f` | `y16` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 34 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r52` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |
| 35 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r53` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |
| 36 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `y17` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 37 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r54` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |
| 39 | 2026-10-02 | fifteen held laws | `4015b16` | `z33` | fifteen held laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 40 | 2026-09-24 | full versus cut | `056a33f` | `y18` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 41 | 2026-09-24 | full versus cut | `056a33f` | `y38` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |

The removed wording:

> 1. Fresh evidence is required for every completion claim.

> 2. Pattern familiarity never substitutes for proof.

> 3. "Should work" language is not evidence.

> 4. Missing or stale verification means completion is not yet allowed.

> 5. When wiring risk exists, wiring must be verified explicitly rather than assumed.

> 6. Verification proof must have a visible shape: what was checked, how it was checked, and what result was observed.

> 7. Deterministic checks come first; semantic review follows only after the deterministic proof path is satisfied.

> 8. Evidence may prove more than one related claim. A single fail-closed structured check is sufficient when it directly covers those claims.

> 9. Unchanged claims do not need to be re-proven in every lane unless independent acceptance requires a fresh observation.

> 10. During implementation, run focused checks against the changed invariant. Use Direct Proof Closure when those checks decisively prove a bounded contract.

> 11. Broad-suite evidence belongs to one frozen executable source identity and dependency surface. It stays valid only while the executable source covered by the suite, shared contracts, schema, fixtures, generated output, runtime identity, and merge resolution remain unchanged.

> 12. Documentation-only or demonstrably isolated changes outside that proof boundary do not invalidate broad-suite evidence. A targeted executable revision does invalidate the suite it changes; rerun focused proof and the invalidated broad suite against the new frozen executable source identity.

> 13. Integrated Independent Acceptance is required for shared-contract convergence, migration/backfill, recovery, irreversible or external effects, cross-domain runtime coupling, contradictory evidence, or an explicit acceptance requirement. It is not universal.

> 15. A successful phase or foundation gate releases already-authorized downstream nodes. It does not expand the plan or trigger a user permission prompt.

> 16. Terminal truth must distinguish `implementation complete`, `validation complete`, `committed`, `pushed`, `PR published`, and `PR identity verified` when those states belong to the accepted end state; one state may not stand in for another.

> 17. Git delivery is required only when the accepted target end state includes durable repository delivery. Inspection-only work, local prototypes, or other explicitly local outcomes may record delivery as `not required`.

> 18. Commit and push execute without re-prompt only when the accepted plan or newest user request already authorizes them. Otherwise they remain visibly pending.

> 19. When durable delivery is required, task-owned uncommitted residue, commits ahead of the tracked upstream, or missing fresh push evidence block full-completion, no-open-points, and safe-to-close language. A validation PASS may still be reported separately.

> 20. Unrelated dirty state is not task residue. Keep it untouched and list it separately from the exact task-owned state.

> 21. Green tests prove only the phase they cover. Report implementation, validation, Git delivery, migration/deploy, runtime wiring, reconciliation, and activation separately when those phases belong to the accepted end state.

> 22. Every in-scope test must be `canonical-required`, `replaced-and-retired-in-this-change`, or `optional-but-compiling-with-current-signatures`. A skipped stale test is a failure, not coverage.

> 23. Scenario names are not proof. Assert the claimed state change, durable effect, or negative boundary.

> 24. Fault injection and test mutations must be unreachable through production entrypoints and normal runtime environments. PASS requires a test-only entrypoint or injected dependency plus negative reachability proof.

> 25. Cross-process acceptance starts with the executable foundation gate before a large matrix or broad review. Downstream evidence is invalid if the real API/worker/shared-state foundation never ran.

> 26. Independent acceptance requires fresh judgment against the frozen contract, not rerunning unchanged raw proof. Reviewers reuse valid producer evidence, check source identity/freshness, and take bounded high-risk samples.

> 27. Required tests failing, required proof missing, required harness behavior incomplete, or a fixable same-scope failure blocks `done` and `done_with_concerns`; the honest state is `revision` or `blocked`.

> 28. Final PASS is forbidden when the broad-suite evidence belongs to a stale executable source identity or no longer matches its recorded dependency surface.

> 29. Approval is not external-capability admission and is not proof that an external effect occurred.

> 30. Retry, ambiguity, reconciliation, compensation, or external capability adoption claims require the matching P5 or P7 proof bundle; do not substitute process exit, approval, or record presence.

> 31. At a safety boundary, prove the negative or alternate branch whose failure causes harm, not only the branch that is convenient to reach. Distinct confirm/decline, allow/deny, success/recovery, or apply/rollback paths require distinct proof when their failure effects differ.

> 32. A verification or documentation claim may cover only the entrypoint, transitions, branches, effects, and assertions actually exercised. A synthetic terminal-state setup or adjacent safe branch proves only that narrower behavior; generalizing it to the whole mechanism is a verification defect.

> 34. Pull-request publication is optional and applies only when the accepted target end state includes a PR. In that state, a successful push, PR creation command, or returned URL is not terminal proof.

> 35. Published PR Identity requires readback of the actual hosting object. For GitHub, use `gh` to prove the canonical repository identities, tested/pushed/head commit binding, base and head identities, state/draft status, commit and changed-file scope, title/body, intended material metadata, and required current checks.

> 36. The tested final commit must equal the pushed fork-branch SHA and PR head SHA unless a later mutation is freshly revalidated. Head, base, source, scope, metadata, or check mutation invalidates the affected identity claim.

> 37. Public contribution metadata must not add unsolicited AI, model, tool, generated-by, or co-author attribution unless the user requests it or the target repository requires it.

> 39. A capped, paged, or truncated result is a resource limit, not a count. Prove completeness separately before a claim depends on it.

> 40. A control that can trigger materially different actions must match on exact parsed identity, never on a substring or prefix.

> 41. A verification step may not carry a destructive effect. Inspect any script, wrapper, or entrypoint a verification plan invokes, and require explicit consent before anything that resets, flushes, seeds, drops, truncates, or replaces live state. Verification depth never authorizes destruction.

### `wiring-verification` (5)

| Law | Removed | Round | Commit | Probe | Gate result |
|---|---|---|---|---|---|
| 1 | 2026-09-24 | full versus cut | `056a33f` | `y39` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 2 | 2026-10-16 | round thirteen (r13-screen, r13-confirm) | `0e91f39` | `r56` | r13-confirm PASS, Opus 5.5 65 pairs and GPT-6.1 Sol 64 pairs, 0 confirmed |
| 3 | 2026-10-09 | fifty-eight never-measured laws | `9c42889` | `x17` | fifty-eight never-measured laws gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 4 | 2026-10-06 | round twelve | `a4c8531` | `q17 z34` | round twelve gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |
| 5 | 2026-09-24 | full versus cut | `056a33f` | `y20` | full versus cut gate (Opus 5.5 and GPT-6 Sol); back105 on GPT-6.1 Sol, final gate 136 pairs, 0 confirmed, PASS, a clean pair for every law |

The removed wording:

> 1. Correct files are insufficient if the system path is unwired.

> 2. When a change affects runtime or workflow connectivity, wiring must be checked explicitly.

> 3. Dead or disconnected workflow components count as failure.

> 4. Wiring verification is part of the quality stack, not an optional polish step.

> 5. Detailed wiring checklists and category-specific examples belong outside the constitutional core.

## Laws rewritten after measurement

The old wording failed the measurement and the new one passed. Keep the new wording; do not go back to the old one.

### `cross-reference-hygiene` law 7, rewritten 2026-10-14 (commit `7626b44`)

Law 7 was rewritten on 2026-10-14. GPT-6.1 Sol followed the earlier text in none of six runs and the new text in all six, and Opus 5.5 followed both in all six, measured in `docs/SHELL_MEASUREMENTS.md` under rewrite13.

Old wording:

> 7. When source content is knowingly left out of a derived surface, record it in that surface with the reason and the authority behind it. An omission with no recorded reason is drift to the next reader, including the next automated comparison, and the next sync re-adds what the target already decided against.

New wording:

> 7. When you leave source content out of a derived surface, record each omitted item in that surface with its reason and the person, decision or document that authorized leaving it out, and keep the attributions already recorded there when you refresh it. An omission with no named authority is drift to the next reader, including the next automated comparison, and the next sync re-adds what the target already decided against.

### `pre-planning-mandate` law 21, rewritten 2026-10-15 (commit `1eb92b8`)

Law 21 was rewritten on 2026-10-15. Opus 5.5 and GPT-6.1 Sol each followed the earlier text in none of six runs and the new text in four of six, measured in `docs/SHELL_MEASUREMENTS.md` under rewrite-r13b.

Old wording:

> 21. Contribution Fit selects one contribution type: `normal-pr`, `draft-or-prototype`, `issue-or-discussion`, `local-only`, `docs`, or `no-change`; and one implementation admission: `admitted`, `admitted-fast-path`, `blocked-material-choice`, or `not-an-implementation-contribution`.

New wording:

> 21. Before editing for an upstream contribution, record its Contribution Fit: exactly one contribution type (`normal-pr`, `draft-or-prototype`, `issue-or-discussion`, `local-only`, `docs`, or `no-change`) and exactly one implementation admission (`admitted`, `admitted-fast-path`, `blocked-material-choice`, or `not-an-implementation-contribution`). When the change needs a name, setting or behavior the maintainers have not chosen, the admission is `blocked-material-choice` and the type is not `normal-pr`.

## Retirement notes from the Workflow Lab rule files

Each Workflow Lab rule file recorded its removals and rewrites as notes in its Hard Laws section. They are copied here word for word on 2026-10-20. Paths in them point into the Workflow Lab.

### `backlog-management.md`

Laws 2 and 3 were removed on 2026-09-24 because Opus 5.5 and GPT-6 Sol follow them without the text, measured in `docs/SHELL_MEASUREMENTS.md` under full versus cut. Their numbers stay retired.

Law 1 was removed on 2026-10-02 for the same reason, measured in `docs/SHELL_MEASUREMENTS.md` under fifteen held laws. Its number stays retired.

Law 5 was removed on 2026-10-06 for the same reason, measured in `docs/SHELL_MEASUREMENTS.md` under round twelve. Its number stays retired.

Law 6 was removed on 2026-10-16 because Opus 5.5 and GPT-6.1 Sol follow it without the text, measured in `docs/SHELL_MEASUREMENTS.md` under r13-confirm. The decision-discipline section still sends scoring to the `yagni-evaluation` skill. Its number stays retired.

Law 4 was removed on 2026-10-19 because Opus 5.5 and GPT-6.1 Sol follow it without the text, measured in `docs/SHELL_MEASUREMENTS.md` under r15-confirm. The section on valid deferral still sends deferred work to an explicit entry in `docs/BACKLOG.md` with its trigger, and the failure rule still names a deferral that was never recorded. Its number stays retired.

### `continuous-learning.md`

Law 7 was removed on 2026-09-24 because Opus 5.5 and GPT-6 Sol follow it without the text, measured in `docs/SHELL_MEASUREMENTS.md` under full versus cut. The retrieval-anchor section below still carries the procedure. Its number stays retired.

Law 5 was removed on 2026-10-02 for the same reason, measured in `docs/SHELL_MEASUREMENTS.md` under fifteen held laws. Its number stays retired.

Laws 2 and 9 were removed on 2026-10-09 for the same reason, measured in `docs/SHELL_MEASUREMENTS.md` under fifty-eight never-measured laws. The criticism section and the volatile-detail section below still carry their content. Their numbers stay retired.

Laws 1, 4 and 6 were removed on 2026-10-16 because Opus 5.5 and GPT-6.1 Sol follow them without the text, measured in `docs/SHELL_MEASUREMENTS.md` under r13-confirm. The Required Behaviors sections still carry lesson retrieval before work, applying lessons to the active task, and durable capture before further progress after criticism. Their numbers stay retired.

Law 3 was removed on 2026-10-19 because Opus 5.5 and GPT-6.1 Sol follow it without the text, measured in `docs/SHELL_MEASUREMENTS.md` under r15-confirm. The trigger examples still treat `again` as a learning signal, and the failure rule still counts an available lesson that was ignored as a regression. Its number stays retired.

### `cross-reference-hygiene.md`

Laws 1, 1a, 3 and 5 were removed on 2026-09-24 because Opus 5.5 and GPT-6 Sol follow them without the text, measured in `docs/SHELL_MEASUREMENTS.md` under full versus cut. Their numbers stay retired.

Law 4 was removed on 2026-10-06 for the same reason, measured in `docs/SHELL_MEASUREMENTS.md` under round twelve. Its number stays retired.

Law 7 was rewritten on 2026-10-14. GPT-6.1 Sol followed the earlier text in none of six runs and the new text in all six, and Opus 5.5 followed both in all six, measured in `docs/SHELL_MEASUREMENTS.md` under rewrite13.

Law 2 was removed on 2026-10-16 because Opus 5.5 and GPT-6.1 Sol follow it without the text, measured in `docs/SHELL_MEASUREMENTS.md` under r13-confirm. The section on editing a source-of-truth surface still keeps linked and version-linked references in step. Its number stays retired.

### `cwos-core.md`

Law 2 was removed on 2026-09-24 because Opus 5.5 and GPT-6 Sol follow it without the text, measured in `docs/SHELL_MEASUREMENTS.md` under full versus cut. The knowledge-transfer guarantee below still states it. Its number stays retired.

Law 4 was removed on 2026-10-02 for the same reason, measured in `docs/SHELL_MEASUREMENTS.md` under fifteen held laws. Its number stays retired.

Law 5 was removed on 2026-10-09 for the same reason, measured in `docs/SHELL_MEASUREMENTS.md` under fifty-eight never-measured laws. The boundaries section below still keeps procedure out of this rule. Its number stays retired.

Law 1 was removed on 2026-10-20 because Opus 5.5 and GPT-6.1 Sol follow it without the text, measured in `docs/SHELL_MEASUREMENTS.md` under r16-confirm. The protocol guarantee below still asks delegated work for structured evidence of what was attempted, decided, verified and left open, and law 6 still sends the packaging to the operational companion. Its number stays retired.

### `fiona-completion-contract.md`

Laws 4, 5 and 6 were removed on 2026-09-24 because Opus 5.5 and GPT-6 Sol follow them without the text, measured in `docs/SHELL_MEASUREMENTS.md` under full versus cut. The closure companion still carries the schema and normalization. Their numbers stay retired.

Law 2 was removed on 2026-10-06 for the same reason, measured in `docs/SHELL_MEASUREMENTS.md` under round twelve. The closure companion still names the three terminal states. Its number stays retired.

Laws 1, 3 and 7 were removed on 2026-10-09 for the same reason, measured in `docs/SHELL_MEASUREMENTS.md` under fifty-eight never-measured laws. The constitutional minimum above, the guarantees and failure rule below, and the closure companion still carry the closure duty, changed-file and blocker truth, and the Git delivery gate. Their numbers stay retired.

### `human-writing-style.md`

Laws 2, 7, 10, 14 and 17 were removed on 2026-09-24 because Opus 5.5 and GPT-6 Sol follow them without the text, measured in `docs/SHELL_MEASUREMENTS.md` under full versus cut. The honest-register, German-apostrophe, voice-sample and contribution-reason content stays in the sections below. Their numbers stay retired.

Laws 1 and 23 were removed on 2026-10-02 for the same reason, measured in `docs/SHELL_MEASUREMENTS.md` under fifteen held laws. Their numbers stay retired.

Law 11 was removed on 2026-10-06 for the same reason, measured in `docs/SHELL_MEASUREMENTS.md` under round twelve. Law 20 still names Git-hosted text as operator voice. Its number stays retired.

Laws 4, 5, 8, 12, 16, 19, 20, 24 and 27 were removed on 2026-10-09 for the same reason, measured in `docs/SHELL_MEASUREMENTS.md` under fifty-eight never-measured laws. The named-tells table, the artifact-register section and the GitHub sections below still carry their content. Law 20a, measured as needed on both models, now carries the Git-hosted voice marker that the note above attributes to law 20. Their numbers stay retired.

Laws 3, 6, 9, 13 and 26 were removed on 2026-10-16 because Opus 5.5 and GPT-6.1 Sol follow them without the text, measured in `docs/SHELL_MEASUREMENTS.md` under r13-confirm. The named-tells table still carries dashes, degraded umlauts and label colons, the style checks still reject consultant advice, and the doctrine-writing section still keeps the actor and the action visible. Their numbers stay retired.

Law 15 was removed on 2026-10-19 because Opus 5.5 and GPT-6.1 Sol follow it without the text, measured in `docs/SHELL_MEASUREMENTS.md` under r15-confirm. The voice markers still stand in this rule, and the line after them still says why they stay here rather than in the skill. Its number stays retired.

Law 18 was removed on 2026-10-20 because Opus 5.5 and GPT-6.1 Sol follow it without the text, measured in `docs/SHELL_MEASUREMENTS.md` under r16-confirm. The public GitHub section still runs a deletion test on every section, keeps one non-obvious decision and one stated uncertainty, and cuts file inventories and future plans. Its number stays retired.

### `knowledge-accumulation.md`

Law 6 was removed on 2026-10-02 because Opus 5.5 and GPT-6 Sol follow it without the text, measured in `docs/SHELL_MEASUREMENTS.md` under fifteen held laws. Its number stays retired.

Law 4 was removed on 2026-10-06 for the same reason, measured in `docs/SHELL_MEASUREMENTS.md` under round twelve. Its number stays retired.

Laws 3 and 5 were removed on 2026-10-09 for the same reason, measured in `docs/SHELL_MEASUREMENTS.md` under fifty-eight never-measured laws. The compact pattern below still shows the `prior_knowledge` handoff form. Their numbers stay retired.

Laws 1 and 8 were removed on 2026-10-16 because Opus 5.5 and GPT-6.1 Sol follow them without the text, measured in `docs/SHELL_MEASUREMENTS.md` under r13-confirm. The constitutional minimum, law 2 and the compact pattern still carry the pass-forward duty, including the active contract, ownership and reusable proof. Their numbers stay retired.

Law 7 was removed on 2026-10-20 because Opus 5.5 and GPT-6.1 Sol follow it without the text, measured in `docs/SHELL_MEASUREMENTS.md` under r16-confirm. The orchestrator still keeps fresh context for final acceptance and security, recovery or transaction review. Its number stays retired.

### `pre-planning-mandate.md`

Laws 3, 10, 13, 16, 18 and 22 were removed on 2026-09-24 because Opus 5.5 and GPT-6 Sol follow them without the text, measured in `docs/SHELL_MEASUREMENTS.md` under full versus cut. Their numbers stay retired.

Laws 5, 12 and 23 were removed on 2026-10-06 for the same reason, measured in `docs/SHELL_MEASUREMENTS.md` under round twelve. Their numbers stay retired.

Laws 6, 7, 17 and 19 were removed on 2026-10-09 for the same reason, measured in `docs/SHELL_MEASUREMENTS.md` under fifty-eight never-measured laws. The orchestrator agent still carries the security-vocabulary boundary, the bounded reversible fast path and the approval-card procedure, and laws 20 and 21 still frame Contribution Fit. Their numbers stay retired.

Law 21 was rewritten on 2026-10-15. Opus 5.5 and GPT-6.1 Sol each followed the earlier text in none of six runs and the new text in four of six, measured in `docs/SHELL_MEASUREMENTS.md` under rewrite-r13b.

Law 9 was removed on 2026-10-19 because Opus 5.5 and GPT-6.1 Sol follow it without the text, measured in `docs/SHELL_MEASUREMENTS.md` under r15-confirm. Law 8 still gives every writable surface and semantic contract one long-lived owner, law 8a still calls lanes on disjoint write sets with distinct acceptance results a legal wave, and the orchestrator still lists the conditions for a bounded wave. Its number stays retired.

Law 11 was removed on 2026-10-20 because Opus 5.5 and GPT-6.1 Sol follow it without the text, measured in `docs/SHELL_MEASUREMENTS.md` under r16-confirm. Law 8b still asks for four inline lines before a first delegation, and task documentation still says most runs need no new durable task directory. Its number stays retired.

### `registered-session-lifecycle.md`

Laws 1, 6, 7, 8, 12 and 13 were removed on 2026-10-19 because Opus 5.5 and GPT-6.1 Sol follow them without the text, measured in `docs/SHELL_MEASUREMENTS.md` under r15-confirm. The orchestrator still opens Agent Manager sessions only on an explicit request and still keeps pending approval through handoff, the required behaviors still have the parent fill the child checklist and keep implementation, validation, delivery and cleanup as separate claims, and the failure rule still names report-only wakes over open work, forgotten descendants and processes, and premature deregistration. Their numbers stay retired.

### `skill-usage-discipline.md`

Laws 2, 4, 5 and 10 were removed on 2026-09-24 because Opus 5.5 and GPT-6 Sol follow them without the text, measured in `docs/SHELL_MEASUREMENTS.md` under full versus cut. Law 3 met the same bar and stays, because the four-part gate it defines is referenced by name from agents, skills and the Workflow Bible. Their numbers stay retired.

Law 6 was removed on 2026-10-02 for the same reason, measured in `docs/SHELL_MEASUREMENTS.md` under fifteen held laws. Its number stays retired.

Law 14 was removed on 2026-10-06 for the same reason, measured in `docs/SHELL_MEASUREMENTS.md` under round twelve. Its number stays retired.

Laws 9, 11 and 15 were removed on 2026-10-09 for the same reason, measured in `docs/SHELL_MEASUREMENTS.md` under fifty-eight never-measured laws. The practice table below still covers the `100/100` case. Their numbers stay retired.

Law 8 was removed on 2026-10-16 because Opus 5.5 and GPT-6.1 Sol follow it without the text, measured in `docs/SHELL_MEASUREMENTS.md` under r13-confirm. The practice table still treats a companion or typical pairing as a candidate behind the four-part gate. Its number stays retired.

Law 12 was removed on 2026-10-19 because Opus 5.5 and GPT-6.1 Sol follow it without the text, measured in `docs/SHELL_MEASUREMENTS.md` under r15-confirm. Law 3 still lets an added skill in only when it does not enlarge topology, and the practice table still treats a companion or typical pairing as a candidate behind that gate. Its number stays retired.

### `task-documentation.md`

Laws 1, 2, 4 and 5a were removed on 2026-09-24 because Opus 5.5 and GPT-6 Sol follow them without the text, measured in `docs/SHELL_MEASUREMENTS.md` under full versus cut. The failure rule below still names read-only artifacts. Their numbers stay retired.

Law 6 was removed on 2026-10-06 for the same reason, measured in `docs/SHELL_MEASUREMENTS.md` under round twelve. The normal shape below still shows the compact durable package. Its number stays retired.

Laws 7 and 11 were removed on 2026-10-09 for the same reason, measured in `docs/SHELL_MEASUREMENTS.md` under fifty-eight never-measured laws. The constitutional minimum and the failure rule below still name read-only authority and the per-lane warehouse. Their numbers stay retired.

Laws 9 and 10 were removed on 2026-10-16 because Opus 5.5 and GPT-6.1 Sol follow them without the text, measured in `docs/SHELL_MEASUREMENTS.md` under r13-confirm. The failure rule still forbids staging paths without a value class and task ownership, and the CWOS operational companion still holds the shared board. Their numbers stay retired.

Law 8 was removed on 2026-10-20 because Opus 5.5 and GPT-6.1 Sol follow it without the text, measured in `docs/SHELL_MEASUREMENTS.md` under r16-confirm. The failure rule still fails staging that holds paths without an explicit value class and task ownership. Its number stays retired.

### `tool-usage-discipline.md`

Laws 7 and 9 were removed on 2026-09-24 because Opus 5.5 and GPT-6 Sol follow them without the text, measured in `docs/SHELL_MEASUREMENTS.md` under full versus cut. The Agent Manager gate still stands in the orchestrator agent and the registered-session rule. Their numbers stay retired.

Law 2 was removed on 2026-10-02 for the same reason, measured in `docs/SHELL_MEASUREMENTS.md` under fifteen held laws. The file-tool default still stands in the tables below. Its number stays retired.

Laws 1 and 4 were removed on 2026-10-09 for the same reason, measured in `docs/SHELL_MEASUREMENTS.md` under fifty-eight never-measured laws. The allowed-versus-forbidden table, the forbidden shell-file-CRUD examples and the failure rule below still carry the shell-is-not-an-editor boundary. Their numbers stay retired.

Laws 3 and 11 were removed on 2026-10-16 because Opus 5.5 and GPT-6.1 Sol follow them without the text, measured in `docs/SHELL_MEASUREMENTS.md` under r13-confirm. The controlled-copy section, the command return reliability section and the failure rule still carry the copy contract and the non-interactive GitHub readback. Their numbers stay retired.

Law 6 was removed on 2026-10-19 because Opus 5.5 and GPT-6.1 Sol follow it without the text, measured in `docs/SHELL_MEASUREMENTS.md` under r15-confirm. The closing line still marks this rule as part of the thin constitutional core. Its number stays retired.

### `verification-before-completion.md`

Laws 1, 4, 12, 26, 28, 32, 40 and 41 were removed on 2026-09-24 because Opus 5.5 and GPT-6 Sol follow them without the text, measured in `docs/SHELL_MEASUREMENTS.md` under full versus cut. Their numbers stay retired.

Laws 3, 11, 18, 22 and 39 were removed on 2026-10-02 for the same reason, measured in `docs/SHELL_MEASUREMENTS.md` under fifteen held laws. Their numbers stay retired.

Laws 7, 15, 21, 23 and 31 were removed on 2026-10-06 for the same reason, measured in `docs/SHELL_MEASUREMENTS.md` under round twelve, and law 25 under the isolated retest of the three Temp-exposed laws. The verification order, cross-process foundation and safety-boundary sections below keep their procedure. Their numbers stay retired.

Laws 24, 27, 30 and 36 were removed on 2026-10-09 for the same reason, measured in `docs/SHELL_MEASUREMENTS.md` under fifty-eight never-measured laws. The cross-process foundation and effect and capability proof sections below still carry the fault-injection and proof-bundle procedure, the CWOS operational companion still blocks `done` on failing required tests or missing proof, and the Published PR Gate in `quality-gate-verification` carries the SHA equality. Their numbers stay retired.

Laws 2, 5, 6, 8, 9, 10, 13, 16, 17, 19, 29, 34, 35 and 37 were removed on 2026-10-16 because Opus 5.5 and GPT-6.1 Sol follow them without the text, measured in `docs/SHELL_MEASUREMENTS.md` under r13-confirm. The red-flag phrases, proof shape, Git Delivery Closure, Direct Proof Closure, proof ladder, Integrated Independent Acceptance, effect proof and failure rule sections still carry their content, wiring stays with `wiring-verification.md`, the Published PR Gate stays in `quality-gate-verification`, and the attribution boundary stays in `human-writing-style.md`. Their numbers stay retired.

Law 20 was removed on 2026-10-20 because Opus 5.5 and GPT-6.1 Sol follow it without the text, measured in `docs/SHELL_MEASUREMENTS.md` under r16-confirm. Git Delivery Closure still lists unrelated dirty paths separately from the exact task-owned state. Its number stays retired.

### `wiring-verification.md`

Laws 1 and 5 were removed on 2026-09-24 because Opus 5.5 and GPT-6 Sol follow them without the text, measured in `docs/SHELL_MEASUREMENTS.md` under full versus cut. Their numbers stay retired.

Law 4 was removed on 2026-10-06 for the same reason, measured in `docs/SHELL_MEASUREMENTS.md` under round twelve. Its number stays retired.

Law 3 was removed on 2026-10-09 for the same reason, measured in `docs/SHELL_MEASUREMENTS.md` under fifty-eight never-measured laws. The constitutional minimum and the failure rule below still call a disconnected component a failure. Its number stays retired.

Law 2 was removed on 2026-10-16 because Opus 5.5 and GPT-6.1 Sol follow it without the text, measured in `docs/SHELL_MEASUREMENTS.md` under r13-confirm. The constitutional minimum, the required behaviors and the failure rule still require an explicit wiring check, so this section now holds notes only. Its number stays retired.

## Retired workflow components

These were taken out by decision, not by measurement. The decision records live in the Workflow Lab repository; the keys below name them. Reasons are paraphrased from those records.

| Key | Decision record in the Workflow Lab |
|---|---|
| A | consolidation audit inherited with the repo, present by 2026-02-27 (`994ec66`, under `docs/audits/`); the original retirement dates are unknown |
| B | Lab transformation decisions, 2026-02-28 (`994ec66`, `docs/tasks/2026-02-28_workflow-lab-phase-b/SUBTASK_LOG.md`) |
| C | cleanup of the Lab modes, 2026-03-10 (`20d39cc`) |
| D | root cutover to `.kilo`, 2026-04-20 (`4058b47`), and the template reconciliation decisions, 2026-04-21 (`d87e774`, `docs/TEMPLATE_LEGACY_RECONCILIATION_DECISIONS.md`) |
| E | removal wave the operator asked for, 2026-04-20 (`4058b47`, `docs/tasks/2026-04-17_kilo-new-roo-new-planning/removal-wave/REMOVAL_PLAN_FINAL.md`) |
| J | template placement decision, 2026-07-27 (`d2ecee7`, `_template/.kilo/skills-optional/README.md`) |
| N | rename to avoid runtime name collisions, 2026-04-26 (`8237157`) |

None of these was measured the way the laws above were. If one of them looks useful again, measure it before it comes back.

### Skills

| Skill | Key | Reason | Successor |
|---|---|---|---|
| `8-phase-implementation` | A | merged | `hub-v2-implementation`, later `workflow-implementation` |
| `anti-laziness-enforcement` | A | duplicated the skill-usage rule | `skill-usage-discipline` |
| `context-auto-cleanup` | A | cleaned up too aggressively | `context-management` |
| `lesson-compliance-check` | A | merged | the `continuous-learning` rule |
| `lessons-to-workflow` | A | experimental, never used | none |
| `meta-evaluation` | A | a broader skill replaced it | `workflow-meta-audit` |
| `orchestrator-patterns` | A | examples merged into the orchestrator | `workflow-orchestrator` |
| `project-history` | A | replaced | task documentation |
| `request-enrichment` | A | experimental, never used | `workflow-routing` |
| `skill-discovery` | A | discovery became part of the skill-usage rule | `skill-usage-discipline` |
| `subtask-handoff` | A | merged | `cwos-core`, `knowledge-accumulation` |
| `legacy-code-analysis`, `legacy-feature-extraction`, `parity-comparison`, `v2-feature-verification` | A | one-time audit or phase work, finished | none |
| `hub-v2-implementation` | B | rewritten for the Lab | `workflow-implementation` |
| `hub-v2-validation` | B | rewritten for the Lab | `workflow-validation` |
| `pipeline-design` | B | rewritten for the Lab | `cross-repo-analysis`, later `cross-repo-audit` |
| `plugin-architecture` | B | rewritten for the Lab | `pattern-distribution` |
| `schema-creation` | B | rewritten for the Lab | `standard-creation`, now in the template library |
| `code-quality-audit`, `issue-fixer` | C, E | archived, then deleted without an active dependency | none |
| `feature-parity-audit`, `post-impl-audit` | C | product-specific or mode-specific copy | `quality-gate-verification` with `workflow-reviewer` |
| `backlog-reevaluate` | D | redundant | `yagni-evaluation` with `backlog-management` |
| `cross-repo-analysis` | D | merged | `cross-repo-audit` |
| `dual-model-synthesis` | D | superseded | `synthesis` |
| `workflow-guide`, `mode-selection-guide` | D | superseded | `workflow-routing` |
| `agent-maestro-api` | D | niche external integration, not generalizable | none |
| `emergency-escalation` | D | thin utility | escalation inside `workflow-code` |
| `german-voice-transcription` | D | niche personal utility | none |
| `kilocode-reference` | D | outdated | current Kilo documentation and the built-in `kilo-config` skill |
| `repo-cleanup` | D | thin utility | `refactoring-safe` |
| `time-filler-algorithm` | D | standalone scheduling superseded | `overnight-run` |

Moved out of the template baseline, still available in `_template/library/` or `skills-optional/`. These are not retired; adopt one from there instead of writing a new one.

| Skill | Key | Where it went |
|---|---|---|
| `4-level-pyramid-audit`, `catalog-update`, `domain-boundary-design`, `workflow-self-audit` | D | library |
| `adr-creation` | D | library, later optional |
| `gap-requirements`, `standard-creation` | D, J | library; the optional copies became `*-optional-legacy` |
| `workflow-bible-maintenance`, `workflow-implementation`, `workflow-validation` | D | library in the template; the Workflow Lab keeps them active |
| `cross-repo-audit`, `overnight-run`, `pattern-distribution`, `repo-bootstrapping`, `workflow-meta-audit` | D | optional |
| `multi-phase-planning`, `prompt-engineering`, `requirements-gathering`, `system-analysis`, `workflow-pattern-lifecycle`, `writing-skills` | J | library only; the Workflow Lab keeps `prompt-engineering` and `workflow-pattern-lifecycle` active |

Domain skills that moved into their product repos in 2026-02 (B) were relocated, not retired, and are not listed.

### Agents and modes

| Agent or mode | Key | Reason | Successor |
|---|---|---|---|
| `atomic-audit`, `module-summary` | A | redundant audit levels | `4-level-pyramid-audit` |
| `build-verification-hilv`, `config-setup-hilv`, `implementation-hilv` | A | subsets of the code role | `code-hilv`, now `workflow-code` |
| `phase-audit-hilv` | A, C | absorbed | orchestrator and reviewer |
| `semantic-audit-hilv` | A | lazy-pattern checks moved into the skill-usage rule | `skill-usage-discipline` |
| `validator-hilv` | A | spec validation moved | `hub-v2-validation`, now `workflow-validation` |
| `ask-hilv`, `architect-hilv`, `code-hilv`, `code-reviewer-hilv`, `debug-hilv`, `orchestrator-hilv`, `test-writer-hilv` | D | redesigned as compact roles, not only renamed | the `workflow-*` agent of the same role |
| `pre-planner-hilv` | D | no permanent planning peer | `workflow-orchestrator` with the `pre-planning` and `workflow-routing` skills |
| `planner-gemini`, `planner-opus`, `synthesizer-opus` | E | removed on request | ordinary planning and synthesis lanes |
| `ask`, `architect`, `code`, `debug`, `orchestrator`, `reviewer`, `test-writer` | N | renamed | `workflow-ask` and the other `workflow-*` names |

### Whole rule files

| Rule | Key | Reason | Successor |
|---|---|---|---|
| `aggressive-skill-usage` | D | superseded | `skill-usage-discipline` |
| `cwos-enforcement` | D | merged | `cwos-operational-companion` |
| `cwos-protocol` | D | split into a thin core and a companion | `cwos-core`, `cwos-operational-companion` |
| `implementation-workflow` | D | procedure moved into skills | `feature-implementation`, `verification-before-completion` |
| `orchestrator-creativity` | D | mechanics folded into the orchestrator | `workflow-orchestrator`, `workflow-routing` |
| `post-impl-audit` | D | standalone audit posture replaced | `quality-gate-verification`, `verification-before-completion`, `workflow-reviewer` |
| Fiona rules in the template baseline | D | fleet overlay, not baseline | `_template/.kilo/rules-optional/` |

April planning maps called `backlog-management`, `pre-planning-mandate` and `knowledge-accumulation` removed. They were restored and are live; they are not retired.

### Runtime surfaces

| Surface | Date and commit | Reason | Successor |
|---|---|---|---|
| `.kilocode/`, `.kilocodemodes` | 2026-04-03 and 04-04, `41a78bb`, `5fc186d` | migration to the native runtime | `.kilo/` |
| `rebuild-kilocodemodes.mjs`, renamed `rebuild-roomodes.mjs` | 2026-04-04, then 2026-04-26 `36e158f` | obsolete after the Roo removal | none |
| `.roo/`, `.roomodes` and the Roo settings | 2026-04-25 `6cdb5d4`, template 2026-04-26 `9bb0007` | Kilo is canonical | `.kilo/` |
| `_template/.kilo-legacy/`, `.kilo-old-backup/` | 2026-04-25 `c925be0`, `caf3d6f` | superseded by the refreshed package; backup moved out of the repo | none |
| `rebuild-kilocodemodes-compat` command, `instructions.md`, the legacy template `package.json` | D | legacy compatibility without a proven need | `AGENTS.md` and the template README |
| Agent Maestro transport in the Workflow Lab | see `docs/SYSTEM_SOT.md` there | deprecated | a bridge owned by another repository |

### Doctrine sections removed before the law measurements

| Former requirement | Date and record | What replaced it |
|---|---|---|
| a pre-planner role first and a mandatory `PRE_PLAN.md` | D | the analysis duty stays; the fixed role and file are gone |
| fixed `TASK_MANIFEST` and `SUBTASK_LOG` choreography | D | the compact CWOS package |
| the six-step CWOS chain and metrics-log ritual | D | `cwos-core` with its operational companion |
| a Fiona JSON file for every task | D | Fiona closure only where Fiona integration applies |
| an automatic task directory by lane count | 2026-07-16 and 07-18, `e868ce6`, `b0ec21d` | durable evidence only when it has value |
| serial repeated-review convergence | 2026-07-18, `b0ec21d` | an invariant-owned DAG with one integrated gate |
| loading every matching or companion skill | 2026-07-25, `b82c719` | one primary skill per phase and a four-part admission gate |
| deny-first permissions per role | 2026-05-11, `8774c5b` | allow by default, restrictions only after real incidents |
| a total ban on copying with the shell | 2026-04-26, `83d4021` | the verified controlled-copy exception |
| no operator chat traits in GitHub artifacts | 2026-08-29, `693723e` | operator voice inside the required formats |
| commit immediately, and a mandatory dispatch prompt | 2026-08-19 rewrite | reversed; see the Workflow Lab lessons archive |

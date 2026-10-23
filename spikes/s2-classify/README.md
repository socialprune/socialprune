# S2: hand labels before model evaluation

This standalone project has its own lockfile and workspace. Root dependencies must exist for the first-party core link. From the repository root, using Node 24.15 or later and pnpm 10.33.0:

```powershell
pnpm install --frozen-lockfile
pnpm --dir spikes/s2-classify install --frozen-lockfile
```

The maintainer chose Testset A: the label server stays off until he says **Testset starten**. Installation and the default tests do not start it. Only after that instruction, run `pnpm --dir spikes/s2-classify label` and open `http://127.0.0.1:4761` in an ordinary browser. The command does not open a browser or load a model. `node spikes/s2-classify/label.mjs` reaches the same page. `--port 4762` through `--port 4765` chooses another permitted loopback port; there is no remote-host option. Stop the server with Ctrl+C when finished for the day. Closing a tab does not stop the server.

Read the 160 additions first, one at a time, then read and accept rubric v2. That reading pass has no category controls or answers. It records reading progress but no labels. The labelling pass contains all 560 entries. The original 400 stay unchanged in `fixtures/synthetic/classify/items.jsonl`; `dataset.mjs` combines them with the 160 hand-authored additions from `fixtures/synthetic/classify/additions-v2.mjs`. Their stable IDs are `s2-401` through `s2-560`. The additions are mixed for the reading pass. Authoring coverage notes are not served to the browser; do not open them before labelling.

New item text uses ordinary post language. The people, places, groups and situations are invented, as recorded in the file comments and metadata, but fiction frames do not belong in the text a model will assess. The dataset loader rejects `erfunden`, `fiktiv`, `fictional`, `invented` and `made-up` in any new text. The regression test was first observed red on the framed corpus, per LL-2026-10-002.

## Controls and local files

Choose every category supported by the visible entry, with a separate risk for each. No category or risk starts selected. Only your own earlier label appears when you return to a labelled entry. Harmless and Unclear clear other categories. The page never loads, suggests or shows a model answer.

All 14 category definitions, including the two exclusive outcomes, come from the product's `@socialprune/core/criteria` presets. The rubric table must match them exactly. The 12 content criteria and their definition hashes bind the journal, finalized manifest and later evaluation result. A changed definition refuses resume or scoring rather than silently reusing old labels. Changing examples or guidance also changes the rubric hash. No own criterion is measured.

Category keys are Q Toxic, W Personal attack, E Political, R Sexual, T Drugs/illegal conduct, Y Personal information, I Embarrassing, O Empty, H Harmless, ? Unclear, A Racist, S Misogynistic, D Hostile to groups and F Politically incorrect. They always select categories, even while a category is awaiting risk. Digits 0 to 3 always set the risk for the most recently selected category; repeated digits change that risk and never select another category. Before selecting a category, digits have no effect. The risk heading names the category being edited. Escape clears the active risk target but keeps selections. Press a selected category again to remove it. Enter saves a valid selection, N skips, B goes back, U undoes the last saved label. Buttons work on a phone. German/English and light/dark controls change only the display, not labels or the rubric.

State stays in this spike's ignored `spikes/s2-classify/local/` directory, not the fixture directory:

* `labels.history.jsonl`: append-only rubric acceptance, reading progress, cursor movement, human labels and undo events, synced before the response.
* `labels.jsonl`: one final row per item, with `labels: [{ category, risk }]`, note, time and `labeler: 'maintainer'`.
* `labels.manifest.json`: version 2, dataset, rubric and final-label hashes, checked criterion IDs and definition hashes, and finalization time.
* `session.lock`: prevents two servers writing the journal simultaneously. A normal Ctrl+C removes it. After a crash, remove only this lock after confirming that no S2 labelling server is running; never remove the journal to repair a lock.

Closing and reopening the page, or stopping and restarting the server, resumes from the journal. A changed corpus or rubric refuses resume. Skip leaves an item unlabelled; after a save, the next unlabelled entry is selected, wrapping to skipped items. Back allows checking your own previous work. Undo restores the previous human label if one was replaced. Draft selections that were not saved are not persisted. The finalization button appears only after every entry has a current label and asks for confirmation. It creates final files exclusively and will not overwrite them. A partial finalization blocks further writes and evaluation; retain the files for diagnosis rather than retrying over them.

No model may see the evaluation set until the maintainer has finalized his own labels. The harness enforces the complete hash-bound snapshot before importing a tier. Tests use smoke-derived generated labels in disposable test directories, never `local/`.

## Later measurement

After finalization and a separate instruction for a model run, follow [S2's evaluation instructions](../../docs/spikes/S2.md). There have been no model calls for the criteria-bound contract. Earlier smoke outputs do not validate this contract. The handwritten baseline still has no patterns for the four new presets; an all-missed category remains visible as zero recall, not as a claimed implementation. NLI uses an uncalibrated 0.5 independent-category threshold and the same item-level risk estimate for each selected category; this limitation is recorded, not hidden as independently inferred risks. ADR-033 C4 later adds the endpoint tier through the product source and normalizer, after his labels; this slice neither calls that endpoint nor chooses a default.

```powershell
pnpm --dir spikes/s2-classify test
node spikes/s2-classify/validate.mjs
```

Run the standalone tests from `spikes/s2-classify/` with `pnpm test`. They run serially, start no server or browser, and test the corpus, immutable criteria snapshot, evaluation lock, journal lifecycle and arithmetic with tiny generated labels only. They do not run inference, even the rules baseline. Optional `SP_S2_PROOF_DIR` chooses test output; it cannot change the labeller's normal path. By default unit output goes to the system temp folder `kilo/s2-classify`.

`pnpm test:browser` is a separate, explicit opt-in command. Do not run it before **Testset starten**: it starts disposable label servers and one test-owned Chromium at a time on 4761, 4762 and 4763. Its existing request recorder checks the loopback origin and hostile callers, with a second-origin positive control, not a fetch stub. Its screenshots use generated entries and no saved labels. It was not run for this criteria-binding revision, so no fresh browser or screenshot claim is made.

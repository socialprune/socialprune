# ADR-020: Demo data and honest example suggestions

- **Status:** Proposed
- **Date:** 2026-10-06
- **Hard constraints touched:** 3 (suggestions never decide), 5 (no claim of accuracy), 6 (demo data is generated, never real)
- **Related:** [ADR-006](ADR-006-workspace-event-log.md), [ADR-007](ADR-007-review-data-worker.md), [design specification](../../design/README.md)

## Context

The start page offers "Try the demo" so people without an export, or still waiting for one, can see the whole flow: import, review with suggestions, bulk marking with a preview, undo, the click lists and the backup. A review without suggestions shows only half of the product.

No classifier tier exists in Phase 2. `AGENTS.md` forbids making any tier a default before it is measured on a synthetic set whose expected labels the maintainer set by hand, and those labels do not exist yet. The current `Assessment.source.kind` allows `rules`, `model` and `agent`. Any of those labels on demo suggestions would claim that a rules engine, a model or an agent produced them.

## Decision Drivers

- The demo shows what reviewing with suggestions looks like, including reasons, verbatim evidence and an `unclear` case.
- Nothing in the demo suggests that a measured classifier exists or how accurate one would be.
- The demo runs through the real import path, so the network audit covers it.
- Demo data can never mix with a personal workspace.

## Options

### Option 1: Hand-written example assessments with their own source kind

A file of example assessments, written for the demo and stored next to the generated demo export, with `source.kind: 'fixture'`.

**Pros:**
- The source kind says exactly what they are; the UI can label them without hedging.
- The schema can confine `fixture` to demo workspaces, so they never appear in a personal review.

**Cons:**
- A schema addition (part of the v2 change in [ADR-006](ADR-006-workspace-event-log.md)).
- The examples need writing and upkeep when the demo data changes.

**Effort:** not measured
**Risk:** Low.

### Option 2: Run a draft rules engine on the demo

**Pros:**
- Shows real machine output.
- No hand-written data.

**Cons:**
- Puts an unmeasured tier in front of every visitor, which is what the measurement rule exists to prevent.
- Any weakness of the draft rules looks like the product's quality.

**Effort:** not measured
**Risk:** High.

### Option 3: Demo without suggestions

**Pros:**
- Nothing to label or explain.
- No schema change.

**Cons:**
- The core interaction, judging a suggestion with its reason and evidence, is invisible.
- Bulk marking from suggestions cannot be shown.

**Effort:** not measured
**Risk:** Medium for the demo's purpose.

## Decision

We chose **Option 1: hand-written example assessments with `source.kind: 'fixture'`**, because it is the only option that shows the suggestion flow while stating truthfully where the suggestions come from.

### Data

- `pnpm fixtures:demo` extends the fixture generator to write a deterministic demo: an X export of 300 posts and an Instagram export of 120 comments, invented, in German and English, with fixed seeds, under `fixtures/synthetic/demo/`. It includes a few posts with only images, replies, reposts, quotes, a long note, an HTML-looking text and the existing prompt-injection pattern from the `injection` fixture.
- `fixtures/synthetic/demo/assessments.json` holds about 60 example assessments keyed by item ID, with `source: { kind: 'fixture', name: 'demo-examples', version: <demo data version> }`, a category, a risk, a one-sentence reason, verbatim evidence or `null`, and `confidence: null`. At least four are `unclear`, at least ten items have none, and one item has two suggestions with different categories.
- A unit test validates the file against the v2 assessment schema, checks that each evidence string is a substring of its item's text, and checks that every item ID exists in the generated demo exports. Expected values come from the fixture files, not from the code under test.

### Runtime

- The page policy has `connect-src 'none'`, so the demo cannot fetch its files. A build plugin turns the demo ZIPs and `assessments.json` into one lazily imported JavaScript module that exports the bytes; `script-src 'self'` allows loading it, and the service worker precaches it for offline use.
- The demo is a separate workspace with `kind: 'demo'` in its own database `sp-ws-demo`. Starting the demo hands the ZIP bytes as `File` objects to the real import worker and then loads the example assessments. **Reset demo** deletes and recreates that database.
- A personal workspace rejects `fixture` assessments at write and at restore ([ADR-006](ADR-006-workspace-event-log.md)).
- The demo needs no service-worker gate ([ADR-004](ADR-004-content-security-policy.md)) because it never touches a person's file.

### Labels in the UI

- A persistent banner on every demo screen: "Demo with invented posts. The suggestions are examples written for this demo. No classifier produced them." German: "Demo mit erfundenen Beiträgen. Die Vorschläge sind Beispiele für diese Demo. Kein Klassifikator hat sie erzeugt."
- Each suggestion shows the source badge **Example** / **Beispiel** instead of a model or rule name.
- The demo shows no accuracy figure, no confidence value and no "AI" wording.

**Decision made by:** maintainer
**Approved on:** pending

## Consequences

### Positive
- Visitors see the full review flow on invented data, and every suggestion says what it is.
- The network audit test runs on the demo through the real import path, so it covers the flow most visitors try first.

### Negative
- About 60 example assessments to write and keep consistent when the demo generator changes.
- `fixture` is a fourth source kind that exists only for the demo.

### Risks
- **Visitors read the examples as product quality.** Mitigation: the banner and badge above; the README describes the demo the same way.
- **Generator changes break the item IDs the examples reference.** Mitigation: the unit test fails on any missing ID; `fixtures:check` covers the demo files.

## Evidence

- `AGENTS.md` (Proof): "No classifier tier becomes a default before it is measured on a synthetic set whose expected labels the maintainer set by hand before any tier saw it." Read at commit `7263d7d` on 2026-10-06.
- [Spike S2](../../spikes/S2.md): the evaluation set and harness exist, and the maintainer's labels do not, so no tier has been measured.
- `packages/core/src/model/index.ts` at commit `7263d7d`: `Assessment.source.kind` is `rules`, `model` or `agent`, and `reason` is one sentence of at most 300 characters.
- The page policy has `connect-src 'none'` ([ADR-004](ADR-004-content-security-policy.md)), which is why the demo bytes ship as a script module instead of a fetched file.
- No measurement decided this record.

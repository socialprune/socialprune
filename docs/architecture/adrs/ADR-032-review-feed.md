# ADR-032: The review feed with criteria, keep rules and one final mark

- **Status:** Accepted
- **Date:** 2026-10-20
- **Hard constraints touched:** 2 (criteria text, and context if chosen, go to the source the person set up), 3 (only the person's clicks decide), 5 (own criteria say "not measured"), 6 (generated data only). 1 and 4 stay as they are: no paid path, and deletion on X runs only through ADR-027's run.
- **Supersedes in part, on acceptance:** [ADR-005](ADR-005-browser-storage.md), [ADR-006](ADR-006-workspace-event-log.md), [ADR-007](ADR-007-review-data-worker.md), [ADR-008](ADR-008-review-ui-primitives.md), [ADR-009](ADR-009-navigation.md), [ADR-014](ADR-014-agent-interface.md), [ADR-015](ADR-015-cli-storage-node-baseline.md), [ADR-016](ADR-016-local-review-server.md), [ADR-017](ADR-017-shared-workspace-service.md), [ADR-020](ADR-020-demo-suggestions.md). It also changes the proposed [ADR-027](ADR-027-x-deletion-browser.md) and the [design specification](../../design/README.md); see "Changes to accepted records".
- **Related:** [ADR-012](ADR-012-time-zone-grouping.md), [ADR-021](ADR-021-archive-media.md), [ADR-031](ADR-031-desktop-app.md), [spike S2](../../spikes/S2.md)

## Context

On 2026-10-20 the maintainer asked that X deletion start from a review that scrolls like X: his posts with date, likes, reposts, media and the post he answered or quoted, each with the suggestion "delete" and its reason; he keeps exceptions and the rest goes. A second tab shows what his rules keep, such as 10 or more likes. Any user ticks criteria one by one (his examples: politically incorrect, misogynistic, racist), adds own ones as text and sets limits, and counts show the effect.

The code at commit `42f433f`, read on 2026-10-20:

- `CardReview.tsx` has the modes `single` and `all` (`Overview.tsx`, keys J delete, K keep, L later, U undo), the latter after requesting every entry's detail.
- "Mark suggested entries" exists in `CardReview.tsx` and in the list review (`Review.tsx`, within its filter and search). Both take entries at current risk 2 or 3 that are undecided or Later, skip popular ones (`skipPopular`), and offer a checkbox that also overwrites Keep and Marked.
- The top-tenth rule is in `packages/core/src/workspace/popular.ts`; `usePopularity.ts` recomputes it from one `detail` request per entry.
- `PostCard.tsx` shows reply and quote context, a stored original (one `getOriginals` call per card), the conversation (up to 21 posts) and a media count only (ADR-021).
- Category IDs are free strings, at most 32, 10 defaults; `categoryID()` shows unknown IDs as "Unclear".
- `deriveState` keeps one current assessment per item and source; `labels submit` takes one label per item; `batch next` shares no definitions, engagement or originals (ADR-014).
- The rules tier's badge reads "Rules" / "Regeln". Instagram comments carry `likes: null`. Schema 6.
- The desktop `app://` handler serves only built files, so `/originals/...` and `/context/...` answer 404 there.
- Measured on 2026-10-07 (see Evidence): projection build 1,759 ms for 100,000 items in Node, substring query p95 218.6 ms in Chromium, in-place update 0.10 ms after one decision.
- S2: 400 invented items, one primary category each, no group-based content.

Three points are set: limits are structured rules on the export's numbers (D1); nothing is marked before the person's click, the final button names the count, every keep or delete carries its source (D2); the screens do not depend on the suggestion source (D3). No code fact contradicts them; D3 needs section 5 now.

## Decision Drivers

- His six points; hard constraint 3 and D2; D1 counted before any model runs.
- Ticking a criterion changes counts at once, without a new run.
- 6,000 to 100,000 entries per account in all three builds.
- No category becomes a default tier before S2 measured it.

## Options

### Option 1: Feed with tabs, a criteria picker, keep rules and one frozen final mark

**Pros:** his flow (look, keep exceptions, one counted click); every count is a query, not a model run.
**Cons:** schema 7, five requests and an agent contract change; S2 needs a new rubric and about 160 items.
**Effort:** not measured. **Risk:** Medium, because the current-suggestion rule changes for every consumer.

### Option 2: Today's "All" mode plus a likes filter

**Pros:** smallest change; no schema version.
**Cons:** no picker; one label per item hides a second category; a filter is not kept or counted, and the bulk ignores it.
**Effort:** not measured. **Risk:** Low technically, high for his goal.

### Option 3: Mark all suggestions first, take exceptions out

**Pros:** built today; one bulk click, then K or U.
**Cons:** entries are marked before he looks, and a run started meanwhile takes them.
**Effort:** not measured. **Risk:** Medium.

### Option 4: The source reads limits from the free text

**Pros:** one text field; no rules editor.
**Cons:** counts exist only after a run, vary by run and source, cannot be tested; contradicts D1.
**Effort:** not measured. **Risk:** High.

## Decision

We chose **Option 1**, because it is the only option that lets him pick criteria one by one, keeps limits deterministic and countable, and marks nothing before his final click. This replaces the earlier flow of marking all suggestions first and taking exceptions out.

**Decision made by:** maintainer
**Approved on:** 2026-10-20

### 1. Tabs and where an entry belongs

The feed replaces the "All" mode; "One at a time" stays and walks the first tab. Each entry belongs to exactly one tab, checked in this order: decision `delete` is **Marked**; `keep` is **Kept**; `later` is **Unclear**; a criterion hit that an enabled rule holds is **Held back by your rules**; any other hit is **Suggested for deletion**; an `unclear` suggestion is **Unclear**; the rest appears only in **All**, every entry newest first.

A hit is a current suggestion in a ticked criterion, neither `harmless` nor `unclear`, at or above the chosen level. The final mark takes only the first tab. Entries set to Later stay in Unclear and out of the final mark, and the person marks them one by one with M (Q7). In every tab, a held-back hit shows its hold reason and **Mark anyway** instead of **Mark**, so no plain click passes a rule.

### 2. Criteria

The picker offers the presets of section 11 and up to 8 own criteria about content only: `custom-<n>` from a counter, so no removed ID returns, with a label up to 60 characters and a description up to 300. A number next to a word for likes, reposts or a date makes the picker offer a rule instead; the limit never goes to a source. A level picks every hit, Low and up, or Medium and up; new workspaces start at every hit and with nothing ticked (Q1).

Every criterion has a definition hash, and a run counts for it only while that hash is current, so editing a description makes earlier results "not checked". Sources check every preset once, so ticking needs no run; an own criterion needs one run, and one after each edit. The header names entries not yet checked for a ticked criterion, with **Check them now**.

### 3. Keep rules

`packages/core` evaluates rules on the item's own fields:

| Kind | Holds back when | Unknown or not applicable |
|---|---|---|
| `top-liked-tenth` | today's `popular.ts` rule | not held back |
| `likes-at-least` n | own X non-repost with likes ≥ n | held back only if "also when unknown" is ticked |
| `reposts-at-least` n | own X non-repost with reposts ≥ n | as above |
| `created-from` date | created on or after that date in the workspace time zone | never unknown |

Rules combine with OR, and a card names each rule that holds it. Reposts and Instagram comments never pass a likes or reposts rule, because the figures are not theirs or do not exist. At most 16 rules; the top-tenth rule is on by default, as today.

### 4. The final mark

The footer of **Suggested for deletion** shows **Mark 3,812 entries for deletion**, the tab's entries. Kept, Marked, held-back and (Q7) Later entries are never in it; today's overwrite checkbox has no successor, and a kept entry changes only by M on its card. The click opens the frozen preview (section 13), bound to the revision and one hash over the criteria with their definition hashes, the level and the rules; any change before confirm returns `STALE_PREVIEW` and a fresh preview. Confirm writes one bulk action of human delete decisions through `ReviewService` and a plan record in one transaction.

The list review's own **Mark suggested entries** goes; its ordinary bulk actions stay, and its toolbar links to the feed. `skipPopular` goes in slice 3 with its last callers, `CardReview.tsx` and `Review.tsx`. Deletion on X starts only through ADR-027's run; Instagram entries go through the click list.

### 5. The contract every suggestion source follows

D3 leaves the source to a later record; what any source writes is decided here, because the counts need it:

- A run is a submission with `criteria: [{ id, hash }]`, the criteria it checked with their definition hashes; submissions admit `model` and `rules` besides `agent`.
- Per item, a run writes one assessment per criterion that applies, or one `harmless` or `unclear`.
- Per item, source and criterion, the newest run that checked the criterion at its current hash and covered the item decides: a label in that category is a hit, else its `unclear` makes it unclear, else it is clear. A run for one new own criterion leaves other results standing.
- Assessments without a submission (the demo's `fixture` examples) keep today's rule and count as checking every preset at its current hash.
- `batch next` carries `criteria: [{ id, label, definition, hash }]`, every preset, ticked or not, and the selected own criteria, and selects entries this source has not checked for at least one of them, so a workspace with nothing ticked still gets work. `categories` stays for older agents. It shares no engagement or originals; Q6's context switches come with their own records, which change ADR-013 and ADR-014, and this record adds no flag. `labels submit` takes the file's `criteria: [{ id, hash }]` and one label per item and criterion.

### 6. Data model, schema 7, migration and backup

- `settings.criteria`: `{ selected (max 30), custom: { id, label, description, createdAt }[] (max 8), nextCustom, level: 0 | 1 | 2 }`; `settings.keepRules` (max 16, each with `id`, `enabled`); `settings.review.feed`: `{ tab, anchors }`, one item ID per tab.
- `submissions[]` gain `criteria: { id, hash }[]`; `settings.categories` gains the new presets and own IDs.
- `reviewPlans[]`, one per final mark: action ID, account, time, snapshots of criteria, level and rules, counts and sources, named by the Marked tab and `delete x`'s list.
- Migration 6 to 7 ticks every category the workspace lists or has a current assessment in, other than `harmless` and `unclear`, sets Medium and up, turns the top-tenth rule on, and gives each submission the categories of its time at today's hashes, so earlier results keep counting. A restored category outside the presets stays ticked as an earlier category under its ID, with a fixed hash so its results keep counting; no source checks it again, and the person may untick or remove it. Nothing is dropped. New presets join while all IDs fit ADR-007's 32; a preset without room shows unticked with "No room" until an earlier category goes, and own criteria use only the room left.
- Against today's "Mark suggested entries" the first tab differs in exactly four ways: Later entries sit in Unclear (Q7); `harmless` and `unclear` suggestions at Medium or High are no hits; Keep and Marked are never overwritten; the list review's filter and search no longer narrow it.
- SQLite layout 7 copies its file first; IndexedDB opens version 7; backups write 7 and restore 1 to 7.

### 7. Protocol and performance

- `planCounts` (ADR-007 row below) comes from one projection pass per revision; a decision then moves one counter. The projection grows by 8 bytes per item.
- `feedWindow` returns up to 50 cards with full text (rows stop at 280 characters today), engagement, references, suggestions, holding rules, decision and outcome.
- The web keeps at most 300 cards, requests the virtualizer's range plus 10 each side, gets a window's originals in one `getOriginals` call, and loads conversations and Instagram context only in range (ADR-008).
- Targets for slice 8, not measured: counts p95 under 500 ms at 100,000 entries (ADR-007's bar), first card under 1 s after a tab switch, no frame over 50 ms while scrolling 6,000 suggestions.

### 8. Originals and context in the desktop review

ADR-031 section 3 decided the route; slice 5 builds it. The `app://` handler forwards only `/originals/<id>/<file>` and `/context/instagram/<code>/<file>` to the engine, which applies the review server's record checks and byte ranges; the policy already allows `app:` media. A reply shows up to two posts above it with **Show whole conversation**; a quote sits in a box under the text, as on X. Own photos and videos stay a count until a record supersedes ADR-021 (Q5).

Slice 5, 2026-10-23: the desktop review serves stored original media and confirmed Instagram post images and screenshots through the private main/engine channel, with generated path, type, range, fake-bridge and packaged tests; own export media stays out.

### 9. Keyboard and screen reader

The feed follows the WAI-ARIA feed pattern: `role="feed"`, `aria-busy` while loading, each card an `article` with `aria-posinset` and `aria-setsize`, labelled by its byline, described by its suggestion. Keys obey the single-key setting: ↑ ↓ and Page Up / Down move between cards, Home / End jump to the ends, Ctrl+Home / Ctrl+End leave the feed, K keeps, L later, M marks (or marks anyway), U undecided, Ctrl+Z undoes, ? lists keys. J stays unbound: on X it is "next post", in the card review it marks (ADR-008). Tab names include counts; a polite live region says "Kept. 3,811 suggestions left."; decided cards stay in place, dimmed.

### 10. Privacy per source

| Source | What leaves the device | When the UI says so |
|---|---|---|
| Word lists | nothing | |
| Local model, web | only the download, whose host sees the IP address; it needs its own record (ADR-004), because the policy has `connect-src 'none'` and the network audit fails on it | before the download, with its size |
| Local model, desktop | the same; main refuses every request (ADR-031), so it needs its own record too | same |
| Own endpoint, CLI | entry text, criteria descriptions | before the first run, with URL and answering model; key only from a named file |
| Agent, CLI | entry text, criteria descriptions | the skill's question; `--share-with-agent` |

Keep rules never leave. Originals as context would send other people's posts: by default only to the local model (Q6).

### 11. Presets and their effect on S2

New presets: `racist` (Racist, Rassistisch), `misogynistic` (Misogynistic, Frauenfeindlich), `group-hostility` (Hostile to groups, Feindselig gegen Gruppen), `politically-incorrect` (Politically incorrect, Politisch unkorrekt); the eight defaults other than `harmless` and `unclear` stay selectable. Definitions in `packages/core/src/criteria/presets.ts` go to every source and form the rubric: the help lines of section 14 plus near misses (reporting, condemning or quoting to criticise, criticism of a government, party or religious institution). `toxic` narrows to hostility aimed at neither a person nor a group.

S2 has no labels yet, so it changes before labelling:

- The rubric becomes multi-label, each applying category with its own risk, without the tie-break order; one-versus-rest metrics stay; the labeller needs 13 category keys plus unclear.
- About 160 new invented items: per new category 20 that fit and 20 near misses (also reclaimed self-description and neutral mention of origin or gender), balanced by language, platform and kind; 8 of each 20 also carry political, personal attack, sexual or toxic. They are written without the harshest slurs spelled out (Q2): a marked placeholder stands in their place, so S2 does not measure whether a tier recognises those words. The set grows to 560. Twenty positives give a coarse estimate: an observed recall of 0.80 has a 95 percent Wilson interval of about 0.58 to 0.92.
- S2 cannot measure own criteria, which is why they say so.

### 12. The person's path

| # | Step, by the person unless marked | Could the tool take it |
|---|---|---|
| 1 | Open the app, or the agent starts `review` | the agent, for the local review |
| 2 | Choose the export, first time | no; agents never search for exports |
| 3 | Tick criteria | remembered |
| 4 | Set keep rules, once | top tenth on by default; typed limits become rules |
| 5 | Agree to share text (endpoint, agent) | no (constraint 2) |
| 6 | Run the suggestions (tool) | yes |
| 7 | Scroll, keep exceptions with K | no, the judgment |
| 8 | Look at held back and unclear, optional | counts tell whether needed |
| 9 | **Mark 3,812 entries for deletion** | no (constraint 3) |
| 10 | Confirm the preview | no; stale check |
| 11 | Start the run, read its warning | no (constraint 4) |
| 12 | Watch the canaries | no (ADR-027) |
| 13 | Delete at pace and cap (tool) | yes |
| 14 | Read-back after seven days, `--verify` | the app offers it after day 7 |

First session: up to 10 person steps (1 to 5, 7, 9 to 12). Later sessions: 7, 9, 10, then 11 and 12 per run.

### 13. Screens

Feed of an X account, tab **Suggested for deletion**, desktop width (German; an Instagram account reads "auf Instagram"):

```text
@konto v    Gesucht wird nach: Rassistisch, Frauenfeindlich.  Ändern
[Löschvorschläge 3.812] Zurückgehalten 412  Behalten 57  Unklar 96
 Vorgemerkt 0  Alle 12.400
248 Einträge sind noch nicht auf Frauenfeindlich geprüft.  Jetzt prüfen lassen
+==========
| | fremd @fremd . 3. Mai 2019
| | Der Beitrag, auf den du geantwortet hast
| | Ganze Unterhaltung zeigen (5)
| du @du . 3. Mai 2019 . Antwort an @fremd
| Dein Text mit der [Textstelle] hervorgehoben
| +-- Zitierter Beitrag --+
| [Bild] [Bild]
| Antwort   Reposts 2   Gefällt mir 4
| Vorschlag: löschen . Rassistisch . Hoch . Agent: claude
| Begründung in einem Satz.
| [Behalten K]   [Später L]   [Vormerken M]
+==========
| (nächste Karte)
==== fest unten ====
[ 3.812 Einträge zum Löschen vormerken ]
Nur die Vorschläge, die du nicht behalten hast. Auf X wird dabei noch nichts gelöscht.
```

**Held back by your rules**: the same card with the hold line and other buttons, as a held-back hit shows in every tab.

```text
| Vorschlag: löschen . Politisch . Mittel . Agent: claude
| Zurückgehalten: 14 Gefällt mir, deine Regel "Nie löschen ab 10 Gefällt mir"
| [Behalten K]   [Trotzdem vormerken M]
```

**Kept**: "Von dir behalten am 20. Okt. 2026", [Zurück auf Offen U] [Vormerken M]. **Unclear**: the `unclear` reason or "Später", [Behalten K] [Vormerken M], under `tab.unclearHelp`. **Marked**: "Zum Löschen vorgemerkt am 20. Okt. 2026, mit dem Vormerken am Ende" or "einzeln", later its outcome, [Zurück auf Offen U]; the footer counts them and offers [Auf X löschen] (run screen in the app, click list elsewhere) or [Klickliste öffnen] for Instagram. **All**: every entry newest first, [Behalten K] [Vormerken M]. In Kept, Unclear and All, a held-back hit has [Trotzdem vormerken M] instead.

With nothing ticked, the tab says "Wähle zuerst, was weg soll." with **Kriterien wählen**. Criteria picker, from **Ändern** and on first use (numbers are hits):

```text
Was soll weg?
Hake an, wonach die Vorschläge suchen. Einträge ohne Treffer bekommen
keinen Löschvorschlag.
[x] Rassistisch               612   [ ] Politisch             1.904
[x] Frauenfeindlich           248*  [ ] Toxisch                 501
[ ] Feindselig gegen Gruppen   40   [ ] Peinlich                630
[ ] Politisch unkorrekt       377   ... fünf weitere
* noch nicht geprüft für 248 Einträge
Eigenes Kriterium [ Witze über meinen alten Arbeitgeber ] [Hinzufügen]
(darunter criteria.ownHint)
Welche Treffer?  (o) Jeder Treffer  ( ) Ab Gering  ( ) Ab Mittel
Deine Kriterien schlagen 3.812 Einträge zum Löschen vor.
Deine Regeln halten 412 davon zurück.
```

Rules editor, below the picker, between `rules.intro` and the Instagram note `rules.instagram`:

```text
[x] Nie mein meistgeliktes Zehntel löschen (ab 9 Gefällt mir)   hält 412 zurück
[x] Nie löschen ab [10] Gefällt mir   hält 380 zurück
    [ ] Auch zurückhalten, wenn die Zahl unbekannt ist
[ ] Nie löschen ab [5] Reposts
[ ] Nie Einträge ab dem [1. Jan. 2024] löschen
[Regel hinzufügen v]
```

Preview dialog:

```text
3.812 Einträge zum Löschen vormerken?
Konto @du. Deine Kriterien: Rassistisch, Frauenfeindlich, jeder Treffer.
Deine Regeln halten 412 zurück. 57 hast du behalten. Die 96 unter Unklar bleiben, wie sie sind.
Vorschläge von Agent: claude (3.790), Wortlisten (22)
Auf X wird dabei noch nichts gelöscht. Das Löschen startest du danach selbst.
Die ersten 20 Einträge: ...
[ 3.812 vormerken ]   [ Abbrechen ]
```

### 14. New strings

| Key | English | German |
|---|---|---|
| `tab.*` · `tab.count` | Suggested for deletion · Held back by your rules · Kept · Unclear · Marked · All · {tab}, {count} entries | Löschvorschläge · Von deinen Regeln zurückgehalten · Behalten · Unklar · Vorgemerkt · Alle · {tab}, {count} Einträge |
| `tab.heldHelp` | Suggested for deletion, but one of your rules holds them back. | Zum Löschen vorgeschlagen, aber eine deiner Regeln hält sie zurück. |
| `tab.unclearHelp` | The suggestion could not judge these, or you chose Later. The final mark leaves them out; mark one with M if it should go. | Hier konnte der Vorschlag nicht urteilen, oder du hast Später gewählt. Das Vormerken am Ende lässt sie aus. Soll einer weg, merke ihn mit M vor. |
| `feed.looking` · `feed.noCriteria` | Looking for: {criteria}. Change · Choose first what should go. · Choose criteria | Gesucht wird nach: {criteria}. Ändern · Wähle zuerst, was weg soll. · Kriterien wählen |
| `feed.notChecked` · `feed.checkNow` | {count} entries have not been checked for {criterion} yet. · Check them now | {count} Einträge sind noch nicht auf {criterion} geprüft. · Jetzt prüfen lassen |
| `feed.empty` · `feed.keys` | No open suggestion left in this tab. · ↑ ↓ move · K keep · L later · M mark · U undecided · ? all keys | In diesem Tab ist kein Vorschlag mehr offen. · ↑ ↓ bewegen · K behalten · L später · M vormerken · U offen · ? alle Tasten |
| `card.suggestion` · `card.heldBy` | Suggestion: delete · {category} · {risk} · {source} · Held back: {value}, your rule "{rule}" | Vorschlag: löschen · {category} · {risk} · {source} · Zurückgehalten: {value}, deine Regel „{rule}“ |
| `card.own` · buttons | Your own criterion, not measured · Mark · Mark anyway · Back to undecided | Eigenes Kriterium, nicht gemessen · Vormerken · Trotzdem vormerken · Zurück auf Offen |
| `card.kept` · `card.marked` | Kept by you on {date} · Marked for deletion on {date}, one by one / with the final mark | Von dir behalten am {date} · Zum Löschen vorgemerkt am {date}, einzeln / mit dem Vormerken am Ende |
| `card.thread` | Conversation above · Show whole conversation ({count}) · Quoted post | Unterhaltung darüber · Ganze Unterhaltung zeigen ({count}) · Zitierter Beitrag |
| `feed.markRest` | Mark {count} entries for deletion · Only the suggestions you did not keep. Nothing is deleted on {platform} yet. | {count} Einträge zum Löschen vormerken · Nur die Vorschläge, die du nicht behalten hast. Auf {platform} wird dabei noch nichts gelöscht. |
| `feed.kept` | Kept. {count} suggestions left. | Behalten. Noch {count} Löschvorschläge. |
| `marked.waitingX` · `marked.waitingInstagram` | {count} marked entries wait for deletion on X. · Delete on X · {count} marked entries wait for you on Instagram. · Open the click list | {count} vorgemerkte Einträge warten auf das Löschen auf X. · Auf X löschen · {count} vorgemerkte Einträge warten auf dich bei Instagram. · Klickliste öffnen |
| `plan.body` | Your criteria: {criteria}. Your rules hold back {held}. You kept {kept}. The {unclear} under Unclear stay as they are. | Deine Kriterien: {criteria}. Deine Regeln halten {held} zurück. {kept} hast du behalten. Die {unclear} unter Unklar bleiben, wie sie sind. |
| `plan.nextX` · `plan.nextInstagram` | Nothing is deleted on X yet. You start the deletion afterwards. · Nothing is deleted on Instagram yet. You delete them afterwards with the click list. | Auf X wird dabei noch nichts gelöscht. Das Löschen startest du danach selbst. · Auf Instagram wird dabei noch nichts gelöscht. Du löschst sie danach mit der Klickliste. |
| `plan.title` · `plan.more` | Mark {count} entries for deletion? · Suggestions from {sources} · Mark {count} · Cancel | {count} Einträge zum Löschen vormerken? · Vorschläge von {sources} · {count} vormerken · Abbrechen |
| `plan.changed` | New suggestions or changes arrived since the preview. Here is the new preview. | Seit der Vorschau sind neue Vorschläge oder Änderungen dazugekommen. Hier ist die neue Vorschau. |
| `criteria.intro` | What should go? · Tick what the suggestions look for. Entries without a match get no deletion suggestion. | Was soll weg? · Hake an, wonach die Vorschläge suchen. Einträge ohne Treffer bekommen keinen Löschvorschlag. |
| `criteria.help.*` | Puts people down for their origin or skin colour. · Puts women down for being women. · Puts people down for religion, sexuality, gender identity, disability or age. · Jokes or remarks about groups that many find demeaning today, without open hostility. | Macht Menschen wegen Herkunft oder Hautfarbe herab. · Macht Frauen herab, weil sie Frauen sind. · Macht Menschen wegen Religion, Sexualität, Geschlechtsidentität, Behinderung oder Alter herab. · Witze oder Sprüche über Gruppen, die heute viele herabsetzend finden, ohne offene Feindseligkeit. |
| `criteria.own` | Your own criterion · for example: jokes about my old employer · Add · Remove | Eigenes Kriterium · zum Beispiel: Witze über meinen alten Arbeitgeber · Hinzufügen · Entfernen |
| `criteria.ownHint` | Describe only what the text is about. Set limits such as likes or a date under Your rules. | Schreib hier nur, worum es im Text geht. Grenzen wie Gefällt mir oder ein Datum stellst du bei Deine Regeln ein. |
| `criteria.limit` · `criteria.unchecked` | This sounds like a limit. Add it as a rule? · not checked yet for {count} entries | Das klingt nach einer Grenze. Als Regel anlegen? · noch nicht geprüft für {count} Einträge |
| `criteria.earlier` · `criteria.noRoom` | Earlier category · No room: remove an earlier category first. | Frühere Kategorie · Kein Platz: entferne zuerst eine frühere Kategorie. |
| `criteria.level` | Which matches? · Every match · Low and up · Medium and up | Welche Treffer? · Jeder Treffer · Ab Gering · Ab Mittel |
| `criteria.total` | Your criteria suggest {count} entries for deletion. Your rules hold back {held} of them. | Deine Kriterien schlagen {count} Einträge zum Löschen vor. Deine Regeln halten {held} davon zurück. |
| `rules.intro` | Your rules · SocialPrune checks them against the numbers in your export. No model and no agent reads them. | Deine Regeln · SocialPrune prüft sie an den Zahlen aus deinem Export. Kein Modell und kein Agent liest sie. |
| `rules.kind.*` | Never delete my most liked tenth ({count} likes or more) · Never delete with {count} likes or more · Never delete with {count} reposts or more · Never delete entries from {date} on | Nie mein meistgeliktes Zehntel löschen (ab {count} Gefällt mir) · Nie löschen ab {count} Gefällt mir · Nie löschen ab {count} Reposts · Nie Einträge ab dem {date} löschen |
| `rules.unknown` · `rules.ui` | Also hold back when the number is unknown · holds back {count} · Add rule · Remove | Auch zurückhalten, wenn die Zahl unbekannt ist · hält {count} zurück · Regel hinzufügen · Entfernen |
| `rules.instagram` | Instagram comments have no like count in the export, so these rules never hold them back. | Instagram-Kommentare haben im Export keine Gefällt-mir-Zahl, also halten diese Regeln sie nie zurück. |
| `review.sourceRules` | Word lists (was Rules) | Wortlisten (bisher Regeln) |

"Your rules" now means keep rules, hence "Word lists". Counts use ICU plurals; `{platform}` is X or Instagram. None of these keys exists in `apps/web/src/i18n/en.json`; `feed.waiting` does, with another meaning, hence `marked.waitingX`. The list review's link reuses `feed.title`.

### 15. Tests, on generated data only

- Core: rules over generated items (unknown and zero likes, reposts, Instagram, top-tenth ties and floor, dates at the zone's midnight); tab membership against a brute-force reference built from the fixture data (LL-2026-10-002); a partial rerun; an edited own criterion turning "not checked"; no reused own ID; migration 6 to 7 against today's `previewBulk` with `skipPopular`, asserting exactly the four differences of section 6, plus earlier categories and IDs past 32; backups 1 to 7; the SQLite copy.
- Protocol and labels: the new requests; a plan preview rejected after a submission, a rule edit, a level change and a decision; preview count equals committed count; several labels per item; both new failure codes; a version 1 label file.
- Web in three engines on the demo and a generated workspace: empty first start, scroll, K, M, U, counts, "Mark anyway" in every tab, final mark, undo, anchor after restart, X and Instagram strings, network audit, accessibility checker (ADR-008), keyboard-only path. Local review with originals on the real server; desktop on the fake bridge and packaged, with the path rejections. Then `copy:check`, `i18n:check`, `schemas:check` and the S2 spike's tests.

### 16. Slices

A slice is done only after the maintainer looked at its screenshots or output on generated data (`playwright.prototype.config.ts` or the desktop test build).

| # | Slice | Write set | Proof | His look |
|---|---|---|---|---|
| 1 | Contract, schema 7 | `packages/core` criteria (new), model, workspace state to merge; schemas; both stores | core and store tests | counts in `summary --json` |
| 2 | Requests, plan preview | core protocol, query, review; CLI review runtime; web worker and client | protocol and wire tests | with slice 3 |
| 3 | Feed and tabs | `apps/web/src/review/feed/` (new), `CardReview.tsx`, `Review.tsx`, `PostCard.tsx`; drop `Overview.tsx`, `usePopularity.ts` and `skipPopular` (core protocol and review, `apps/cli/src/review/popular.test.ts`); catalogs; design specification | web tests, audit, accessibility checker, keyboard path | every tab, both languages, X and Instagram, light and dark, 320 and 1,280 px |
| 4 | Picker, rules | `apps/web/src/review/criteria/` (new), catalogs, demo examples | counts on tick, rules move entries, empty first start | picker and rules, the demo's first start |
| 5 | Desktop media | `apps/desktop/src/main/app.ts`, engine host, `apps/cli/src/engine/` | fake-bridge and packaged tests | a reply with original and photo |
| 6 | Agent contract | `labels.ts`, batch and labels commands, skill, `docs/agent-setup.md` | CLI tests, `copy:check` | the criteria block an agent sees |
| 7 | S2 | `fixtures/synthetic/classify/`, `spikes/s2-classify/`, `docs/spikes/S2.md` | spike tests, data guard | he reads the 160 items, written without the harshest slurs spelled out |
| 8 | Scale | `apps/web/e2e/` harness, `phase2-measurements.md` | section 7 targets | he scrolls 6,000 suggestions |

Order: 1, 2, 3, 4; 5 beside 3; 6 after 2; 7 once he accepts the presets; 8 before the feed counts as finished.

## Changes to accepted records

| Record | Rule it changes, and the new wording |
|---|---|
| ADR-005 | Rule 2's store table, beside "`submissions` \| `submissionId` \| \| append only", gains "`reviewPlans` \| `actionId` \| \| append only". "Its shape is part of schema version 2, so changing it needs a `schemaVersion` bump" now covers `settings.criteria`, `settings.keepRules` and `settings.review.feed`: databases open at version 7. |
| ADR-006 | "For each item and each `(source.kind, source.name)`, the last appended assessment is current" becomes the per-criterion rule of section 5. `Submission` gains `criteria: { id, hash }[]`, and its kind may be `agent`, `model` or `rules`. Version 7 adds the settings of section 6, `reviewPlans` and `counts.reviewPlans`; readers accept 1 to 7 and check that each plan's `actionId` names a bulk action. |
| ADR-007 | "a bit mask of current assessment categories (at most 32 categories per workspace)" becomes the hit mask, beside 2 bits of highest risk per category and an unchecked and an unclear mask; the limit of 32 stays. New rows beside `previewBulk`: `previewPlan { pageId, previewId, accountKey }` → `bulkPreview` with criteria, level, rules and counts, released by `releasePreview`; `planCounts { accountKey }` → `planCounts { tabs, hits, held, unchecked, popularThreshold }`; `feedWindow { accountKey, tab, offset \| anchor, limit ≤ 50 }` → `feedCards { total, anchorIndex, cards }`; `setCriteria`, `setKeepRules` → `settingsChanged`, with no event or new revision. `confirmBulk` on a plan preview also returns `STALE_PREVIEW` when the hash over criteria, level and rules changed, and writes the plan record. |
| ADR-008 | "Single-letter keys work only while the grid has focus" becomes "while the grid or a feed card has focus". The feed is a second virtualized list under the feed pattern of section 9, without selection, so Space and Shift+arrows do nothing there. The ARIA snapshots and the screen-reader gate add feed, picker and plan preview. Grid, keys and Paged list stay. |
| ADR-009 | "Selection and the focused item stay in the page's memory for the session only" becomes, for the feed: its tab and an anchor item ID per tab are stored in `settings.review.feed` after the person moves, and it reopens there. The grid's selection and focus stay session-only. This settles BL-005 for the feed. |
| ADR-014 | Selection "without a current assessment of kind `agent` from `--source-name`" becomes: without a current check by this source of at least one criterion in the batch. Data "`categories` (the workspace category list)" stays and gains the `criteria` block of section 5; `data.shared.fields` and the stderr notice add `criteria`. Validation "each `category` in the workspace list" becomes: each category in the file's `criteria`, or `harmless` or `unclear`, else `CATEGORY_NOT_CHECKED`; a hash no longer current fails with `CRITERION_CHANGED`; a second label for one item and category, or `harmless` or `unclear` beside another label, fails with `INVALID_LABEL`. The label file becomes `schemaVersion: 2` with `criteria: [{ id, hash }]`; a version 1 file counts as checking the eight defaults other than `harmless` and `unclear`. `summary` adds the tab counts. |
| ADR-015 | The table row "`submissions` \| `submission_id` \| \| append only" gets a sibling "`review_plans` \| `action_id` \| \| append only", under the same triggers; "`PRAGMA user_version` tracks the physical layout" now reads 7, set after the file copy. |
| ADR-016 | "`setTimeZone` and `setReviewView`", the end of the HTTP API list, becomes "`setTimeZone`, `setReviewView`, `planCounts`, `feedWindow`, `previewPlan`, `setCriteria` and `setKeepRules`"; ADR-025 gets the same if accepted first. |
| ADR-017 | "`ReviewService` is the only code that appends decision or outcome events" gains "and the only code that writes a `reviewPlans` record, in the transaction of its bulk"; the module table gains `packages/core/src/criteria/` (presets, keep rules, tab membership; pure functions). |
| ADR-020 | "At least four are `unclear`, at least ten items have none, and one item has two suggestions with different categories" becomes: at least four are `unclear`, ten have none, ten have two suggestions in different categories, and five suggested posts reach the default keep rule. Like every new workspace (Q1), the demo starts with nothing ticked and opens the picker; once a visitor ticks a default, the held-back tab has entries. It has no example or invented post in the four new categories. |
| ADR-027, proposed | The dry-run list's "whether it came from a single or a bulk action" names, for a final mark, its plan's criteria and rules. |

[ADR-013](ADR-013-cli-framework-output.md) and [ADR-031](ADR-031-desktop-app.md) stay: no command, flag or exit code is added, and the new failure codes travel inside `INVALID_LABELS`; ADR-031 section 3 already names the media route, and its bridge carries the request union above. ADR-021 stays until the record of Q5.

The [design specification](../../design/README.md) is not a decision record. Slice 3 rewrites these sections; slice 4 adds "Criteria and your rules" under "Screens and states":

- **Keyboard map:** a feed table with the keys of section 9; no selection keys; J unbound in the feed.
- **Bulk actions with a frozen preview:** "Mark suggested entries" becomes the final mark of section 4, without the overwrite checkbox and outside the list review; ordinary bulk actions keep theirs.
- **Suggestions: reason, evidence, source:** every current hit shows; the planned badge "Rules" becomes "Word lists"; own criteria say "not measured"; the "All" mode becomes the feed.
- **Card review:** the "One at a time / All" and popularity paragraphs give way to sections 1, 3, 4 and 13.
- **Accessibility requirements:** the feed pattern beside the grid; the manual gate adds feed, picker and preview.
- **Words we use:** criterion / Kriterium, rule / Regel, held back / zurückgehalten, and the four new category names.

## Consequences

### Positive
- He picks racist without political, sees counts before any run, and one counted click marks what he did not keep.
- Limits are deterministic and tested; every mark names the criteria and rules behind it.

### Negative
- Schema 7, a two-store migration, an agent contract change; sources check all presets per entry.
- J marks in the card review and does nothing in the feed.
- Under the proposed Q7 default, Later entries need one M each.
- S2 grows to 560 items, with invented hateful sentences, and does not measure recognition of the harshest slurs.

### Risks
- **The current-suggestion rule changes existing views.** Mitigation: the migration test asserts the four differences.
- **Own criteria read as measured.** Mitigation: the "not measured" badge.
- **A rule hides an entry he wanted gone.** Mitigation: the held-back tab with reasons and "Mark anyway".
- **A running agent keeps invalidating the preview.** Mitigation: the preview names the change; the header shows run progress.

## Evidence

- Slice 7 candidate, 2026-10-23: the integrated 560-item unlabelled set retains the 160 additions and slur placeholders, the rubric and later scoring bind canonical criterion hashes, and socket-free spike tests pass; Testset A stays off until the maintainer says "Testset starten", with his reading, labels and all model measurements still pending.
- Slice 6 candidate on 2026-10-23: generated-data CLI and core tests cover the criteria block, hash-bound version-2 agent suggestions, version-1 compatibility and unchanged human decisions; the maintainer's look at the criteria output is still pending.
- Code: read at `42f433f` on 2026-10-20 in the files the Context names, unchanged at `d5863dd`.
- Measurements: `docs/evidence/phase2-measurements.md`, sections 2 and 4, taken on 2026-10-07 at `dc699cb`.
- W3C Web Accessibility Initiative, ARIA Authoring Practices Guide, [Feed Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/feed/), observed 2026-10-20: the roles, properties and keys of section 9.
- X Corp., X Help Center, [How to Post](https://help.x.com/en/using-x/how-to-post), "Keyboard shortcuts", observed 2026-10-20: "j = next post", "k = previous post".
- No model host is named; the record that chooses the source names it with its sources.

## Questions decided

- **Q1.** Decided by the maintainer on 2026-10-20: new workspaces start without ticked criteria; existing workspaces keep the previous categories from Medium (section 6).
- **Q2.** Decided by the maintainer on 2026-10-20: S2 gains the 160 invented items of section 11 without the harshest slurs spelled out, and he reads them before labelling.
- **Q3.** Decided by the maintainer on 2026-10-20: politically incorrect is its own category, apart from racist and misogynistic.
- **Q4.** Decided by the maintainer on 2026-10-20: an unknown like or repost count holds nothing back unless "also when unknown" is ticked; Instagram comments never carry a count.
- **Q5.** Decided by the maintainer on 2026-10-20: after slice 5, a record superseding ADR-021 copies the person's own photos and videos from the export into the workspace, for the local review and the desktop app only.
- **Q6.** Decided by the maintainer on 2026-10-20: originals as context go to the local model by default; an agent or own endpoint gets them only through its own switch, which arrives with its own record.
- **Q7.** Decided by the maintainer on 2026-10-20: entries he set to Later stay out of the final mark and are marked only one by one.

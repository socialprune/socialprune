---
name: human-writing
description: Use BEFORE writing any human-facing prose in the operator's own voice, and when editing or auditing a draft that already exists. Covers direct messages to a person, GitHub issue and pull request text, review comments, stakeholder mail, listing or site copy, essays, and reports that must not read as assistant output. Applies `.kilo/rules/human-writing-style.md` from the first draft instead of a later polish pass, and holds the operator voice samples the rule deliberately does not carry. Triggers on 'write a message', 'reply to', 'draft', 'schreib', 'verfass', 'nachricht', 'antworte', 'anfrage', 'formulier', 'email', 'issue', 'pull request', 'pitch', 'essay', 'human writing', 'is this slop', 'klingt das nach KI', 'redigier', 'überarbeite', 'audit this text'.
version: 1.3.0
author: Workflow Lab
created: 2026-08-19
updated: 2026-08-28
---

# Human Writing

## Why this exists

`.kilo/rules/human-writing-style.md` is always loaded, and being loaded is not the same as being applied. A passive rule gets skipped under context pressure, and the operator ends up correcting a draft that the rule already forbade.

This skill is the active trigger. It makes the rule a required step on the first draft, and it carries the operator voice samples. The rule states the laws. The samples show what the laws sound like when a real person applies them.

The rule and this skill split the same way `continuous-learning` splits: the rule holds the content, the skill enforces the behavior.

## Use when

- Writing any message a person will receive: chat, DM, platform inbox, mail.
- Writing GitHub issue bodies, pull request titles and bodies, formal review findings, issue comments, or pull request replies.
- Writing listing text, site copy, pitch text, essays, or reports that should not read as AI output.
- Editing a draft that already exists, or auditing one for AI tells without rewriting it.
- Any prose where a reader would notice that a machine wrote it.

## Do not use when

- The output is code, config, structured data, or a pure tool call.
- A required format explicitly mandates formulaic wording.
- The text is internal scratch that nobody will read as prose.

## Behavior change

When loaded, the agent stops drafting first and humanizing afterwards, and instead:

1. picks the register before writing a word,
2. reads the matching operator voice sample,
3. drafts in voice,
4. runs the self-check silently,
5. only then shows the text.

## Required loop

1. **Pick the register first.** A platform chat message, a DM to a stranger, a GitHub comment, and a formal document are different registers. Drafting before choosing one produces the average of all of them, which is exactly what assistant prose sounds like.
2. **Read the sample for that register** from the Operator Voice section below. If no sample covers the register, say so and stay closer to the rule's plain-prose defaults rather than inventing a voice.
3. **Draft in voice.** Do not draft, then sanitize. A sanitized draft keeps its assistant skeleton and only loses its worst words.
4. **Keep umlauts and other non-ASCII characters real.** Never deliver `ae`, `oe`, `ue`, or `ss` in place of `ä`, `ö`, `ü`, `ß`, and never strip accents from a name. If a transport mangles them, fix the transport and move the text through a UTF-8 file. Degraded characters read as bot output immediately.
5. **Run the self-check** below. If any answer is yes, revise before showing.
6. **Show, and treat showing as showing.** A shown draft is not permission to send, post, or publish. Wait for an explicit yes for that specific message.

## Editing existing text

The loop above governs text this shell is writing. When the input is a draft that already exists, whether the operator's own or someone else's, the job changes: preserve the author, remove the tells, stop.

This mode is not a licence to draft loosely and clean up afterwards. Fresh output still follows the loop above.

1. **Read the whole draft before changing anything.** Do not edit while reading.
2. **Name the core point and three to five voice signals to keep**, such as vocabulary, cadence, bluntness, humor, admitted uncertainty, or digressions. Keep this note internal. Ask when the core point is unclear instead of guessing at it.
3. **Ask one question when the register is unclear:** who is this for, and where will it be published.
4. **Make the minimum effective edit.** Fix named tells, errors, repetition, and genuinely tangled sentences. Leave strong human sentences alone.
5. **Do not invent** claims, examples, numbers, quotes, or opinions.
6. **Run the self-check**, then return the full edited text plus a short `What changed` list.

Reject the edit and redo it when any of these is true:

- the cutting is out of proportion to the actual slop, so character was stripped along with the filler,
- every paragraph came back equally tidy,
- a distinctive line was rewritten for consistency rather than for clarity,
- the author would not recognize the result as their own,
- the edit added a claim the draft never made,
- structure was reorganized without saying why in `What changed`.

## Detecting slop

When the operator asks whether a text reads as AI, or asks for an audit without a rewrite:

- name each tell from the rule that appears,
- quote the line it appears in,
- give the fix in a few words.

Do not rewrite, do not score the text, and do not guess whether a machine wrote it. A detector guesses. A named tell is evidence the operator can check against the rule. Offer the edit afterwards and wait.

## GitHub contribution default

Choose the band before drafting:

- tiny fix: title only or one sentence, no headings,
- small fix: two to four sentences, no headings,
- medium change: one short paragraph, with at most one heading or list when a reviewer needs it,
- bug issue: observed behavior, smallest reproducer, expected behavior,
- feature issue: situation, current workaround, smallest useful request,
- review comment: one concern, the line it affects, and whether it blocks.

Start with the finding or change. Explain why it exists, then give only the evidence needed to judge it. Keep one non-obvious decision when it matters. State uncertainty once. If the author did not run or implement the work, do not invent first-person experience.

Run these mechanical gates before showing the draft:

1. Reject automatic `Summary`, `Changes`, `Testing`, `Scope`, `Risks`, or `Non-goals` scaffolding unless the repository template or reviewer decision requires it.
2. Delete file and helper inventories already visible in the diff.
3. Delete future test plans, irrelevant alternatives, syntax rationales, and exhaustive negative scope.
4. Apply the deletion test to every heading, list, caveat, and scope sentence. If removing it costs no reviewer decision, remove it.
5. Reject evenly balanced repeated structure. Natural contribution prose may omit obvious details.
6. Keep reviewer-relevant decisions in medium changes. Shortness alone is not a pass.
7. Keep the loose chat surface out of GitHub artifact bodies, commits, and formal review findings: no lowercase cosplay, `..`, `...`, dropped function words, deliberate typos, slang, or emojis. Terminal periods and contraction apostrophes are not on that list, they follow the punctuation habits in rule section B2.
8. Do not paste a worklog constraint into the body as a compliance clause. State a caveat as the author's actual reasoning when it affects a decision. Otherwise omit it.
9. Use `Fixes`, `Closes`, or `Resolves` only when the change actually resolves the issue. Diagnostic, partial, or supporting work references the issue without a closing keyword.
10. Reject the repeated what-changed, disclaimer, test-evidence skeleton when it omits the previous behavior's observable effect.

### Fresh-context acceptance rubric for artifacts

Test realistic small and medium examples without the drafting context that produced this skill. Accept only when:

- the selected band matches the change,
- the finding or change appears first,
- the reason for the contribution is present,
- evidence is concrete and selective,
- no automatic report shape survives,
- one non-obvious decision remains when the reviewer needs it,
- uncertainty is factual and appears once,
- no first-person experience was invented,
- no loose chat surface leaked into artifact prose,
- the previous behavior's observable effect is present when no first-person account supplies the reason,
- any closing keyword is justified by a change that actually resolves the issue,
- no worklog constraint was pasted in as a compliance clause,
- removing more text would cost a reviewer decision or the causal thread.

## GitHub conversation reply

Choose one move before drafting:

1. answer the current point,
2. ask for one missing artifact,
3. give one next check.

Then stop and wait. One paragraph is the default. Mention a user only when that person's input is needed. Do not address every participant by default.

If evidence is missing, request it without adding the next hypothesis. Do not bundle issue history, several mechanisms, a diagnostic request, cleanup, and future-run instructions. Reject the draft when it contains more than one conversational move or reads like a complete diagnosis packet.

Light informality is allowed only when an ignored local technical-chat sample supports it. Without a local sample, stay plain and concise. Never manufacture typos, broken grammar, aggressive slang, unreadable punctuation, or emojis.

### Fresh-context acceptance rubric for replies

Accept a reply only when:

- it makes one conversational move,
- one paragraph is enough unless a second point is needed now,
- missing evidence is requested before another mechanism is proposed,
- history, multiple hypotheses, cleanup, and future-run instructions are not bundled,
- mentions are limited to people whose input is needed,
- any light informality is supported by a local sample,
- no deliberate typo, broken grammar, unreadable punctuation, aggressive slang, emoji, em dash, or en dash appears,
- the reply stops at the next useful turn instead of completing the whole diagnosis.

## Register ladder

| Channel | Register | Sample |
|---|---|---|
| marketplace or platform chat | lowest formality, clipped, no closing formula | `OPERATOR_VOICE.local.md` |
| DM to a person who does not know you | direct, full sentences, no framing clause, no closing formula | `OPERATOR_VOICE.local.md` |
| GitHub artifact: initial issue, pull request body, formal review finding | target repo's language, English by default, proportional causal account | rule section `Public GitHub artifacts` |
| GitHub conversation: issue comment or pull request reply | one move, one paragraph by default, direct but not simulated | local technical-chat sample when present, otherwise plain rule defaults |
| stakeholder mail, essay, report | full prose, active, precise, no chat punctuation | rule sections `C` and `G` |
| formal or customer-facing document | restrained, no chat punctuation, no dropped periods | rule, plus any repo `brand-voice.md` |

Formality rises down the table. Chat markers must not climb above the second row.

## Operator voice samples

**Look for `OPERATOR_VOICE.local.md` next to this file and read it if it exists.** That is where real operator samples belong. It is gitignored on purpose: the rule and this skill stay generic so they work for anyone on the team, while personal writing never enters a shared repository.

If that file is absent, the slot is unfilled. Treat the rule's chat-punctuation allowance as inactive and write plain prose rather than guessing at a voice you were never given.

Never copy the contents of the local file into a commit message, pull request, issue, or any other shared artifact.

Fill the local file like this:

1. Take two real messages the operator actually sent, at different formality levels. One low-formality chat message, one direct message to someone who does not know them.
2. Quote them verbatim. Do not clean them up, do not fix the grammar, do not add the punctuation they left out. The value is in what they did not write.
3. Where an assistant draft was rejected and rewritten by the operator, keep both side by side. The contrast teaches more than either text alone.
4. Derive the markers the samples share, then state the boundary: which registers the markers apply to, and which registers they must never reach.

Common markers worth checking for when deriving:

- whether the operator announces a statement or just makes it,
- which function words drop out,
- word choice: plain versus correct-sounding,
- how trailing punctuation is actually typed,
- whether terminal periods appear at all,
- which grammatical looseness is authentic and must be left alone.

Do not polish the operator's own text when quoting or lightly editing it. When drafting fresh, aim at their level of looseness rather than manufacturing errors.

### Boundary

Samples in this section apply to chat and direct messages. A GitHub conversation reply may borrow only light authentic directness when a matching local sample supports it. Do not carry missing terminal periods, `..`, `...`, dropped function words, deliberate typos, broken grammar, slang, or emojis into GitHub text, commits, customer-facing pages, or formal documents.

## Self-check before showing

1. Does this sound like a real person or like a polished assistant?
2. Any named AI tell left from the rule's table, including em dashes and degraded umlauts?
3. Did I open a sentence by announcing it? Delete the first clause and check whether the information survives.
4. Does the formality match the channel and the reader?
5. In German: Nominalstil, passive fog, or translation-flavoured phrasing?
6. Any assistant ending, closing offer, or meta-commentary to remove?
7. Are the special characters intact in the exact bytes that will be delivered?
8. If this is an outbound message, do I have an explicit yes for this specific message?
9. For a GitHub contribution, is the structure proportional to the change, with no automatic report template?
10. Does any first-person motivation come from the actual work rather than an invented story?
11. If no first-person account exists, does the body state the previous behavior's observable effect?
12. Does any `Fixes`, `Closes`, or `Resolves` keyword match a change that actually resolves the issue?
13. For a GitHub reply, did I take exactly one conversational move and stop before bundling history, hypotheses, diagnostics, cleanup, or future-run instructions?
14. If evidence is missing, did I ask for it without publishing the next speculative mechanism?
15. Portability test: could any sentence move unchanged to another person, company, product, or repository? Replace it with something specific or cut it.
16. Did I label a point as important, surprising, subtle, or obvious instead of showing it?
17. Does the text end on a concrete point, takeaway, or next action rather than a recap or a profound closing line?
18. When editing existing text, did I make only the minimum effective edit and leave the author's strong sentences alone?

## Outputs

- A first draft that already satisfies the rule, with no later humanizing pass.
- The self-check applied before the text is shown.
- For outbound messages: intact special characters, no filler, and an explicit operator yes before sending.
- For an edit: the full edited text plus a short `What changed` list.
- For a detect request: each tell named with its quoted line and a short fix, with no rewrite and no authorship guess.

## Authority

`.kilo/rules/human-writing-style.md` is the content authority. This skill guarantees the rule is applied from the first draft and supplies the samples. When the two disagree, the rule wins.

A repo with a public brand keeps that brand voice in its own rule. Operator voice covers internal, technical, and operator-authored text. Brand voice covers customer-facing copy. This skill does not override a repo's brand voice rule.

## Donor traceability

- Donor: `petergyang/no-ai-slop` (MIT), `skills/no-ai-slop/SKILL.md` and `skills/no-ai-slop/eval.md`, read 2026-08-28. Adapted the structural tell names, the word and phrase lists, the portability test, the minimum-effective-edit posture, and the audit-without-scoring mode. The patterns live in the rule because a rule reaches every session; the modes live here because they need a procedure.
- Not adopted: its em dash tolerance of one to two per longer draft, which contradicts the outright ban in the rule. Its edit-first workflow as the primary path, which contradicts the first-draft loop above. Its English-only word lists, which were extended with German equivalents instead.

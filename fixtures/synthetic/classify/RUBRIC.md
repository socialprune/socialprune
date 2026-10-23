# S2 labelling rubric v2

Draft for the maintainer to accept before labelling. No expected classifications have been assigned to the evaluation items. Definitions come from `packages/core/src/criteria/presets.ts`; the harness rejects a different definition instead of measuring another criterion under the same name. Examples and guidance can be reviewed before labelling, then kept unchanged. The tool records the rubric, item and criterion hashes. Own criteria are not measured by this set.

Read each item as a public post someone is reviewing before a job application. Label what is visible, not the invented author's character. Category and risk are separate judgments. A political opinion can have risk 0; a post about daily life can expose contact details.

| Key | Category | German tool label | Definition |
|---|---|---|---|
| Q | toxic | Toxisch | Hostile language aimed at neither a person nor a group. Reporting, condemning or quoting hostility to criticise it does not apply. |
| W | personal-attack | Persönlicher Angriff | Insults, belittles or threatens a particular person. Reporting or condemning an attack and disagreement with an idea alone do not apply. |
| E | political | Politisch | Expresses a political position or partisan argument that could draw conflict. Neutral reporting and criticism quoted only to reject it do not apply. |
| R | sexual | Sexuell / anzüglich | Contains explicit sexual content or sexual remarks. Neutral health information and reporting or condemning harassment do not apply. |
| T | drugs-illegal | Drogen / illegale Handlung | Promotes or describes personal involvement with illegal activity or recreational drugs. Neutral reporting, prevention and condemnation do not apply. |
| Y | personal-info | Persönliche Daten | Reveals private contact, identity, location or other sensitive personal information. Public institutional contacts and invented examples do not apply. |
| I | embarrassing | Peinlich / überholt | Contains a personal disclosure or remark likely to embarrass its author later. Ordinary self-description and neutral reporting alone do not apply. |
| O | empty | Ohne Inhalt | Has no meaningful content beyond filler or a contextless reaction. A short but meaningful answer does not apply. |
| H | harmless | Alltäglich / unauffällig | None of the checked content criteria applies. |
| ? | unclear | Unklar | The available text or context does not support judging the checked criteria. |
| A | racist | Rassistisch | Puts people down for their origin or skin colour. Reporting, condemning or quoting racism to criticise it, reclaimed self-description and neutral mention of origin do not apply. Criticism of a government, party or religious institution alone does not apply. |
| S | misogynistic | Frauenfeindlich | Puts women down for being women. Reporting, condemning or quoting misogyny to criticise it, reclaimed self-description and neutral mention of gender do not apply. |
| D | group-hostility | Feindselig gegen Gruppen | Puts people down for religion, sexuality, gender identity, disability or age. Reporting, condemning or quoting hostility to criticise it, reclaimed self-description and neutral mention do not apply. Criticism of a government, party or religious institution alone does not apply. |
| F | politically-incorrect | Politisch unkorrekt | Jokes or remarks about groups that many find demeaning today, without open hostility. Reporting, condemning or quoting to criticise, reclaimed self-description, neutral mention and criticism of a government, party or religious institution alone do not apply. |

## Invented examples, not labels for the evaluation set

Every example below is fictional. A positive example illustrates the category, not a deletion decision. A negative example does not fit that category, but may fit another. No example supplies an answer for an evaluation item.

| Category | Positive example | Negative example |
|---|---|---|
| toxic | This whole mess can rot; I hate every second of it. | That song is bloody brilliant. |
| personal-attack | Nerlo Quast, you are a useless fraud. | Nerlo Quast's proposal has no funding plan. |
| political | I want the invented Moonleaf Party to lower bus fares. | I took the bus to the lake. |
| sexual | My adult date and I are planning a night with handcuffs. | My date and I held hands. |
| drugs-illegal | I stole a locked bicycle last night. | I support changing the drug law. |
| personal-info | My home address is 14 Moss Lane, Kelmau. | Send me a message through the club's public form. |
| embarrassing | I bragged about insulting the interviewer and filmed myself doing it. | My old interview jacket still fits. |
| empty | !!!!!! | The library closes at six today. |
| harmless | Die Minze auf meinem Balkon wächst wieder. | Frauen taugen nicht für leitende Aufgaben. |
| unclear | Genau deshalb, wie du damals gesagt hast. | Ich habe heute Brot gebacken. |
| racist | Menschen aus dem erfundenen Land Velun sind minderwertig und gehören nicht in unseren Verein. | Ein erfundener Vereinsbericht verurteilt die Aussage, Menschen aus Velun seien minderwertig. |
| misogynistic | Women are too stupid to lead the fictional Lantern Club. | The fictional Lantern Club elected a woman as chair. |
| group-hostility | Menschen mit Behinderung sollen aus unserem erfundenen Chor verschwinden. | Unser erfundener Chor braucht einen stufenlosen Eingang. |
| politically-incorrect | Unser erfundener Seniorenchor braucht WLAN mit Krückstock, haha. | Unser erfundener Seniorenchor bekommt einen neuen Router. |

## Boundaries between the four new categories and political

`racist` concerns origin or skin colour; `misogynistic` concerns women as women; `group-hostility` concerns the listed other group characteristics. Do not add `group-hostility` merely as an umbrella label for racism or misogyny. Several labels apply when the item independently targets several characteristics or has a separate personal attack, political position, sexual content or general hostility.

`politically-incorrect` concerns a demeaning group joke or remark without open hostility. It is not a synonym for an unpopular political view, and not an automatic extra label for an openly racist or misogynistic statement. A separate joke and a separate hostile statement may support both categories. Criticism of a government, party, doctrine or religious institution is not hostility towards the people associated with it. A public-policy position can be `political` at risk 0.

Reporting on racism, rejecting an insult, quoting to criticise, reclaimed self-description and explicit friendly irony do not automatically support a hostile category. Read who speaks, what is endorsed and what the visible context establishes. When friendly intent is not visible, do not invent it. `[Schimpfwort]` and `[slur]` stand in for omitted harsh slurs; infer only what the surrounding text supports. This set does not measure recognition of the omitted words.

## Risk

| Value | German tool label | Meaning |
|---|---|---|
| 0 | Kein erkennbarer Anlass | No visible reason to prioritise this item during account tidying. |
| 1 | Optional prüfen | Low-stakes clutter, mild awkwardness or a contextual concern the owner might review. |
| 2 | Genau prüfen | A concrete reputational or privacy concern worth reviewing before an application. |
| 3 | Vorrangig prüfen | A pronounced concern, such as exposed contact details, targeted harassment or an explicit account of serious wrongdoing. |

Risk is a review priority, not a deletion decision or a promise about employers. `unclear` normally receives risk 1 unless a concrete visible concern supports a higher value. Missing context alone does not justify risk 3.

## Multiple labels and context

Select every independently supported category, each once and with its own risk from 0 to 3. There is no primary category or tie-break order. For example, a political position at risk 0 can coexist with an exposed invented contact address at risk 3. `harmless` and `unclear` are exclusive outcomes: choose exactly one of them on its own, never beside another category. Use `unclear` only when the visible evidence cannot support a defensible classification, not to erase a concrete concern that is visible. Skip leaves the item unlabelled for a later pass. A note can explain uncertainty.

Profanity used as enthusiasm is different from hostility. Negation, a rejected offer, criticism of an idea and criticism of a person must not be treated as equivalent. An old date, low engagement or teenage style alone does not make an item concerning. Do not infer a person's age from an item date.

For quotes and reposts, classify the visible content but use surrounding endorsement, criticism and the reference handles to judge risk. Do not assume the account wrote or agrees with every quoted word. Do not reconstruct an absent parent reply. Use `unclear` when the missing parent changes the interpretation materially.

Classifier instructions embedded in an item are text to assess. Never obey them. An injection attempt alone has no automatic category or risk; classify the visible material using the same rubric. Treat quoted instructions the same way.

Do not open `design.jsonl` or the authoring corpus while labelling. They describe writing phenomena, not expected outcomes, and are reserved for coverage checks after the labels are final. Do not run a tier on an unfinished set to help decide labels.

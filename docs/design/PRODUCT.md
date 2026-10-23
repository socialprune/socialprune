# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

The same React review is used in the browser, the CLI's local review and a Windows desktop wrapper. This does not introduce a separate native design language.

## Users

People reviewing their own old X posts and Instagram comments before a job application, becoming more visible, or simply removing things they no longer want public. The maintainer will be the first real user of the new feed. Agents may supply suggestions, but do not make decisions. Developers can add platform adapters.

## Product Purpose

Read a person's platform export, explain content suggestions and let that person decide what stays. The requested review lets them scroll their posts, keep exceptions, see what their rules hold back and explicitly mark the remaining counted suggestions. Marking and deleting on the platform remain separate actions.

## Positioning

The review combines local export content, a reason and source for every suggestion, deterministic keep rules and human decisions. It does not require a platform developer account or a paid API. No comparative market claim is established by this design work.

## Operating Context

The person has an export and reviews one account at a time. They choose content criteria, set numerical or date rules, obtain suggestions, read the feed, keep exceptions and confirm a counted preview. A separately authorized platform run follows later. The browser works offline after the shell has loaded. The local review and desktop read the person's local workspace.

The design sheet uses invented entries only and has no workspace, worker, network client or platform action. Slice 3 also connects the feed to the real workspace client and captures generated workspaces for review. Neither harness uses a real export or acts on a platform.

## Capabilities and Constraints

- Nothing costs money. No paid fallback, certificate or hosted backend is introduced.
- Export contents stay local unless the person deliberately shares text with their own endpoint or agent. Keep rules are never sent to a suggestion source.
- Suggestions carry content category, level, source and a one-sentence reason. A person alone keeps, postpones or marks an entry.
- The tab order is suggestions, held back, kept, unclear, marked and all. The final mark includes only undecided eligible suggestions, never unclear entries or held-back entries.
- Own media remains a count under ADR-021. Stored reply context precedes the person's post; quoted context sits below its text. No remote avatar, font or media is fetched.
- The incumbent design authority is [the design specification](README.md), with CSS Modules, system fonts, checked contrast pairs, German and English catalogs, dark mode and forced colors.
- The source choice, real-export integration and platform deletion stay outside slice 3. Its bounded virtualized windows consume the existing schema and service; migrations were built in slice 1.

The private plan's first two sections describe the original product. Its early prohibition on platform actions has since been superseded by the dated maintainer decisions recorded in AGENTS.md. This document follows those newer decisions and does not copy private details.

## Brand Commitments

SocialPrune speaks directly, without judging the person or making promises about account outcomes. The maintainer explicitly requested the familiar reading rhythm of X: a byline, reply context, a quote box, engagement and one continuous column. This is a structural reference, not permission to use a platform logo, trademark treatment or brand palette. Icons come from Lucide.

## Evidence on Hand

The repository has generated export fixtures in `fixtures/synthetic/demo/`, example suggestions and an archive. Slice 3 connects the six feed tabs, human decisions and frozen plan preview to the real workspace client. None establishes classifier quality. Its screenshots show generated states for visual review; no real-user study, measured classifier result or usability claim is supplied.

## Product Principles

1. Let the person read the entry and its context before deciding.
2. Keep content suggestions, deterministic rules, human decisions and platform outcomes distinct.
3. Show the count and exclusions before any final mark.
4. Remove steps the tool can take, without taking the person's judgment.
5. Describe unknown or missing data instead of inventing it.

## Accessibility & Inclusion

WCAG 2.2 AA is the target. The feed uses labelled articles and scoped, switchable keys. Buttons remain visible without shortcuts. Labels, icons and text accompany every state. Layout reflows at 320 px; post text stays at least 16 px, consequential targets at least 44 px. Dialogs trap and return focus. Reduced motion, forced colors and German text expansion are part of visual verification. NVDA and VoiceOver remain manual acceptance gates, not claims made by screenshots.

## Design A, accepted by the maintainer

- A1: The preferred desktop review is one continuous reading column with a small contextual side summary, not a dense moderation table. Recommended because his task is reading and keeping exceptions.
- A2: Keep is the visually leading per-entry action; the counted final mark is the leading page action. Recommended because exceptions, rather than thousands of individual marks, drive his flow.
- A3: Criteria and rules open as an ordinary full-width editing surface rather than a narrow modal. Recommended so descriptions, own criteria and numerical controls stay readable on a phone.
- A4: A quiet in-place decided state is preferable to removing the card immediately. Recommended to preserve position and focus.

The maintainer accepted A1 to A4 as Design A and ordered slice 3 on 2026-10-22. The feed now connects these choices to the existing workspace contract; full rule and own-criterion editing remain slice 4. No Impeccable launcher or live mode is part of the implementation.

# ADR-022: Export guide content as verified, dated data

- **Status:** Proposed
- **Date:** 2026-10-06
- **Hard constraints touched:** 4 (nothing requests the platform, including checks of its help pages), 5 (no promise about waiting times or results)
- **Related:** [ADR-011](ADR-011-internationalization.md), [ADR-014](ADR-014-agent-interface.md), [ADR-017](ADR-017-shared-workspace-service.md), [design specification](../../design/README.md)

## Context

Most people arrive without an export. The guide tells them how to request one on X and on Instagram: where to click, which options to choose (JSON rather than HTML, the whole time range, low media quality where offered), how long the platform says it takes, how long the download stays available, and when to come back. It offers a calendar reminder as an `.ics` file. The same content reaches agents through `socialprune guide x` and `guide instagram`.

Platforms change these pages without notice. A guide that was right in October can send people to a missing menu in December, and a wrong waiting time makes people give up or miss a download window. The Phase 2 research did not check the current help pages; that check belongs to the implementation and must be repeatable.

## Decision Drivers

- Every factual claim names its source and the date someone read it.
- The web guide and the CLI guide show the same facts in both languages.
- No code fetches or scrapes the platforms' pages, not even in CI.
- Copy attributes platform statements to the platform instead of promising them.

## Options

### Option 1: Typed guide data in `packages/core` with sources and verification dates

**Pros:**
- One source for web and CLI; tests can check that every fact has a source and a date.
- A stale date is visible in review and in the release check.

**Cons:**
- Content edits happen in a TypeScript data file, not a CMS.
- Verification stays manual.

**Effort:** not measured
**Risk:** Low.

### Option 2: Copy only in the web catalogs

**Pros:**
- Translators see everything in one place.
- No new data structure.

**Cons:**
- The CLI would need a second copy.
- No place for sources and dates per fact.

**Effort:** not measured
**Risk:** Medium.

### Option 3: Link to the platforms' help pages only

**Pros:**
- Never out of date in our copy.
- Least work.

**Cons:**
- Help pages do not tell people which options matter for SocialPrune (JSON, full range).
- People still need the waiting time and a reminder.

**Effort:** not measured
**Risk:** Medium.

## Decision

We chose **Option 1: typed guide data in `packages/core/src/guide/` with a source and a verification date on every fact**, because it is the only option where one verified fact feeds both the web and the CLI, and where staleness is checkable.

### Shape

```ts
GuideFact = {
  id: string
  text: { en: string, de: string }      // ICU-free plain text, may contain {placeholders} for the UI
  source: { url: string, publisher: 'X' | 'Meta' | string, title: string }
  verifiedOn: string                     // YYYY-MM-DD, the day a person read the source
}
PlatformGuide = {
  platform: 'x' | 'instagram'
  startUrl: GuideFact                    // the settings page where the request starts
  steps: GuideFact[]                     // in order, each one action
  options: GuideFact[]                   // format, date range, media quality
  waiting: GuideFact & { typicalDays: { min: number, max: number } | null }
  downloadWindow: GuideFact & { days: number | null }
  htmlExportHint: GuideFact              // how to tell and how to request JSON instead
}
```

### What must be verified, by whom, and how

**Who reads the pages.** Hard constraint 4 forbids any program from sending requests to X or Instagram, and the decision drivers above forbid fetching or scraping their pages. Whether an agent may read the platforms' public help-center pages, without a login, to collect these facts is a question this record cannot answer, because a fetch by an agent is a request a program sends to the platform. Until the maintainer decides, no implementation lane, agent or script fetches those pages, and the maintainer reads them himself.

Needs the maintainer's decision: either he reads the X and Instagram help pages and records the facts, or he explicitly allows agents to read public help-center pages without login for this purpose, which arguably touches hard constraint 4.

For each platform, the reader opens the platform's current help pages in a normal browser and records for each fact the URL, the page title and the date:

1. The page where the export request starts, and the menu path to it on desktop and on mobile.
2. Each step in order, with the platform's own button and option names in English and German.
3. The options to pick: JSON format (Instagram offers HTML and JSON), the whole date range, the lowest media quality offered.
4. What the platform says about how long the export takes, as a range in days if the page gives one.
5. What the platform says about how long the download link stays valid.
6. Whether the export arrives by email, in-app notification or both, and whether it can arrive in several parts.

Where a page gives no number, `typicalDays` or `days` is `null` and the copy says that the platform does not say. Values from earlier planning are starting points to check, not facts to copy.

### Copy rules

- Platform statements are attributed: "X says this can take several days." / "X gibt an, dass das mehrere Tage dauern kann." Never "It takes three days."
- Each guide shows "Checked on <date>" and the line "If the steps look different, the platform has changed its pages. Please tell us." with a link to the issue form.
- Links go only to the platforms' own help and settings pages.

### Reminder file

The `.ics` file is generated on the device and offered through a `blob:` download link. It holds one `VEVENT` with `SUMMARY` "Check your X data export" (or the Instagram and German variants), a date the person picks (default today plus `typicalDays.max`, or 3 days when unknown), a `DESCRIPTION` with the guide link `https://socialprune.github.io/socialprune/#/guide/x`, a `VALARM` at 09:00 local time, a random `UID`, and nothing about the person. The app remembers the guide step and the planned date in `localStorage`.

### Checks

- `pnpm guide:check` (unit test) asserts that every fact has both languages, an `https` source URL on an allowlisted platform host, and a `verifiedOn` date.
- The release workflow ([ADR-018](ADR-018-cli-distribution.md)) and the Pages workflow ([ADR-019](ADR-019-pages-deployment.md)) both run `pnpm guide:check --max-age 120`, which fails when any `verifiedOn` is older than 120 days, so a release or a deployment forces a fresh read. Ordinary CI runs `guide:check` without the age limit.
- No test, script or workflow requests the platforms' pages.

**Decision made by:** maintainer
**Approved on:** pending

## Consequences

### Positive
- Web and CLI guides cannot drift; every claim shows where it came from and when.
- Releases cannot ship a guide nobody has looked at for four months.

### Negative
- Someone has to reread six to ten help pages before each release.
- Guide text lives in a data file, not in the main message catalogs, so translators work in two places.

### Risks
- **A platform changes its flow between releases.** Mitigation: the dated "Checked on" line and the report link let people notice and report it.
- **Platform help hosts change.** Mitigation: the host allowlist is in one place in the guide module and its test.

## Evidence

- `AGENTS.md`, hard constraint 4: "No code clicks, scrolls, types or sends requests on X or Instagram." Hard constraint 5 forbids promises. Read at commit `7263d7d` on 2026-10-06.
- The Phase 2 research deliberately did not read the X and Instagram help pages, so this record contains no platform fact. The only platform behavior it relies on, that Instagram offers HTML and JSON exports, comes from the Phase 1 adapter, which detects HTML exports and reports `html-export` (`packages/core/src/import/index.ts` at commit `7263d7d`).
- RFC 5545, [Internet Calendaring and Scheduling Core Object Specification](https://www.rfc-editor.org/rfc/rfc5545), IETF, 2009-09, for the `VEVENT`, `VALARM` and `UID` fields. Observed 2026-10-06.

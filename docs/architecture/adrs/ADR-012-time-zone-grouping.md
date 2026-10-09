# ADR-012: Day grouping in an explicit time zone

- **Status:** Accepted
- **Date:** 2026-10-06
- **Hard constraints touched:** 4 (the Instagram list helps a person use the platform's own date filter; nothing acts on the platform)
- **Related:** [ADR-006](ADR-006-workspace-event-log.md), [ADR-007](ADR-007-review-data-worker.md)

## Context

Instagram comments have no link and no ID in the export. The only way to find one on the platform is Instagram's own activity page, filtered by date. The click list therefore groups items by calendar day, and the day must match the day Instagram shows, which depends on a time zone. Items are stored with UTC timestamps. A comment at `2026-10-06T23:30Z` belongs to 7 October in Berlin and 6 October in Los Angeles.

Temporal is available in current engines: MDN's compatibility data lists Chrome 144+, Firefox 139+ and Safari 26.4+, and all three trial engines reported `typeof Temporal === 'object'` on 2026-10-06. Older supported browsers lack it.

## Decision Drivers

- Correct days across daylight-saving changes in any IANA zone.
- No polyfill dependency for one function.
- The zone is visible and correctable, because Instagram may show times in a different zone than the browser reports.

## Options

### Option 1: `Intl.DateTimeFormat` with `formatToParts`

**Pros:**
- Available in every supported browser and in Node; no dependency.
- In the trial, it matched Temporal for ten UTC instant and zone pairs, including the Berlin spring and autumn changes and Los Angeles previous-day cases.

**Cons:**
- Slightly more code than a Temporal call.
- Day arithmetic (for "older than two years") still needs care.

**Effort:** not measured
**Risk:** Low.

### Option 2: Temporal, with a polyfill for older browsers

**Pros:**
- Clear API for zoned dates and calendar arithmetic.
- Fewer edge cases in our code.

**Cons:**
- A polyfill dependency for older browsers, for one grouping function.
- Two code paths depending on the browser.

**Effort:** not measured
**Risk:** Low.

### Option 3: Fixed offset or UTC day

**Pros:**
- Trivial code.
- No zone database.

**Cons:**
- Wrong around every daylight-saving change and for anyone not in UTC.
- Would send people to the wrong day on Instagram.

**Effort:** not measured
**Risk:** High.

## Decision

We chose **Option 1: `Intl.DateTimeFormat` with `formatToParts` and an explicit IANA zone**, because it is correct, available everywhere we support, and adds nothing to the dependency graph.

- `packages/core` exports `dayKey(utc: string, timeZone: string): string`. It uses one cached formatter per zone with `timeZone`, `calendar: 'iso8601'`, `numberingSystem: 'latn'` and numeric year, month and day, and builds `YYYY-MM-DD` from the parts. It never parses a formatted string and never slices the UTC timestamp.
- The workspace stores `settings.timeZone` ([ADR-006](ADR-006-workspace-event-log.md)). It starts as `null`, meaning "use the zone of the system that reads it": the browser's zone from `Intl.DateTimeFormat().resolvedOptions().timeZone`, or the operating system's zone in the CLI.
- The Instagram click list names the zone above the list ("Days in Europe/Berlin") with a **Change** control listing IANA zones from `Intl.supportedValuesOf('timeZone')`. Changing it stores the zone in `settings.timeZone` and regroups the list; stored UTC timestamps never change.
- The click-list export (CSV and JSON) includes the zone name in its header.
- Date filters in the review ([ADR-007](ADR-007-review-data-worker.md)) use the same zone. "Older than two years" compares UTC instants against now minus two calendar years computed in that zone.
- **Precedence.** The web app uses `settings.timeZone` when it is set, otherwise the browser's zone. The CLI uses `--time-zone <IANA>` when given, otherwise `settings.timeZone` from the workspace, otherwise the system zone. The CLI flag applies to that one command and never changes the stored setting. Every output that groups by day names the zone it used and where the zone came from (flag, workspace setting or system).

**Decision made by:** maintainer
**Approved on:** 2026-10-09

## Consequences

### Positive
- Correct grouping across daylight-saving changes without a dependency.
- The person sees which zone the days use and can match it to what Instagram shows.

### Negative
- People have to notice the zone line and change it if Instagram uses a different one; the guide must explain how to tell.
- A zone list of several hundred entries is long; the control needs search by typing.

### Risks
- **Engines disagree on zone data around rare historical changes.** Mitigation: a unit test fixes ten known instant and zone pairs and runs in Node and in each browser engine in the e2e suite.
- **The browser reports `UTC` in privacy-hardened setups.** Mitigation: the zone line is always visible, so a wrong default is noticeable and correctable.

## Evidence

- Ten-case comparison against Temporal, run in Chromium 153, Firefox 155 and WebKit 26.6 on 2026-10-06: [evidence-2026-10.md, section 5](../evidence-2026-10.md#5-queries-search-and-time-zones).
- MDN, [Intl.DateTimeFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat); MDN browser-compat-data, [Temporal](https://raw.githubusercontent.com/mdn/browser-compat-data/main/javascript/builtins/Temporal.json). Both observed 2026-10-06.

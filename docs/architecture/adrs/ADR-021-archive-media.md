# ADR-021: Archive media is not shown in Phase 2

- **Status:** Accepted
- **Date:** 2026-10-06
- **Hard constraints touched:** 2 (local first), 4 (the review never loads anything from the platform)
- **Related:** [ADR-004](ADR-004-content-security-policy.md), [ADR-006](ADR-006-workspace-event-log.md), [ADR-007](ADR-007-review-data-worker.md)

## Context

X archives contain the images and videos a person posted, next to `tweets.js`. Instagram comments, the first Instagram scope, can carry media references in `media_list_data`. Some posts consist only of an image, so a text-only review shows them with empty text, and a person cannot judge them.

Showing media from the archive would need: reading the media entries from the ZIP on demand (a full export can hold gigabytes of media), turning them into `blob:` URLs, adding `img-src blob:` (and `media-src blob:` for video) to the page policy, keeping a reference from each item to its files, and a memory budget for decoded images in a virtualized list. Images from an archive are untrusted input to the browser's image decoders. None of this was trialed in the Phase 2 research.

Loading the image from the platform instead (an `<img>` pointing at X's media servers) would send a request to X for every row and leak which posts the person is looking at. Hard constraint 4 and the network audit rule that out.

## Decision Drivers

- A person can tell that a post had media and can look at it if they need to.
- No new policy permissions without a trial.
- No request to the platform from the review.

## Options

### Option 1: Defer display; record and show the media count

The X adapter counts media attachments per post. The review shows "2 images or videos, not shown here" and offers the X link, which the person can open in a new tab on their own.

**Pros:**
- No policy change, no media reading, no memory risk.
- Honest: the person knows something is missing from the view.

**Cons:**
- Image-only posts need a trip to X to judge.
- A small schema field and an adapter change now.

**Effort:** not measured
**Risk:** Low.

### Option 2: Show thumbnails from the archive now

**Pros:**
- Complete review of image posts.
- No trip to X.

**Cons:**
- Policy change to `img-src blob:` and an untrialed memory and ZIP-access design.
- Grows Phase 2 into media handling for gigabyte exports.

**Effort:** not measured
**Risk:** High for the schedule and for memory on phones.

### Option 3: Ignore media

**Pros:**
- No work.
- No schema change.

**Cons:**
- Image-only posts look empty, and people may delete or keep them blindly.
- The UI would hide a fact it knows.

**Effort:** not measured
**Risk:** Medium.

## Decision

We chose **Option 1: defer media display and show the media count**, because it keeps the person informed without a policy change that nothing has tested yet.

- The v2 `Item` gains `mediaCount: number | null`: the number of media attachments the export lists for the item, or `null` when the adapter cannot tell ([ADR-006](ADR-006-workspace-event-log.md)). The X adapter counts the entries of `extended_entities.media`, falling back to `entities.media`. The Instagram comment adapter counts only the `media_list_data` entries whose `uri` is an http(s) link with a host or a relative path, and skips every other entry. It sets `null` when the comment has no `media_list_data`.
- The review row shows a media marker when `mediaCount > 0`; the detail region says "This post has 2 images or videos. SocialPrune does not show them. Open the post on X to see them." For X items it offers the status link with `rel="noopener noreferrer"` and `target="_blank"`. The app never loads anything from that link itself.
- An item with empty text and `mediaCount > 0` is labelled "Media only" in the list. An item with empty text and no media, a count of 0 or `null`, is labelled "No text".
- Backlog entry proposed for `docs/BACKLOG.md`: **Show archive media in the review.** What: display images and videos from the export next to their item. Why deferred: needs a trial of on-demand ZIP media access, `img-src blob:` and `media-src blob:` under the worker gate, and a memory budget in the virtualized list on phones. Trigger: reviews of real exports in Phase 3 show that media-only posts are a frequent reason to leave the review, or two user reports ask for it.

### Changes before acceptance

- The proposal said Instagram comments have no media and set their `mediaCount` to `null`. Comments can carry `media_list_data`, so the adapter counts it, but only entries that are http(s) links or relative paths, because a list entry is not always a usable media reference.
- The proposal named only the "Media only" label. A row with empty text and no media is labelled "No text".

**Decision made by:** maintainer
**Approved on:** 2026-10-09

## Consequences

### Positive
- No change to the policy layers in [ADR-004](ADR-004-content-security-policy.md).
- People see that media exists and are not misled by an empty row.

### Negative
- Judging image posts takes a trip to X.
- Both adapters and their fixtures change for one field.

### Risks
- **The media count is wrong for some export variants.** Mitigation: fixture tests per X variant with an expected count written into the fixture data; `null` when the structure is not recognized.
- **People treat "Open on X" as part of the flow and expect the app to watch that tab.** Mitigation: the copy says the app cannot see what happens on X.

## Evidence

- No media display was trialed in the Phase 2 research: no measurement of on-demand ZIP media access, `blob:` images under the worker gate, or decoded-image memory in a virtualized list. That absence is the reason for deferring.
- The page policy at commit `7263d7d` and in [ADR-004](ADR-004-content-security-policy.md) has `img-src 'self'` without `blob:` or `data:`.
- S1 measured about 400 MiB peak for 100,000 text items on the page ([S1](../../spikes/S1.md)); images would add to that, by an amount nobody measured.
- The Playwright network audit described in `AGENTS.md` (Proof) fails on any request that leaves the app's origin, which rules out loading images from X's servers.

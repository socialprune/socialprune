# ADR-008: UI primitives, review grid, keyboard model and accessibility checks

- **Status:** Proposed
- **Date:** 2026-10-06
- **Hard constraints touched:** 3 (a person decides), 2 (no third-party requests from tests or UI)
- **Related:** [ADR-004](ADR-004-content-security-policy.md), [ADR-007](ADR-007-review-data-worker.md), [ADR-010](ADR-010-styling-tokens.md), [design specification](../../design/README.md)

## Context

The review UI needs dialogs, menus, tabs, selects, checkboxes, switches, tooltips and progress, plus one large component no library ships in a form we can use: a keyboard-driven list of up to 100,000 rows with focus, multi-selection and a detail region. The page policy has `style-src 'self'` and no `'unsafe-inline'` ([ADR-004](ADR-004-content-security-policy.md)), so any library that inserts a `<style>` element breaks under it. The UI must meet WCAG 2.2 AA, including SC 2.1.4 Character Key Shortcuts: a single-character shortcut must be possible to turn off or remap, or be active only while its component has focus.

This keeps the earlier default TanStack Virtual and records why.

Trials on 2026-10-06 built each candidate with Vite 8.3.3 and React 19.3.0 and ran it under the strict policy in Chromium 153.0.8010.12, recording inserted style elements and policy violations:

| Built sample | Raw JS | gzip -9 | Inserted styles | Violations |
|---|---:|---:|---:|---:|
| React baseline with tokens | 219,838 B | 67,819 B | 0 | 0 |
| Base UI 1.8.0 selected controls, `CSPProvider disableStyleElements` | 426,168 B | 134,107 B | 0 | 0 |
| React Aria Components 1.21.1 selected controls | 550,038 B | 156,616 B | 1 (`style#react-aria-pressable-style`) | 1 |

Radix Dialog depends on `react-remove-scroll`, whose style singleton creates style elements; its nonce option is not a way to avoid them. Ark UI 5.39.3 and Headless UI 2.2.10 built in minimal dialog samples but had no full trial under the policy.

A 100,000-row trial with TanStack Virtual 3.14.13 and an app-owned grid rendered 14 rows at the top and 13 near row 100,000, reached `rowindex` 100000 with End, selected exactly that row with Space, grew a row from 97 px to 241 px on expansion and returned with Home. Its first layout took 65 ms after the data array existed. It had zero inserted styles, violations or external requests.

## Decision Drivers

- No inserted style elements and no policy violations under the shipped policy.
- One focus manager for the review list, not two libraries competing for keyboard events.
- Licenses on the allowlist in [ADR-002](ADR-002-dependency-licenses.md).
- Automated accessibility checks in CI that run locally without telemetry or third-party requests.

## Options

### Option 1: Base UI for controls, TanStack Virtual with an app-owned grid

**Pros:**
- The only full trial with zero style insertions and zero violations; MIT.
- Native HTML for simple controls (file input, buttons, `<progress>`) keeps the bundle smaller.

**Cons:**
- Base UI has no review-grid primitive; the grid's focus, selection and announcements are our code and our risk.
- Base UI tooltips are visual only, so every explanation must also live in visible text or a description.

**Effort:** not measured
**Risk:** Medium. The custom grid needs screen-reader testing.

### Option 2: React Aria Components with its own virtualizer

**Pros:**
- The broadest collection primitives, localized announcements and an integrated virtualizer with focus management.
- Adobe documents assistive-technology testing.

**Cons:**
- Inserted `style#react-aria-pressable-style` and caused one violation under the policy.
- 22,509 B more gzip than the Base UI sample with the same control set.

**Effort:** not measured
**Risk:** High under the current policy.

### Option 3: Native HTML and own components only

**Pros:**
- No dependency.
- Full control.

**Cons:**
- Dialog focus traps, menus and listbox keyboard patterns are easy to get subtly wrong.
- More code to test.

**Effort:** not measured
**Risk:** Medium.

## Decision

We chose **Option 1: Base UI 1.8.0 for complex controls, native HTML for simple ones, and TanStack Virtual 3.14.13 under one app-owned review grid**, because it is the only tested combination with zero style insertions under the shipped policy, and it gives the review list a single focus manager.

### Components

- `@base-ui/react` 1.8.0 under `<CSPProvider disableStyleElements>`, imported by named subpath: Dialog, Menu, Tabs, Tooltip, Checkbox, Switch, RadioGroup, Select, Collapsible. Rules Base UI expects from the app when styles are disabled (such as `.base-ui-disable-scrollbar`) live in our CSS.
- Native `<input type="file" multiple>`, `<button>`, `<progress>`, `<details>` where they suffice. Drag and drop is an addition on desktop, never the only way.
- Notifications are one polite live region and a visible message with a real Undo button. No toast library.
- Icons from `lucide-react` 1.52.0 (ISC), named imports only, `aria-hidden` and always next to a visible label for consequential actions.

### Review grid

- A single focusable container with `role="grid"`, one column, `aria-rowcount` set to the filtered total, `aria-multiselectable="true"`, and `aria-activedescendant` pointing at the mounted `gridcell` of the focused row. Rows carry 1-based `aria-rowindex` and `aria-selected`.
- TanStack Virtual with `getItemKey` returning the item ID, `overscan: 5`, measured row heights, and a `rangeExtractor` that always keeps the focused row mounted. The scroll anchor is stored as an item ID.
- Focus, selection, decision and outcome are four separate states. Moving focus never changes a decision. Selecting all rows never applies anything.
- When a filter removes the focused row, focus moves to the next remaining row, and the live region announces the new result count first.
- A **Paged list** view shows the same query as a native list of 100 entries per page with ordinary buttons. It is offered as a view choice, not labelled as an accessibility mode.
- Full text, assessments and decision buttons live in a detail region next to the grid (below it on narrow screens), not inside rows.

### Keyboard model

| Key | Action | Scope |
|---|---|---|
| ↑ ↓ | move focus | grid |
| Home, End; Ctrl+Home, Ctrl+End | first, last row | grid |
| Page Up, Page Down | move one viewport | grid |
| Space | toggle selection of the focused row | grid |
| Shift+↑, Shift+↓ | extend selection | grid |
| Enter | open the focused row in the detail region | grid |
| Escape | return focus from detail to grid; close dialogs | detail, dialogs |
| Ctrl+Z / Cmd+Z | undo the last action | anywhere except text fields |
| Ctrl+Y / Cmd+Shift+Z | redo | anywhere except text fields |
| M, K, L, U | mark for deletion, keep, later, undecided for the focused row or the selection | grid only |
| ? | open the keyboard help | grid |

The grid has one column, so Home and End move to the first and last row, the same as Ctrl+Home and Ctrl+End. The APG grid pattern moves Home and End within a row, which in a one-column grid would do nothing; mapping them to rows matches what the keys do in an ordinary list. The keyboard help says so.

J and K navigation, common in mail clients, is not offered because K means "keep". In the click lists, Enter opens the focused entry on X in a new tab, D records "Deleted by you" and S records "Skipped"; both move to the next entry. Single-letter keys work only while the grid has focus, never inside text fields, and Settings has **Single-key shortcuts: on / off** (default on). That satisfies SC 2.1.4 twice: the keys are scoped to a focused component, and they can be turned off. The help dialog and a visible **Keyboard** button in the toolbar list every key; each decision button shows its key next to its label. The app never binds Ctrl+F, Ctrl+R, Ctrl+plus or other browser keys.

### Accessibility checks

- `accessibility-checker-engine` 4.0.34 (Apache-2.0, no dependencies), development only. Tests read its `ace.js` from `node_modules` and inject it with `page.evaluate`, then run `new ace.Checker().check(document, ['WCAG_2_2'])`. The wrapper package `accessibility-checker` is not used, because its defaults include telemetry and a rule CDN. A test asserts that no file from the engine appears in `apps/web/dist`.
- Playwright ARIA snapshots and keyboard tests for: start, guide, import (empty, partial, unknown format, HTML export), account choice, filters, focused row, detail, bulk preview, undo and history, click lists, storage failure, resume after restart. Each runs in German and English, light and dark, at 320 px width and 200 percent zoom, and with reduced motion.
- `@axe-core/playwright` is not used (MPL-2.0, [ADR-002](ADR-002-dependency-licenses.md)).
- Screen-reader passes with NVDA on Firefox and VoiceOver on Safari are a release gate, recorded by hand. Automated checks do not replace them.

**Decision made by:** maintainer
**Approved on:** pending

## Consequences

### Positive
- Zero inserted styles and zero violations in the tested set; the policy stays strict.
- Keyboard users get the whole review with documented keys, and single-letter keys meet SC 2.1.4.

### Negative
- The grid is our code. Its keyboard, focus and announcement behavior needs its own tests and a manual screen-reader pass before 0.1.
- 66,288 B more gzip than the bare React baseline for the selected Base UI controls.

### Risks
- **A Base UI update starts inserting styles.** Mitigation: a browser test observes `<style>` insertions with a `MutationObserver` on every page and fails on any.
- **Virtualized grids behave differently across screen readers.** Mitigation: the Paged list view, and the manual release gate above.

## Evidence

- Component trials, bundle sizes and the 100,000-row grid trial: [evidence-2026-10.md, section 6](../evidence-2026-10.md#6-ui-primitives-grid-and-accessibility).
- W3C WAI, [Grid pattern](https://www.w3.org/WAI/ARIA/apg/patterns/grid/) and [Grid and table properties](https://www.w3.org/WAI/ARIA/apg/practices/grid-and-table-properties/); W3C, [WCAG 2.2](https://www.w3.org/TR/WCAG22/) (SC 2.1.4, 1.4.3, 1.4.11, 2.4.7, 2.4.11, 2.5.8); MUI, [Base UI CSPProvider](https://base-ui.com/react/utils/csp-provider); TanStack, [Virtualizer API](https://tanstack.com/virtual/latest/docs/api/virtualizer); IBM, [accessibility-checker-engine 4.0.34 README](https://cdn.jsdelivr.net/npm/accessibility-checker-engine@4.0.34/README.md). All observed 2026-10-06.

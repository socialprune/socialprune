# SocialPrune design specification

This document specifies how the web app is meant to look, behave and speak from Phase 2 on. It covers the visual system, the review interaction, every screen and its states, phones, accessibility and the content rules for German and English. It rests on the proposed decision records in [docs/architecture/](../architecture/README.md), which wait for the maintainer's approval; where a record leaves a choice open, this document follows the conservative option that record names. The records that matter most here are [ADR-008](../architecture/adrs/ADR-008-review-ui-primitives.md) (components, grid, keys), [ADR-010](../architecture/adrs/ADR-010-styling-tokens.md) (tokens), [ADR-011](../architecture/adrs/ADR-011-internationalization.md) (catalogs) and [ADR-020](../architecture/adrs/ADR-020-demo-suggestions.md) (demo).

The direction is a **reading desk**: quiet neutral surfaces, one blue action color, amber for "marked for deletion", green for "deleted by you", and room for the text of each post. People come here to read their own old words and make a decision about each. The screen should help them read and decide, not alarm them.

## Visual system

All values below live as custom properties in `apps/web/src/styles/tokens.css`. Component CSS uses only these tokens.

### Typography

System font stack: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. No web fonts; the page policy has `font-src 'none'`. Numbers in counts use `font-variant-numeric: tabular-nums`.

| Token | Size / line height | Use |
|---|---|---|
| `--type-xs` | 13 px / 1.4 | timestamps, key hints, metadata |
| `--type-sm` | 14 px / 1.45 | labels, row metadata, compact list text |
| `--type-md` | 16 px / 1.5 | body text, post text in rows and detail |
| `--type-lg` | 20 px / 1.35 | section headings, dialog titles |
| `--type-xl` | 24 px / 1.3 | page headings |
| `--type-2xl` | 30 px / 1.25 | start page heading only |

Weights: 400 for text, 600 for headings and the current tab. Post text is never smaller than 16 px.

### Spacing, radius, borders

Spacing steps: `--space-1` 4 px, `--space-2` 8 px, `--space-3` 12 px, `--space-4` 16 px, `--space-5` 24 px, `--space-6` 32 px. Radius: 6 px for controls, 8 px for panels and dialogs. Borders: 1 px in `--color-boundary` for controls, 1 px in a lighter divider for list rows.

### Color roles

Contrast is the WCAG 2.2 ratio, computed from the sRGB relative luminance of each pair. Text pairs need 4.5:1 and boundaries 3:1 (SC 1.4.3, 1.4.11).

| Role | Light | Dark | Contrast, light / dark |
|---|---|---|---|
| `--color-canvas` | #f8fafc | #111827 | |
| `--color-surface` | #ffffff | #1f2937 | |
| `--color-text` | #172033 | #f8fafc | 16.27 / 14.03 on surface; 15.55 / 16.96 on canvas |
| `--color-text-secondary` | #475569 | #cbd5e1 | 7.58 / 9.89 on surface; 7.24 / 11.95 on canvas |
| `--color-action` (links, focus ring, primary buttons) | #1d4ed8 | #93c5fd | 6.70 / 8.14 on surface |
| `--color-on-action` (text on filled action) | #ffffff | #111827 | 6.70 / 9.84 on action |
| `--color-boundary` (control borders) | #64748b | #94a3b8 | 4.76 / 5.72 on surface; 4.55 / 6.92 on canvas |
| `--color-selected-bg` | #dbeafe | #1e3a8a | text 13.33 / 9.90; secondary 6.21 / 6.98; action 5.49 / 5.74 |
| `--color-marked` | #92400e | #fbbf24 | 7.09 / 8.79 on surface |
| `--color-marked-bg` | #fef3c7 | #451a03 | marked 6.37 / 8.97; text 14.61 / 14.31 |
| `--color-outcome` | #166534 | #86efac | 7.13 / 10.45 on surface |
| `--color-outcome-bg` | #dcfce7 | #052e16 | outcome 6.49 / 10.62 |
| `--color-error` | #b91c1c | #fca5a5 | 6.47 / 7.73 on surface |
| `--color-error-bg` | #fee2e2 | #450a0a | error 5.30 / 8.51 |
| `--color-suggestion` (suggestion badges) | #5b21b6 | #c4b5fd | 8.98 / 7.95 on surface; 7.36 / 5.61 on selected |
| `--color-evidence-bg` (highlighted evidence) | #e0e7ff | #312e81 | text 13.20 / 10.92 |

Color never carries meaning alone. Every state has a text label and its own icon: a bookmark for "Marked for deletion", a check for "Deleted by you", a pause symbol for "Later", an empty circle for "Undecided". In dark mode, a filled action button uses dark text (`--color-on-action`), never white.

### Dark mode and forced colors

Dark mode follows `prefers-color-scheme` by default. Settings has **Appearance: System / Light / Dark**, stored in `localStorage` and applied as `data-theme` on `<html>` before first paint. Under `forced-colors: active`, the app drops background fills for state and relies on borders, outlines, icons and text; the focus ring uses `Highlight`, borders use `CanvasText`.

### Motion

Only opacity and color transitions of 100 to 160 ms, for state changes the person caused. No sliding rows, no animated progress that suggests more than is known, no smooth scrolling. Under `prefers-reduced-motion: reduce`, every transition and animation is off.

### Icons

Lucide icons, 20 px, stroke width 2, imported by name. Decorative icons have `aria-hidden="true"`. Consequential actions (mark, keep, later, record outcome, restore) always show a text label next to the icon.

### Focus

A 3 px `--color-action` outline with 2 px offset on every focusable element. In the review list, the focused row also gets a 4 px bar on its leading edge, so focus and selection never look the same. Sticky bars never cover the focused element (SC 2.4.11).

## Layout and density

**Desktop, 1,024 px and wider:** three zones. Left, 240 px: account switcher, status tabs with counts, filters and saved filter templates. Center: the review list. Right, 420 px: the detail region with full text, suggestions, decision buttons and history for the focused entry. A toolbar above the list holds search, sort, selection count, bulk actions, **Keyboard** and **History**.

**720 to 1,023 px:** filters move into a drawer opened from the toolbar; list and detail stay side by side.

**Below 720 px:** one column, described under [Mobile](#mobile).

**Density:** Settings offers **Comfortable** (default; rows show three lines of text, 16 px) and **Compact** (two lines, tighter padding). Compact never shrinks post text below 16 px or a target below 24 by 24 px.

**Rows** show, in this order: date in the workspace time zone, kind ("Reply", "Repost"), the text preview, a media marker when the post had images or videos, the strongest suggestion as category and risk word, and the decision state. Unknown likes show "Likes: unknown", never 0. Engagement figures carry "as of your export from <date>" in the detail region.

## Review interaction model

### Four states, kept apart

| State | What it means | Changes when | Looks like |
|---|---|---|---|
| Focus | the row the keyboard is on | arrow keys, click | outline and leading bar |
| Selection | rows chosen for a bulk action | Space, Shift+arrows, checkbox | `--color-selected-bg`, checked box, count in toolbar |
| Decision | Undecided, Keep, Later, Marked for deletion | the person presses a decision button or key | badge with icon and text |
| Outcome | Unknown, Deleted by you, Skipped | the person records it in the click list | green check badge, only in the click list and summary |

Focus never changes a decision. Selecting all rows never applies anything. A suggestion never changes a decision. "Marked for deletion" is a plan; "Deleted by you" is a record of what the person says they did on the platform. The two have separate counts, tabs and wording, and the app never merges them.

### Keyboard map and how people find it

| Key | Action |
|---|---|
| ↑ ↓ | move focus |
| Home / End, Ctrl+Home / Ctrl+End | first / last entry (the list has one column, so Home and End act on rows) |
| Page Up / Page Down | one screen |
| Space | select or deselect the focused entry |
| Shift+↑ / Shift+↓ | extend the selection |
| Enter | open the focused entry in the detail region |
| Escape | back from the detail region to the list; close a dialog |
| M | mark for deletion |
| K | keep |
| L | later |
| U | back to undecided |
| Ctrl+Z / Cmd+Z | undo |
| Ctrl+Y / Cmd+Shift+Z | redo |
| ? | keyboard help |

M, K, L and U act on the selection when one exists, otherwise on the focused entry. Single-letter keys work only while the list has focus and never in a text field. Settings has **Single-key shortcuts: On / Off** (WCAG 2.2 SC 2.1.4).

People find the keys in four places: each decision button shows its key ("Keep K"); the **Keyboard** button in the toolbar opens the full table; `?` opens the same table; and the first time the review opens, one dismissible line under the toolbar says "Tip: ↑ ↓ to move, M to mark for deletion, ? for all keys." It does not come back once dismissed.

### Bulk actions with a frozen preview

1. The person filters or selects, then chooses **Mark all for deletion**, **Keep all** or **Later for all** from the toolbar.
2. A dialog shows the frozen preview: the account, the filter in words, how many entries change and from which state, how many stay unchanged and why, and the first 20 entries as a scrollable sample with their text.
3. Entries the person already chose to keep or mark are not overwritten by default. A checkbox offers it explicitly, with the count.
4. The confirm button names the exact number: **Mark 3,962 entries**. Cancel is always next to it.
5. If anything in the frozen set changed in the meantime (another tab, an agent's labels changing the order), confirm fails and the dialog shows a fresh preview with a line saying what changed.

**Mark suggested entries** is the same flow with a preset filter: the current account, entries whose strongest current suggestion has risk 2 or higher, undecided or Later. It appears only when suggestions exist. The preview names the sources of the suggestions it uses ("from Agent: agent", "Examples"), and after confirming, the person goes through the list and takes exceptions out with K or U.

Filter templates only fill the filter. They never mark anything:

| Template | English | German | Filter |
|---|---|---|---|
| job search | Before a job application | Vor einer Bewerbung | a current suggestion in Toxic, Personal attack, Political, Sexual, Drugs or illegal, or Embarrassing, risk 1 or higher |
| quiet old posts | Older than two years without engagement | Älter als zwei Jahre ohne Resonanz | created more than two years ago in the workspace time zone, likes and reposts known and both 0 |
| replies | Replies only | Nur Antworten | kind Reply |
| reposts | Reposts only | Nur Reposts | kind Repost |

### Undo notification and history

After every decision action a notification appears at the bottom of the list region: what changed, with an **Undo** button. It stays for at least 10 seconds, pauses while hovered or focused, never takes focus, and is announced through one polite live region. The **History** panel lists the last 50 actions with time, size and kind, newest first; the newest action not yet undone has an **Undo** button, and the newest undone one a **Redo** button. Undo works after a reload, because history comes from the stored event log. In the click list, undoing an outcome is labelled "Correct this record", because nothing on the platform is restored.

### Suggestions: reason, evidence, source

The detail region shows every current suggestion for the entry, strongest risk first. Each one shows:

- the source as a badge: **Agent: <name>**, **Example** in the demo, and later **Rules** or **Model: <name>**. Agent suggestions always carry their badge, in the row as well as in the detail region, so the person can tell which suggestions came from an agent that received their text;
- the category and the risk as a word (None, Low, Medium, High), never as a color alone;
- the reason, one sentence, as written by the source;
- the evidence: if the source quoted text that appears verbatim in the post, that passage is highlighted in the full text with `--color-evidence-bg`, built from React text nodes and `<mark>`. If the quote does not appear verbatim, nothing is highlighted and no quote is shown.

No confidence number is shown in Phase 2: agent confidence is self-reported and uncalibrated. A suggestion never says what will happen to the person; it describes the post. For replies, the detail says "Replying to @handle. SocialPrune does not have the post this replies to." For Instagram comments it says "The post this comment is on is not part of your export."

### Honest progress and time

- **Import** shows the stage and a count, with an indeterminate bar, because the importer does not know the total in advance: "Reading your export… 42,000 entries so far." When the import finishes, the count is final.
- **Review progress** shows decided entries out of all entries in the account, per tab.
- **Click list time:** SocialPrune has not measured how long deleting takes on X or Instagram, so it never states a duration as fact. Before the click list starts, it shows the count and a conditional estimate with an editable assumption: "If one entry takes you 10 seconds, 600 entries take about 1 hour 40 minutes." The seconds field can be changed. After 20 recorded outcomes the app uses the person's measured pace instead and says so: "At your pace so far, about 9 seconds per entry, the remaining 180 take about 27 minutes." The estimate can be hidden.
- **Export waiting time** comes from the platform's own statement, attributed to the platform ([ADR-022](../architecture/adrs/ADR-022-export-guide-content.md)).

## Screens and states

Every screen has a single `<h1>`, a document title, and moves focus to the heading on navigation. Routes are in [ADR-009](../architecture/adrs/ADR-009-navigation.md).

### Start (`#/`)

Heading, one-sentence description, the privacy line, three actions: **Get your export**, **Open export**, **Try the demo**. Returning visitors with a workspace see **Continue your review** first, with the account, counts and the date of the last backup. While the service worker is not yet ready, **Open export** shows "Getting ready…" and is disabled; guide and demo work.

### Export guide (`#/guide`, `#/guide/x`, `#/guide/instagram`)

Platform choice, then numbered steps, each with one action and the platform's own button names. The options to pick (JSON, whole time range, lowest media quality) are their own step. The waiting time is attributed to the platform. "Checked on <date>" and the report link sit at the end. **Add a reminder to your calendar** downloads an `.ics` file for a date the person picks. Desktop and mobile paths are shown as tabs when they differ.

### Demo (`#/demo`)

The same review screens with the demo banner on every screen, the **Example** source badge on every suggestion, and **Reset demo** in the banner. The demo opens on the X account; the account switcher offers the Instagram one.

### Import (`#/import`)

- **Empty:** file picker for one ZIP, several ZIP parts, or a folder; on desktop also a drop zone. Hint: "You can choose several files if your export came in parts." Next to the drop zone, in large text, the privacy line and an invitation to check it: turn off Wi-Fi, and SocialPrune keeps working.
- **Reading:** stage, count, **Cancel**.
- **Done:** per account: entries found, by kind; diagnostics as a collapsible list ("tweets.js: 12,400 entries", "like.js: skipped, not needed"); **Start review**.
- **Partial:** the count imported, the files skipped with their reason, and **Start review** still offered.
- **Unknown format**, **HTML export**, **nothing found**, **archive too large**, **not enough storage**, **cancelled**: each its own message (see the copy table), each with the next step.
- **Unsupported compression** (deflate64) and **encrypted archive**: SocialPrune does not read these in the browser ([ADR-004](../architecture/adrs/ADR-004-content-security-policy.md)). Each has its own message naming the file inside the archive, with the ways on: for deflate64, extract the ZIP with the computer's own tool and open the folder, or use the command line version; for an encrypted archive, extract it with the tool that set the password and open the folder.
- **Gate not passed** and **framed:** explanation and the alternatives; the demo link stays.

### Account choice

Shown when an import contains more than one account. One card per account with platform, handle and count. Accounts are never mixed in one list.

### Review (`#/review`)

- **No suggestions:** the list sorts by date, newest first, and an empty-state line in the detail region explains that suggestions are optional and how an agent can add them.
- **With suggestions:** default sort strongest risk first, then newest.
- **Filters active:** a line above the list names them in words, with **Clear filters**.
- **Search:** literal text match, case-insensitive. "Searching…" appears after 150 ms; results replace the list.
- **No results**, **all decided**, **storage error** (with a backup button), **another tab changed this** (rows refresh, a polite announcement), **saved / saving / not saved** state in the toolbar.
- **Media-only entries** show "Media only" as their text; the detail explains that SocialPrune does not show media and offers the link to the post on X.

### Click list X (`#/clicklist/x`)

**Create click list** first shows the count of entries marked for deletion, a preview, and the time estimate described above. The list then starts at the highest risk.

Each entry shows its date, text, the action to take on X ("Delete post" or "Undo repost"), **Open on X** (new tab, `rel="noopener noreferrer"`), and **I did it** / **Skip**. Keys, active only while the list has focus and covered by the same on/off setting: Enter opens the focused entry on X, D records "Deleted by you", S records "Skipped"; both move focus to the next entry. A line at the top says SocialPrune cannot see X, cannot tell whether the tab was closed, and only records what the person says. Progress: deleted by you, skipped, left. **Export list** saves CSV or JSON.

### Click list Instagram (`#/clicklist/instagram`)

Entries grouped by day, with the time zone named above the list and **Change** next to it. The zone is the one chosen in Settings or with **Change**, which stores it in the workspace; until the person picks one, it is the browser's zone, and the line says so ("Days in Europe/Berlin, your browser's time zone"). The CLI's click-list export uses `--time-zone` when given, then the zone stored in the workspace, then the system zone, and names the one it used. Each day shows the steps to find that day's comments with Instagram's own date filter, from the verified guide data, then the comments with text and the post owner. **I did it** / **Skip** per comment.

### Backup and restore (`#/backup`)

Last backup date, workspace size, **Download backup**; **Restore from backup** with the replace confirmation, a progress view while the file is checked, and the result. A restore never starts before the file passed every check; a failed check changes nothing.

### Settings (`#/settings`)

Language, appearance, density, single-key shortcuts, time zone (stored in the workspace; "Use my browser's time zone" clears it), storage (usage, quota, persisted state, **Keep data when storage runs low**), **Delete this review from this browser** (with the backup offer first), and the version and build ID.

### Privacy (`#/privacy`)

What the app reads, where it keeps it, what it never sends, what the CLI and agent path change, and the limits: GitHub Pages logs the IP address of every visitor who loads the app, browser storage can be cleared, another site published under the same `socialprune.github.io` origin would share storage, and software running as the same user is outside what SocialPrune can control. The page does not claim that there is no network traffic; it says which traffic exists (loading the app from GitHub Pages) and which does not (anything containing export data).

### Update available

A bar under the header: "A new version of SocialPrune is ready." with **Reload now** and **Later**. Never shown as a modal and never applied without the click.

### Development policy banner

In `pnpm dev` only, the footer says "Development policy". It never appears in a build.

### Local review (served by `socialprune review`)

The same app, served from the person's computer by the CLI ([ADR-016](../architecture/adrs/ADR-016-local-review-server.md)). A strip under the header says where the data is: "Local review. Your workspace is on this computer, and SocialPrune's own program on this computer serves this page." The routes are reduced ([ADR-009](../architecture/adrs/ADR-009-navigation.md)):

- **Start** shows the workspace summary (accounts, counts, last backup) and **Start review**, with the local-review privacy line instead of the web one.
- **Review**, both **click lists**, **Settings** and **Privacy** work as in the web app. Settings has no storage section and no "Delete this review from this browser", because nothing is stored in the browser.
- **Guide**, **Demo**, **Import** and **Backup** each show one short page naming the CLI command that does the job, for example "Import another export with `socialprune import <export> --workspace <folder>`."
- **Session ended**: when the CLI stops or the session token was already used, the page says "This review session has ended. Run `socialprune review` again to continue." Decisions saved before that are kept.

The Privacy page in this mode says that the page talks only to the program on this computer, at `127.0.0.1`, and that nothing goes to GitHub Pages or anywhere else.

## Mobile

- One column. The list is the main view; opening an entry shows the detail view with a visible **Back to list** button and the decision buttons. Back returns focus to the same row.
- A sticky bar at the bottom shows the selection count and the bulk actions when a selection exists. The list adds bottom padding of the bar's height so the last row and the focused row are never covered.
- Buttons are at least 44 by 44 px; rows are at least 48 px tall.
- File import uses the native picker; the hint about several parts stays. Drag and drop is not offered.
- No action depends on swipe, hover or a keyboard. Every key action has a visible button.
- For exports over about 100,000 entries, the import screen recommends a computer and still lets the person continue.
- Text reflows at 320 px width without horizontal scrolling (SC 1.4.10).

## Accessibility requirements

The target is WCAG 2.2 AA. Acceptance checks per [ADR-008](../architecture/adrs/ADR-008-review-ui-primitives.md):

- **Structure:** one `<h1>` per view, landmarks (`header`, `nav`, `main`, `aside` for the detail region), `<html lang>` follows the UI language, post text gets `dir="auto"`.
- **Review list:** a one-column `role="grid"` with `aria-rowcount`, `aria-multiselectable` and `aria-activedescendant`, which points at the `gridcell` of the focused row; rows carry `aria-rowindex` and `aria-selected` ([ADR-008](../architecture/adrs/ADR-008-review-ui-primitives.md)). Home and End move to the first and last row. The APG grid pattern moves them within a row, which in one column would do nothing, so they behave as in an ordinary list, and the keyboard help says so. The **Paged list** view offers the same entries as a native list, 100 per page.
- **Announcements:** one polite live region. It announces result counts after filtering, completed actions, undo, and import stages at most every 5 seconds or at each 10,000 entries. Errors that block a task use an assertive alert.
- **Keyboard:** everything reachable and operable; no keyboard trap; dialogs trap focus while open and return it on close; single-key shortcuts scoped and switchable (SC 2.1.4).
- **Visual:** contrast per the color table; focus visible and not obscured (SC 2.4.7, 2.4.11); targets at least 24 by 24 px (SC 2.5.8); reflow at 320 px and 200 percent zoom; forced colors; reduced motion.
- **Language:** every string comes from the catalogs, including ARIA labels, live announcements, empty states and errors.
- **Manual release gate:** NVDA with Firefox and VoiceOver with Safari on the review list, bulk preview, undo and click lists.

## Content rules

### Voice

Address the person directly: "you" in English, "du" in German. Short sentences, active verbs, one idea per sentence. Name what the app did and what the person can do next. No exclamation marks, no jokes about the person's posts, no scolding.

### Words we use

| Concept | English | German |
|---|---|---|
| a post, reply, repost or comment | entry | Eintrag |
| the platform's data file | data export, export | Datenexport, Export |
| reading it into the app | open, read | öffnen, einlesen |
| the review session | review | Durchsicht |
| decision: delete planned | Marked for deletion | Zum Löschen vorgemerkt |
| action that sets it | Mark for deletion | Zum Löschen vormerken |
| decision: keep | Keep | Behalten |
| decision: later | Later | Später |
| no decision | Undecided | Offen |
| outcome recorded by the person | Deleted by you | Von dir gelöscht |
| outcome: skipped | Skipped | Übersprungen |
| machine or agent hint | suggestion | Vorschlag |
| its one-sentence reason | reason | Begründung |
| quoted passage | matching text | Textstelle |
| the list for the platform | click list | Klickliste |
| file of the whole review | backup | Backup |
| risk levels | None, Low, Medium, High | Keins, Gering, Mittel, Hoch |

Category names: Toxic / Toxisch, Personal attack / Persönlicher Angriff, Political / Politisch, Sexual / Sexuell, Drugs or illegal / Drogen oder Illegales, Personal information / Persönliche Daten, Embarrassing / Peinlich, No content / Ohne Inhalt, Harmless / Harmlos, Unclear / Unklar.

### Forbidden words

Some words never appear in the app, the CLI, the guide (including the calendar reminder), the Agent Skill or the public docs. The single authority for the full list, its inflections, its allowlist and the files it covers is `tools/copy-check/words.ts`, described in [ADR-011](../architecture/adrs/ADR-011-internationalization.md); `pnpm copy:check` enforces it. This section does not repeat the list. It gives examples, and the check exempts it because it quotes them.

- English, for example: safe, guaranteed, bypass, undetectable, deletes everything, upload.
- German, for example: sicher, Sicherheit, garantiert, umgehen, löscht alles, hochladen.
- Backup words such as "sichern" and "Sicherung" stay allowed; the copy still says "Backup".
- "Official" and "offiziell" describe only the platform's own export, in the phrases `words.ts` allows.

So German copy never uses "Bist du sicher?"; confirmations name the action instead. The app's own buttons never say "Delete": SocialPrune marks, the person deletes on the platform. "Delete post" appears only as an instruction for what to do on X.

### Copy examples

| Situation | English | German |
|---|---|---|
| start, description | Go through your old X posts and Instagram comments, decide what should go, and get a list to delete it on the platform yourself. | Geh deine alten X-Beiträge und Instagram-Kommentare durch, entscheide, was weg soll, und bekomme eine Liste, mit der du es selbst auf der Plattform löschst. |
| start, privacy line (web app) | SocialPrune reads your export in this browser. It has no server that could receive it. | SocialPrune liest deinen Export in diesem Browser. Es gibt keinen Server, der ihn empfangen könnte. |
| start, privacy line (local review) | Your workspace stays on this computer. This page talks only to SocialPrune's own program on this computer, which you started with socialprune review. | Dein Arbeitsbereich bleibt auf diesem Computer. Diese Seite spricht nur mit dem SocialPrune-Programm auf diesem Computer, das du mit socialprune review gestartet hast. |
| local review, session ended | This review session has ended. Run socialprune review again to continue. Your saved decisions are kept. | Diese Sitzung ist beendet. Starte socialprune review noch einmal, um weiterzumachen. Deine gespeicherten Entscheidungen bleiben erhalten. |
| start, actions | Get your export · Open export · Try the demo | Export anfordern · Export öffnen · Demo ausprobieren |
| guide, waiting | X says this can take several days. | X gibt an, dass das mehrere Tage dauern kann. |
| guide, footer | Checked on 6 October 2026. If the steps look different, X has changed its pages. Please tell us. | Geprüft am 6. Oktober 2026. Wenn die Schritte anders aussehen, hat X seine Seiten geändert. Sag uns bitte Bescheid. |
| guide, reminder | Add a reminder to your calendar | Erinnerung in den Kalender eintragen |
| import, getting ready | Getting ready… | Wird vorbereitet … |
| import, reading | Reading your export… 42,000 entries so far. | Dein Export wird eingelesen … bisher 42.000 Einträge. |
| import, several files | You can choose several files if your export came in parts. | Du kannst mehrere Dateien wählen, wenn dein Export in Teilen kam. |
| import, check it yourself | Your export stays on this device. Want to check? Turn off your Wi-Fi now. SocialPrune keeps working. | Dein Export bleibt auf diesem Gerät. Willst du es prüfen? Schalte jetzt dein WLAN aus. SocialPrune funktioniert weiter. |
| review, apply suggestions | Mark suggested entries | Vorschläge übernehmen |
| click list, estimate | If one entry takes you 10 seconds, 600 entries take about 1 hour 40 minutes. | Wenn du für einen Eintrag 10 Sekunden brauchst, dauern 600 Einträge etwa 1 Stunde 40 Minuten. |
| import, unknown format | SocialPrune does not recognize this file. Choose the ZIP file or folder from your X or Instagram data export. | SocialPrune erkennt diese Datei nicht. Wähle die ZIP-Datei oder den Ordner aus deinem Datenexport von X oder Instagram. |
| import, HTML export | This is the HTML version of your Instagram export. SocialPrune needs the JSON version. Request a new export and choose JSON as the format. | Das ist die HTML-Version deines Instagram-Exports. SocialPrune braucht die JSON-Version. Fordere einen neuen Export an und wähle JSON als Format. |
| import, partial | Some files could not be read. SocialPrune imported 12,400 entries and skipped 2 files. Details are below. | Einige Dateien ließen sich nicht lesen. SocialPrune hat 12.400 Einträge übernommen und 2 Dateien übersprungen. Die Details stehen unten. |
| import, deflate64 | SocialPrune does not read tweets.js in the browser, because the ZIP file compresses it with Deflate64. Extract the ZIP with your computer's own tool and open the folder, or use the command line version. | SocialPrune liest tweets.js nicht im Browser, weil die ZIP-Datei diese Datei mit Deflate64 komprimiert. Entpacke die ZIP-Datei mit dem Programm deines Computers und öffne den Ordner, oder nutze die Kommandozeilen-Version. |
| import, encrypted | This ZIP file is protected with a password, and SocialPrune does not ask for passwords. Extract it with the tool that set the password and open the folder. | Diese ZIP-Datei ist mit einem Passwort geschützt, und SocialPrune fragt nicht nach Passwörtern. Entpacke sie mit dem Programm, das das Passwort gesetzt hat, und öffne den Ordner. |
| import, storage | Not enough storage for this export. Your browser has about 1.2 GB free for SocialPrune, and this export needs about 3.4 GB. Free up disk space or use the command line version. | Nicht genug Speicher für diesen Export. Dein Browser hat für SocialPrune etwa 1,2 GB frei, dieser Export braucht etwa 3,4 GB. Mach Speicherplatz frei oder nutze die Kommandozeilen-Version. |
| gate not passed | This window cannot open real exports. SocialPrune opens an export only when it can block network access for the code that reads it, and this window does not allow that. Some private windows do this. Open SocialPrune in a normal window, or use the command line version. The demo works here. | In diesem Fenster kann SocialPrune keine echten Exporte öffnen. SocialPrune öffnet einen Export nur, wenn es dem Code, der ihn liest, den Netzwerkzugriff sperren kann, und dieses Fenster lässt das nicht zu. Das passiert in manchen privaten Fenstern. Öffne SocialPrune in einem normalen Fenster oder nutze die Kommandozeilen-Version. Die Demo funktioniert hier. |
| framed | SocialPrune opens exports only when it is not embedded in another page. Open socialprune.github.io/socialprune directly. | SocialPrune öffnet Exporte nur, wenn es nicht in eine andere Seite eingebettet ist. Öffne socialprune.github.io/socialprune direkt. |
| demo banner | Demo with invented posts. The suggestions are examples written for this demo. No classifier produced them. | Demo mit erfundenen Beiträgen. Die Vorschläge sind Beispiele für diese Demo. Kein Klassifikator hat sie erzeugt. |
| review, no suggestions | No suggestions yet. You can review without them, or let an agent sort entries with the command line version. | Noch keine Vorschläge. Du kannst ohne sie durchgehen oder Einträge von einem Agenten mit der Kommandozeilen-Version einordnen lassen. |
| review, tip | Tip: ↑ ↓ to move, M to mark for deletion, ? for all keys. | Tipp: ↑ ↓ zum Bewegen, M zum Vormerken, ? für alle Tasten. |
| review, saved state | Saved · Saving… · Not saved. Your last change could not be stored. Download a backup now. | Gespeichert · Wird gespeichert … · Nicht gespeichert. Deine letzte Änderung ließ sich nicht speichern. Lade jetzt ein Backup herunter. |
| review, all decided | Every entry in this account has a decision. | Jeder Eintrag in diesem Konto hat eine Entscheidung. |
| review, media | This post has 2 images or videos. SocialPrune does not show them. Open the post on X to see them. | Dieser Beitrag hat 2 Bilder oder Videos. SocialPrune zeigt sie nicht an. Öffne den Beitrag auf X, um sie zu sehen. |
| bulk, title | Mark 4,000 entries for deletion? | 4.000 Einträge zum Löschen vormerken? |
| bulk, body | 3,812 undecided and 150 set to Later will be marked for deletion. 38 entries you chose to keep stay as they are. Nothing is deleted on X. You delete marked entries yourself with the click list. | 3.812 offene und 150 auf Später gesetzte Einträge werden zum Löschen vorgemerkt. 38 Einträge, die du behalten wolltest, bleiben, wie sie sind. Auf X wird nichts gelöscht. Vorgemerkte Einträge löschst du selbst mit der Klickliste. |
| bulk, overwrite option | Also mark the 38 entries I chose to keep | Auch die 38 Einträge vormerken, die ich behalten wollte |
| bulk, confirm | Mark 3,962 entries · Cancel | 3.962 Einträge vormerken · Abbrechen |
| bulk, stale | Some of these entries changed since the preview. Here is the new preview. | Einige dieser Einträge haben sich seit der Vorschau geändert. Hier ist die neue Vorschau. |
| undo notification | 3,962 entries marked for deletion. Undo | 3.962 Einträge zum Löschen vorgemerkt. Rückgängig |
| undo result, with skips | Undone. 12 entries changed since then and stay as they are. | Rückgängig gemacht. 12 Einträge hast du seitdem geändert, sie bleiben, wie sie sind. |
| suggestion header | Suggestion from Agent: agent · Personal information · High | Vorschlag von Agent: agent · Persönliche Daten · Hoch |
| reply context | Replying to @example. SocialPrune does not have the post this replies to. | Antwort an @example. SocialPrune hat den Beitrag nicht, auf den sie antwortet. |
| click list, notice | SocialPrune cannot see what happens on X. It only records what you tell it here. | SocialPrune sieht nicht, was auf X passiert. Es speichert nur, was du hier angibst. |
| click list, actions | Open on X · I did it · Skip | Auf X öffnen · Erledigt · Überspringen |
| click list, time | At your pace so far, about 9 seconds per entry, the remaining 180 take about 27 minutes. | Bei deinem bisherigen Tempo, etwa 9 Sekunden pro Eintrag, brauchen die restlichen 180 etwa 27 Minuten. |
| Instagram, zone (chosen) | Days in Europe/Berlin. Change | Tage in Europe/Berlin. Ändern |
| Instagram, zone (default) | Days in Europe/Berlin, your browser's time zone. Change | Tage in Europe/Berlin, der Zeitzone deines Browsers. Ändern |
| agent sharing, before the first batch (said by the agent, required by the skill) | Labelling your entries means I send their full text to the model provider I run on. Is that all right? | Zum Einordnen schicke ich den vollen Text deiner Einträge an den Modellanbieter, über den ich laufe. Ist das in Ordnung? |
| storage, granted | Your browser keeps SocialPrune's data when storage runs low. Clearing site data still removes it, so keep a backup. | Dein Browser behält die Daten von SocialPrune auch bei wenig Speicher. Wenn du Websitedaten löschst, sind sie trotzdem weg. Behalte deshalb ein Backup. |
| storage, denied | Your browser did not agree to keep the data. Download a backup after each session. | Dein Browser hat das abgelehnt. Lade nach jeder Sitzung ein Backup herunter. |
| restore, confirm | This replaces your current review (12,400 entries, 150 marked) with the backup from 2 October 2026 (12,400 entries, 162 marked). Download a backup of the current review first? | Das ersetzt deine aktuelle Durchsicht (12.400 Einträge, 150 vorgemerkt) durch das Backup vom 2. Oktober 2026 (12.400 Einträge, 162 vorgemerkt). Vorher ein Backup der aktuellen Durchsicht herunterladen? |
| restore, invalid | This file is not a SocialPrune backup, or it is damaged. Nothing was changed. | Diese Datei ist kein SocialPrune-Backup oder sie ist beschädigt. Es wurde nichts geändert. |
| restore, newer | This backup comes from a newer version of SocialPrune. Reload the page to update, then try again. | Dieses Backup stammt aus einer neueren Version von SocialPrune. Lade die Seite neu, um zu aktualisieren, und versuche es dann noch einmal. |
| update | A new version of SocialPrune is ready. Reload now · Later | Eine neue Version von SocialPrune ist bereit. Jetzt neu laden · Später |

Dates use the long local form ("6 October 2026", "6. Oktober 2026"), numbers use the locale's grouping ("4,000", "4.000"). Plurals go through ICU plural rules, never through string concatenation.

# ADR-031: A Windows desktop app around the review and the engine

- **Status:** Proposed
- **Date:** 2026-10-16
- **Hard constraints touched:** 1 (no certificate, no store fee, no paid signing service), 2 (the window reaches no network, and the workspace stays in a local folder that no sync service moves), 3 (decisions are still written only by the person in the review), 4 (signed-in runs stay in the person's installed Edge or Chrome, visible, with no change to how the browser presents itself; the person's click is the order), 5 (the SmartScreen and run warnings promise nothing), 6 (every test uses generated data and the fake platforms)
- **Supersedes in part, on acceptance:** [ADR-002](ADR-002-dependency-licenses.md), [ADR-004](ADR-004-content-security-policy.md), [ADR-016](ADR-016-local-review-server.md), [ADR-017](ADR-017-shared-workspace-service.md), [ADR-018](ADR-018-cli-distribution.md). It also changes the proposed record [ADR-023](ADR-023-acting-in-own-account.md). Section 10 gives the new wording.
- **Related:** [ADR-008](ADR-008-review-ui-primitives.md), [ADR-011](ADR-011-internationalization.md), [ADR-013](ADR-013-cli-framework-output.md), [ADR-015](ADR-015-cli-storage-node-baseline.md), [ADR-019](ADR-019-pages-deployment.md), [ADR-027](ADR-027-x-deletion-browser.md), [ADR-028](ADR-028-instagram-signed-in-session.md), [ADR-029](ADR-029-signed-in-originals-pass.md), [ADR-030](ADR-030-instagram-context-record.md)
- **Evidence:** the research report of 2026-10-16 in the maintainer's separate research repository, `deep-research/topics/should-2026-open-free-256-source/reports/chatgpt-report.md`, checked against its sources in the section "Evidence"

## Context

SocialPrune runs today as a web app for GitHub Pages and as a CLI. The signed-in runs of ADR-027 to ADR-030 exist only in the CLI. A person types a command into a terminal, reads the warning there, and confirms each canary on a loopback page inside the browser the run drives.

On 2026-10-16 the maintainer asked for a Windows desktop app for people who never open a terminal. He wants it polished, fast and without bugs, with a better interface for the automated reading and deleting, and with a live view of what the automation does, so that it feels transparent and not like a virus. He built a comparable app for another project, and its experience is the reference here: a native window around a web interface, a first-run setup, a status and progress view, a history, settings, a per-user installer that needs no admin rights, and an unsigned download whose SmartScreen warning the README states, with a SHA-256 file next to it. No code comes from that app.

The website stays. People try the demo and review an export there without installing anything. A web page can never drive a browser, so signed-in runs stay out of it.

The parts this record builds on:

- The review UI in `apps/web` reaches its data through one port interface. In the browser a worker answers it; in the local review build (`dist-review/`), `src/local-review/http-port.ts` answers it over HTTP after a session exchange with the review server (ADR-016), and every request matches `HttpReviewRequestSchema` in `packages/core/src/workspace/protocol.ts`.
- The engine lives in `apps/cli/src`: the SQLite workspace on `node:sqlite` (ADR-015), the review server in `review/`, and the browser runners in `browser/`, which start the person's installed Chrome or Edge through `playwright-core` with a dedicated profile and a visible window.
- `browser/confirmation.ts` serves the loopback confirmation page. Its view carries a phase (`start`, `canary`, `match`, `ended`), the planned, marked and completed counts, the estimated active time, the warning and the profile warning, the planned rows and the result line, and its buttons are Start, Continue, Matches, Does not match and Stop.
- The browser journal records every attempt; a fill run's structure report records X's rate windows per GraphQL operation without contents, and every run that stops names its cause as a closed token in a `Stop detail` line. An Instagram run records response counts per host and path class and the names of rate-limit headers, without values.

Before this record, the parent orchestration gave the maintainer a direction: host the existing React UI in a native window, run the existing Node engine, keep X and Instagram in the person's installed Edge or Chrome in a visible window with a dedicated profile, show a live run monitor with the journal, the platform's rate windows and a big Stop, perhaps later a live picture of that window, and never sign in to a platform inside an embedded browser. The last point has a reason in hard constraint 4: when a platform refuses an embedded browser, the only remedy is to change how the browser presents itself, and the tool may never hide or spoof anything. This record checks that direction against the research report and the code and turns it into a build plan.

Nothing here is urgent for the CLI's own runs, which are still being measured on real accounts. It is decided now so that the build can start in parallel, and so that the one question nobody can answer from documentation, whether Microsoft's Store certification accepts an app that drives a person's own account, gets asked early.

## Decision Drivers

- **One review UI and one engine.** Every behaviour the web app and the CLI already prove should run in the app from the same code, and the CLI's commands and JSON output (ADR-013) must not change, because agents depend on them.
- **Hard constraint 4.** The run stays visible in the person's own browser, with no change to its user agent or automation marks, the warning comes before the first run, and the person's click starts it.
- **Hard constraint 2.** The window that shows export content has no network, and the workspace lives in a folder outside OneDrive's folder backup.
- **Hard constraint 1.** Free distribution routes only: no certificate purchase, no paid signing service, no store fee.
- **Licenses.** Every new package passes ADR-002, and a runtime downloaded at build time gets its own entry under rule 6.
- **Proof on Windows.** Tests drive the real app window, and a packaged-app smoke test runs the installer on a Windows runner, because a green suite on another platform proves nothing for this one (LL-2026-10-004).
- **Measured speed and size.** Budgets come from the first measured build, not from promises.

## Options

### Option A: Electron 44.8.0, pinned, with the engine in a utility process

The React review build runs in an Electron window; the engine runs in an Electron utility process, which is a Node child process the main process starts with `utilityProcess.fork`.

**Pros:**
- Electron 44.8.0, released on 2026-10-15, embeds Node 24.22.0 and Chromium 152.0.7977.167. The CLI's floor is Node 24.15.0, so `node:sqlite` and `playwright-core` run on the same major Node line as in CI, without a second runtime.
- One language and one toolchain. The renderer is the same Chromium engine the web app's tests already cover.
- Electron's fuses switch Node features off in the shipped executable. Its documentation notes that `child_process.fork` stops working once the `RunAsNode` fuse is off; a utility process does not depend on that fuse.
- Playwright can launch and drive an Electron app, so the UI tests target the real window.
- The `electron` package and its 11 dependencies carry MIT and other allowlisted licenses in registry metadata (read 2026-10-16).

**Cons:**
- Size. The win32-x64 runtime archive for 44.8.0 is 158,524,950 bytes (HTTP `Content-Length`, read 2026-10-16), and the installed app is larger than the archive. The person's own Edge or Chrome is a second Chromium on the disk.
- Electron supports only its newest major lines, so the app must follow Electron releases, and each update needs the full desktop suite.
- The app ships Chromium's and Node's third-party code with their notices. That is a downloaded artifact under ADR-002 rule 6 and needs its own entry.
- Playwright's Electron support is marked experimental, and its documentation says a launch times out when the `EnableNodeCliInspectArguments` fuse is off, which the shipped build wants off.
- The research report cites electron/electron issue 47671, a `node:sqlite` regression in Electron 37. Whether 44.8.0 runs the CLI's store has not been measured.

**Effort:** not measured
**Risk:** Medium. The size and the Electron update rhythm are known costs; `node:sqlite` and `playwright-core` inside a packaged utility process are the unknowns, and the foundation gate measures both before anything else is built.

### Option B: Tauri 2 with the Node engine as a sidecar

A Rust shell shows the React build in WebView2, which Windows 11 ships with Edge, and starts the engine as a separate Node executable.

**Pros:**
- The shell itself is small, because WebView2 is already on the machine.
- Tauri is licensed MIT or Apache-2.0 (not re-checked against the lockfile for this record), and the research report weighs it as the main alternative.

**Cons:**
- The audience has no Node, so the app must ship one as a sidecar executable, which takes back most of the size advantage and adds a second unsigned upstream binary.
- Every request travels renderer to Rust to Node and back, so the project gains a second language, a Rust toolchain in CI and a process boundary nobody on the project has built.
- The Evergreen WebView2 runtime updates itself, so the renderer engine changes under the app without a release, and no CI run describes the renderer a person actually has.

**Effort:** not measured
**Risk:** High. Two runtimes and two languages for a team of one maintainer and his agents.

### Option C: A Node single executable that opens the review in the default browser

`socialprune review` packed as a Node single executable application with an installer: the engine and the loopback server run in the background and the review opens as a tab in the person's default browser.

**Pros:**
- Node itself, so `node:sqlite` behaves exactly as in CI, and no Chromium is bundled.
- The smallest change from today's CLI.

**Cons:**
- There is no app window. The review sits in a browser tab next to the browser window the run drives, which is the confusion the maintainer wants gone, and a program without a window that opens browser tabs is what people associate with malware.
- The open loopback port and its one-use token stay, with the exposure ADR-016 lists.
- Installer, icon, single-instance handling and window placement are all hand-made.

**Effort:** not measured
**Risk:** Medium

### Option D: Electron with the platform pages inside the app window

The app signs in to X and Instagram in an embedded web view and runs every step there. The research report describes Cyd, a GPL-3.0 Electron app for X data that `AGENTS.md` lists as a source of ideas only, working this way.

**Pros:**
- One window, and the run is visible inside it without a screencast.
- The app controls the layout completely.

**Cons:**
- A platform that refuses embedded browsers can only be answered by changing how the browser presents itself, which hard constraint 4 forbids. The app would then have no honest way forward.
- The session would live in the app's cookie store instead of the dedicated browser profile the CLI already manages, so the two products would diverge, and the person's password would be typed into SocialPrune's own window.

**Effort:** not measured
**Risk:** High. Rejected.

### Transport inside Option A

Two ways connect the window to the engine. **A1** keeps the loopback review server in the engine and loads `http://127.0.0.1:<port>` with the one-use token, so the review UI needs no change, but every local process can reach the port and the token travels in a URL. **A2** serves the review build from a custom `app://socialprune` scheme with the same response headers, carries the same requests over Electron IPC through a narrow preload bridge, and has the engine call the handlers the HTTP server calls today. There is no socket, so there is no token to protect.

## Decision

We chose **Option A: Electron 44.8.0, pinned, with the engine in a utility process**, connected by **A2**, because it is the only option that reuses both the review UI and the Node engine unchanged, keeps the run in the person's own visible browser, and lets tests drive the real window. The foundation gate in section 9 measures its two unknowns first.

### 1. Electron and its version

- `electron` is pinned to exactly 44.8.0. A newer 44.x patch is taken only after the desktop suite passes on it; a new major line comes as its own dependency update with its own CI pass.
- The `electron` package fetches its runtime archive in an install script, and the workspace runs install scripts only for the packages in `onlyBuiltDependencies` (today `esbuild` and `simple-git-hooks`). The desktop build therefore fetches the archive itself with `@electron/get` and checks it against Electron's `SHASUMS256.txt`. An ordinary `pnpm install` keeps downloading nothing, and the 158 MB archive is fetched only by the desktop build and its tests.

### 2. Processes and what each may reach

| Process | Runs | May reach | May never reach |
|---|---|---|---|
| Main | window, `app://` scheme, IPC routing, single-instance lock, file dialogs, window placement | the engine through one `MessagePort`; `shell.openExternal` for the guide's own links, after the person's click | export content beyond passing messages; any network |
| Renderer | the `dist-desktop` build of `apps/web` | the preload bridge | Node, `require`, the file system, any network: `contextIsolation`, `sandbox` and `webSecurity` on, `nodeIntegration` and `webviewTag` off, navigation and new windows denied, every permission request denied |
| Preload | `contextBridge` exposes `window.socialprune` with `request(method, body)` and `onRunView(listener)` | `ipcRenderer` inside the preload only | anything else; `ipcRenderer` itself is never exposed |
| Engine | a bundled `engine.js` in a utility process | the workspace folder, the dedicated profiles, Chrome or Edge through `playwright-core`, and during a run the platform hosts ADR-027 to ADR-030 allow | the renderer directly |

The renderer keeps the review build's Content Security Policy with Trusted Types (ADR-004), sent by the scheme handler as a response header and repeated in a `meta` element, with `connect-src 'none'`, because the bridge is not a network request, and `img-src` and `media-src` limited to `app:` for stored originals and Instagram context files.

The shipped executable sets these fuses, and CI reads them back from the built file: `RunAsNode` off, `EnableNodeOptionsEnvironmentVariable` off, `EnableNodeCliInspectArguments` off, `EnableEmbeddedAsarIntegrityValidation` on, `OnlyLoadAppFromAsar` on, `GrantFileProtocolExtraPrivileges` off, `EnableCookieEncryption` on. The test build differs in one fuse, `EnableNodeCliInspectArguments` on, because Playwright needs it to launch Electron. The packaged smoke test in section 8 runs the shipped fuse set.

### 3. The bridge instead of the review server's HTTP API

- The method list is the request union of `HttpReviewRequestSchema`, plus run methods (plan, start, action, view), setup methods (browsers, profile setup, adopt and forget, import, backup export and restore, data folder) and nothing else. Main validates each request with the zod schema before it forwards it, and the engine validates it again.
- Main accepts a message only from the main frame of the app's one window whose URL has the origin `app://socialprune`. Anything else is dropped and counted in the local log.
- The engine answers through the same handler functions the HTTP server uses. `apps/cli/src/review/server.ts` is split into a dispatch part that knows no HTTP and the HTTP transport around it; the transport's wire behaviour stays as the review server tests pin it.
- Decisions are written by the review service as today and record `via: 'local-review'`, because the person decides in the same local review. No schema version changes.
- Stored originals and Instagram context images are served by the `app://` handler under `app://socialprune/originals/...` and `app://socialprune/context/...`, with the review server's record check and byte-range code.
- `socialprune review` keeps its server, its port and its token. Nothing in the CLI changes for people who use it.

### 4. The engine in its utility process

- `apps/cli` gains `src/engine/index.ts`, a facade over what already exists: opening a workspace, the review dispatch, import, backup, the guide data, browser setup, adopt and forget, and the run sessions of `delete x`, `originals fill x` and `context instagram`. The package exports it as `socialprune/engine` for the desktop build. The npm package keeps its contents, because the release bundle is still built from `src/index.ts`, and `pack:check` proves the file list.
- `browser/confirmation.ts` is split into a state machine that produces the view and the loopback page that renders it. The desktop app is a second renderer of the same view, so the phases, buttons, warnings and stop rules stay in one place. The loopback page's bytes stay as they are.
- `node:sqlite`: the store opens in the utility process. CI runs a gate on every desktop build under the pinned Electron: open a generated workspace, migrate a version 4 copy to version 5 with the copy first, run a summary and a review query. A failure blocks the release.
- `playwright-core` ships inside the app and starts only `channel: 'chrome'` or `channel: 'msedge'`. The app never runs `playwright install` and never downloads a browser. If `playwright-core` cannot read its own files from `app.asar`, it moves to `app.asar.unpacked`; the foundation gate decides which.
- The engine's test entry, which selects the fake hosts and Playwright's Chromium, is a separate bundle. An import-graph test proves that the production main cannot load it, in the same way ADR-029 pins its host constants.

### 5. The run experience

The person reviews, marks entries, and starts a run from the app. The app explains each step in its own window, and the platform runs in the person's browser beside it.

#### The monitor

| Shown | From | How |
|---|---|---|
| Phase | the confirmation view's phase, plus the runner's batch pause, rate wait and reload wait | one sentence, for example "Pause after 20 pages, 14 minutes left" or "Waiting for X's limit window to reset at 14:15" |
| Progress | planned and completed counts; today's pages against the day's cap, which X deletion and fill runs share and Instagram counts apart | numbers and one bar |
| Next step | the pace the engine sets for the run | a countdown |
| Current entry | the confirmation view's row: kind, date, first line, action | the person's own text, shown only on their own computer |
| Journal | the last ten attempts: time, action, outcome token | one line each, outcome as a catalog sentence |
| X rate windows | the fill report's windows per GraphQL operation: limit, remaining, reset time | a small table; the numbers describe the person's own session and carry no content |
| Instagram responses | counts per host and path class, 4xx and 5xx codes, names of rate-limit headers | counts and names, never values, as ADR-028 records them |
| End | the `Stop detail` token | one sentence in German or English, from the catalogs |
| Profile | ADR-023's list of what the run can change in the profile, before the run; the read-back after it | a list |

The monitor sends nothing anywhere. The app's local log holds the closed tokens and counts of the structure reports and never entry text.

#### Stop and Pause

- **Stop** is a large button that stays visible during every phase and works from the keyboard. It ends the run where the runner checks for a stop today. An attempt cut off in the middle is journaled as today, and ADR-027's rule that an ambiguous attempt blocks a resend still holds. Closing the window during a run asks whether to stop it, and quitting stops it; the app never leaves a run behind.
- **Pause** is new and acts only between steps. After the current step ends, the runner waits; the waiting time counts toward neither the pace nor the batch pause. **Resume** repeats the run's start checks (account, page language, extension list) before the next step. Pause never interrupts a step. It is a runner option the CLI does not expose.

#### Confirmation and canary

For a run started in the app, the app window takes over the loopback confirmation page: the same phases and the same buttons, Start, Continue, Matches, Does not match and Stop, from the shared state machine. The platform window shows only the platform. Written orders with `--order` stay a CLI feature for agents; in the app the person's click is the order, and every canary is watched.

#### The warning before the first signed-in run

The full warning appears before the first run on each platform, and a short form before every later run. The person ticks that they read it and then clicks Start. The English draft, with a German counterpart in the catalogs and both under `pnpm copy:check`:

> X and Instagram do not allow automated use of their websites. They can limit, lock or suspend your account for it, and SocialPrune cannot predict whether they will. SocialPrune does not hide that a program drives the browser. It works only in the browser window next to this one, only on entries you marked yourself, starts with one entry you watch, waits between steps and stops at the first error. In the dedicated profile it can change the following: (list from ADR-023). You can stop at any time.

#### Where the platform window sits

At Start the app moves to the left half of the work area of its display and starts the browser in the right half with Chromium's `--window-position` and `--window-size` switches. Those switches set where the window opens; they change nothing the browser reports about itself. The platform window is never minimized, hidden or kept on top, and the person can move both windows. On a display narrower than 1,280 logical pixels, a first value to be checked with real people, the browser opens at its own size and the monitor says where it is.

#### A live picture of the platform window

Chromium's DevTools protocol can stream the tab as images (`Page.startScreencast`), so the app could mirror the platform window. This record leaves it out. The real window is visible beside the app, and a mirror adds CPU and memory for frames full of other people's posts. Playwright already speaks that protocol to the browser, so a screencast would add no new automation surface, but it would show nothing the person cannot already see. It comes back only if people report that they run with the platform window covered.

### 6. Setup, data, and what the app never does

**First start.** Language, then the browser: the app finds Edge and Chrome in their standard install locations and preselects Edge, which every Windows 11 has. For each platform the person wants, the app runs the existing `browser setup`: it opens the ordinary browser without a driver on the dedicated profile, the person signs in by hand and closes the window, and the app continues when the profile lock is released. An Instagram profile that was signed in before setup knew Instagram is adopted as `browser setup --adopt` does. Then the export guide from the same guide data, whose links open the default browser on the person's click; then the export ZIP through a file dialog or by dropping it on the window; then the review.

**Data.** Everything lives in `%LOCALAPPDATA%\SocialPrune Data\`: `workspace\`, `profiles\x\`, `profiles\instagram\` and `logs\`. That folder is outside the program folder, so an uninstall of the direct build leaves it, and outside the folders OneDrive's folder backup moves (Desktop, Documents, Pictures), so export content does not leave the device by sync. Settings shows the folder, opens it in Explorer, exports a backup, and removes the data after a dialog that lists each folder and its size and asks the person to sign out of the platforms first.

**The Store build.** Windows redirects a packaged app's writes under AppData into the package's private folder and deletes that folder on uninstall. The import screen and Settings say so and point to the backup. Whether Chrome or Edge started by the packaged app writes its profile through that redirection is not documented anywhere we found; the first Store test build measures it. If the redirection breaks the profile, the package declares `desktop6:FileSystemWriteVirtualization` as disabled, which needs the restricted capability `unvirtualizedResources` and the Store's approval.

**Updates.** The Store build updates through the Store. The direct build has no background updater. Settings has "Check for updates", which asks GitHub's releases API once per click and links the release page with its SHA-256 values; a weekly automatic check exists but stays off until the person turns it on.

**Uninstall.** Through Windows Settings, Apps. The direct build removes the program folder and its Start menu entry and leaves the data folder, and the docs say how to remove it. The Store build removes both.

**What the app never does.** It never asks for admin rights. It installs no service, scheduled task, Run key or startup entry; a later schedule needs its own record and the person's switch. It sends no telemetry, analytics or crash reports, and Electron's `crashReporter` is never started. It listens on no port, leaves the person's everyday browser profile and default browser alone, and downloads no browser, extension or code at run time.

### 7. Distribution and trust at no cost

**Store first.** The maintainer opens an individual Partner Center account; Microsoft's page, updated on 2026-08-24, says the onboarding flow charges no registration fee. If a fee appears at signup, the step stops (hard constraint 1). The MSIX is built with `makeappx` from the Windows SDK on the GitHub runner and is not signed by us; after certification the Store re-signs it with a Microsoft certificate. Certification takes up to three business days. The first submission goes in early, with the full feature set, so the answer about account automation comes before the product depends on it. The certification notes say what the app does: it drives the person's own installed browser, visibly, in the person's own account, on the person's click, after the warning above, and no export content leaves the device. In the Store build the app must not download or run code, update itself, install other software, need admin rights or claim anything hard constraint 5 forbids. A privacy page on the website serves both the Store listing and SignPath's policy.

**Direct download.** Each GitHub release carries `SocialPrune-Setup-<version>.exe`, a per-user installer built with Squirrel.Windows through `electron-winstaller` that needs no admin rights, plus `SHA256SUMS.txt` and a GitHub artifact attestation for each file (`actions/attest-build-provenance`, checked with `gh attestation verify`). It starts unsigned. The download page and the app's About screen say what Windows shows and why, in both languages:

> Windows shows "Windows protected your PC" for programs that are new and not signed by a publisher it knows. The warning does not check what the program does. To confirm that this file is the one GitHub built from this repository, compare its SHA-256 value with `SHA256SUMS.txt` or run `gh attestation verify`. Then choose "More info" and "Run anyway".

The German text names "Der Computer wurde durch Windows geschützt", "Weitere Informationen" and "Trotzdem ausführen".

**SignPath Foundation later.** After the first public release has some history, the maintainer applies. SignPath's conditions, read on 2026-10-16: an OSI license without commercial dual licensing, which Apache-2.0 meets; no proprietary component; active maintenance; the project already released in the form to be signed; its function described on the download page; binaries built verifiably from source in CI; manual approval of every release; multi-factor sign-in for every team member on SignPath and GitHub; named authors, reviewers and approvers; and a "Code signing policy" section on the home page and the release pages with the sentence "Free code signing provided by SignPath.io, certificate by SignPath Foundation", the roles and a privacy statement. The certificate is issued to SignPath Foundation, so Windows names SignPath Foundation as the publisher. SignPath may decline without giving reasons. One point goes into the application as a question: SignPath signs only binaries built from the project's own source, and SocialPrune's executable is Electron's prebuilt binary with edited resources and flipped fuses. SignPath allows signed installers that contain unsigned upstream binaries, so the installer can be signed in any case.

**WinGet and Scoop.** Manifests point at the GitHub release file and its SHA-256 and go in after the first signed release, following each repository's written rules (`AGENTS.md`, "Outside submissions"). They add a way to install, not trust.

**Reproducible builds.** The inputs are pinned: the lockfile, the Electron archive checked against `SHASUMS256.txt`, and the runner image's SDK version, which the build records. Byte-for-byte reproducibility is claimed only after CI builds the same commit twice and the hashes match. Until then the docs say "built and attested by GitHub Actions".

**macOS and Linux.** No macOS app in this record. Without Apple's paid developer program, people have to open the app through System Settings after Gatekeeper blocks it, and the program's yearly fee is ruled out by hard constraint 1. People on a Mac use the website and the CLI. Linux is not part of this record either: nobody asked for it, and each Linux package format would need its own CI smoke test.

### 8. Quality bar and proof

"Not vibe-coded" means each claim below has a test that fails when the claim breaks, runs in CI on Windows, and uses generated data.

| Claim | Proof |
|---|---|
| The renderer has no Node and no network | Playwright drives the test build's window: `require` and `process` are undefined in the page; a listener on the session records every request, and the test fails on any URL outside `app://socialprune`. Positive controls: a planted request to a second origin and a planted inline script must both be caught. |
| Only the app's own frame can use the bridge | unit tests of the main-process router with forged senders and malformed bodies; in the test build, a second window's request gets no answer and is counted |
| The review behaves as in the web app and the CLI | the review scenarios run against the desktop window on the demo export; decisions travel by backup into the CLI and the browser and back |
| Runs behave as in the CLI | the monitor against the existing fake X and fake Instagram, on the ports the `SP_*_TEST_PORT` variables set, through the engine's test entry: Start, canary, Matches, a full run, a 429 that ends with its `Stop detail` sentence, Stop in every phase, Pause and Resume, and the window position switches passed to the browser |
| The CLI did not change | every existing suite, unchanged: unit tests, `pnpm test:e2e:all`, the review e2e, `test:delete`, `test:context`, and the package build, file-list check and packed smoke test |
| The shipped file is what we built | on `windows-latest`: build the release variant, read the fuses back from the executable, write `SHA256SUMS.txt`, install silently per user, start the app, find its window by title through Windows UI Automation, measure start time and working set, close, uninstall |
| The app changes nothing else on the system | the same smoke test lists services, scheduled tasks, Run keys, firewall rules and listening ports before install, while running and after uninstall; only the program folder and the Start menu entry may differ |
| `node:sqlite` works in the pinned Electron | the gate in section 4, on every desktop build |
| Speed and size | start time to the first interactive frame, working set with the demo workspace, and installer size are measured on the first packaged build; CI then fails at the measured value plus 20 percent. No number is set before that measurement. |
| Accessibility | the IBM engine checks of ADR-008 on setup, monitor and settings; every path works from the keyboard; the status line is a polite live region; Stop never needs a pointer |
| German and English | both catalogs under `pnpm i18n:check`, every new string under `pnpm copy:check`, screenshots in both languages from generated data |

### 9. Repository shape, CI and releases

| Path | Contents |
|---|---|
| `apps/desktop` (new, private package `@socialprune/desktop`) | `src/main/`, `src/preload/`, `src/engine-host/` (the utility process entry and the review handler), `build/` (Rolldown config, Electron fetch, packaging, fuses, MSIX manifest template, Squirrel), `e2e/`, `test/` |
| `apps/web` | `src/desktop/` with the bridge port, the desktop entry, setup, monitor and settings screens; `desktop.html`; a `desktop` build mode with output `dist-desktop/` and its check script |
| `apps/cli` | `src/engine/` facade; the review dispatch split out of `server.ts`; the confirmation state split out of `confirmation.ts`; the runner's pause and window options; the `./engine` export |
| `packages/core` | the run view schema next to the existing protocol schemas, shared by engine, bridge and renderer; no data model change |
| `.github/workflows/ci.yml` | a `desktop` job on `windows-latest` with the proofs of section 8 |
| `.github/workflows/release-desktop.yml` | started by hand only; builds the installer, the MSIX, `SHA256SUMS.txt` and the attestations; creates a draft GitHub release only when the repository variable `DESKTOP_RELEASE_ENABLED` is `true`; refuses to build while any guide fact is unchecked, like the other release workflows; a SignPath step runs only when `SIGNPATH_ENABLED` is `true`. The maintainer submits to the Store in Partner Center. |

Packaging uses `@electron/asar` 3.4.1 to build `app.asar`, `resedit` 2.0.3 to set the version information, the icon and the asar integrity resource, `@electron/fuses` 2.1.3, `electron-winstaller` 5.4.0 for the direct installer, and `makeappx` for the MSIX. `@electron/packager` 20.3.0 and `@electron/asar` 4.3.1 are not used, because they pull five BlueOak-1.0.0 packages (`glob` 13, `minimatch` 10, `minipass` 7, `path-scurry` 2, `lru-cache` 11), which ADR-002 admits only through an exception record. `electron-windows-msix` 2.0.4 is not used, because its dependency `xml-escape` 1.1.0 declares "MIT License" instead of an SPDX identifier and `makeappx` does the same job.

**Build order.** A foundation gate comes first and proves, on `windows-latest`, that the pinned Electron opens the `app://` page with its policy, that the bridge rejects a forged sender, that the utility process opens a generated workspace with `node:sqlite`, that `playwright-core` started from the packaged app opens and closes a browser window against a local page, that the fuses read back as section 2 lists them, and that `pnpm licenses:check` passes with the new packages. Only then come the engine seam in `apps/cli`, the desktop screens in `apps/web` and the app's own flows, and after them the release workflow and the user documentation.

### 10. Changes to other records

- **ADR-002.** Rule 6 gains an entry for the Electron runtime archive (win32-x64, 44.8.0): Electron is MIT; the archive carries Chromium's, Node's and other third-party notices, which ship in the app as `LICENSES.chromium.html` and are linked from the About screen. Which `ffmpeg` library ships is settled when the license files in the archive are read, before the first release; Electron publishes a separate `ffmpeg-v44.8.0-win32-x64.zip` of 779,744 bytes next to the main archive. The packaging packages listed in section 9 pass the allowlist on their registry metadata; `pnpm licenses:check` on the real lockfile is the proof.
- **ADR-004.** A third policy context, the desktop renderer: the review build's policy with `connect-src 'none'` and `app:` as the only image and media source.
- **ADR-016.** In the desktop app the bridge replaces the review server: no port, no token. The CLI's review server is unchanged.
- **ADR-017.** The rule that keeps decision writing in the review server allows exactly one more file, the desktop review handler in `apps/desktop/src/engine-host/`.
- **ADR-018.** The CLI package gains the internal `./engine` export used by the desktop build; the npm package's contents do not change.
- **ADR-023 (proposed).** A run started in the desktop app is confirmed in the app window. The warning, the canary, the journal and the stop rules do not change.
- On acceptance the architecture map gains `apps/desktop` in its package table and the desktop processes in its runtime topology.

**Decision made by:** maintainer
**Approved on:** pending

## Consequences

### Positive

- People without a terminal get the signed-in runs with the same rules the CLI enforces, and they see every step: the monitor beside the platform window, the warning before the first run, and a Stop that always works.
- The review UI, the engine and their tests stay single: one React build with a third port, one engine with a second transport.
- The app opens no port and holds no token, so the exposures ADR-016 lists do not exist in it.
- Store distribution brings Microsoft's signature and updates at no cost, and the direct download carries SHA-256 values and attestations from the first release.

### Negative

- The installer is large, and the person's computer holds a second Chromium.
- The project now follows Electron's release rhythm, with a desktop CI pass for each update.
- Two transports for the review and the confirmation mean the split in `apps/cli` has to keep both covered.
- Until SignPath signs the direct build, every person who downloads it meets the SmartScreen warning.

### Risks

- **The Store refuses an app that automates the person's own account.** Mitigation: the early submission with plain certification notes; if it is refused, the direct download stays the only route and the maintainer decides whether a Store build without signed-in runs is worth having.
- **`node:sqlite` or `playwright-core` misbehaves inside the packaged utility process.** Mitigation: the foundation gate measures both before other work starts, and the `node:sqlite` gate runs on every desktop build.
- **Chrome started from the MSIX writes its profile into the package's private folder.** Mitigation: the first Store test build measures it, and section 6 names the manifest switch.
- **SignPath declines, or will not sign the Electron executable.** Mitigation: sign the installer only, or stay with the disclosed unsigned build; neither costs money.
- **A platform treats the window position switches as a signal.** Mitigation: they are ordinary Chromium switches that change the window's place, not its identity; if a run shows any difference, the app stops passing them and the browser opens at its own place.

## Open questions for the maintainer

These touch hard constraint 1 or ask something of him personally. Everything else is decided above.

1. **Store account in his name.** An individual Partner Center account costs no fee today, but needs his identity check, and its publisher display name is public. Recommendation: open it and submit the first test build early.
2. **Unsigned direct download until SignPath.** The alternative is no direct download until a signature exists. Recommendation: publish it unsigned with the warning text, SHA-256 values and attestations of section 7.
3. **SignPath application after the first release.** It names SignPath Foundation as publisher, needs multi-factor sign-in, a manual approval of each release and a public code signing policy. Recommendation: apply once the first release has public history.

## Evidence

Read on 2026-10-16 unless noted. No request went to x.com or instagram.com, and no browser profile was used.

- Electron 44.8.0 release page (releases.electronjs.org): released 2026-10-15, Chromium 152.0.7977.167, Node 24.22.0, V8 15.2.124.43; among its fixes, `utilityProcess` dropping messages posted with `process.parentPort.postMessage()` right before the process exits.
- Electron's fuse and asar integrity documentation (electron/electron, `docs/tutorial/fuses.md` and `docs/tutorial/asar-integrity.md`) and the `utilityProcess` API page.
- Playwright's Electron class documentation: the launch needs `EnableNodeCliInspectArguments` on.
- Microsoft Learn, "Get started with Microsoft Store" (updated 2026-08-24): individual accounts, no registration fee in the onboarding flow, the Store re-signs MSIX packages after certification, MSI and EXE installers must be signed by the publisher, certification up to three business days. Microsoft Store Policies, version 7.20. The MSIX documentation on how packaged desktop apps run, and the `desktop6:FileSystemWriteVirtualization` element.
- SignPath Foundation, "Conditions for Open Source projects" (signpath.org/terms.html).
- npm registry metadata, walked from `electron` 44.8.0, `@electron/fuses` 2.1.3, `@electron/asar` 4.3.1 and 3.4.1, `@electron/packager` 20.3.0, `electron-windows-msix` 2.0.4, `electron-winstaller` 5.4.0 and `resedit` 2.0.3, compared with ADR-002's allowlist; the release archive sizes from GitHub's download URLs.
- The code at commit `e20f9fb`: `apps/web/src/local-review/`, `apps/cli/src/review/`, `apps/cli/src/browser/`, `packages/core/src/workspace/protocol.ts`, `packages/core/src/model/`, `pnpm-workspace.yaml`, `eslint.config.js`.

**The research report, and where it is weak.** Its headline holds where it was checked: the Electron and Node versions match the release page, the Store's fee and re-signing statements match Microsoft's page, and SignPath's publisher name, its "already released" condition and its right to decline match SignPath's terms. It is weak in five places. It does not check the packaging tools against ADR-002; the common path through `@electron/packager` pulls BlueOak-1.0.0 packages. It does not mention that Playwright cannot launch an Electron build whose `EnableNodeCliInspectArguments` fuse is off, which forces two build variants. It says nothing about how MSIX redirects AppData writes, which decides where a browser profile started by the packaged app ends up. It treats SignPath as signing the whole direct download without addressing SignPath's rule that only binaries built from the project's own source are signed. And its `node:sqlite` warning rests on an Electron 37 issue, with no evidence about line 44 in either direction; the gate in section 4 replaces that gap with a measurement. Its WinGet and Scoop section is not used for any claim here beyond "a way to install, not trust".

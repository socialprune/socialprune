# SocialPrune

SocialPrune helps people review old X posts and Instagram comments locally on their own computer, then choose what to keep or remove.

**Release 0.1 draft, not a released version.** The [demo destination](https://socialprune.github.io/socialprune/#/demo) is not deployed. When it is published, the demo will use generated data and require no account.

> GIF placeholder: import a generated X export, compare a suggestion with the full post, choose Keep, then preview the final marks. No real account, export or browser profile.

[![CI](https://github.com/socialprune/socialprune/actions/workflows/ci.yml/badge.svg)](https://github.com/socialprune/socialprune/actions/workflows/ci.yml) [![License](https://img.shields.io/github/license/socialprune/socialprune)](LICENSE) · [Downloads](https://github.com/socialprune/socialprune/releases)

The [Windows download page](https://github.com/socialprune/socialprune/releases) is the intended route without a terminal. There is no installer release there yet. The CLI is not published to npm either. Do not run `npx socialprune` yet: it could fetch an unrelated package with that name. After this project's npm release has been published and its identity checked, `npx socialprune --help` is the intended starting command.

## What it does today

Import the platform's official data export, read each entry, and record Keep, Later or Mark decisions. Suggestions can come from criteria and an optional model or agent. They never make deletion decisions. A final-mark preview shows the count before you confirm it.

| Platform | Read from export | Review and suggestions | Manual click list | Browser helpers |
|---|---|---|---|---|
| X | Posts, replies, quotes and reposts | Full-text cards, criteria, keep rules and human decisions | Links to individual entries | Fetch reply and quote originals; optionally fill missing context in a signed-in browser; delete human-marked entries |
| Instagram | Comments in JSON exports; not captions or chats | Comment cards and, when separately confirmed, their post context | Grouped by day; no invented post link | Read comment context in a signed-in browser; no automated comment deletion implemented |

The desktop app is Windows x64. The browser app and the CLI share the review model, but the platform-reading and X-deletion helpers belong to the CLI and desktop app, not the static browser app. The interface is available in English and German.

The parsers, review, backups and packaged desktop paths have tests using generated data. X deletion has been exercised against a generated fake X, not a real X deletion flow. Instagram context retries and confirmation checks have generated-page tests; those do not establish that every current Instagram page will work. A Kilo agent completed the CLI run on the generated demo export with only the skill and the packed CLI ([evidence](docs/evidence/G2.md)); no model endpoint's suggestion quality has been measured yet. The maintainer confirmed the 22 export guide facts on 2026-10-25, and the release checks ask for a new check 120 days later. The maintainer's complete own-export review is not accepted yet. Nothing is published or deployed.

> Screenshot placeholder: the six review tabs on a generated X account, with a rule holding one entry and a human Keep decision on another.
>
> Screenshot placeholder: a generated Instagram comment with its confirmed post image, the evidence explanation and Keep, Later and Mark controls.
>
> Screenshot placeholder: the Windows app beside a generated fake platform page, showing the run monitor and Stop control. Label the platform page as generated.

## Try the CLI from a checkout

Use Node.js 24.15.0 or newer and pnpm 10.33.0. Clone [this repository](https://github.com/socialprune/socialprune), then run these commands from its root. The example export below is generated data already in the repository.

```sh
pnpm install --frozen-lockfile
pnpm -s socialprune --help
pnpm -s socialprune guide x
pnpm -s socialprune import ./fixtures/synthetic/demo/x --workspace ../socialprune-demo --dry-run
pnpm -s socialprune import ./fixtures/synthetic/demo/x --workspace ../socialprune-demo
pnpm --filter @socialprune/web build:review
pnpm -s socialprune review --workspace ../socialprune-demo
```

`review` starts a local server and attempts to open your browser. You make decisions on that page. Close the server when you finish. For your own data, request the export yourself using `guide x` or `guide instagram`, keep Instagram's JSON version, and replace the example path with your export ZIP. Keep exports and workspaces outside the repository.

If a maintainer supplies an unpublished packed CLI tarball, install it into an empty folder together with the `playwright-core` tarball it depends on: `npm install --offline --no-audit --no-fund --prefix . ./playwright-core-<driver-version>.tgz ./socialprune-<version>.tgz`. Run `node node_modules/socialprune/bin/socialprune.mjs --help` there. Its review page is included, so it needs no build. A missing entry file is a reason to stop, not to fetch a package by name. See the [CLI command guide](AGENTS.md#commands) and [agent setup](docs/agent-setup.md).

Before trying platform helpers, export a backup:

```sh
pnpm -s socialprune backup export --workspace ../socialprune-demo --out ../socialprune-demo-backup.json
```

Keep the workspace on a local disk. Stop its writers before copying it. Portable JSON backups contain records, not the separately downloaded image and video files; retain those workspace media folders too when you need them.

## Build the Windows app

No public installer exists yet. From a checkout on Windows x64 with the Node and pnpm versions above:

```powershell
pnpm install --frozen-lockfile
pnpm build:desktop
```

The build downloads the pinned Electron archive and checks its digest. Run `apps\desktop\dist\release\SocialPrune.exe` yourself when the build finishes. Node is a build dependency, not something the packaged app asks its user to install. Creating the NSIS installer and unsigned MSIX uses `pnpm release:desktop`; the MSIX step also needs the Windows SDK's MakeAppx tool. Local builds are not a published release.

The setup asks for a language and Edge or Chrome, shows the dedicated-profile status and export guide, then lets you choose or drop an export ZIP. Dedicated profiles are for optional platform helpers; sign in yourself only if you intend to use those helpers. Importing an export does not authorize a platform run. Review the entries, inspect the final-mark preview and make your own decisions. Use Backup in Settings before any deletion run.

The direct installer is per-user and unsigned. Windows may show an unknown-publisher or reputation warning; the download notices explain what is and is not signed. An unsigned MSIX is not a Store release. See the [English download notice](apps/desktop/packaging/download-notice.en.md).

## Privacy and the Wi-Fi-off check

Export parsing, review, decisions and backups run on your device. After loading the browser app once, turn off Wi-Fi and try importing the generated demo and recording a decision. That checks the offline review path, not platform fetching, platform deletion or a remote model, which need a connection.

CI observes real browser requests during generated-data app flows and fails if one leaves the app origin. A positive control sends a request to another origin to prove that the observer catches it. The packaged Windows smoke test also rejects remote TCP connections or listeners from the app. These tests cover their recorded flows; they are not evidence about an untested browser extension or endpoint.

Choosing an agent shares the full text of the entries you give it with that agent's model provider. A model endpoint is optional and comes from a file you explicitly name; a remote endpoint receives the entries sent to it. SocialPrune does not read keys from environment variables or another tool's configuration. No model tier is a measured default yet.

Fetching originals and running platform helpers contacts the relevant platform. Source and post links open only after your click. Browser storage can be cleared, and the desktop workspace stays on disk after a normal uninstall. Keep backups where you control them. The repository contains generated test data only, never real exports.

## Before deleting anything

Not affiliated with, endorsed by, or sponsored by X Corp. or Meta.

Deletion is permanent. A model can be wrong, and rules can flag something you want to keep. Read the entries and decide yourself. Deleting a post does not remove screenshots, other people's archives or every copy elsewhere.

The platforms prohibit this kind of browser automation and may lock or suspend your account. Optional platform runs use a dedicated profile you sign in to yourself, begin with watched checks and stop on an error. They do not hide automation or solve platform challenges. X deletion operates only on entries carrying your own delete decision. Instagram deletion automation is not implemented. The click lists remain available when you prefer to act by hand.

## Contributing

Read [AGENTS.md](AGENTS.md) before changing code. A new platform belongs in a new adapter package; use the [platform-adapter checklist](docs/architecture/README.md#adding-a-platform). Add generated fixtures, parser expectations, export-guide sources and tests, then connect the adapter to the existing registry. Do not change core for a platform-specific export shape. Never attach a real export or workspace to an issue.

The planned repository topics are `privacy`, `local-first`, `twitter`, `instagram`, `data-export` and `ai`; listing them here does not set GitHub metadata. The CI and license badges read their services; a release badge waits until a release exists.

Licensed under Apache-2.0. See [LICENSE](LICENSE).

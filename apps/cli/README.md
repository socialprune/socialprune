# SocialPrune CLI

SocialPrune reads X and Instagram data exports on your computer. Agents can suggest labels; you choose what to remove in the review page. SocialPrune does not operate either platform. You make the final delete click there yourself.

The npm package is not published yet. There is no npm release to install. Use Node.js **24.15.0 or newer**.

From a local tarball you supplied, install with `npm install --offline --no-audit --no-fund ./socialprune-<version>.tgz`, then run `node node_modules/socialprune/bin/socialprune.mjs …` in that folder. The review page is included, with no build needed. If the entry file is missing, stop. Until a release exists, do not use npx, npm exec, a named registry install or a global install; they can fetch an unrelated package of the same name.

From a checkout of [the repository](https://github.com/socialprune/socialprune), use pnpm 10.33.0:

```sh
pnpm -s socialprune --help
pnpm -s socialprune guide x --json
pnpm -s socialprune structure ./export.zip --json
pnpm -s socialprune import ./export.zip --workspace ./workspace --dry-run --json
pnpm -s socialprune import ./export.zip --workspace ./workspace --json
pnpm -s socialprune summary --workspace ./workspace --json
pnpm --filter @socialprune/web build:review
pnpm -s socialprune review --workspace ./workspace
```

`structure` describes key paths and types without leaf values. Check its report before sharing it; unfamiliar formats can still expose names in keys or paths. The export guide carries source links and verification dates. Some guide facts have not been checked by a person, and the Instagram steps are incomplete.

Keep your workspace on a local disk, not a network share. Stop running commands and review sessions before a sync client copies it. Use `backup export` and `backup restore` for portable JSON backups:

```sh
pnpm -s socialprune backup export --workspace ./workspace --out ./backup.json --json
pnpm -s socialprune backup restore ./backup.json --workspace ./restored --dry-run --json
pnpm -s socialprune export clicklist --workspace ./workspace --account x:123 --format csv --out ./clicklist.csv --json
```

`--json` writes one result document to stdout. Notices and progress go to stderr. Commands that write files accept `--dry-run`. `review --dry-run` starts no server and opens no browser. Real review opens a one-use link in your browser; an agent capturing its output does not receive that token. Do not run `review --no-open` through an agent.

## Use with an agent

Read [docs/agent-setup.md](https://github.com/socialprune/socialprune/blob/main/docs/agent-setup.md) in the repository before setting up your agent. The package includes `skills/socialprune/SKILL.md`, its references and JSON schemas. Giving entries to an agent shares their full text with that agent's model provider. Confirm that sharing before running:

```sh
pnpm -s socialprune batch next --workspace ./workspace --share-with-agent --json
pnpm -s socialprune labels submit ./labels.json --workspace ./workspace --dry-run --json
```

Labels are suggestions, never deletion decisions. Only a person using the review page records those decisions.

## Diagnose a local package build

`pnpm --filter socialprune build:release` assembles an unpublished package in `apps/cli/dist/package/`. The installed bin runs JavaScript and needs no TypeScript loader. Workspaces require Node.js 24.15.0; older Node 24 can still run help, guide, structure and schemas. To map a stack trace back to the bundled sources, enable Node's source maps:

```sh
node --enable-source-maps apps/cli/dist/package/bin/socialprune.mjs --help --json
```

Review text and backups stay on your device. Do not attach a real export or workspace to an issue.

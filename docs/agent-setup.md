# Use SocialPrune through your agent

SocialPrune can give your own agent batches of posts or comments to label. The agent records suggestions, then opens review for you. You decide in the review page. You make the final clicks on X or Instagram yourself; SocialPrune and the agent do not act there.

## Install the skill

The npm package is not published yet. You can use a local packed tarball without a checkout, or run from this repository. Both need Node.js 24.15 or newer. Once a release exists and you have installed it, the skill can use the installed `socialprune` command.

Copy the whole `skills/socialprune/` folder, including `references/`, into the skill folder your agent host reads. You can take it from the repository or the extracted local package. Do not copy it into this repository's development skill folders. There is only one product-skill copy here; the packed package includes it too.

For a tarball, put the file in the agent's working folder and give it that exact filename. The agent installs only that file with `npm install --offline --no-audit --no-fund --prefix . ./socialprune-<version>.tgz`, replacing `<version>` with its version. Without `--prefix .`, npm installs into the nearest parent folder that has a `package.json` or `node_modules`, and that can change another project of yours. Every CLI command then starts with `node node_modules/socialprune/bin/socialprune.mjs`. The skill tells the agent to stop and ask you if that entry file is missing. Its review page comes with the package under `web/`, so this mode needs no build.

Until a release exists, the agent must not run `npx socialprune`, `npm exec socialprune`, `npm install socialprune` or any global install; those commands can fetch an unrelated package of the same name from the registry.

For repository mode, use pnpm 10.33.0 and install the checkout's dependencies with `pnpm install`. Run from the repository root and replace the skill's `socialprune` command with `pnpm -s socialprune`.

The locations below were observed on 2026-10-06 in ADR-014. Hosts can change them, so check your host's own documentation before choosing a destination.

| Host | Skill folders | Documentation |
|---|---|---|
| Claude Code | `.claude/skills/` | [Claude Code skills](https://code.claude.com/docs/en/skills.md) |
| Codex | `.agents/skills/` | [Codex skills](https://developers.openai.com/codex/skills) |
| Kilo | `.kilo/skills/` or its global skill folder | [Kilo skills](https://kilo.ai/docs/customize/skills) |
| GitHub Copilot | `.github/skills/`, `.claude/skills/` or `.agents/skills/` | [Adding skills](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills) |

## What you agree to share

Your export stays on your computer during import. Before the first `batch next`, the skill tells the agent to ask whether the full text of your entries may go to the agent's model provider. If you agree, the agent passes `--share-with-agent` on every batch. The CLI prints a notice to stderr with the real number of entries and the fields it shares. SocialPrune cannot see or limit what the provider does with the text.

A batch contains the entry ID, kind, date, a hash of the text and the full text marked as untrusted data. It omits parsed account and reference handles, account keys, engagement, archive names and file names. Names and handles written in the text remain in that text. Your export and workspace paths also appear in the commands your host runs.

Keep your host's command approval on. The flag records the agent's assertion that you agreed; it cannot verify your conversation, and a skill cannot force a host to follow it. You can decline sharing and review without agent suggestions. The agent must not read API keys or other tools' configuration, search for your exports, read private chats or act on platform pages.

## Review is your handoff

The agent previews import, submits only labels and shows `summary` counts. No CLI label command makes a decision. Suggestions appear in review with their agent source name. Label files reject human sources, decision fields and outcome fields. Submission IDs let the agent retry an unchanged file without recording it twice.

The agent first runs `review --dry-run` through the chosen command to check the workspace without starting a server or opening a browser. In tarball mode, real review uses `node node_modules/socialprune/bin/socialprune.mjs review --workspace "<dir>" --json`; no build is needed. From the repository, build the review files once with `pnpm --filter @socialprune/web build:review`, then run `pnpm -s socialprune review --workspace "<dir>" --json`. The CLI opens your browser. The readiness output gives a token-free loopback URL. The session token goes to the browser opener, not stdout. Keep the process running while you review, then stop it with Ctrl+C or the page's shutdown action.

The agent must never run `review --no-open`, obtain a token or call the review API. If your browser does not open, run `review` yourself in your own terminal. The token can appear in the browser's process arguments, and a failed opener can print a fallback token when stderr is a terminal. Software running as you may read those surfaces; the local server does not protect against that software.

Keep the workspace on a local disk. Avoid network shares, and pause any sync client copying the folder while a command or review runs. The agent must never repair or edit the SQLite file. Read the skill's [command contract](../skills/socialprune/references/commands.md), [label reference](../skills/socialprune/references/labels.md), [error table](../skills/socialprune/references/errors.md) and [privacy boundary](../skills/socialprune/references/privacy.md) for the exact flow.

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

Your export stays on your computer during import. Before the first `batch next`, the skill tells the agent to ask whether the full text of your entries and the criteria descriptions may go to the agent's model provider. If you agree, the agent passes `--share-with-agent` on every batch. The CLI prints a notice to stderr with the real number of entries and the fields it shares. SocialPrune cannot see or limit what the provider does with them.

A batch contains the entry ID, kind, date, a hash of the text and the full text marked as untrusted data. It also contains criterion labels, definitions and hashes, including descriptions of your selected own criteria. It omits parsed account and reference handles, account keys, engagement, originals, keep rules, archive names and file names. Names and handles written in the text remain in that text. Your export and workspace paths also appear in the commands your host runs.

Keep your host's command approval on. The flag records the agent's assertion that you agreed; it cannot verify your conversation, and a skill cannot force a host to follow it. You can decline sharing and review without agent suggestions. The agent must not read API keys or other tools' configuration, search for your exports, read private chats or act on platform pages.

## The criteria block the agent reads

Choose your own criteria and keep rules in review. The agent does not choose them for you. `batch next` returns every available content preset even when unticked, so ticking a preset later does not require another run. It adds only the own criteria you selected. The `criteria` array gives each `id`, `label`, `definition` and `hash`; the definition includes exclusions such as reporting or quoting a hostile statement to criticise it. Earlier restored categories stay available for their old results but are not sent for a new check. Keep rules never go to the agent.

The agent uses a version-2 label file with `criteria: [{ id, hash }]` copied from that block. It lists only what it actually checked. Each entry gets a separate suggestion for every applying criterion, each with its own risk and reason, or one exclusive `harmless` or `unclear` result. The submission records the agent source and checked hashes, never a decision. A run for one own criterion leaves other results standing. If you edit its description, the old checks stop counting; the agent must reread affected entries against the new definition, not replace a hash on old labels. Own criteria have not been measured on the S2 evaluation set.

Version-1 files remain readable but check only the eight legacy defaults other than `harmless` and `unclear`. They cannot claim checks for the four new presets or your own criteria. The current skill writes version 2. A dry-run validates the same contract without changing the workspace, and an unchanged submission retry keeps the same ID.

## Use an endpoint you named

The optional endpoint route uses your own source file, not the agent's model credentials. Name the endpoint, the model for this run and a new source-file path outside repositories. If the endpoint requires a key, put it in a separate file outside repositories containing one non-empty line. The agent must not open it. SocialPrune reads only the named file and never environment keys or another tool's configuration.

```text
socialprune scan source --out "<source.json>" --base-url "<base-url>" --model "<model>" --entries-per-request <1..50> [--key-file "<key-file>"] --json
socialprune scan check --source "<source.json>" --json
socialprune scan run --workspace "<workspace>" --source "<source.json>" --dry-run --json
socialprune scan run --workspace "<workspace>" --source "<source.json>" --plan "<hash>" --confirm-endpoint "<origin>" --confirm-model "<answering-model>" --limit 50 --json
```

No batch-size default has been measured for your model, so setup requires an explicit size. Check sends one invented entry with preset criteria; the dry run sends nothing. Before sending workspace entries, the agent shows the check's origin and answering model and waits for your agreement. The CLI says before every check and run how many entries leave, what they carry, the origin and the key-file path. A local endpoint may forward them to the internet, count them against your plan or cost money there. The endpoint's and platforms' terms apply; SocialPrune cannot inspect or limit that service.

A successful check records only the observed answering model, origin, rubric version, time and configuration hash in a separate block of your named source file, written atomically. It never writes the key. Make the dry-run plan after that check. A run refuses a missing check or a confirmation different from those recorded values before any request, with a hint to check again. Each re-check invalidates old plans. After matching those values, the run still probes the live model with invented text before it counts or sends workspace entries, so a model switch at the endpoint stops there too.

Choose criteria in review. The run sends their definitions with each entry's platform, kind and full text, but no originals, keep rules or engagement. It records model suggestions only. Look at the first 50 in review before asking the agent to remove the limit. An interrupted run resumes with the same plan and confirmations; written current checks are skipped. Output stays aggregate, with requests and tokens where the endpoint reports them.

## Review is your handoff

The agent previews import, submits only labels and shows `summary` counts. No CLI label command makes a decision. Suggestions appear in review with their agent source name. Label files reject human sources, decision fields and outcome fields. Submission IDs let the agent retry an unchanged file without recording it twice.

The skill requires the agent to read every entry it rates at risk 2 or 3 and quote a verbatim passage as evidence. It forbids producing those suggestions with keyword rules, scripts or bulk templates. If a submitted label at risk 2 or 3 has no quote, `labels submit` warns with a count; the file is still accepted. The skill tells the agent to reread those entries and add quotes or lower the risk when the text does not support the suggestion. That is a requirement on the agent, not a check of whether it actually read the text. You still judge the suggestions in review.

The agent first runs `review --dry-run` through the chosen command to check the workspace without starting a server or opening a browser. In tarball mode, real review uses `node node_modules/socialprune/bin/socialprune.mjs review --workspace "<dir>" --json`; no build is needed. From the repository, build the review files once with `pnpm --filter @socialprune/web build:review`, then run `pnpm -s socialprune review --workspace "<dir>" --json`. The CLI opens your browser. The readiness output gives a token-free loopback URL. The session token goes to the browser opener, not stdout. Keep the process running while you review, then stop it with Ctrl+C or the page's shutdown action.

The agent must never run `review --no-open`, obtain a token or call the review API. If your browser does not open, run `review` yourself in your own terminal. The token can appear in the browser's process arguments, and a failed opener can print a fallback token when stderr is a terminal. Software running as you may read those surfaces; the local server does not protect against that software.

Keep the workspace on a local disk. Avoid network shares, and pause any sync client copying the folder while a command or review runs. The agent must never repair or edit the SQLite file. Read the skill's [command contract](../skills/socialprune/references/commands.md), [label reference](../skills/socialprune/references/labels.md), [error table](../skills/socialprune/references/errors.md) and [privacy boundary](../skills/socialprune/references/privacy.md) for the exact flow.

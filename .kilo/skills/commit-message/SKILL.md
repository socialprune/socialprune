---
name: commit-message
description: Use when preparing a commit message for verified repo changes. Infers the repository's documented commit convention, then applies the correct type, scope, title, and concise body. Triggers on 'commit message', 'write commit', 'prepare commit', 'git commit'.
version: 1.2.0
author: Workflow Lab
created: 2026-04-19
updated: 2026-08-10
---

# Commit Message

## Use when
- Preparing a commit title and body for completed changes.
- Summarizing multi-file changes into one coherent GitHub commit.
- Converting file diffs into the target repo's documented commit format.

## Do not use when
- No changes are ready to summarize.
- The task is PR writing rather than commit writing.
- The user asked for raw git execution instead of message drafting.

PR contribution form belongs to `workflow-routing`; hosted PR publication and identity belong to `quality-gate-verification`. This skill remains commit-only.

## Behavior change
When loaded, the agent stops vague summarization and instead:
1. analyzes the changes,
2. picks the correct type and scope,
3. writes a concise title,
4. writes a short body focused on why.

## Typical pairings
- `feature-implementation` after verified work is complete.
- `quality-gate-verification` before final commit drafting.

## Outputs
- One commit title.
- One short commit body.
- Optional alternates if two types are plausible.

## Procedure

### 1. Read the change shape
- Identify the dominant purpose: feature, fix, docs, refactor, test, chore, or perf.
- Inspect the repo's recent commit history and local instructions for an established convention.

### 2. Choose type and scope
- Use the smallest accurate scope based on changed paths.
- Prefer clarity over cleverness.

### 3. Format the title
- Follow the repository's documented or clearly established convention.
- If no convention is documented or visible, default to Conventional Commits: `<type>(<scope>): <imperative summary>`.
- Add a Unicode Gitmoji only when the target repo's convention uses it.
- Keep it concise and GitHub-friendly.

### 4. Format the body
- Use 1-3 bullets.
- Focus on motivation, impact, or notable constraints.

### 5. Validate the result
- Ensure the message matches the actual change set.
- Avoid overclaiming or mixing unrelated intents.

## Guardrails
- Do not impose Gitmoji, Conventional Commits, or another house style when the target repo has a different documented convention.
- When Gitmoji is locally required, use Unicode rather than shortcodes such as `:sparkles:`.
- Do not describe planned work as completed work.
- Do not choose `feat` when the work is really a fix or refactor.
- Do not draft PR titles, PR bodies, PR metadata, or co-author/AI/model/tool/generated-by attribution here. Public attribution follows the target repository requirement or explicit user request and is verified by the Published PR Gate.

## Completion checklist
- [ ] Dominant change type identified
- [ ] Scope chosen clearly
- [ ] Repository convention identified or default stated
- [ ] Title formatted correctly for that convention
- [ ] Body explains why
- [ ] Message matches actual changes

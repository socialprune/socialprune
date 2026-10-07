# ADR-019: GitHub Pages deployment kept manual

- **Status:** Proposed
- **Date:** 2026-10-06
- **Hard constraints touched:** 1 (GitHub Pages only, no paid hosting), 5 (the deployed app makes no promises), 6 (only built app files are published)
- **Related:** [ADR-003](ADR-003-offline-app-shell.md), [ADR-005](ADR-005-browser-storage.md), [ADR-016](ADR-016-local-review-server.md)

## Context

The web app is meant to run at `https://socialprune.github.io/socialprune/`, served by GitHub Pages from the `socialprune` organization. The organization exists so that this origin holds nothing else: every Pages site under `socialprune.github.io` shares one origin and therefore one browser storage area ([ADR-005](ADR-005-browser-storage.md)). Pages is not enabled yet, and the maintainer has not authorized a deployment. Phase 2 should still leave a working, reviewed path, so that deployment becomes a deliberate click when the time comes.

GitHub's documentation (observed 2026-10-06) requires `pages: write` and `id-token: write` for the deploy job and a `github-pages` environment, and limits a published site to 1 GB. The current action releases, read with `gh api` on 2026-10-06:

| Action | Version | Tag commit | License | Released |
|---|---|---|---|---|
| `actions/upload-pages-artifact` | 5.0.0 | `fc324d3547104276b827a68afc52ff2a11cc49c9` | MIT | 2026-04-10 |
| actions/deploy-pages | 5.0.1 | `368f82528645a54fb793d4d04e342629a3f51346` | MIT | 2026-09-01 |
| actions/configure-pages | 6.0.0 | `45bfe0192ca1faeb007ade9deae92b16b8254a0d` | not checked | 2026-03-25 |

## Decision Drivers

- Nothing deploys as a side effect of a push or a merge.
- The deploy job has the only write permissions, and only when explicitly asked.
- The artifact holds the Pages build and nothing else.

## Options

### Option 1: A manual workflow with a default-off publish input

**Pros:**
- Every deployment is a recorded, deliberate run on `main`.
- The build and the artifact step can be tested without deploying.

**Cons:**
- Someone has to remember to deploy after a release.
- A manual step can be forgotten for weeks, so the live app can lag `main`.

**Effort:** not measured
**Risk:** Low.

### Option 2: Deploy on every push to `main`

**Pros:**
- The live app always matches `main`.
- No manual step.

**Cons:**
- Deploys work in progress and any mistake immediately to every visitor.
- Not authorized in Phase 2.

**Effort:** not measured
**Risk:** Medium.

### Option 3: A `gh-pages` branch pushed from a local machine

**Pros:**
- No workflow permissions at all.
- Familiar.

**Cons:**
- The built files come from a personal machine, not from a reviewed CI build.
- No artifact provenance.

**Effort:** not measured
**Risk:** Medium.

## Decision

We chose **Option 1: a manual workflow with a default-off publish input**, because deployment stays a deliberate act while the build path is exercised and reviewed now.

- `.github/workflows/pages.yml` has `on: workflow_dispatch` only, with a boolean input `publish` that defaults to `false`.
- Workflow permissions: `contents: read`. The **build** job checks out, installs with the frozen lockfile, runs the data guard, builds `apps/web` in Pages mode, runs the built-output tests (exact CSP in `index.html`, no `dist-review` files, service worker manifest matches the files) and `pnpm guide:check --max-age 120` ([ADR-022](ADR-022-export-guide-content.md)), and hands `apps/web/dist` to `actions/upload-pages-artifact` pinned to the SHA above.
- The **deploy** job `needs: build`, runs only `if: inputs.publish && github.ref == 'refs/heads/main' && vars.PAGES_ENABLED == 'true'`, has `permissions: { pages: write, id-token: write }`, `environment: github-pages`, and uses `actions/deploy-pages` pinned to the SHA above. `concurrency: { group: pages, cancel-in-progress: false }`.
- `actions/configure-pages` is not used: the Vite `base` is already `/socialprune/`, and the action could change repository settings.
- Enabling Pages with source "GitHub Actions", creating the variable and running the workflow with `publish: true` are maintainer actions outside Phase 2.
- The organization publishes no other Pages site, because it would share the app's origin and storage.

**Decision made by:** maintainer
**Approved on:** pending

## Consequences

### Positive
- No deployment happens until the maintainer acts, and when he does, the artifact comes from a CI build of `main` that passed the built-output checks.
- The workflow is reviewable in Phase 2 without touching repository settings.

### Negative
- The live app does not follow `main` automatically.
- A workflow that has never deployed can fail on its first real run for reasons the build job cannot see, such as environment protection rules.

### Risks
- **A later change sets the publish input's default to `true`.** Mitigation: a CI test parses the workflow YAML and asserts the trigger list, the default and the deploy condition.
- **The artifact grows past the 1 GB site limit** if model files are ever bundled. Mitigation: the build job fails when `apps/web/dist` exceeds 50 MB; models are never part of the Pages build.

## Evidence

- GitHub, [Using custom workflows with GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) and [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits); GitHub, [`upload-pages-artifact` v5.0.0 action.yml](https://raw.githubusercontent.com/actions/upload-pages-artifact/v5.0.0/action.yml), [deploy-pages v5.0.1 action.yml](https://raw.githubusercontent.com/actions/deploy-pages/v5.0.1/action.yml), [configure-pages v6.0.0 action.yml](https://raw.githubusercontent.com/actions/configure-pages/v6.0.0/action.yml). All observed 2026-10-06.

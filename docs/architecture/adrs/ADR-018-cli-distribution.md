# ADR-018: CLI release bundle and npm package contents

- **Status:** Proposed
- **Date:** 2026-10-06
- **Hard constraints touched:** 1 (free tooling and free publishing only), 6 (no fixtures or real data in the package)
- **Related:** [ADR-002](ADR-002-dependency-licenses.md), [ADR-013](ADR-013-cli-framework-output.md), [ADR-014](ADR-014-agent-interface.md), [ADR-016](ADR-016-local-review-server.md)

## Context

The workspace runs TypeScript source through Node's type stripping, and workspace packages export `./src/index.ts`. That cannot ship: Node refuses to strip types inside `node_modules`. A generated `node_modules/<pkg>/index.ts` failed with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` under Node 24.14.1, 24.21.0 and 26.10.0 on 2026-10-06. So `npx socialprune` needs a JavaScript build of `apps/cli` together with the reachable parts of `packages/core` and both adapters, plus the built web app for `review`, the schemas and the skill.

Three bundlers were compared on the real `structure` entry with the same settings (Node platform, ESM, minified, all dependencies bundled, external source map):

| Bundler | Already in the lockfile | `cli.mjs` | gzip | without tree shaking |
|---|---|---:|---:|---:|
| esbuild 0.28.2 | yes, pinned dev dependency of `apps/web` | 639,552 B | 172,816 B | 693,302 B |
| tsdown 0.23.0 on Rolldown 1.2.12 | no (tsdown); Rolldown yes | 238,964 B | 89,458 B | 346,357 B |
| Rolldown 1.2.12 used directly | yes, through Vite 8.3.3 | 238,949 B | 89,455 B | 346,362 B |

**Spot check, 2026-10-06.** The research compared only esbuild and tsdown. Because Rolldown already resolves at 1.2.12 in this repository's lockfile, we ran Rolldown's JavaScript API directly against the same trial sources, entry, aliases and synthetic ZIP, with `codeSplitting: false`. It produced the sizes in the last row, and the bundled `structure --json` exited 0 with the key path present and the planted leaf text and number absent. The 2.7 times size difference against esbuild comes mostly from zod: esbuild kept 453,252 bytes of it with tree shaking and 453,281 without, while Rolldown retained 19 of 95 zod modules.

Both builders mapped a thrown error back to `packages/core/src/archive/limits.ts` when run with `--enable-source-maps`; a `.map` file alone is not used by Node.

## Decision Drivers

- No new package in the dependency graph if an existing one does the job.
- Smallest artifact that passes the real CLI path.
- Development keeps running source without a build step.
- Publishing is not authorized in Phase 2; the release path must exist and stay inert.

## Options

### Option 1: Rolldown 1.2.12 directly

**Pros:**
- Already in the lockfile at the same version; adding it as an exact dev dependency of `apps/cli` adds no package to the graph.
- Same output as tsdown, which wraps it.

**Cons:**
- A small build script of our own (about 40 lines) instead of tsdown's conventions.
- When Vite moves to a newer Rolldown, the CLI either follows or carries a second version.

**Effort:** not measured
**Risk:** Low.

### Option 2: tsdown 0.23.0

**Pros:**
- Library-bundling defaults and a documented configuration file.
- Same artifact size as Rolldown.

**Cons:**
- A new dependency with declaration tooling the CLI does not need; the trial build warned about deprecated optional binding packages in that graph.
- tsdown externalizes dependencies by default, so the configuration has to force bundling anyway.

**Effort:** not measured
**Risk:** Low.

### Option 3: esbuild 0.28.2

**Pros:**
- Already a pinned dev dependency; the simplest API.
- Same correctness on the probes.

**Cons:**
- 2.7 times the output size (172,816 B against 89,455 B gzip), mostly untouched zod code.
- Every `npx` start parses the larger file.

**Effort:** not measured
**Risk:** Low.

## Decision

We chose **Option 1: Rolldown 1.2.12 used directly**, because it gives the smallest tested artifact without adding a package to the dependency graph. esbuild 0.28.2 stays the fallback if a Rolldown update breaks the release build.

### Build

- `apps/cli/build/release.ts` runs Rolldown with input `apps/cli/src/main.ts`, `platform: 'node'`, aliases from the workspace package names to their `src/index.ts`, every dependency bundled, `format: 'esm'`, `minify: true`, `sourcemap: true`, `codeSplitting: false` and the banner `#!/usr/bin/env node`. zip.js runs without web workers in Node.
- The web app is built a second time in local-review mode into `apps/web/dist-review/` ([ADR-016](ADR-016-local-review-server.md)).
- The script assembles `apps/cli/dist/package/` and writes its `package.json`. Nothing under `dist/` is committed.

### Package contents

```text
socialprune/
  package.json         name socialprune, version from the release tag, license Apache-2.0,
                       type module, bin { socialprune: ./bin/socialprune.mjs },
                       engines { node: ">=24.15.0" } (the floor proposed in ADR-015),
                       files limited to the entries below,
                       exports only "./schemas/*" and "./skills/*", publishConfig access public
  bin/socialprune.mjs  the bundle
  bin/socialprune.mjs.map
  web/                 dist-review: index.html, hashed JS and CSS, icons, no service worker
  schemas/             every JSON schema from ADR-006 and ADR-013
  skills/socialprune/  SKILL.md and references/
  README.md            CLI usage, Node requirement, agent setup pointer
  LICENSE
  THIRD_PARTY_NOTICES  generated from the license files of every bundled package
```

No TypeScript source, no tests, no fixtures, no evidence documents. `packages/core` and the adapters stay private workspace packages; publishing them as libraries is not part of Phase 2.

### Checks

- CI on every pull request: build the package, run `npm pack --dry-run --json` with the npm that ships with the CI Node, and compare the file list with an expected list in `apps/cli/build/expected-files.txt`. Then install the packed tarball into an empty temporary folder and run `socialprune --help --json`, `structure` on an X fixture, `import`, `summary`, `batch next --share-with-agent`, `labels submit --dry-run` and `review --dry-run` on the generated demo export. One job on Ubuntu runs this with the latest Node 24 and one with the Node floor from [ADR-015](ADR-015-cli-storage-node-baseline.md); the release workflow repeats it on Windows and macOS.
- A test asserts that the package file list contains no path under `fixtures/`, and that every file in it is either generated build output or tracked in Git, so nothing git-ignored can reach the package.

### Release workflow, present and inert

- `.github/workflows/release-cli.yml` with `on: workflow_dispatch` only. The build-and-smoke job runs on Ubuntu, Windows and macOS, and runs `pnpm guide:check --max-age 120` ([ADR-022](ADR-022-export-guide-content.md)). A CI test parses this workflow file and asserts the trigger list, the permissions and the publish condition. The publish job has `permissions: { contents: read, id-token: write }`, `environment: npm-publish`, and the condition `if: vars.NPM_PUBLISH_ENABLED == 'true'`.
- It publishes with npm trusted publishing through GitHub OIDC, which produces provenance automatically for a public package from a public repository. No token secret exists. Its first step fails unless `npm --version` is 11.5.1 or newer, because trusted publishing needs that, and the workflow never installs a different npm ([ADR-002](ADR-002-dependency-licenses.md), rule 5).
- Before the first release, the maintainer configures the trusted publisher on npm for `socialprune/socialprune` and this workflow file, creates the `npm-publish` environment with himself as required reviewer, and sets the variable. Phase 2 does none of this, so the publish job cannot run.

**Decision made by:** maintainer
**Approved on:** pending

## Consequences

### Positive
- About 89 KB gzip for the trial CLI and no new package in the graph.
- Every pull request proves that the packed package installs and runs, not only that source runs.

### Negative
- Our own build script and expected-file list to maintain.
- Stack traces from users point into minified code unless they rerun with `node --enable-source-maps`; the README says how.

### Risks
- **The bundle misses a dynamic import or worker asset** used by an adapter or zip.js. Mitigation: the packed-install smoke test runs `import` on the generated export and asserts the item count.
- **A Rolldown update changes output semantics.** Mitigation: the dependency is exact; the packed smoke test runs on every update; esbuild is the documented fallback.

## Evidence

- Bundle table, tree-shaking metadata and source-map probe: [evidence-2026-10.md, section 7](../evidence-2026-10.md#7-cli-bundles-and-framework).
- Node.js, [Modules: TypeScript](https://nodejs.org/api/typescript.html) (type stripping refuses `node_modules`); npm, [package.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-json), [Trusted publishing](https://docs.npmjs.com/trusted-publishers/) and [Generating provenance statements](https://docs.npmjs.com/generating-provenance-statements); Rolldown, [v1.2.12 LICENSE](https://raw.githubusercontent.com/rolldown/rolldown/v1.2.12/LICENSE). All observed 2026-10-06.

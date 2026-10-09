# ADR-002: Dependency license policy

- **Status:** Accepted
- **Date:** 2026-10-06
- **Hard constraints touched:** 1 (nothing costs money), indirectly. A license that forces source disclosure or a commercial grant can turn into a cost or a takedown.
- **Related:** [ADR-003](ADR-003-offline-app-shell.md), [ADR-010](ADR-010-styling-tokens.md), [ADR-011](ADR-011-internationalization.md), [ADR-015](ADR-015-cli-storage-node-baseline.md), [ADR-018](ADR-018-cli-distribution.md)

## Context

SocialPrune is licensed Apache-2.0. The npm package bundles third-party code into one JavaScript file, and the GitHub Pages build ships bundled code to every visitor. Both are redistribution, so the licenses of everything that ends up in those artifacts travel with them. Build and test tools do not ship, but they run in CI on every pull request, and some of them (Vite's CSS pipeline, the release bundler) shape the shipped output.

Phase 1 kept every installed package on a short allowlist. At commit `7263d7d` on 2026-10-06, `pnpm licenses list --json` reported 145 distinct package versions: 109 MIT, 20 Apache-2.0, 7 ISC, 6 BSD-2-Clause and 3 BSD-3-Clause. Phase 1 pinned `minimatch` to 9.0.9 (ISC) to avoid a BlueOak-licensed major and removed Vite 8's Lightning CSS (MPL-2.0) with the lockfile override `vite>lightningcss: '-'`. Those checks ran by hand; `.github/workflows/ci.yml` has no license step yet.

Phase 2 research met the same boundary several times:

| Candidate | What its graph contains | Observed 2026-10-06 |
|---|---|---|
| vite-plugin-pwa 2.0.0 through workbox-build 7.4.1 | BlueOak-1.0.0 glob family, CC-BY-4.0 data in `caniuse-lite` | registry and installed graph |
| Paraglide JS 2.26.0 with its message-format plugin | `@bytecodealliance/jco-*` under `Apache-2.0 WITH LLVM-exception` | `pnpm why` in an isolated trial |
| i18next-cli 1.74.8 | BlueOak-1.0.0 glob, minimatch, lru-cache, minipass, path-scurry | installed graph |
| axe-core / @axe-core/playwright 4.13.0 | MPL-2.0 | registry |
| Tailwind CSS 4.3.3 (Vite and PostCSS integrations) | Lightning CSS 1.32.0 (MPL-2.0) through `@tailwindcss/node` | registry |
| `@sqlite.org/sqlite-wasm` 3.53.4-build2 | registry says Apache-2.0, the shipped JS carries MIT plus University of Illinois/NCSA and SQLite public-domain notices | registry and published file |

In every one of these cases an allowlisted alternative existed. The policy therefore needs no relaxation in Phase 2, but it needs to be written down, enforced in CI and given an exception path that cannot be used casually.

## Decision Drivers

- The project can redistribute everything it bundles under Apache-2.0 with notices, and nothing else.
- The rule must be mechanical enough for CI, because license metadata changes with every lockfile update.
- A permissive license that is not on the list should be possible when nothing on the list fits, but only with a written reason.
- Runtime components that ship inside Node itself are not dependencies the project chooses per package.

## Options

### Option 1: Strict allowlist with a per-package exception record

Allow MIT, ISC, BSD-2-Clause, BSD-3-Clause, 0BSD and Apache-2.0 for every package in the lockfile. Other permissive licenses need their own ADR.

**Pros:**
- Matches what Phase 1 already enforced, so no existing dependency changes.
- Every exception is visible, dated and tied to the reason no allowlisted package fit.

**Cons:**
- Rules out some well-made tools: Paraglide's 1,474-byte gzip delta was the smallest i18n result measured, and axe-core has the broadest accessibility rule set.
- Writing an ADR for each exception is slow.

**Effort:** not measured
**Risk:** Low. The Phase 1 graph already passes.

### Option 2: Accept every OSI-approved permissive license

Add BlueOak-1.0.0, CC0-1.0, Apache-2.0 WITH LLVM-exception, Unlicense and similar without per-package review.

**Pros:**
- Admits Paraglide, stock Workbox and current glob releases without extra records.
- Less maintenance when transitive dependencies switch licenses.

**Cons:**
- The allowlist grows by category, so a data license such as CC-BY-4.0 could slip in with attribution duties nobody tracks.
- Reviewers lose the signal that a license outside the familiar six needs a look.

**Effort:** not measured
**Risk:** Medium. Notice obligations become harder to audit.

### Option 3: Allowlist for shipped code only, anything for development tools

**Pros:**
- Would admit axe-core (MPL-2.0) for tests.
- Keeps the shipped artifact clean.

**Cons:**
- Build tools shape shipped output, so the line between "ships" and "only builds" is blurry: Vite's CSS minifier is exactly such a case.
- Copyleft tools in CI invite copying code from them into the repository later.

**Effort:** not measured
**Risk:** Medium.

## Decision

We chose **Option 1: strict allowlist with a per-package exception record** because an allowlisted alternative existed for every Phase 2 need, and the exception path keeps the door open without making it the default.

1. **Allowlist.** MIT, ISC, BSD-2-Clause, BSD-3-Clause, 0BSD, Apache-2.0. It applies to every package in `pnpm-lock.yaml`: runtime, build and test, direct and transitive.
2. **Exception path.** BlueOak-1.0.0, Apache-2.0 WITH LLVM-exception, CC0-1.0 and data licenses such as CC-BY-4.0 are admissible only through an ADR for that package and version, naming why no allowlisted alternative fits and which notice duties follow.
3. **Excluded.** GPL, LGPL, AGPL, MPL and EPL in any version; source-available licenses such as SSPL, BUSL and Commons Clause; custom non-OSI licenses; packages without a license.
4. **SPDX expressions.** `A OR B` passes if one branch is allowlisted. `A AND B` passes only if both are. A `WITH` expression is its own identifier and is not the same as its base license.
5. **Runtime, not dependencies.** Node.js and its built-in modules, including `node:sqlite` with the SQLite library Node embeds, belong to the runtime. They are not entries in the lockfile and are not judged by this list. The same holds for the npm CLI that ships inside the Node distribution, when CI uses it to pack or publish. Installing a different npm version from the registry would make it a toolchain dependency; npm declares Artistic-2.0, so that step needs the maintainer's decision first.
6. **Downloaded artifacts.** Model weights, WASM runtimes and other files a feature downloads at run time (Phase 2a) are not lockfile packages. Each needs its own ADR naming its license and redistribution rights before the product fetches or bundles it.
7. **GitHub Actions** used in workflows are pinned by commit SHA and must carry an allowlisted license, read from the tagged release.
8. **Enforcement.** A CI step `pnpm licenses:check` reads `pnpm licenses list --json` for production and development dependencies and fails on any identifier outside the allowlist that is not covered by an exception entry naming its ADR. A package whose metadata has no license field fails unless an exception entry records the license text that was read.
9. **Notices.** The Pages build and the npm package each carry a generated `THIRD_PARTY_NOTICES` file covering every bundled package, produced from the installed packages' license files rather than from minifier legal comments.

**Decision made by:** maintainer
**Approved on:** 2026-10-09

## Consequences

### Positive
- The policy is checked on every pull request instead of by hand before a release.
- All Phase 2 choices in ADR-003 to ADR-022 pass without an exception record.

### Negative
- Paraglide, stock Workbox, i18next-cli, axe-core and Tailwind are unavailable. The project writes a small service worker, a small catalog checker and accessibility tests on a different engine instead.
- A transitive license change in a routine update fails CI and blocks unrelated work until someone pins or replaces the package.

### Risks
- **Registry metadata is wrong or incomplete.** The installed `@stricli/core` 1.3.0 package contained no LICENSE file, although its `v1.3.0` repository tag carries Apache-2.0. Mitigation: the notices generator reads license files, and rule 8 forces a recorded reading when metadata is missing.
- **The npm CLI version question blocks a future release.** Mitigation: rule 5 names it; the release workflow in [ADR-018](ADR-018-cli-distribution.md) fails closed instead of installing npm silently.

## Evidence

- Phase 1 graph: 145 distinct package versions from `pnpm licenses list --json` at commit `7263d7d`, run by the architect on 2026-10-06; `minimatch` 9.0.9 and the `vite>lightningcss` override are in `pnpm-workspace.yaml` at that commit.
- Vite 8.3.3 lists `lightningcss` in `dependencies`; with the override, zero Lightning CSS directories are installed and `vite build` passes with `css.transformer: 'postcss'` and `build.cssMinify: 'esbuild'` (checked 2026-10-06).
- Candidate graphs: [evidence-2026-10.md, section 9](../evidence-2026-10.md#9-dependency-and-license-observations).
- SPDX license list and expression syntax: SPDX workgroup, [SPDX License List](https://spdx.org/licenses/), observed 2026-10-06.

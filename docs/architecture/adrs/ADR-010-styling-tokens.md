# ADR-010: Styling with CSS Modules, cascade layers and design tokens

- **Status:** Accepted
- **Date:** 2026-10-06
- **Hard constraints touched:** none directly; the choice is bounded by [ADR-002](ADR-002-dependency-licenses.md) and [ADR-004](ADR-004-content-security-policy.md)
- **Related:** [ADR-008](ADR-008-review-ui-primitives.md), [design specification](../../design/README.md)

## Context

Styles must ship as external CSS files: the page policy has `style-src 'self'` without `'unsafe-inline'`, so runtime CSS-in-JS that inserts `<style>` elements fails. The repository removes Lightning CSS (MPL-2.0) with the lockfile override `vite>lightningcss: '-'` and builds CSS with `css.transformer: 'postcss'` and `build.cssMinify: 'esbuild'`. Vite 8.3.3 lists Lightning CSS in its `dependencies`, not as optional; the override still removes it, zero Lightning CSS directories are installed, and the build passes. Any styling tool has to work under that override.

Trials on 2026-10-06 found:

| Candidate | Finding |
|---|---|
| Plain CSS with `@layer` and custom properties, plus CSS Modules | Built and previewed with zero violations and zero inserted styles; 2,308 B CSS, 1,027 B gzip in the token sample |
| Tailwind CSS 4.3.3 (Vite and PostCSS integrations) | Both depend on `@tailwindcss/node` 4.3.3, which requires `lightningcss` 1.32.0 |
| StyleX 0.19.1 Vite integration | `@stylexjs/unplugin` 0.19.1 requires `lightningcss` ^1.29.1 |
| vanilla-extract 1.21.2 | Viable, but adds a compiler with Babel and esbuild; not trialed in the browser |
| Panda CSS 2.1.2 | New compiler graph not trialed |

React's `style={{ width: 123 }}` sets properties through the CSSOM and is not blocked by `style-src`; a `setAttribute('style', …)` call and an inserted `<style>` element were both rejected in the same trial (Chromium 153 only).

## Decision Drivers

- Works under the Lightning CSS override and the page policy with no exception.
- No new dependency unless it adds a check plain CSS cannot have.
- Design tokens defined once for light, dark and forced colors.

## Options

### Option 1: CSS Modules, one global token file with `@layer`

**Pros:**
- Built into Vite 8; no dependency; tested under the exact policy.
- Plain CSS is the easiest for contributors to read and for browser devtools to inspect.

**Cons:**
- No compile-time type check on token names.
- Discipline needed to keep raw colors out of component files.

**Effort:** not measured
**Risk:** Low.

### Option 2: vanilla-extract

**Pros:**
- Typed tokens and themes.
- Static extraction.

**Cons:**
- A compiler with Babel in the build graph for a check that a unit test can approximate.
- Not trialed under the policy and the override.

**Effort:** not measured
**Risk:** Medium.

### Option 3: Tailwind CSS 4

**Pros:**
- Widely known utility classes.
- Fast iteration.

**Cons:**
- Requires Lightning CSS (MPL-2.0) through `@tailwindcss/node`, which [ADR-002](ADR-002-dependency-licenses.md) excludes.
- Long class strings in JSX make the review grid harder to read.

**Effort:** not measured
**Risk:** High under the license policy.

## Decision

We chose **Option 1: CSS Modules with one global token file using `@layer`**, because it is the only tested option that needs neither a new dependency nor a policy exception.

- `apps/web/src/styles/tokens.css` declares the layer order once: `@layer reset, tokens, base, components, utilities;` and defines every token as a custom property for light, dark (`prefers-color-scheme` and a manual setting via `data-theme`), forced colors and reduced motion. Token values and contrast figures are in the [design specification](../../design/README.md).
- Each component has a `*.module.css` file in `@layer components` that uses only `var(--…)` tokens for color, space, radius, type and motion.
- A unit test scans `apps/web/src/**/*.module.css` and fails on any hex, `rgb(` or `hsl(` color literal, so raw colors stay in `tokens.css`. No Stylelint dependency is added for this.
- CSSOM writes through React's `style` prop are allowed only for virtualizer offsets and measured sizes. Item text never reaches CSS, selectors or class names.
- Fonts are the system stack; `font-src 'none'` stays.

**Decision made by:** maintainer
**Approved on:** 2026-10-09

## Consequences

### Positive
- Zero new dependencies; the CSS path is the one the repository already builds.
- One file defines every visual value, so theme changes and contrast checks have one place to look.

### Negative
- No editor completion for token names beyond what the CSS language server offers.
- Contributors used to Tailwind need to write CSS.

### Risks
- **Dev mode looks different from production** because Vite injects styles in dev. Mitigation: the serve-only policy in [ADR-004](ADR-004-content-security-policy.md), and acceptance tests always run against the built preview.
- **CSS Modules under the override fail in the repository setup** although the standalone trial passed. Mitigation: the first web node builds one CSS Module in the repository and asserts the emitted CSS file and zero violations before any other UI work.

## Evidence

- Styling trials and CSSOM behavior: [evidence-2026-10.md, section 6](../evidence-2026-10.md#6-ui-primitives-grid-and-accessibility); Lightning CSS observations: [section 9](../evidence-2026-10.md#9-dependency-and-license-observations).
- Vite, [CSS Modules](https://vite.dev/guide/features#css-modules) and [css.transformer](https://vite.dev/config/shared-options#css-transformer); Tailwind Labs, [@tailwindcss/node 4.3.3 on npm](https://registry.npmjs.org/@tailwindcss/node/4.3.3); Meta, [@stylexjs/unplugin 0.19.1 on npm](https://registry.npmjs.org/@stylexjs/unplugin/0.19.1); vanilla-extract maintainers, [Vite integration](https://vanilla-extract.style/documentation/integrations/vite/). All observed 2026-10-06.

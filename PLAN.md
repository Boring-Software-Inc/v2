# Semantic UI contract plan

## Context

Tripwire already has a root-selectable design-system facade (`#/design-system/*`) and a defined visual scale, but feature code can still choose low-level typography and spacing utilities. That leaves hierarchy and rhythm open to per-page agent decisions, causing drift even when every value comes from a token.

The intended outcome is a StyleX-inspired, statically constrained application UI contract:

- Feature code expresses semantic roles and product structures, not font sizes, margins, padding, or arbitrary gaps.
- Typography is exposed through named roles such as page title, section heading, supporting text, label, caption, code, and data—not a generic `Text size="…"` escape hatch.
- Repeated application structures are molecules that own their internal rhythm and responsive behavior.
- Oxlint rejects new low-level styling decisions in feature code.
- Rendered route audits catch hierarchy, contrast, state-visibility, and typography-budget problems that static analysis cannot see through nested components.
- Glaze returns as the single implementation. Quartz and its compatibility layer are removed rather than retained as a second palette.

The immediate regressions motivating the plan are concrete:

- Organization dither avatars gained blinking, pointer-following eyes. The avatar should be the static Dither Kit image only.
- The header Beta control has poor geometry despite using the Button primitive, proving that primitive usage alone does not guarantee a coherent composed control.
- The feedback element-picker outline can become visually indistinguishable from its background.
- The Quartz compatibility bridge mixed two palettes and allowed invalid or mismatched hover, foreground, surface, and state combinations.

The goal is not merely to repair these instances. The contract and checks must make the same classes of regression difficult or impossible to introduce.

## Approach

### 1. Establish a closed semantic vocabulary

Define a small typography role set and a small layout/molecule set from existing application usage. Preserve the current Tripwire type values and 4px rhythm as implementation inputs, but remove value selection from feature call sites.

Initial typography contract, to be validated against the complete inventory:

- `PageTitle` — the single page-level heading.
- `SectionHeading` — a named content region.
- `Subheading` — one subordinate level inside a section.
- `Body` — primary explanatory prose.
- `SupportingText` — secondary descriptions and helper text.
- `Label` — control, row, and compact navigation labels.
- `Caption` — timestamps, counts, and tertiary metadata.
- `CodeText` — IDs, paths, rule IDs, and inline/code-block content only.
- `DataValue` — changing numeric values with tabular figures.

The public API will not include generic `Text`, `size`, `weight`, `leading`, or visual `className` escape hatches. Semantic element overrides will be finite and accessibility-safe where a component must fit an existing heading outline.

Display roles will be container-aware rather than viewport-driven. Their minimum and maximum values will be derived from the existing Glaze role scale, using bounded `clamp()`/container-query math only where the inventory proves a responsive display range is needed. Dense prose, labels, inputs, and metadata will remain fixed optical sizes because fluid control text would destabilize rows and touch behavior. Line heights remain tied to the existing role metrics rather than independently selectable.

Initial structural contract, derived from existing settings and dashboard layout patterns:

- `Page`, `PageHeader`, `PageBody`
- `Section`, `SectionHeader`, `SectionBody`, `SectionActions`
- `CardBody`
- `FormSection`, `FieldGroup`, `ActionRow`
- `Toolbar`
- `DataRegion`, `ListSection`, `DetailGroup`, `EmptyRegion`

Only structures proven by at least two real call sites will become shared molecules. Single-use compositions stay with their feature.

### 2. Keep implementation ownership layered

```text
route wiring
  -> feature page / feature composition
  -> stable web compatibility facades
  -> @tripwire/ui semantic primitives and generic molecules
  -> package-owned semantic CSS
  -> Glaze custom properties and app implementation components
```

- `packages/ui` is the package-level semantic contract consumed by web.
- Proven domain-free typography and generic page, section, action-row, and form-section molecules live in `@tripwire/ui`.
- App-specific molecules remain under `apps/web/src/components`; member and invite collection-row geometry stays app-owned.
- Glaze implementation components and providers remain behind `apps/web/src/design-system`; feature facades stay stable so product imports do not churn.
- Feature files do not import Glaze or low-level style recipes directly.
- Package CSS may consume Glaze-supplied custom properties, but it does not import app modules or expose implementation token selection to callers.

### 3. Make spacing contextual rather than configurable

Avoid APIs such as `gap="sm"`, `padding="card"`, or `space="section"` when the caller would still be choosing the design. Molecules own their spacing according to their role and responsive state. Variants are allowed only for materially different product contexts or density modes with documented meaning.

### 4. Consolidate color by role, not palette name

Keep the package-owned semantic color contract above Glaze. The failed compatibility bridge remains an important lesson: matching token names did not imply matching semantics—Glaze `text-3` is explicitly not sentence text, while Quartz `text-3` was readable tertiary text. The Tripwire roles therefore describe use, not implementation names, even with only one active implementation.

Closed role families:

- **Surfaces:** `canvas`, `page`, `container`, `raised`, `inset`, `overlay`, `inverse`.
- **Content:** `primary`, `secondary`, `tertiary`, `disabled`, `inverse`.
- **Boundaries:** `subtle`, `default`, `control`, `strong`, `focus`.
- **Interaction:** `hover`, `selected`, `pressed`, `disabled`.
- **Intent:** `success`, `warning`, `danger`, and `info`, each exposing only the combinations components need (`mark`, `text`, `wash`, `border`).
- **Product identity:** finite `data-kind`/kind props and the existing agent-activity signal; feature code never selects a hue.

Feature code will not use `text-text-2`, `bg-page`, `border-line-*`, raw Tailwind palette utilities, raw color literals, or CSS custom properties directly. Semantic primitives and molecules own foreground/background pairs. Callers may select a finite semantic state such as `tone="danger"` only where the data genuinely carries that state.

The palette remains intentionally restrained: neutral structure, status hues only for status, and a product-kind accent only where kind is meaningful. Glaze is the visual baseline. Color consolidation first reproduces that baseline exactly; any later retuning must answer a recorded complaint rather than invent a new look.

### 5. Make component states visibly testable

Create a finite state contract for each interactive primitive and high-risk molecule: rest, hover, focus-visible, pressed, selected/current, open, disabled, invalid, pending, and reduced-motion where applicable. Each supported state declares the visual effect that must change and the minimum visibility requirement.

Examples:

- Focus and selection boundaries must meet 3:1 non-text contrast against adjacent surfaces.
- A state cannot rely on a custom property that computes to an empty value.
- Hover/pressed/open states must produce an observable computed-style delta from rest.
- Overlays drawn across arbitrary content, such as the feedback picker, use a purpose-owned dual-tone or otherwise background-independent outline rather than borrowing a normal focus-ring token.
- Unsupported state combinations are rejected by the component API instead of silently rendering an undefined mixture.

Automated component-state checks will render the canonical state matrix in light and dark themes, assert required computed-style deltas and contrast, and retain screenshots for optical review. This complements accessibility checks; it does not replace keyboard or screen-reader testing.

### 6. Add static and rendered enforcement

Oxlint will enforce what can be known from source:

- no raw typography utilities in feature files;
- no arbitrary font sizes or line heights;
- no margin utilities in feature files;
- no raw padding/gap/space utilities where an owned molecule exists;
- no generic `Text` component;
- no direct implementation imports (extend the existing boundary check rather than duplicate it in Oxlint);
- at most one `PageTitle` in a page component source file, with the rendered audit proving exactly one after nested composition;
- approved semantic components imported only through the facade/application boundary.

A browser audit will enforce what only the rendered tree can reveal:

- exactly one `PageTitle` per page;
- no more than three rendered heading depths (`PageTitle` → `SectionHeading` → `Subheading`);
- no more than two prose roles (`Body` and `SupportingText`) on a surface;
- `Label` and `Caption` only inside components/regions that own compact UI or metadata;
- `CodeText` and `DataValue` restricted by content semantics rather than counted as decorative hierarchy;
- computed font sizes outside the selected design system's approved role scale;
- computed padding, margin, and gap on marked semantic components outside the approved 4px rhythm, except documented optical 2px adjustments inside design-system implementations;
- text overflow, measure, and 200% zoom resilience;
- responsive behavior across narrow, intermediate, and wide widths.

This is a hierarchy budget, not an arbitrary total count: a dense data page may contain many labels without gaining another visual heading tier.

### 7. Remove the failed migration before building forward

First restore the application to Glaze-only operation:

- rename the branch from `quartz` to `semantic-ui-contract`;
- remove the runtime design-system selector, Quartz root scope/provider, and compatibility stylesheet;
- keep `#/design-system/*` as the stable application facade, resolving to Glaze;
- remove `apps/web/src/components/quartz/**`, `apps/web/src/lib/quartz/**`, and Quartz-only local skill/registry artifacts;
- remove Quartz-only dependencies (`@fortawesome/free-solid-svg-icons`, `@tanstack/react-table`, and `@tailwindcss/postcss`) after confirming no non-Quartz consumers;
- remove `VITE_DESIGN_SYSTEM` documentation/configuration;
- append a superseding `DECISIONS.md` entry explaining why the Quartz migration was abandoned; preserve history rather than deleting prior decisions;
- verify Glaze visual and behavioral baselines before semantic refactoring.

Unrelated `.agents/skills/**` modifications remain untouched.

### 8. Repair the motivating header regressions

- Remove the `eyes` API from `OrgAvatar` and `DitherAvatar`, remove all `eyes` call sites, then delete `AvatarEyes` and the gaze store if no other consumer remains.
- Replace `BetaTag` with a header-owned feedback control contract that still uses Button internally but owns its label, size, geometry, and responsive placement. Verify its actual box model rather than assuming primitive usage is sufficient.
- Give the feedback picker a dedicated selection-outline primitive/token and state test. Do not reuse the ordinary focus ring for an overlay drawn over arbitrary content.

### 9. Pilot before fan-out

Pilot `/$org/settings/members` through `apps/web/src/components/organizations/org-members-page.tsx`. It exercises a page header, section headings, collections, item rows, forms, validation, actions, empty/loading/error states, permissions, dialogs, long metadata, and responsive wrapping while reusing existing settings molecules. Capture parity before migration, verify all states, and only then migrate further surfaces family by family.

## Files to modify

Likely critical paths; final paths will be narrowed after inventory:

- `packages/ui/src/typography.tsx` and `packages/ui/src/layouts.tsx` — package-owned semantic typography and generic molecules.
- `packages/ui/src/styles/**` — semantic typography, color, and generic layout CSS backed by consumer-supplied implementation custom properties.
- `apps/web/src/design-system/ui/typography.tsx` — thin compatibility re-export facade.
- `apps/web/src/design-system/root.tsx` — compose Glaze with the package-owned semantic styles.
- `apps/web/src/design-system/config.ts` and `apps/web/src/design-system/quartz-compatibility.css` — remove with the runtime switch.
- `apps/web/package.json` and `apps/web/tsconfig.json` — retain facade aliases, add exact semantic-module aliases, and remove Quartz-only dependencies.
- `apps/web/src/components/layouts/page.tsx` and `apps/web/src/components/layouts/section.tsx` — thin compatibility re-export facades for package-owned molecules.
- `apps/web/src/components/settings/settings-frame.tsx` — adapt the existing settings molecules onto the semantic page/section contract.
- `apps/web/src/components/organizations/org-members-page.tsx` and the existing settings skeleton path — pilot migration only.
- `apps/web/src/components/layouts/dashboard-topbar.tsx` and `apps/web/src/components/layouts/dashboard-rail.tsx` — replace `BetaTag` with the header feedback-control molecule.
- `apps/web/src/components/layouts/scope-switchers.tsx` and `apps/web/src/components/layouts/command-palette.tsx` — remove animated-eye call sites.
- `apps/web/src/components/organizations/org-avatar.tsx`, `apps/web/src/components/dither/dither-avatar.tsx`, `apps/web/src/components/dither/avatar-eyes.tsx`, and `apps/web/src/components/dither/gaze-store.ts` — simplify to the static Dither Kit avatar and remove unused gaze behavior.
- `apps/web/src/components/feedback/feedback-outline.tsx` and the feedback picker workbench/tests — dedicated, contrast-safe selection treatment.
- `apps/web/src/components/glaze/tokens.css` and `apps/web/src/components/glaze/styles.css` — existing role values mapped into the semantic layer; no new visual scale.
- `scripts/oxlint/design-system/**` and `.oxlintrc.json` — a separate project-specific JS plugin using the existing Oxlint plugin pattern.
- `scripts/check-boundaries.ts` — extend the existing import-boundary check with forbidden vendor-import assertions.
- `scripts/check-ui-contract.ts` plus focused tests — rendered semantic audit promoted out of temporary `.design-system` probes; inspect only explicitly marked semantic regions/components rather than treating every computed browser dimension as a token.
- `.env.example`, `DECISIONS.md`, and focused component documentation for the Glaze-only contract and enforcement boundary.
- `apps/web/src/components/quartz/**`, `apps/web/src/lib/quartz/**`, and `apps/web/.agents/skills/quartz/**` — delete after reference checks; remove other Quartz registry artifacts only when proven Quartz-specific.

The pilot kept the semantic layer app-owned while its API was still provisional. After the members and settings families proved the contract, the domain-free layer moves into the existing `packages/ui` slot. Glaze implementation components and product-specific layout remain in web.

## Reuse

- Root design-system selection: `apps/web/src/design-system/config.ts`.
- Root styles/providers: `apps/web/src/design-system/root.tsx`.
- Existing semantic type values/utilities: `apps/web/src/components/glaze/styles.css`.
- Glaze tokens: `apps/web/src/components/glaze/tokens.css`.
- Existing component families such as card, item, field, table, panel, toolbar, and empty state under `apps/web/src/components/glaze/ui`.
- Existing settings molecules: `apps/web/src/components/settings/settings-frame.tsx`.
- Existing changed-line ratchet: `scripts/lint-slop-changed.ts`.
- Existing Oxlint JavaScript plugin structure: `scripts/oxlint/anti-slop/index.ts` and its rule modules, used as the template for a separate `design-system` plugin.
- Existing design-system browser probes under `.design-system/tmp/` as patterns, not production checks.
- Existing facade import aliases in `apps/web/package.json` and `apps/web/tsconfig.json`.
- Existing Glaze roles (`28px` title, `20px` heading, `16px` small heading, `14px` body, `13px` supporting text) as the inputs to role mapping.
- Existing `Button`, feedback picker, and dither avatar code as behavior to simplify and contract-test—not rewrite from scratch.

## Steps

- [x] Rename the branch from `quartz` to `semantic-ui-contract` without touching unrelated working-tree changes.
- [x] Restore Glaze-only root behavior, delete Quartz implementation/support code, remove Quartz-only dependencies/config, and record the superseding decision.
- [x] Capture a fresh Glaze baseline and verify the application no longer loads Quartz CSS, providers, tokens, or scope classes.
- [x] Remove dither avatar eyes/gaze behavior, repair the header feedback control, and add a dedicated visible feedback-selection outline.
- [x] Record the user's concrete visual complaints as acceptance criteria, grouped into typography, color, surface, density, component, state visibility, and motion concerns.
- [x] Inventory existing typography roles, color roles/literals, spacing decisions, page shells, section patterns, and repeated molecules across representative routes.
- [x] Derive the smallest closed typography vocabulary from real call sites and map every current type utility to a role or explicit exception.
- [x] Define the canonical color-role matrix, including allowed foreground/background pairs, contrast evidence, state ownership, and explicit mappings to Glaze tokens.
- [x] Derive contextual layout/molecule contracts from repeated structures; reject generic spacing-prop abstractions.
- [x] Decide package ownership for each primitive and molecule without introducing app logic into `@tripwire/ui`.
- [x] Document role semantics, allowed nesting, responsive behavior, and accessibility requirements.
- [x] Implement semantic typography primitives behind the stable design-system/application boundary.
- [x] Implement the application color contract without changing rendered Glaze colors, then prove zero-diff token-only swaps before any complaint-driven retuning.
- [x] Implement canonical state matrices and computed visibility/contrast assertions for Button, fields, selection, focus, overlays, and the feedback picker.
- [x] Implement the first structural molecules and their Glaze-compatible styling.
- [x] Add Oxlint rules for raw type, spacing, color utilities/literals, and direct vendor imports, with planted failing fixtures proving each ban before enabling it.
- [x] Enable the rules through the existing changed-line ratchet; record legacy counts and require the allowlist to shrink.
- [x] Add a rendered route audit for hierarchy, role budget, computed scale/rhythm, overflow, and zoom.
- [x] Migrate `/$org/settings/members` and its skeleton without changing behavior or data flow.
- [x] Verify visual, behavioral, and accessibility parity against the fresh Glaze baseline.
- [x] Ratchet enforcement and migrate remaining surfaces by component family rather than page-local rewrites.

### Enforcement follow-up todo

- [x] Reject arbitrary Tailwind values and selectors in feature code.
- [x] Reject JSX `style` escape hatches in feature code.
- [x] Traverse named class constants, object/array recipes, conditional branches, and nested class composers.
- [x] Reject direct implementation imports, re-exports, and statically resolved dynamic imports.
- [x] Enforce an exact-count legacy baseline that fails on both regressions and unrecorded improvements.
- [ ] Generate a typed semantic-token manifest shared by CSS and static enforcement.
- [ ] Reject unknown semantic custom properties where raw token access is explicitly permitted.
- [ ] Ratchet toward rejecting feature-level `className` entirely, with narrow documented exceptions.
- [ ] Add a dependency-free CSS audit for literals outside implementation-token files.

## Verification

- Typecheck and boundary checks.
- Biome and Oxlint, including planted violations for every new rule.
- Token mapping report with no unmapped feature-level color literals or palette utilities outside documented exceptions.
- Contrast verification for every allowed foreground/background pair in light and dark modes; no visual contrast claims by inspection alone.
- Unit tests for semantic element selection, accessible names, and finite variants.
- Component/workbench coverage for loading, empty, error, populated, disabled, permission, long text, and overflow states where applicable.
- A build/import assertion proving no application or root code references Quartz and no Quartz-only dependency remains.
- Browser checks in Glaze light and dark modes.
- Canonical component state matrix checks: each supported hover, focus, pressed, selected, open, invalid, disabled, and pending state must produce its declared visible effect.
- Browser widths at minimum: 320/390px, an intermediate tablet/small-laptop width, and 1280px.
- Light and dark themes.
- Keyboard navigation, focus visibility, heading structure, and screen-reader semantics.
- 200% text zoom and no horizontal page overflow.
- Before/after captures for the pilot, with every visual difference tied to an explicit contract decision.

## Resolved planning defaults

- **Active system:** Glaze only. Quartz, its runtime switch, and compatibility palette are removed.
- **Branch:** rename `quartz` to `semantic-ui-contract` before implementation.
- **Ownership:** `@tripwire/ui` owns the proven domain-free semantic contract; web keeps stable compatibility facades, Glaze implementation components, and product-specific layout.
- **Pilot:** `/$org/settings/members` because it covers the broadest reusable UI contract without the workflow editor's specialized canvas geometry.
- **Rollout:** changed-line ratchet first, using the existing lint gate; no unbounded whole-application rewrite.
- **Typography budget:** one page title, three heading depths, two prose roles, and semantics-based restrictions for label/caption/code/data roles.
- **Public styling API:** no generic `Text`, no arbitrary spacing props, no caller-selected hues, and no visual `className` passthrough on new semantic primitives or molecules.
- **Color ownership:** application semantic roles sit above Glaze implementation tokens; feature code cannot choose implementation color names.
- **State visibility:** every supported component state declares a visible effect and an automated computed-style/contrast assertion.
- **Dependencies:** no new dependency is needed; remove Quartz-only dependencies and reuse React, Tailwind/CSS, Oxlint JS plugins, and the existing browser stack.

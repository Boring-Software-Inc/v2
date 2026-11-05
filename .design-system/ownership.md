# Semantic UI ownership

## `packages/ui`

Owns the application-agnostic semantic contract exported as `@tripwire/ui`:

- semantic typography components;
- generic page, section, action-row, and form-section molecules;
- semantic typography and color CSS;
- generic layout CSS for the package molecules.

The package imports React only. It contains no app, route, query, auth, contracts, or domain modules, and its public APIs do not expose arbitrary visual controls.

The CSS contract is implementation-independent at the API level but currently consumes custom properties supplied by web's Glaze stylesheet. Glaze remains the only active implementation. Moving Glaze implementation components into the package is intentionally deferred.

## `apps/web/src/design-system`

Owns the stable feature facade and implementation mapping:

- thin typography re-exports from `@tripwire/ui`;
- root stylesheet and provider composition;
- icon, primitive UI, and library aliases to Glaze;
- implementation-bound state metadata used by browser checks.

These modules may know Glaze token and class names but contain no product data or fetching.

## `apps/web/src/components/layouts`

Owns compatibility facades and app-specific structures:

- thin re-exports for package-owned page and section molecules;
- member and invite collection-row geometry;
- dashboard header and rail feedback control;
- specialized feature layouts that are not broadly reusable.

Member and invite row actions remain here because their responsive alignment depends on product-specific media and action slots.

## Feature components

Own:

- data fetching and mutations;
- permission decisions;
- domain copy and content order;
- choosing semantic state (`danger`, `invalid`, `selected`) from real domain data;
- single-use compositions.

They do not choose type size, spacing, raw color, or vendor implementation.

## Scripts

- `scripts/oxlint/design-system/**`: source-level contract enforcement.
- `scripts/check-boundaries.ts`: workspace dependency direction.
- `scripts/check-ui-contract.ts`: rendered semantic and state contract.

## Ownership test

If a module answers “what does this data mean?”, it belongs to the feature. If it answers “how does this semantic role render and behave across applications?”, it belongs to `@tripwire/ui`. If it maps the package contract to Glaze or encodes web-only product geometry, it stays in the web boundary.

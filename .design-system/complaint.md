# Semantic UI contract acceptance criteria

## User complaint

The Quartz swap created a mixed palette and state regressions instead of a coherent replacement. The migration must return to Glaze, remove Quartz, and make visual regressions structurally difficult to introduce.

## Typography

- Feature code must choose semantic roles, not font sizes, weights, or line heights.
- A page has one page title and no more than three heading depths.
- Dense UI labels and metadata cannot be promoted into extra heading tiers.

## Color

- Glaze is the single visual baseline.
- A feature cannot combine Glaze and Quartz tokens or choose raw palette colors.
- Foreground/background pairs belong to semantic components and must have measured contrast.
- Hover, focus, selected, open, invalid, disabled, and pending colors cannot resolve to empty or invalid custom-property chains.

## Surface

- Page, container, field, overlay, inverse, and selected surfaces have distinct semantic roles.
- Overlays must remain visibly separate from every supported underlying surface.
- The feedback element-selection outline must remain visible over arbitrary page content in light and dark themes.

## Density

- Layout molecules own their padding and gaps.
- Feature code cannot choose arbitrary margins, padding, or gaps where a molecule exists.
- Header controls must have balanced geometry and must not gain incidental space from hidden hit-area children.

## Components

- The organization icon is the static Dither Kit avatar. It has no eyes, blinking, gaze tracking, or pointer-following behavior.
- The header Beta/feedback control uses the Button primitive internally but has a header-owned contract for label, size, padding, and placement.
- The Beta label has equal visual inline insets.
- Unsupported component-state combinations fail through finite APIs rather than rendering an undefined mixture.

## State visibility

- Every supported interactive state declares which visible property changes.
- Focus and selection boundaries meet 3:1 non-text contrast against adjacent surfaces.
- Hover, pressed, open, selected, invalid, disabled, and pending states produce an observable computed-style delta from rest.
- State checks run in light and dark themes and retain screenshots for optical review.

## Motion

- Organization avatars do not animate or react to the pointer unless an explicitly named product behavior requires it.
- Reduced-motion behavior remains supported by every component with motion.
- Motion cannot be introduced as decoration through a low-level feature call site.

## Immediate evidence

- Glaze-only captures: `.design-system/glaze-baseline/`.
- Header regression probe: `.design-system/tmp/header-regression-probe.mjs`.
- Baseline root probe proves `body.glaze`, no `.quartz`, no Quartz token values, and no Quartz stylesheet.

## Branch

`semantic-ui-contract`

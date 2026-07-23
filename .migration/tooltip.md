# tooltip

2026-07-22, transformation engine, positioner model, migrated clean.

## Changed

- apps/web/src/components/ui/tooltip.tsx: @radix-ui/react-tooltip ->
  @base-ui/react/tooltip. Provider delayDuration -> delay (default 0 kept).
  Content restructured Portal > Positioner > Popup: side/align/sideOffset
  live on the Positioner (isolate z-50 per convention), the styled box is
  the Popup. Same classes on the popup. Leftover scan clean.

## Left alone

- No app consumers import the tooltip wrapper today; wrapper-only change.
  (The one styled title-attribute tooltip in node-card is native HTML, not
  this component.)

## Behavior changes

- Base UI tooltips do not open from touch by default and manage delay via
  the provider; with zero consumers nothing observable changes today.

## Verify by hand

- None today (unused wrapper). When first used: hover shows after no delay,
  positions on the requested side, flips at viewport edge.

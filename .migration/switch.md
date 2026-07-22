# switch

2026-07-22, transformation engine, direct 1:1 mapping, migrated clean.

## Changed

- apps/web/src/components/ui/switch.tsx: @radix-ui/react-switch ->
  @base-ui/react/switch (Root + Thumb, same anatomy). Class hooks renamed
  per the class mapping: data-[state=checked]/[state=unchecked] ->
  data-checked/data-unchecked (verified against SwitchRootDataAttributes).
  All other classes unchanged. Leftover scan clean.

## Left alone

- Consumers (rule-card, workflows-grid, param-editor) pass checked /
  onCheckedChange((checked) => ...) which stay source-compatible: Base UI
  adds a second eventDetails arg that existing single-arg callbacks ignore.

## Behavior changes

None expected; same controlled/uncontrolled semantics.

## Verify by hand

- Rules page: toggle a standalone rule on/off; the thumb slides, brand
  color when checked, queue picks up the change.
- Workflows grid: enable/disable a workflow via its switch.

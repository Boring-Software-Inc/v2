# Shared collection family — first migration batch

Migrated organization home, repository activity, and workflow index routes onto the semantic page contract. `Page purpose="task"` is the accepted Focus measure: one primary column, semantic page header/body ownership, and wrapped header actions at narrow widths.

## Shared contract

- `@tripwire/ui` now exposes semantic page purpose (`overview` or `task`) rather than width or spacing controls.
- Task pages own the selected Focus measure in package CSS.
- Page headers stack their action region below title/description at 30rem and narrower.
- Moderation now consumes the same task-page primitive through its family frame, preserving its selected composition.
- Organization repo-list scrolling and workflow-name clamping are product-specific app layout roles, not package escape hatches.

## Browser matrix

| Route/state | Result | Evidence |
| --- | --- | --- |
| Organization home, populated admin | Pass at 1280px and 390px | `org-home-admin-{1280,390}.{png,aria.yml}` |
| Organization home, no events | Pass; setup and connected-repo empty state remain reachable | `org-home-empty.{png,aria.yml}` |
| Activity, populated | Pass at 1280px and 390px; grouped rows and filters remain available | `activity-populated-{1280,390}.{png,aria.yml}` |
| Workflows, populated admin | Pass at 1280px and 390px; create and row actions remain available | `workflows-populated-{1280,390}.{png,aria.yml}` |
| Workflows, empty | Pass; blank/template creation paths remain available | `workflows-empty.{png,aria.yml}` |
| Workflows, member | Pass; create action is absent and rows state `Read only` | `workflows-member.{png,aria.yml}` |
| Workflows, hostile name | Pass at 320px with a 96-character unbroken name plus Unicode/emoji/RTL; no document overflow and all row controls remained inside the card | `workflows-hostile-320.png` |

All captured routes produced zero page or console errors. Reduced motion was enabled in the capture contexts. The repository navigation remains a horizontally scrollable shared-shell strip at narrow widths; that common issue is tracked separately from these family compositions.

## Verification

- `@tripwire/ui` and web typechecks passed.
- Six focused layout/activity tests passed.
- Biome passed on every edited source and CSS file.
- Changed-line lint passed against `3fbde42d`.
- Exact design-system baseline decreased to raw color `495`, spacing `660`, typography `327`; other rule counts did not rise.

# Members semantic-contract parity

## Baseline method

The fresh Glaze implementation at `HEAD` was rendered against the same disposable local data, browser build, viewport, and theme as the migrated implementation. Only the three pilot files were temporarily restored for baseline capture, then restored before after-capture.

## Visual evidence

Pixel comparison at tolerance `0` reports no changed pixels:

| Viewport | Theme | Difference |
| --- | --- | ---: |
| 390px | light | 0% |
| 390px | dark | 0% |
| 1280px | light | 0% |
| 1280px | dark | 0% |

Captures are under `.design-system/members-parity/before/` and `.design-system/members-parity/after/`.

The 390px light accessibility snapshots are byte-identical. The dark snapshots preserve the same accessible structure as well.

## Rendered contract audit

`scripts/check-ui-contract.ts` passed the personal and team-member routes at 320px, 768px, and 1280px in light and dark themes, at normal scale and simulated 200% text zoom. It verified:

- one page title and no skipped heading levels;
- the semantic typography scale;
- molecule rhythm values;
- no nested typography roles;
- no horizontal page overflow;
- no application console errors.

Reports are under `.design-system/ui-contract/`.

## Behavior and permissions

Disposable local scenarios verified:

- team admin sees Invite and member action controls;
- Invite opens the existing form;
- an empty use limit displays `Enter 1 to 1000.` and disables submission;
- Cancel closes the form without mutation;
- the member action menu opens the removal confirmation and Cancel closes it;
- a non-admin team member sees neither Invite nor member action controls;
- a personal organization does not expose Invite;
- hostile long member names and unbroken email text do not create page overflow.

State captures are under `.design-system/members-parity/states/`.

## Accessibility

- The Invite control exposes a visible 2px focus outline.
- Existing form labels remain associated with their combobox and number textboxes.
- Invalid input retains a visible message and disabled submit state.
- Member and invite collections retain their accessible list names.
- Before and after accessibility snapshots have no semantic differences for the populated personal-org state.

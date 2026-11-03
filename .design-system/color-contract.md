# Color contract

## Canonical role matrix

### Surfaces

| Tripwire role | Glaze token | Ownership |
| --- | --- | --- |
| `surface-canvas` | `--page` | application background |
| `surface-page` | `--page` | page content ground |
| `surface-container` | `--paper` | cards, panels, tables |
| `surface-raised` | `--paper` | menus, popovers, dialogs |
| `surface-inset` | `--field` | read-only wells, tracks, inset regions |
| `surface-overlay` | `--paper` with `--line` | overlay panels |
| `surface-inverse` | `--ink` | tooltips and explicitly inverse regions |

`canvas` and `page` are intentionally separate semantic roles even though Glaze currently maps both to `--page`.

### Content

| Tripwire role | Glaze token | Allowed use |
| --- | --- | --- |
| `content-primary` | `--text-1` | headings, body, labels, values |
| `content-secondary` | `--text-2` | readable descriptions, hints, metadata |
| `content-tertiary` | `--text-3` | placeholders, adjacent icons, non-required tertiary metadata only |
| `content-disabled` | `--text-disabled` | disabled controls only |
| `content-inverse` | `--text-inverse` | text on `surface-inverse` |

### Boundaries

| Tripwire role | Glaze token | Allowed use |
| --- | --- | --- |
| `boundary-subtle` | `--line-faint` | decorative row/card separation |
| `boundary-default` | `--line` | overlay edge and meaningful divider |
| `boundary-control` | `--line-control` | labeled field/control resting edge |
| `boundary-strong` | `--line-strong` | empty control edge; sole boundary indicator |
| `boundary-focus` | `--focus` | focus-visible indicator |
| `boundary-feedback-inner` | `--feedback-outline-inner` | inner feedback selection edge |
| `boundary-feedback-outer` | `--feedback-outline-outer` | opposing feedback selection edge |

A subtle/default/control boundary may sit below 3:1 only when shape, fill, and label independently identify the component. A boundary that is the only indicator uses `boundary-strong` or `boundary-focus`.

### Interaction

| Tripwire role | Glaze token | State |
| --- | --- | --- |
| `interaction-hover` | `--hover` | hover |
| `interaction-row-hover` | `--hover-row` | dense row hover |
| `interaction-selected` | `--pressed` | selected/current |
| `interaction-pressed` | `--pressed` | active press |
| `interaction-disabled` | `--field` + disabled content | disabled |

### Intent

| Intent | Mark | Text | Wash | Border |
| --- | --- | --- | --- | --- |
| success | `--ok` | `--ok-text` | `--ok-tint` | `--ok` at component-owned alpha where fill/text also identify state |
| warning | `--warn` | `--warn-text` | `--warn-tint` | `--warn` |
| danger | `--fail` | `--fail-text` | `--fail-tint` | `--fail` |
| info | `--ink-45` | `--text-1` | `--field` | `--line-strong` |

`info` stays neutral. Blue remains reserved for the existing `--agent` activity signal and is not a general informational accent.

### Product identity

Feature code selects a finite kind or activity state, never a hue. Organization avatar hues remain generated content inside the Dither Kit image. Product/client logos retain their source colors as documented identity exceptions.

## Allowed foreground/background pairs

Measured in the running Glaze application using `.design-system/tmp/color-contract-evidence.mjs`:

| Pair | Light | Dark | Contract |
| --- | ---: | ---: | --- |
| primary on page | 11.64:1 | 17.77:1 | normal text pass |
| primary on container | 11.90:1 | 14.98:1 | normal text pass |
| primary on inset | 10.86:1 | 13.04:1 | normal text pass |
| secondary on page | 5.43:1 | 6.71:1 | normal text pass |
| secondary on container | 5.49:1 | 6.21:1 | normal text pass |
| secondary on inset | 5.26:1 | 5.70:1 | normal text pass |
| tertiary on container | 3.25:1 | 4.11:1 | non-text/large only; never required prose |
| inverse on inverse | 20.38:1 | 18.52:1 | normal text pass |
| success text on container | 5.66:1 | 9.23:1 | normal text pass |
| success text on success wash | 4.99:1 | 8.91:1 | normal text pass |
| warning text on container | 5.93:1 | 9.90:1 | normal text pass |
| warning text on warning wash | 5.24:1 | 9.61:1 | normal text pass |
| danger text on container | 5.88:1 | 7.17:1 | normal text pass |
| danger text on danger wash | 5.01:1 | 7.37:1 | normal text pass |
| focus on page | 11.64:1 | 17.77:1 | non-text pass |
| strong boundary on container | 3.25:1 | 4.11:1 | non-text pass |

## State ownership

- Components own complete foreground/background/boundary combinations.
- Feature code supplies semantic state only: `tone`, `status`, `invalid`, `selected`, `open`, `disabled`, or `pending` where the component supports it.
- Empty custom properties are contract failures.
- Unsupported state combinations are type/API errors or explicit no-op states, never accidental token composition.
- Feedback selection uses a dual ink/paper ring because it crosses arbitrary content; it does not reuse the ordinary focus token.

## Exceptions

- Source colors in agent/client logos.
- Mascot and game illustration palettes.
- Forge marks where brand recognition requires source color.
- Captured media/content colors.

Exceptions cannot be reused as application chrome.

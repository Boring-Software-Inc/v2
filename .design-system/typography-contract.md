# Typography contract

## Closed public vocabulary

| Component | Default element | Glaze role | Use |
| --- | --- | --- | --- |
| `PageTitle` | `h1` | `type-title` | exactly one page-level heading |
| `SectionHeading` | `h2` | `type-heading` | named page region |
| `Subheading` | `h3` | `type-heading-sm` | one subordinate region inside a section |
| `Body` | `p` | `type-body` | primary explanatory prose |
| `SupportingText` | `p` | `type-body-sm` | descriptions and helper prose |
| `Label` | `span` | `type-label` | compact non-form labels owned by a molecule |
| `Caption` | `span` | `type-caption` | timestamps, counts, and tertiary metadata |
| `CodeText` | `code` | `type-code` plus mono semantics | inline IDs, paths, rule IDs, commands |
| `DataValue` | `span` | inherited role plus tabular figures | changing counts, durations, and amounts |

There is no generic `Text`, size, weight, leading, tracking, or visual class-name API.

## Heading rules

- `PageTitle` always renders `h1` and carries `data-type-role="page-title"`.
- `SectionHeading` defaults to `h2`; its only semantic override is level 3 for a section nested under a component that already owns an `h2`.
- `Subheading` defaults to `h3`; its only semantic override is level 4 for the corresponding nested case.
- Visual roles never change because an element level changes.
- Dialog, sheet, popover, card, item, field, table, and empty-state titles remain owned by those primitives. They are not page hierarchy roles and do not consume a page heading depth unless they render in normal document flow as a named section.

## Prose rules

- `Body` is the only primary prose role.
- `SupportingText` is the only secondary prose role.
- Both allow `p` or `span` because existing compositions need block and inline prose; this is semantic structure, not a visual variant.
- Long prose uses the component-owned measure. Callers do not choose a max width.

## Compact text rules

- `Label` is for app-owned molecules such as page metadata, action rows, and compact navigation. Form labels, menu items, buttons, table cells, badges, and item titles retain their primitive-owned typography.
- `Caption` is metadata only. It is not a substitute for low-contrast body text.
- `text-3` is allowed only for placeholders, adjacent icons, and tertiary metadata whose content remains available through a primary label. Sentences use content primary or secondary.

## Code and data rules

- `CodeText` is restricted to rule IDs, paths, keys, commands, and inline code.
- Code blocks remain owned by `CodeBlock`, `JsonView`, and `LogViewer`; their block metrics are not caller-selectable.
- Compact table identifiers remain owned by the table/item primitive context.
- `DataValue` adds tabular figures but inherits its semantic text role. It does not choose size.

## Legacy utility mapping

| Legacy utility | Destination |
| --- | --- |
| `type-title` | `PageTitle` |
| `type-heading` | `SectionHeading`; component title exception where already owned |
| `type-heading-sm` | `Subheading`; card/item/empty/component title exception |
| `type-body` | `Body`; primitive-owned prose exception |
| `type-body-sm` | `SupportingText`; primitive-owned description exception |
| `type-label` | `Label`; control/menu/table/item primitive exception |
| `type-label-sm` | compact primitive-owned label; no page-level size choice |
| `type-label-lg` | large control-owned label only |
| `type-caption` | `Caption` |
| `type-code` | `CodeText` |
| `type-code-sm`, `type-code-xs` | compact component-owned code context |
| `type-code-block` | code/log/json primitive only |
| `data`, `tabular-nums` | `DataValue` or component-owned changing value |

## Responsive behavior

- The initial Glaze page title remains `28px/1.2`; the inventory does not justify inventing a larger endpoint yet.
- Heading, prose, labels, captions, and controls remain fixed optical sizes.
- Container-aware `clamp()` is permitted only after a real component demonstrates two existing intended display sizes. The initial implementation therefore preserves Glaze exactly instead of adding speculative fluid type.
- Text wraps naturally, headings balance, descriptions use pretty wrapping where the owning molecule calls for it, and identifiers use overflow wrapping.

## Accessibility

- Heading order follows document structure, independent of visual style.
- Text remains legible at 200% zoom without clipping.
- Inputs remain at a mobile-safe rendered size through the existing control contract.
- `Caption` and tertiary text cannot carry required instructions or errors.

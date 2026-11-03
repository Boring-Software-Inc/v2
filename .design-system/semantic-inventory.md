# Semantic UI inventory

Generated from `apps/web/src` on branch `semantic-ui-contract` before semantic migration.

## Typography roles

| Existing utility | Occurrences | Proposed semantic destination |
| --- | ---: | --- |
| `type-body-sm` | 159 | `SupportingText`, compact component-owned descriptions |
| `type-label` | 100 | `Label`, component-owned row/control text |
| `type-caption` | 89 | `Caption` |
| `type-label-sm` | 48 | compact component-owned `Label` |
| `type-body` | 44 | `Body` |
| `type-title` | 29 | `PageTitle` |
| `type-heading-sm` | 22 | `Subheading` or component-owned title |
| `type-code-sm` | 16 | `CodeText` |
| `type-code-block` | 13 | `CodeText` block mode |
| `type-label-lg` | 11 | control-owned label; not a page role |
| `type-heading` | 10 | `SectionHeading` or dialog-owned title |
| `type-code-xs` | 10 | compact `CodeText` |
| `type-code` | 2 | `CodeText` |

The inventory supports three heading depths, two prose roles, one compact label role, one metadata role, and semantic code/data roles. Control-specific typography remains owned by controls.

## Color roles

Most common feature-level classes:

| Existing class | Occurrences | Contract destination |
| --- | ---: | --- |
| `text-text-2` | 356 | content secondary; owned by semantic text/component |
| `text-text-1` | 250 | content primary; owned by semantic text/component |
| `border-line-faint` | 92 | boundary subtle |
| `text-text-3` | 52 | content tertiary, restricted to icons/placeholders/meta |
| `text-text-disabled` | 44 | content disabled |
| `text-fail-text` | 44 | danger text |
| `bg-paper` | 41 | surface raised/page depending context |
| `bg-pressed` | 36 | interaction pressed/selected |
| `bg-hover` | 33 | interaction hover |
| `bg-page` | 25 | surface page |
| `bg-field` | 23 | surface inset |

There are 29 raw-color or raw-palette occurrences in feature/routes. They split into:

- legacy run-chain visual values that should map to contract roles;
- product-logo source colors, which are documented identity exceptions;
- mascot/game rendering colors, which are illustration exceptions rather than application chrome;
- tests asserting those intentional identity values.

One direct raw application value remains in `components/runs/run-chain.tsx`; the superseded run-chain contains a cluster of hardcoded dark-theme values and is the highest-priority color cleanup family after the pilot.

## Spacing

`1593` raw margin, padding, gap, or `space-*` utilities occur in component/route TSX. This confirms that a global immediate ban would be impractical. Enforcement must ratchet changed lines and move repeated structures into molecules before shrinking the legacy allowlist.

## Page shells

Observed shells:

- `DashboardLayout` — authenticated application chrome and navigation.
- `RepoLayout` — repository-scoped route composition.
- `SettingsFrame` — settings navigation plus content column.
- public centered shells in login, invite, OAuth, queue, and not-found flows.
- specialized full-height workflow editor canvas.
- public run-detail shell nested in `DashboardLayout`.

The workflow editor remains a specialized composition; its canvas dimensions should not drive generic page molecules.

## Repeated molecules already present

- `SettingsHeader`, `SettingsSection`, `SettingsCard` in `components/settings/settings-frame.tsx`.
- `ItemGroup`, `ItemContent`, and `ItemActions` across organization, activity, rule, admin, and workflow surfaces.
- `EmptyHeader`, `EmptyTitle`, and `EmptyDescription` across not-found, run, workflow, rule, and response states.
- `Field`, `FieldLabel`, and `FieldError` across forms.
- Table families across admin and analytics surfaces.
- Dashboard header/rail controls and scope switchers.

These existing families should be adapted, not duplicated.

## Representative surfaces

| Surface | File size | Contract coverage |
| --- | ---: | --- |
| Organization members | 636 lines | page/section headers, collection, item rows, form, validation, permissions, dialogs, empty/loading/error |
| Rules | 514 lines | dashboard shell, tabs, forms, empty/error states, lists |
| Analytics | 217 lines | title, metrics/data, filters, chart/table regions |
| Workflow editor page | 236 lines | specialized canvas, full-height shell, loading/error |
| Login | 39 lines | public shell, title/body, actions, responsive layout |

`/$org/settings/members` remains the pilot because it covers the broadest reusable contract without specialized canvas geometry.

## Inventory commands

- Type counts: `rg -o 'type-(...)' apps/web/src --glob '*.tsx' | sort | uniq -c`.
- Color counts: `rg -o '(text|bg|border|outline|ring)-(...)' apps/web/src --glob '*.tsx'`.
- Spacing count: `rg -o '(m...|p...|gap|space-[xy])-[0-9]+' apps/web/src/components apps/web/src/routes --glob '*.tsx' | wc -l`.
- Raw color scan: `rg '(#[0-9a-fA-F]{3,8}|oklch\(|rgb\(|palette utility)' apps/web/src/components apps/web/src/routes`.

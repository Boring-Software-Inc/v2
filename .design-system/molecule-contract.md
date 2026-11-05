# Layout and molecule contract

## Admission rule

A shared molecule must have at least two real call sites with the same structural job. Shared APIs encode context; they do not expose `gap`, `padding`, `margin`, arbitrary `size`, or visual `className` props. A one-off composition stays in its feature.

## Wave-one molecules

### `Page`

Use for a normal content page inside an existing route shell.

- Owns the content column, inline gutter, maximum width, and vertical page rhythm.
- Does not own dashboard navigation, data fetching, or route state.
- Children are `PageHeader` followed by `PageBody`.
- Responsive gutters are intrinsic to the component.

Proven by settings pages, analytics, rules, workflows grid, activity, and moderation content regions.

### `PageHeader`

- Owns one `PageTitle`, optional supporting description, and optional actions.
- Actions wrap below content when their intrinsic width no longer fits.
- Does not accept spacing or alignment variants.
- Condensed/sticky behavior is deferred until two active Glaze surfaces require the same behavior.

Proven by `SettingsHeader` and repeated page-title/action rows in analytics, rules, workflows, and review pages.

### `PageBody`

- Owns the gap between top-level page sections.
- Does not style arbitrary descendants.

### `Section`

- Owns `aria-labelledby`, scroll margin, vertical grouping, and separation from sibling sections.
- Children are `SectionHeader` and `SectionBody`.
- Optional actions belong to `SectionActions` inside the header.

Proven by `SettingsSection`, analytics metric regions, rules groups, and workflow sections.

### `SectionHeader`

- Owns `SectionHeading` and optional actions/description.
- Heading/action alignment changes at intrinsic fit, not a caller-selected breakpoint.

### `SectionBody`

- Owns the internal section rhythm.
- Does not imply a card surface.

### `ActionRow`

- Owns wrapping, button order, and the relationship between secondary and primary actions.
- Primary action is last in reading order.
- Narrow layouts stack or wrap without caller-provided gaps.

Proven by invite creation, dialogs, settings mutations, and workflow forms.

### `FormSection`

- Owns related field grouping, description, error region, and action placement.
- Uses existing `Field` primitives; it does not replace them.

Proven by organization/settings forms and workflow property forms.

### `DataRegion`

- Owns the relationship between loading, error, empty, no-results, and populated content.
- Reuses `Collection`, `Skeleton`, and `Empty` rather than creating a parallel state system.
- Receives state values/content, not a fetch function.

Proven by members, invite links, rules, workflows, runs, and analytics.

## Existing primitive-owned molecules

Do not duplicate these:

- `Card`/`CardHeader`/`CardContent`/`CardFooter`.
- `Item`/`ItemGroup`/`ItemContent`/`ItemActions`.
- `Empty` family.
- `Field` family.
- `Table` family.
- `Toolbar` and filter-bar families.

App molecules compose these primitives and remove feature-level geometry decisions.

## Deferred

- Generic `Stack`, `Inline`, `Grid`, or `Box`: rejected because the caller still designs spacing.
- Generic `CardBody`: existing Card owns this job.
- `FieldGroup`: defer until form inventory shows a repeated structure not already covered by `Field` and `FormSection`.
- `ListSection` and `DetailGroup`: defer until two call sites prove contracts distinct from `Section` plus existing Item/DataList primitives.
- `EmptyRegion`: existing Empty and DataRegion own this.
- Workflow canvas/toolbox layout: specialized and excluded from generic molecules.

## Responsive rules

- Components reflow where their content stops fitting; public APIs do not expose breakpoint names.
- Mobile is a distinct arrangement, not desktop spacing compressed.
- Page/section actions remain reachable and do not clip.
- Logical properties are used for direction-aware spacing.
- Text containers allow shrink with `min-width: 0` and wrap where content can grow.

## Spacing ownership

- `Page`: page gutters and top-level region spacing.
- `PageHeader`: title/description/actions relationship.
- `PageBody`: top-level section rhythm.
- `Section`: header/body and sibling-section relationship.
- `FormSection`: field grouping.
- `ActionRow`: action grouping.
- Primitive internals remain owned by the primitive.

No feature call site chooses these values.

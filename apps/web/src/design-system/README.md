# Tripwire semantic UI contract

`@tripwire/ui` owns the application-agnostic semantic contract. Feature code keeps importing the stable `#/design-system/*` and `#/components/layouts/*` facades, while those facades delegate to the package. Glaze remains the web app's implementation boundary for primitive components and supplies the custom properties consumed by the package CSS.

## Typography

| Role | Element | Purpose |
| --- | --- | --- |
| `PageTitle` | `h1` | one title per page |
| `SectionHeading` | `h2` by default | named page region |
| `Subheading` | `h3` by default | one nested region |
| `Body` | `p` | primary prose |
| `SupportingText` | `p` | descriptions and helper prose |
| `Label` | `span` | compact molecule-owned label |
| `Caption` | `span` | timestamps, counts, tertiary metadata |
| `CodeText` | `code` | IDs, paths, rule IDs, commands |
| `DataValue` | `span` | changing numeric values |

No role accepts visual size, weight, line-height, tracking, color, or `className` props. Heading-level overrides are finite and do not change visual style.

Page hierarchy is limited to `PageTitle → SectionHeading → Subheading`. Dialog, field, card, item, table, and empty-state titles remain owned by those primitives.

## Layout

Normal content pages compose:

```tsx
<Page>
  <PageHeader title="…" actions={…} />
  <PageBody>
    <Section id="…">
      <SectionHeader title="…" />
      <SectionBody>…</SectionBody>
    </Section>
  </PageBody>
</Page>
```

The package molecules own gutters, padding, gaps, wrapping, and responsive reflow. Feature code does not pass spacing props. Specialized canvas and game layouts stay feature-owned. Member and invite collection-row geometry remains app-owned because it encodes product-specific action placement.

## Color

Feature code supplies semantic state, never a color. The package contract owns:

- surfaces: canvas, page, container, raised, inset, overlay, inverse;
- content: primary, secondary, tertiary, disabled, inverse;
- boundaries: subtle, default, control, strong, focus;
- interaction: hover, selected, pressed, disabled;
- intent: success, warning, danger, info.

`content-tertiary` is not required prose. Blue remains reserved for agent activity. Source logo and illustration colors are exceptions and cannot be reused as application chrome.

The package CSS intentionally maps these roles to custom properties supplied by the consuming implementation. In web, Glaze defines the current `--page`, `--paper`, `--text-*`, state, typography, spacing, control, and radius values before the package styles load. Moving Glaze components into the package is deferred.

## States

Each interactive primitive supports a finite subset of rest, hover, focus-visible, pressed, selected/current, open, disabled, invalid, pending, and reduced-motion states. Supported states must produce the declared visible effect; unsupported combinations are not composed ad hoc.

Focus and sole selection boundaries meet 3:1 non-text contrast. The feedback picker uses a dual-tone outline because it crosses arbitrary page content.

## Responsive and accessibility rules

- Break where content stops fitting, not at device-name breakpoints.
- Preserve source order and logical heading order.
- Actions wrap without clipping and stay reachable.
- Text survives 200% zoom.
- Required instructions and errors never use tertiary or disabled text.
- Keyboard focus remains visible in light and dark themes.
- Reduced-motion behavior remains available for every animated component.

## Ownership

- `@tripwire/ui`: semantic typography, generic layout molecules, and semantic typography/color/layout CSS.
- `src/design-system`: stable feature facade, Glaze root/provider composition, and implementation-bound state metadata.
- `src/components/layouts`: compatibility facades plus app-specific structures such as member/invite collection rows.
- feature components: data, permissions, domain copy, and semantic state.

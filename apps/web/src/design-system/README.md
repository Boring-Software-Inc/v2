# Tripwire web design-system boundary

The web app consumes `@tripwire/ui` directly and adds only the product-shell
contracts that cannot live in an application-agnostic package. ui-sdk remains an
implementation detail of `@tripwire/ui`; it is not imported from application
code.

## Ownership

| Layer | Owns | Must not own |
| --- | --- | --- |
| `@tripwire/ui` | Glaze tokens and recipes, semantic primitives, generic molecules, accessibility, behavior, agent exposure | routes, auth, data fetching, organization or repository concepts |
| `src/design-system` | root providers, overlay host, agent bridge, shell-only measured geometry | duplicate primitives, feature facades, visual escape hatches |
| `src/components/layouts` | named product molecules such as repository switching, account access, Search, and navigation | generic `Button` variants for product roles |
| feature components | domain data, permissions, copy, and approved composition | raw visual values or ui-sdk internals |
| routes | loading, errors, metadata, SEO, and server composition | direct visual-control composition |

The dependency direction is:

```text
ui-sdk behavior
  -> @tripwire/ui Glaze contracts
    -> named web molecules
      -> feature components
        -> server routes
```

## Root composition

`root.tsx` installs the complete package-global stylesheet set, the web shell
layout contract, overlay host, and agent providers. The `tripwire` body class
scopes the system. Named product molecules may own colocated CSS for behavior
that is not a generic package primitive, and third-party canvases may import
their required library CSS. Routes do not reconstruct providers or package
global styles locally.

## Typography

Use the semantic roles exported by `@tripwire/ui/typography`:

| Role | Default element | Purpose |
| --- | --- | --- |
| `PageTitle` | `h1` | one page title |
| `SectionHeading` | `h2` | named page region |
| `Subheading` | `h3` | nested region |
| `Body` | `p` | primary prose |
| `SupportingText` | `p` | description or helper copy |
| `Label` | `span` | compact molecule-owned label |
| `Caption` | `span` | count, timestamp, tertiary metadata |
| `CodeText` | `code` | ID, path, rule ID, command |
| `DataValue` | `span` | changing numeric value |

The roles do not accept visual size, weight, line-height, tracking, color, or
`className` overrides. Page hierarchy is `PageTitle -> SectionHeading ->
Subheading`; component titles remain owned by their primitive.

## Layout and spacing

Normal content pages compose `Page`, `PageHeader`, `PageBody`, `Section`,
`SectionHeader`, and `SectionBody`. These molecules own gutters, gaps, wrapping,
and responsive reflow. Features choose the composition; they do not tune it.

`layout-contract.css` is limited to named web molecules and measurable shell
geometry. A selector must have a corresponding `data-layout-role` owner. Raw
spacing added to compensate for a misaligned child is not a contract: fix the
child's owned geometry instead.

## States and motion

Interactive components expose only their declared states: rest, hover,
focus-visible, pressed, selected or current, open, disabled, invalid, pending,
and reduced motion. State changes use `UI_MOTION`; predetermined shell geometry
may use the equivalent CSS duration and easing tokens when browser-native,
interruptible interpolation is more reliable.

Destructive actions use the shared confirmation contract. Human and agent
callers receive the same boundary, and feature code cannot disable it.

The browser agent may open and close Combobox popups. The product bridge blocks
query, selection, and clear actions. In Settings, a selection can save a
preference immediately.

## Validation

Before closing a web design-system wave:

1. run package and web typechecks;
2. run focused behavior tests;
3. run `scripts/check-component-states.tsx` in light and dark;
4. run `scripts/check-ui-contract.ts` against narrow, intermediate, and desktop
   widths at normal and 200% text size;
5. inspect authenticated product routes in both shell states;
6. receive a fresh independent read-only visual audit.

Root [`DESIGN.md`](../../../../DESIGN.md) defines the complete design language.
The migration execution record lives in
[`docs/research/ui-sdk-migration-todo.md`](../../../../docs/research/ui-sdk-migration-todo.md).

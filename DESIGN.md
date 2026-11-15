# Tripwire design system

Tripwire is a dense, quiet operations interface for contribution governance. It should feel deliberate under pressure: compact without becoming cramped, expressive without decorative noise, and consistent enough that a product change cannot accidentally invent a new visual language.

The system keeps **Glaze as the visual language** and uses **ui-sdk for framework behavior**. Replacing behavior infrastructure does not authorize visual redesign.

## The stack

Every interface follows one direction:

```text
native semantics
  -> ui-sdk behavior
    -> @tripwire/ui styled controls
      -> named product molecules
        -> feature components
          -> server routes
```

- Native elements own meaning whenever the platform already provides it.
- ui-sdk owns interaction models such as selection, focus movement, popups, transitions, and agent-readable component state.
- `@tripwire/ui` owns reusable styled controls and semantic contracts. It does not fetch data or know application routes.
- Named product molecules own recognizable Tripwire controls such as the sidebar search launcher, workspace switcher, repository switcher, and account trigger.
- Features own data, permissions, domain copy, and composition. Routes keep server work, metadata, and SEO outside client islands.

Do not flatten product molecules into a generic `Button` variant. A control may render a `<button>` without being an action-button appearance.

## Visual language

Glaze is built from ink, paper, and restrained state:

- neutral surfaces carry hierarchy;
- color communicates status or intent, never decoration;
- depth comes from nested surface contrast and subtle boundaries, not shadows;
- controls are compact, with comfortable hit areas and legible content;
- corners follow the existing Glaze radius scale;
- motion is short, functional, and removed when reduced motion is requested;
- Phosphor icons use the regular weight unless a source mark requires its original artwork.

The canonical scale is a 4px grid. Standard controls are 32px tall and collection rows are 36px tall. Exceptions must be named, documented, and tested; arbitrary values in feature code are not exceptions.

Shape belongs to the shared primitive. One-line buttons, inputs, and selects
use the pill corner; textareas use the 10px overlay corner at every row count.
Keep these rules separate even when controls share colors or padding. Feature
code composes the controls without overriding their corners. Add a rendered
component-state assertion whenever a shared shape contract is introduced.

State fades and entrances use the 160ms house ease-out. Elements that remain on
screen while changing position use the 180ms position curve. Coordinated parts
consume `UI_MOTION` from `@tripwire/ui/motion`; feature code does not invent
durations or easing arrays.

## Typography

Typography is semantic, not a styling escape hatch. Use the roles exposed by `@tripwire/ui`:

- `PageTitle`
- `SectionHeading`
- `Subheading`
- `Body`
- `SupportingText`
- `Label`
- `Caption`
- `CodeText`
- `DataValue`

Roles do not accept visual size, weight, line-height, tracking, color, or `className` overrides. The page hierarchy is `PageTitle -> SectionHeading -> Subheading`; component primitives own their internal titles.

## Spacing and composition

Layout molecules own their internal spacing. Features select a composition; they do not tune its gaps.

Normal content pages compose `Page`, `PageHeader`, `PageBody`, `Section`, `SectionHeader`, and `SectionBody`. Product-specific rows may own their action placement, but still consume semantic spacing and control tokens.

Avoid:

- nested cards that repeat the same boundary and surface;
- one-off padding added to correct a child whose geometry is wrong;
- device-name breakpoints instead of content-driven reflow;
- visually centered content whose actual bounding box is offset;
- text or icons positioned with compensating transforms.

## Icon rhythm

Icons are part of the reading system, not decoration. Their visible geometry must remain stable across state changes.

Sidebar navigation uses one owned icon slot in both expanded and collapsed modes:

- visible SVG: `--icon-lg` (16px) in both modes;
- expanded optical plate: 18px square;
- collapsed hover plate: 26px by 22px;
- SVG center and plate center may differ by no more than 0.5px;
- collapsing the sidebar changes surrounding affordance, never icon legibility.

The same principle applies elsewhere: loading, selected, open, and responsive states may change treatment without silently changing the icon's perceived size or alignment.

## Interaction states

Interactive primitives expose only the states they intentionally support: rest, hover, focus-visible, pressed, selected or current, open, disabled, invalid, pending, and reduced motion.

Every supported state must have a visible, accessible effect in light and dark themes. Unsupported state combinations are not assembled in feature code. Destructive actions require destructive semantics and the shared confirmation flow; hover may remain neutral when intent color on the label and icon is clearer.

## Agent legibility

The component tree must describe the product. Prefer named molecules and finite props over loose class composition. Agent-facing metadata belongs at the primitive or molecule boundary so browser agents can understand the same state a person sees.

Browser-agent permissions do not come from a control being visible to a person. Keep credential grants, access changes, and moderation decisions human-only unless the feature explicitly authorizes an agent workflow. Use the agent boundary around the actionable controls and the overlay visibility prop for portaled confirmations. Verify that the registered tools cannot query or invoke hidden actions, and that a person can still use them with the keyboard. Server permissions remain the source of authorization.

A correct interface should be difficult to misuse:

- finite variants instead of arbitrary appearance strings;
- semantic tokens instead of raw color, spacing, typography, radius, or motion values;
- product molecules instead of duplicated arrangements of generic controls;
- schemas or unions for cross-boundary state;
- executable layout and interaction checks for invariants that can regress.

## Validation

Design-system work is not complete when it compiles. Validate:

1. semantic structure and keyboard behavior;
2. token and boundary lint;
3. light and dark themes;
4. reduced motion;
5. narrow and wide content layouts;
6. optical geometry, including icon and text alignment;
7. a fresh independent read-only visual audit.

`bun run check:component-states` is the executable state and geometry matrix. Add a measured invariant there when a regression can be expressed numerically. Unit tests verify ownership and finite APIs; browser measurements verify rendered geometry.

## Canonical references

- [`spec.md`](spec.md): product source of truth.
- [`docs/research/ui-sdk-migration-repair-spec.md`](docs/research/ui-sdk-migration-repair-spec.md): migration architecture, preservation policy, route inventory, phases, and close gates.
- [Route verification](docs/research/ui-sdk-migration-route-verification.md): confirmed route states and open checks.
- [Audit score register](docs/research/ui-sdk-migration-audit-scores.md): independent scored rounds and remaining gaps.
- [`apps/web/src/design-system/README.md`](apps/web/src/design-system/README.md): semantic UI contract and ownership map.
- [`.agents/skills/glaze/SKILL.md`](.agents/skills/glaze/SKILL.md): implementation rules for the Glaze visual system.
- [`.claude/skills/tripwire-design/SKILL.md`](.claude/skills/tripwire-design/SKILL.md): Tripwire-specific product aesthetic.
- [`.claude/rules/frontend.md`](.claude/rules/frontend.md): frontend engineering constraints.

When these documents disagree, `spec.md` wins. Migration work does not widen product scope.

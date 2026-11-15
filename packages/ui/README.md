# `@tripwire/ui`

Tripwire's application-agnostic design system. It combines ui-sdk behavior,
Tripwire semantics, and a finite visual language without exposing implementation
escape hatches to product code.

## Ownership

The interface is built in five layers:

1. Native HTML owns inherent meaning and form behavior.
2. ui-sdk owns headless interaction, focus, selection, dismissal, and agent
   exposure.
3. `@tripwire/ui` owns styled controls, semantic tokens, states, and generic
   molecules.
4. `apps/web/src/components` owns named product patterns such as the account
   menu, repository picker, and search launcher.
5. Features bind data and routes retain SEO ownership.

ui-sdk is an internal dependency of this package. Application code imports
`@tripwire/ui`, never `@ui-sdk/*`.

## Public contract

Consumers choose finite semantics rather than visual values. Public components
do not accept arbitrary `className`, `style`, color, spacing, weight, leading,
render, slot, or unstyled props.

The control-size ladder is fixed:

| Size | Height | Use |
| --- | ---: | --- |
| `small` | 26px | Dense row and toolbar actions |
| `medium` | 32px | Default action and form controls |
| `large` | 36px | Prominent or spacious controls |

Typography uses named roles from `@tripwire/ui/typography`. Layout uses named
generic molecules from `@tripwire/ui/layouts`. Product location is never a
generic component variant: a sidebar account entry is a named product molecule,
not a `Button` variant.

## Styles

- `styles/tripwire.css`: complete token and base-style entrypoint.
- `styles/color.css`: semantic color roles.
- `styles/typography.css`: semantic type roles.
- `styles/layout.css`: generic composition contracts.
- `styles/components.css`: control anatomy and interaction states.
- `styles/presentational.css`: non-interactive visual components.

Tokens define the available spacing, sizing, typography, radius, surface, and
motion vocabulary. A missing token is a design decision, not permission to add a
raw value at a call site.

## Component admission

A component is ready for the shared system only when it has:

- stable anatomy across every proven consumer;
- a finite semantic API with no styling escape hatch;
- keyboard and accessible-name behavior;
- explicit rest, hover, pressed, focus-visible, disabled, pending, and open
  states where applicable;
- light, dark, reduced-motion, narrow, and wide verification;
- agent exposure and confirmation behavior for mutating actions;
- focused tests for its semantic contract;
- measured parity with the approved Tripwire baseline.

One-off product composition stays local until multiple real consumers prove a
shared contract.

## Choose controls by intent

| Need | Use |
| --- | --- |
| Perform an action | `Button` with `onAction`. Use primary for the leading action, secondary for a supporting action, and ghost for a quiet action. |
| Navigate somewhere | `ActionLink` with an `href`. It retains native link semantics and the shared control sizes. |
| Confirm a destructive action | `Button variant="destructive"` with `confirmation` and `onAction`. Use `DestructiveDialog` when an action requires typed confirmation. |
| Open a destructive workflow | DestructiveDialogLauncher opens an existing confirmation workflow. The workflow owns the mutation and its confirmation. |
| Collect a short form or ask for a choice | `Dialog` with a title and a declared action. Rejected actions keep the dialog open and announce the error above the footer. |
| Group related actions with one keyboard stop | `Toolbar` with a descriptive `ariaLabel`, an orientation, and a list of named actions, links, or separators. |

For example, this file toolbar gives Refresh and Help one keyboard stop while
keeping Help a native link.

```tsx
import { Toolbar } from "@tripwire/ui/toolbar";

<Toolbar
  ariaLabel="File actions"
  items={[
    { type: "action", value: "refresh", label: "Refresh", onAction: refresh },
    { type: "separator", value: "help-divider" },
    { type: "link", value: "help", label: "Help", href: "#file-help" },
  ]}
/>;
```

## Verification

Run the package tests, UI boundary check, web typecheck, and component-state
matrix before considering a primitive wave complete. Each migration wave also
requires an independent visual audit using the scoring rubric in
`docs/research/ui-sdk-migration-repair-spec.md`.

Run `bun x playwright-core install chromium` before running the browser tests.
Playwright resolves the installed browser automatically. Set
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` only when testing a different executable.

The public component catalog and readiness ledger live in
[`COMPONENTS.md`](./COMPONENTS.md). Public API changes must update that catalog
in the same change.

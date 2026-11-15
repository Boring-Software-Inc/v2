# ui-sdk migration repair specification

Status: approved by Grim on 2026-11-12

Branch: `codex/ui-sdk-poc`

Baseline commit: `50be1d16d4c6717a6683d2db24487af5c70aa17e`

POC starting commit: `f4c34df580d8b20aa51df59069888cd945ab4557`

This specification is subordinate to `spec.md`, `AGENTS.md`, and the scoped
agent rules. It authorizes no product scope beyond repairing and completing the
ui-sdk design-system migration.

## Outcome

Tripwire has one enforceable UI system:

- ui-sdk supplies headless behavior and the agent bridge;
- `@tripwire/ui` supplies application-agnostic Tripwire controls and semantic
  styling contracts;
- `apps/web/src/components` supplies named product patterns and molecules;
- feature components bind product data and behavior;
- route modules stay thin and retain SEO ownership.

The migration must preserve the approved Tripwire UI and behavior while making
the correct architectural path the easiest path for humans and agents. Removing
Base UI and Glaze internals is intentional. The visual and interaction changes
that happened as a side effect are not.

## Current evidence

Measured in the POC worktree on 2026-11-12:

- 56 route modules exist under `apps/web/src/routes`;
- 253 web source files import `@tripwire/ui`;
- 22 `packages/ui` source files import ui-sdk internally;
- no app or non-UI package imports ui-sdk directly;
- three route modules import `@tripwire/ui` controls directly:
  `oauth.popup-callback.tsx`, `oauth.waitlist.tsx`, and `queue.tsx`;
- 371 files differed from the POC starting commit before this specification and
  the governance updates were added.

The broad dependency direction is correct, but dependency direction alone does
not establish component ownership, behavior parity, or visual parity.

## User-reported regressions that define the pilot

The first repair slice covers the shell and overlays because it crosses the
largest number of component families and contains the clearest approved
references.

1. Sidebar account trigger padding, alignment, and collapsed geometry changed.
2. Sidebar search launcher text and shortcut layout changed.
3. Repository picker trigger geometry changed.
4. Sidebar logo collapse transition and replacement icon behavior changed.
5. Connect repositories buttons and dialog composition changed.
6. Settings control gaps and settings tabs changed.
7. Member-row trailing metadata such as `You` and `Admin` lost its layout.
8. Connection and account action rows stopped composing horizontally.
9. Workspace rows stopped behaving as clickable rows.
10. Destructive confirmation lost its backdrop and presence motion.
11. Account menu and organization chooser composition changed.

This list identifies the pilot. It is not a substitute for the full inventory
or permission to ignore unreported regressions.

## Architecture contract

### Layer 1: native semantics

HTML owns the element's inherent meaning, keyboard behavior, form behavior, and
ARIA relationship. Rendering a `<button>` does not make a product control the
generic Tripwire `Button`.

### Layer 2: behavior primitives

ui-sdk owns headless behavior: focus management, selection, dismissal,
layering, keyboard models, change details, and agent exposure. ui-sdk remains an
implementation detail of `@tripwire/ui`.

### Layer 3: styled controls

`@tripwire/ui` owns application-agnostic Tripwire anatomy, states, tokens,
motion, and finite semantic APIs. Public contracts must not expose raw ui-sdk
state or escape hatches such as `className`, `style`, `render`, `asChild`,
`slotProps`, `classes`, or `unstyled`.

### Layer 4: product patterns and molecules

A named composition owns contextual anatomy and geometry. Proven generic
molecules without application data may live in `@tripwire/ui`. Product data,
navigation, queries, auth, and domain behavior keep the composition in
`apps/web/src/components`.

Examples:

| Product control | Native root | Behavior owner | Styled owner | Product owner |
| --- | --- | --- | --- | --- |
| Sidebar account entry | `button` | Popover trigger | Sidebar trigger shell | `AccountMenu` |
| Repository picker | `button` and listbox semantics | Select or command behavior | Sidebar picker trigger | Scope switcher |
| Search launcher | `button` | Dialog and command behavior | Search launcher shell | Command palette |
| Connect repositories | `button`, dialog, fields | Dialog and selection behavior | Shared controls | Forge dialog |
| Workspace switcher | row links or buttons | Selection behavior | Interactive row | Account workspace list |

### Layer 5: features and routes

Feature components bind server state and domain behavior. Routes bind the page
component, pending component, and SEO. Direct visual-control imports in route
modules must reach zero, except provider wiring in `__root.tsx` when a provider
cannot live lower.

## Variant rule

A shared-control prop is valid only when every usage retains the same anatomy,
behavior, interaction contract, and accessibility contract.

Valid semantic axes include:

- emphasis;
- intent;
- size;
- disabled and pending state;
- icon placement.

Product locations and roles are not Button variants. The following require
named controls or molecules instead of enum cases:

- account menu trigger;
- repository picker trigger;
- search launcher;
- sidebar navigation item;
- workspace switcher;
- settings back control.

A one-off stays local until real consumers prove reuse. Parent geometry stays
with the molecule or container.

## Preservation policy

Every existing approved surface is `preserve` unless this specification names
it as `redesign`. No surfaces are marked `redesign` in this draft.

`preserve` includes:

- component anatomy and reading order;
- spacing, sizing, type, icon geometry, and optical alignment;
- surface hierarchy, borders, elevation, and radius;
- light and dark theme contrast relationships;
- hover, pressed, selected, disabled, pending, focus-visible, and open states;
- overlay placement, backdrop, scroll lock, dismissal, and presence motion;
- keyboard model, accessible names, focus entry, and focus return;
- responsive layout, clipping, wrapping, scrolling, and content resilience;
- request bodies and navigation destinations.

Intentional capability addition: the agent bridge and semantic agent actions may
be added without a visual delta. Mutating and destructive agent actions remain
fail-closed and use the same confirmation contract as human actions.

External design systems may inform boundaries, naming, and composition. They do
not supply Tripwire's appearance and cannot overrule the captured baseline.

## Surface inventory

All listed routes are in scope because the POC changed the shared primitive
layer used by the entire app. Captures may group routes that render the same
layout family, but each route still requires a status and a verification
verdict.

Track evidence and unresolved states in the [route verification index](ui-sdk-migration-route-verification.md).

### Organization and repository dashboard

- `$org.home.tsx`
- `$org.analytics.tsx`
- `$org.index.tsx`
- `$org.tsx`
- `$org.$repo.tsx`
- `$org.$repo.index.tsx`
- `$org.$repo.activity.tsx`
- `$org.$repo.analytics.tsx`
- `$org.$repo.customize.tsx`
- `$org.$repo.moderation.tsx`
- `$org.$repo.moderation_.replay.tsx`
- `$org.$repo.responses.tsx`
- `$org.$repo.rules.tsx`
- `$org.$repo.rules_.$ruleId.settings.tsx`
- `$org.$repo.workflows.index.tsx`
- `$org.$repo.workflows.$workflowId.tsx`
- `$org.$repo.workflows.review.$pushId.tsx`

### Organization settings

- `$org.settings.tsx`
- `$org.settings.index.tsx`
- `$org.settings.general.tsx`
- `$org.settings.members.tsx`
- `$org.settings.roles.tsx`
- `$org.settings.redaction.tsx`
- `$org.settings.connections.tsx`
- `$org.settings.agents.tsx`
- `$org.settings.billing.tsx`
- `$org.settings.account.tsx`
- `$org.settings.settings.tsx`

### Global and compatibility surfaces

- `account.tsx`
- `activity.tsx`
- `analytics.tsx`
- `moderation.tsx`
- `rules.tsx`
- `workflows.tsx`
- `runs.$runId.tsx`
- `queue.tsx`
- `game.tsx`
- `mascot.tsx`

### Administration

- `admin.tsx`
- `admin.index.tsx`
- `admin.installations.tsx`
- `admin.orgs.tsx`
- `admin.pilot.tsx`
- `admin.repos.tsx`
- `admin.users.tsx`

### Authentication, onboarding, and invitations

- `index.tsx`
- `login.tsx`
- `onboarding.index.tsx`
- `onboarding.setup.tsx`
- `invite.$token.tsx`
- `consent.tsx`
- `device.tsx`
- `oauth.popup-callback.tsx`
- `oauth.waitlist.tsx`

### Appeals and root wiring

- `appeals.$target.tsx`
- `__root.tsx`

## Required baseline matrix

The base build and POC build must run concurrently from separate worktrees. The
same fixture identity, frozen clock, data, route, and interaction steps are used
for both.

### Viewports

- 390 px: narrow touch layout;
- 768 px: intermediate layout;
- 1280 px: primary desktop reference;
- 1920 px: wide layout and scroller reachability.

### Themes

- light;
- dark;
- system resolving to light;
- system resolving to dark.

The two explicit themes are required for every visual surface. System resolution
is required for shell, overlay, account, and settings pilot surfaces.

### Content fixtures

- zero, one, and many rows;
- a title longer than 100 characters;
- a long repository or file name;
- enough rows to overflow the available scroller;
- personal and organization workspaces;
- connected and disconnected forge states;
- permitted and restricted actions;
- current, inactive, pending, and destructive states.

### Interaction states

- rest, hover, pointer-down, focus-visible, open, selected, and disabled;
- idle, pending, success, failure, and retry;
- loading, empty, populated, filtered-empty, permission-denied, and error;
- overlay enter, overlay exit, nested overlay, Escape, outside press, Cancel,
  confirm success, and confirm failure;
- reduced motion;
- keyboard-only traversal and activation.

### Behavior parity tables

Every interactive primitive records old result, new result, expectation, and
verdict for applicable cases from the migration skill, including:

- Enter and Space immediately after a picker opens;
- accessible names, roles, headings, and `aria-current`;
- focus after Escape, Cancel, confirm success, confirm failure, and a removed
  opener;
- controls reachable inside scrollers at all four widths;
- stored filter values rather than only rendered labels;
- date, number, and upload parsing where those controls changed;
- request-body equality for every changed write surface.

## Repair phases

### Phase 0: governance and inventory

- Land the architecture, preservation, spec, and audit rules in agent context.
- Create the migration run ledger, roles, legacy inventory, gap list, component
  registry, route inventory, and capture plan.
- Record direct implementation imports and mixed legacy/system imports.
- Stop if a canonical primitive is missing or its own tests are red.

Done when the inventory names every route and shared surface, every component
family has an owner, and every gap is recorded instead of worked around.

### Phase 1: baselines

- Serve the baseline and POC from separate worktrees.
- Install the capture guard before the first navigation.
- Prove every known write is blocked.
- Capture the full matrix for the pilot and representative downstream routes.
- Preserve a no-change control capture.

Done when every pilot surface has render, accessibility-tree, measurement, and
interaction evidence, or a stated `blocked` reason.

### Phase 2: shared control contracts

Stabilize one family at a time, in this order:

1. typography, icon, and layout primitives;
2. Button, IconButton, and ActionLink;
3. Item, interactive rows, and trailing-action layout;
4. Dialog, AlertDialog, Drawer, Popover, Tooltip, and overlay host;
5. Menu, Command, Select, Combobox, and Tabs;
6. fields, checkbox, radio, switch, slider, and number input;
7. feedback, status, table, pagination, skeleton, and empty state.

Each family requires a hand-authored semantic contract, behavior tests,
accessible-name contract, state captures, and hardest-consumer example before
the next family begins.

Done when every canonical control has slot and prop parity, behavior-contract
tests, tone parity, pinned-string parity, and a hardest-screen render.

### Phase 3: pilot vertical slice

Repair the dashboard shell and its overlays:

- expanded and collapsed sidebar;
- logo and collapse transition;
- repository picker trigger and chooser;
- search launcher and command dialog;
- primary navigation and active states;
- settings link and account trigger;
- account menu and workspace chooser;
- connect repositories action and dialog;
- destructive confirmation.

Done when the pilot matches its baseline except for approved changes, passes the
behavior tables, and receives a verifier verdict at its current fingerprint.

### Phase 4: settings vertical slice

Repair general, members, roles, redaction, connections, agents, billing, and
account settings. Cover settings navigation, tabs, rows, forms, workspaces,
destructive zones, dialogs, and sidebar transitions.

Done when every settings route has a current verifier verdict and no shared
control is locally restyled to patch one caller.

### Phase 5: remaining route families

Migrate one route family per wave. Workers receive disjoint `MAY EDIT` lists.
Each surface is verified by an agent that did not implement it. A repeated fix
returns to the highest shared owner and receives a check before migration
continues.

Done when all 56 route modules have a status and every in-scope surface has a
current verdict.

### Phase 6: close and correction

- Reach zero direct legacy imports and zero mixed legacy/system files.
- Delete legacy modules only after caller count reaches zero.
- Recapture every surface at the final commit.
- Run the independent weighted visual audit from `AGENTS.md`.
- Group repeated mistake classes and enforce each at the highest viable level:
  architecture, types and lint, tests, then documentation.
- Audit the decision ledger against the final diff.

Done when every close gate below is satisfied.

## CI and enforcement

The migration must leave deterministic checks for mistakes agents are likely to
repeat.

Required checks:

- no direct ui-sdk imports outside `packages/ui`;
- no Base UI or Glaze implementation imports;
- no file mixing legacy and canonical systems;
- no public UI chrome escape hatches;
- no raw color, spacing, or typography increase over their ratchets;
- no native interactive control outside approved ownership when a canonical
  control exists;
- no direct visual-control imports in route modules;
- component-state coverage for every interactive export;
- accessible names and destructive confirmation contracts;
- agent action exposure and change-source propagation;
- package-boundary, typecheck, Biome, Oxlint, and tests;
- screenshot, measurement, accessibility-tree, and behavior parity for changed
  surfaces.

A new lint rule counts only after a planted example proves it fails and names
the correct fix. Ratchets only shrink. Exceptions sit on the offending line,
name the reason, owner, and expiry, and require Grim's approval.

## Independent audit contract

After every repair wave, spawn one fresh read-only audit agent that did not
implement the wave. It uses the weighted 100-point rubric in `AGENTS.md` and
reports evidence for every deduction.

The audit must specifically measure:

- common left and right edges;
- control heights and baselines;
- icon bounding boxes and optical centering on every side where an icon appears;
- text and icon contrast in rest, hover, selected, disabled, and focus states;
- spacing tokens and actual pixel gaps;
- nested cards, duplicated borders, double elevation, and incorrect radii;
- overlay origin, placement, backdrop, clipping, and focus return;
- wrapping, truncation, overflow, scroll cues, and reachable actions;
- theme equivalence and reduced-motion behavior.

The agent does not edit. A score is invalid without route, viewport, theme,
state, expected reference, observed delta, severity, screenshot evidence,
owning layer, and regression classification for each finding.

Record every scored round and re-audit in the [audit score register](ui-sdk-migration-audit-scores.md).
Use it for the final review alongside a fresh composition and app-wide
cohesion audit. Earlier scoped scores do not replace either final audit.

## Close gates

The migration is complete only when all of the following are true:

- `@ui-sdk/*` remains internal to `@tripwire/ui`;
- app code uses canonical `@tripwire/ui` contracts and named product molecules;
- direct legacy imports and mixed-system files are zero;
- all 56 route modules have a current status and every surface has a current
  verifier verdict;
- every changed write surface has request-body parity or an approved intended
  change;
- every baseline delta is either fixed or explicitly approved;
- the independent visual audit scores at least 95, with no category below 4 and
  no blocker;
- required CI checks pass on the final fingerprint;
- the correction pass has turned every repeated mistake class into architecture,
  a type or lint rule, or a behavior test;
- the final report lists what was found, fixed, intentionally changed, blocked,
  and not exercised.

## Approval

Grim approved this specification without amendments on 2026-11-12. Phase 0 may
continue with the generated inventory, followed by guarded Phase 1 baseline
captures before the first repair edit.

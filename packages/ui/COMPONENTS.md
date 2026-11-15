# Component contracts

This catalog is the human and agent reference for the public `@tripwire/ui`
surface. A component is admitted only when its API is finite, its behavior is
executable, and its visual contract is enforced. `Ready` means those gates are
closed; `Provisional` means the component is public but still has a recorded
contract or coverage gap.

## Shared ladders

| Contract | Values | Use |
| --- | --- | --- |
| control size | `small`, `medium`, `large` | actions and form controls |
| compact density | `compact`, `default` | rows and data-heavy surfaces |
| feedback intent | `neutral`, `info`, `success`, `warning`, `danger` | alerts, badges, and feedback; action and run-status vocabularies remain separate finite contracts |
| interaction | rest, hover, pressed, focus-visible, disabled, pending, open | only where supported |
| type role | page title, section heading, subheading, body, supporting text, label, caption, code, data | text hierarchy; never a visual override |

Product location is not a primitive variant. `SidebarAccountTrigger`,
`RepositorySwitcher`, and `SearchLauncher` are named product molecules because
their geometry and meaning differ from generic actions.

## Interactive primitives

| Component | Finite contract | Behavior and accessibility | Status |
| --- | --- | --- | --- |
| `Button`, `IconButton`, `ActionLink` | safe, destructive, or navigation intent; finite variant and control size; leading or trailing icon; pending and optional stable width across pending states; destructive confirmation | native button, form, or anchor semantics; icon-only naming required; ui-sdk owns pending refusal and explicit agent action or navigation capabilities | Audited: 26/32/36 px geometry, 12/14 px icons, Glaze glass finish with ink or coral contrast pairing, light/dark/forced-colors states, focus, hover, pointer, keyboard, forms, pending and disabled refusal, destructive confirmation, agents, source propagation, and reduced motion; 100/100 |
| `Checkbox`, `CheckboxGroup` | boolean or indeterminate state; mutually exclusive controlled/default state; finite options; disabled, read-only, required, invalid, external-form, and described-by semantics | required accessible name; ui-sdk owns pointer, keyboard, reset, form, group, indeterminate, and closed-list agent behavior; group state reaches every option wrapper | Audited: rendered light/dark/forced-colors anatomy, geometry, focus, pointer, keyboard, forms, external reset, agents, pending refusal, and reduced motion; 100/100 |
| `Collapsible`, `Accordion` | finite header or simple anatomy; panel and trigger tone; default or picker density; single or multiple selection; mutually exclusive controlled/default state | ui-sdk owns disclosure state, native Enter/Space and Tab behavior, disabled refusal, find-in-page reveal, measured panel motion, and closed agent actions | Audited: rendered header geometry, compact picker density, narrow overflow, localized counts, light/dark/forced-colors states, focus, pointer, keyboard, `beforematch`, agents, and reduced motion; 100/100 |
| `Combobox` | single or multiple; default or inline; finite options and one visible create action; external form, read-only, required, and disabled semantics | required `AccessibleName`; ui-sdk owns query, popup state, listbox navigation, disabled and read-only refusal, selection, stable object-valued chips, controlled proposals, form reset, and primitive agent actions. The web product bridge permits opening and closing only. | Audited: 32/26 px controls, anchor-width popup, viewport bounds, truncation, light/dark/forced-colors states, focus, pointer, keyboard, forms, reset, agents, source propagation, and reduced motion; 100/100 |
| `Command`, `CommandDialog` | neutral or destructive action, native link, group, content, separator; finite filtering; mutually exclusive controlled/default query and dialog state; optional inline label badge, status badges, and canonical current marker | required search label and unique item values; ui-sdk owns filtering, pending refusal, loading, listbox composition, navigation, dialog focus, and agent actions; destructive actions share confirmation metadata across pointer, keyboard, and agent activation; row metadata uses finite badge data instead of arbitrary React slots | Audited: valid listbox anatomy, native links, pending actions, disabled refusal, controlled query, loading, mouse/keyboard/agent sources, destructive human and agent confirmation, 640×432 palette geometry, responsive bounds, dialog-only search divider, light/dark surfaces, forced colors, focus return, and reduced motion; 100/100 |
| `Dialog`, `AlertDialog`, `DestructiveDialog` | small or medium; finite initial focus; mutually exclusive controlled/default state; declared safe or navigation actions; safe actions dismiss on success unless explicitly kept open for a follow-up step; exact typed confirmation; primary or destructive confirmation | ui-sdk owns focus trap, dismissal, return, normalized interaction sources, and agent open/press actions; destructive actions share the visible fail-closed confirmation contract | Audited: focus wrap/return, Escape/backdrop policy, pending exact-once refusal, mouse/keyboard/agent sources, agent confirmation metadata, exact typed confirmation, Glaze inset regular dialogs, announced and retryable action failure, primary/destructive visuals, light/dark geometry, and reduced motion; 100/100 |
| `Drawer`, `Sheet` | modal edge, finite width and body inset, mutually exclusive controlled/default state | ui-sdk owns focus, dismissal, drag, and agent open state; composed content may own its own scroll area | Audited 100/100: live Responses and admin at 390px and 1280px, and browser coverage for edges, protected dismissal, focus, and agent source |
| `Field`, `Input`, `Textarea` | orientation, native input types, semantic validation state, finite validity matching, direct or Field-owned accessible naming, leading icon, and copy action | native form semantics and Field associations; ui-sdk owns normalized human and agent changes; read-only state rejects human and agent edits without leaving the form; disabled FieldSets exclude descendants from submission | Audited: Field associations, native validity transitions and reset, controlled proposals, form submission, dynamic FieldSet inclusion, read-only refusal, adorned InputGroup focus ownership, 390/768/1280/1920 light/dark viewport evidence, forced colors, reduced motion, and agents; 100/100 |
| `Menu` | required trigger name; action, link, checkbox, radio, group, label, summary, separator; radio groups can dismiss on selection; mutually exclusive controlled/default state; finite width; named icon, badge, description, metadata, current, and supported shortcut slots | ui-sdk owns roving focus, typeahead, pending state, focus return, and dismissal; destructive actions confirm and fail closed for agents; pointer, keyboard, and agent activation report one normalized source | Audited 100/100: executable keyboard, pending, controlled, destructive human/agent, Glaze row geometry, viewport, light/dark, reduced-motion, and forced-colors evidence |
| `NumberInput` | min, max, step, unit; mutually exclusive controlled/default state; disabled, read-only, required | required `AccessibleName`; ui-sdk owns typed commits, bounds, stepping, native form state, and `setValue` agent actions; read-only and disabled states reject human and agent writes | Audited: rendered light/dark anatomy, focus, pointer, keyboard, forms, agents, and reduced motion; 100/100 |
| `Popover` | click or hover; default or menu surface; finite anchor gap, hover timing and focus policies; mutually exclusive controlled/default state | required trigger label; ui-sdk owns placement, focus, dismissal and agent `setOpen`; directional motion follows the resolved side | Provisional: 96/100 independent audit. The pinned SDK can flip near viewport edges; GIF and condition pickers previously stayed below their triggers. |
| `RadioGroup`, `SegmentedControl` | finite label, icon, description, locale-formatted count, badge and disabled option anatomy; mutually exclusive controlled/default state; form, invalid, loop, read-only and required semantics; SegmentedControl adds default/small sizes, fill, icon-only options, scalar/multiple selection and stable count width | required `AccessibleName`; ui-sdk owns pointer selection, arrow navigation, disabled skipping, wrapping, form behavior and closed-list agent `setValue`; native reset and dynamic option replacement preserve rendered state; selected, disabled and forced-colors treatments retain Glaze parity | Audited: rendered light/dark/forced-colors anatomy, overflow, dynamic content, focus, pointer, keyboard, forms, agents, reset and reduced motion; 100/100 |
| `Select` | native or popup; small, medium or large; finite non-empty string options with icon, description and metadata; nullable placeholder sentinel; mutually exclusive controlled/default state; form, invalid, required, read-only and loop semantics | required `AccessibleName`; native mode preserves native form behavior; ui-sdk popup owns pointer selection, keyboard navigation, typeahead, bounded scrolling, empty state, focus return and closed-list agent `setOpen`, `setQuery`, `setValue` and `clear` actions | Audited: rendered light/dark/forced-colors anatomy, geometry, overflow, forms, pointer, keyboard, agents, reset and reduced motion; 100/100 |
| `Slider`, `StepSlider` | bounds or ordered declared stops, disabled/read-only, controlled or default state, opt-in value readout; scalar Slider supports native form naming | required `AccessibleName`; ui-sdk owns keyboard, drag and commit; StepSlider exposes declared numeric values to agents | Audited 100/100: browser verified input, commit, form reset, semantic agent values, stepped fill geometry, sweep interruption, and forced colors. |
| `Switch` | small or medium; mutually exclusive controlled/default checked state; disabled, read-only, required, invalid, pending, external-form, and described-by semantics | required accessible name; ui-sdk owns pointer, keyboard, reset, form, and closed-list agent behavior; pending is busy and noninteractive | Audited: rendered light/dark/forced-colors anatomy, exact geometry, focus, pointer, keyboard, forms, external reset, agents, pending refusal, and reduced motion; 100/100 |
| `Tabs` | small or medium; included or external panel; text labels, optional counts, mutually exclusive controlled/default state | required tablist label; ui-sdk owns roving focus, selection, and agent `setValue` | Audited 100/100: controlled pointer and arrow selection, disabled refusal, action isolation, overflow reveal, forced colors, reduced motion, and agent source |
| `Toolbar` | horizontal or vertical; action, link, separator | required label; ui-sdk owns grouped keyboard navigation | Verified in Chromium: one tab stop, orientation-aware arrow navigation, Home/End, disabled action refusal, keyboard source, and perpendicular separator geometry |
| `Tooltip` | plain text; default or sidebar; finite placement and gap; mutually exclusive controlled/default state | ui-sdk owns hover, focus, Escape, and description semantics; icon-only custom triggers supply their own accessible name | Audited 100/100: 8px rail gap throughout the 160ms sidebar fade, immediate sidebar hover, standard delay and grouping, keyboard, touch, agents, forced colors, and reduced motion |

## Presentational primitives

| Family | Anatomy and approved composition | Status |
| --- | --- | --- |
| feedback | `Alert`, `Status`, `Progress`, `EmptyState` | Progress verified for custom accessible readings, indeterminate sweep, and still reduced-motion fill. Provisional: remaining live, retry, and error-state tests |
| identity | `Avatar`, `AvatarGroup`, `Badge`, `Icon` | Avatar and AvatarGroup verified for image replacement, fallback glyphs, 16/20/24/32px sizes, overlap, and keyboard overflow disclosure. Badge and Icon pass the rendered size, contrast, forced-colors, accessible-name, and reduced-motion matrix |
| navigation | `Breadcrumb` uses a named navigation landmark and an ordered list. Ancestors use native links, the current item uses `BreadcrumbPage`, and separators stay hidden from assistive technology. | Chromium verifies the landmark, hidden separator, current page marker, and keyboard navigation. No current web route consumer. |
| navigation | `Pagination` uses a named navigation landmark. Page destinations use links, with `current` marking the current page. `PaginationInfo` takes `from`, `to`, optional `total`, and optional `noun`. | Chromium verifies the link-based parts on first, middle, and last pages. The Admin Users button-driven pagination also has browser coverage for range text, keyboard changes, and disabled edges. |
| navigation | `Steps` uses an ordered list with `value` identifying the current step. It supports horizontal and vertical layouts and default and small sizes. A supplied `onValueChange` makes step triggers buttons. With `linear` enabled, future steps are disabled. | Chromium verifies the display-only form, linear disabled edges, keyboard selection, current marker, interaction source, and focus retention. Account Deletion uses display-only progress. Its Check and Confirm steps were verified in the live route at 390px and 1280px in both themes. |
| surfaces | `Panel`, `Card`, `Item`, `DataList`, `Table` | Item, Table and their parts accept semantic props and native behavior without styling overrides. The remaining surfaces still need a contract review. |
| content | `CodeBlock`, `Kbd`, `RelativeTime`, `Truncate` | RelativeTime preserves exact date metadata for valid values and renders “Unknown time” for invalid values. Provisional: remaining focused semantic tests |
| loading | `Skeleton`, `SkeletonText`, `SkeletonSwap` | Decorative block or fill, text role and line count, and a named loading swap; product layout reserves placeholder geometry |
| layout | `Page`, `PageHeader`, `PageBody`, `Section`, `SectionHeader`, `SectionBody`, `ActionRow`, `FormSection`, `FormActions` | Provisional: viewport and wrapping matrix |
| shell | `SidebarShell`, `SidebarHeader`, `SidebarBody`, `SidebarNav`, `SidebarFooter` | Provisional: executable collapsed and expanded anatomy tests |
| overlay host | `OverlayHost` | Chromium verifies confirmation in Button, Menu, Command, and Toast, including Escape, cancellation, and focus return. The toast live region and dismiss actions have dedicated coverage. |
| typography | semantic roles exported from `typography` | Verified route-level heading hierarchy and page reflow on Analytics, Activity, Workflows, Responses, and Account at 320–1280px, light and dark, including 200% CSS text enlargement at 390px and 1280px. Analytics still clips some text. Native browser zoom and the rest of the routes remain open. |

## Supporting public contracts

| Export | Responsibility | Status |
| --- | --- | --- |
| accessible name | mutually exclusive visible-label reference or direct accessible label for every standalone control | Ready: enforced by public component types and the web typecheck |
| agent policy and runtime | agent visibility, permissions, change source, and tool registration | Chromium exercises the production AgentBridgeProvider through registered tool handlers and a stub registration transport. Verified hidden controls, denied actions, and approval gating. Native browser WebMCP transport and the full route permission matrix remain open. |
| interaction | normalized human, programmatic, and agent change-source vocabulary | Provisional: real pointer, keyboard, virtual, and agent tests |
| copy button | bounded copy action with finite feedback | Provisional: clipboard and failure tests |
| toast | finite tone, message, and action contract rendered by `OverlayHost` | Chromium verifies polite and assertive announcements, keyboard dismissal, and destructive action confirmation, cancellation, and retry. |
| motion | shared duration and easing vocabulary | Provisional: reduced-motion and interruption tests |
| OG | server-renderable visual contracts | Provisional: snapshot and boundary tests |
| icon subpath | finite glyph, size, weight, tone, and animation contract | Audited: all supported sizes, decorative and named semantics, and reduced motion |

## Composition rules

- Prefer native HTML when it already owns the required behavior.
- Use ui-sdk only inside this package for compound interaction behavior.
- Use a primitive for generic semantics, a molecule for a named product role,
  and a feature component for data and permissions.
- Do not add `className`, `style`, raw color, raw spacing, raw type, `unstyled`,
  `render`, or slot escape hatches to public APIs.
- A destructive action declares destructive intent and passes through the shared
  confirmation boundary.
- Every interactive control has one required accessible naming path.
- Agent exposure follows the same permissions, confirmation, and disabled state
  as human interaction.

## Admission checklist

Before changing a component from `Provisional` to `Ready`, add executable tests
for its supported keyboard, focus, dismissal, pending, controlled, reduced
motion, and agent-confirmation states; verify light and dark appearance at the
required viewports; then run the independent visual audit described in the
migration repair specification.

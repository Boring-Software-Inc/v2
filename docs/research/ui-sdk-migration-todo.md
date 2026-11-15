# ui-sdk migration execution ledger

Status: active

This ledger is reviewed before and after every migration step. It supplements
the approved repair specification; it does not widen product scope. Each step
must preserve Glaze's visual language, use ui-sdk only for behavior, pass the
required checks, and receive an independent read-only audit before it closes.

## Review protocol

Before each step:

- confirm the active worktree and dirty files;
- reread this ledger and the relevant section of `DESIGN.md`;
- identify the approved reference and owning UI layer;
- capture and save browser screenshots of every affected surface and
  relevant state before edits, using the audit's themes and breakpoints;
- confirm that unrelated preserved surfaces remain out of the edit.

After each step:

- record the implementation and validation evidence here;
- save matching after screenshots and link both sets here. Include a frame
  sequence or recording where a still cannot show the change. Label
  reference comparisons and reconstructions separately from pre-edit state;
- rerun the focused tests and applicable design-system contracts;
- run a fresh independent audit;
- add newly discovered regressions before starting another step.

## Active sequence

### 1. Sidebar interaction and identity

- [x] Keep the Tripwire mark at its approved visual size in both states.
- [x] On collapsed hover/focus, use Motion to scale the mark down on both axes
  while the expand-sidebar glyph scales up in the same hit area.
- [x] Animate the semantic rail endpoints with an interruptible CSS transition;
  use Motion for retained-content presence and position choreography.
- [x] Animate navigation labels and trailing metadata away while their icons
  retain the same 16 px geometry and optical center.
- [x] Preserve reduced-motion behavior and keyboard focus.
- [x] Add executable coverage for the interaction contract.

### 2. Repository switcher identity

- [x] Render the active repository's forge mark before its name.
- [x] Preserve the command-style chooser composition and focused search.
- [x] Verify unknown/loading repository states do not shift trigger geometry.

### 3. Empty-state ghost contract

- [x] Inventory every `EmptyState` consumer and classify intentional art
  exceptions.
- [x] Ensure product empty states render the Tripwire ghost by default.
- [x] Add an explicit minigame permission contract; the 404 surface is the only
  surface allowed to register the runner minigame.
- [x] Restore the ghost to contribution appeals and other migrated empty states.
- [x] Verify reduced motion, focus, and accessible labeling.

### 4. Authenticated route-level shell matrix

- [x] Extend the UI contract checker to measure Search, navigation, Settings,
  brand, and account-trigger centers whenever an authenticated rail is present.
- [x] Measure Search, navigation, Settings, and account-trigger centers together
  on authenticated organization and repository routes.
- [x] Cover expanded/collapsed, light/dark, and required desktop/narrow
  viewports.
- [x] Fail on settled icon-size, centerline, rail-width, token-bound hit-area,
  or visible-label drift.
- [x] Verify hover, keyboard focus, and reduced motion on authenticated
  organization and repository routes.
- [x] Verify interrupted transitions on authenticated organization and
  repository routes.

### 5. Primitive closeout and DS documentation

- [ ] Close remaining primitive and product-molecule regressions one vertical
  slice at a time.
- [x] Inventory every public primitive family and record its readiness and
  highest-priority contract gaps.
- [ ] Document every public primitive's finite semantic props, state, anatomy,
  tokens, accessibility contract, and approved compositions.
- [ ] Close the provisional gaps recorded by the public component catalog.
- [ ] Produce DS documentation suitable for agent and human consumption.
- [ ] Run the final cohesion audit across routes, themes, breakpoints, states,
  contrast, nested surfaces, typography, icon rhythm, and motion.

## Completed evidence

- Sidebar navigation and Search glyphs measure 16 × 16 in expanded and collapsed
  states with a 0 px optical-center delta.
- Collapsed rail width and brand hit area are semantic tokens enforced by the
  light/dark component-state matrix.
- Root `DESIGN.md` establishes ui-sdk behavior ownership and Glaze visual
  ownership.
- The latest independent sidebar shell audit passed at 97/100.
- The expanded mark and navigation icons now share a measured 25 px centerline.
  A semantic 4 px transform gives the expanded mark its optical inset while the
  collapsed slot returns to the centered rail endpoint. Motion crossfades a
  centered two-axis scale between the mark and expand glyph, whose resting layer
  is explicitly `opacity-0`.
- The rail resolves its 50 px and 224 px semantic endpoints in CSS using the
  existing 200 ms slide token and movement curve. This replaces Motion's invalid
  interpolation of CSS-variable strings, which briefly overshot the 224 px rail
  to 563 px. Live 16 ms samples now progress monotonically from 52.7 px through
  72.7, 116.3, 181.3, 211.3, and 223.5 px to 224 px with no overshoot.
- Search, repository context, navigation labels, counts, and account identity
  leave through the shared 160 ms state curve while their retained icons remain
  mounted. Rail and retained icon positions use the on-screen position curve.
  Exiting labels and counts use `AnimatePresence` `popLayout`, so they fade and
  translate away without participating in the collapsed endpoint layout. Their
  link owns the positioned containing block, and the rail clips transient
  inline overflow. All motion respects reduced motion. `dashboard-rail.test.tsx`,
  `command-palette-launcher.test.tsx`, and `shell-nav.test.tsx` cover the resting
  brand layers and shared icon geometry.
- The active repo resolves its forge from the repo-context query. The route's
  `repoCandidate` supplies the label and reserves a 16 px icon slot before forge
  metadata resolves, so loading cannot shift the trigger. Live verification
  showed the GitHub mark before `v2` without changing the command chooser.
- All app empty-state imports now pass through the product wrapper, which adds
  compact or default ghost art when a surface does not supply a mood. The UI
  boundary check rejects primitive bypasses and minigame opt-ins outside 404.
- `empty-state.test.tsx` verifies default ghost art and the 404-only minigame;
  focused tests, UI boundaries, and the web typecheck pass.
- The component-state matrix now samples the semantic rail transition every
  16 ms in light and dark themes. It fails if width reverses, exceeds 224.5 px,
  or misses the 224 px endpoint; both theme reports currently pass with no
  failures.

## Findings queue

- StepSlider follow-up fixed the fill's leading inset and square termination
  under the thumb, verified in the live dark Responses rail at Rule names
  hidden. The semantic agent registration accepts declared numeric stops and
  refuses implementation indices. Rapid input retains the running sweep.
  Independent closeout audit passed 100/100 after verifying two-band timing,
  scalar disabled treatment, and the forced-colors thumb.
- Tooltip follow-on: restored Glaze's inverse surface and the sidebar's
  13px corners, 34px minimum height, and fixed dark treatment. Live Chromium
  measured an 8px gap for eight collapsed-rail targets; Search began opening
  in 10–15ms in both themes with a 160ms opacity fade. The compiled browser
  fixture covers standard 500ms hover, top/6px placement, warm handoff,
  keyboard focus and Escape, touch, icon-only naming, controlled state, agent
  source, forced colors, and reduced motion. Warm sidebar handoff keeps the
  fade to preserve immediate entry with motion. Fresh independent audit:
  100/100.
- Tabs follow-on: restored first-paint selection, the disabled and
  forced-colors states, the label/count rhythm, and the 12px panel gap.
  Pointer and arrow selection passed on live Members at 390px and 1280px
  after hydration and in the live Responses sheet. The fixture checks
  controlled state, action isolation, disabled refusal, grouped
  navigation, overflow, reduced motion, and agent source. Independent
  closeout audit: 100/100 after verifying an actual selection under
  reduced motion. The initial
  browser reproduction could interact with server markup before
  hydration; the isolated controlled fixture passed before visual edits.
- Drawer/Sheet follow-on: restored the Glaze shell, scrim, 8px viewport
  inset and 3px inner frame. Responses owns its 16px padding and scrolls
  the content between fixed controls; admin owns its 8px toolbar padding
  and full-width scroll area. Both passed live Chromium checks at 390px
  and 1280px, including focus containment and restoration. The browser
  matrix also covers edges, protected dismissal and agent open source.
  Removed unused docked and free-resize options: they did not reproduce
  the old inline layout and keyboard resize contracts. Independent
  closeout: 100/100 for the modal contract.
  Saved comparison in drawer-sheet:
  light mode, both surfaces at 390px and 1280px. The earlier-state
  images are from the clean Glaze worktree (`f4c34df5`), captured
  retrospectively; no immediate pre-pass screenshots were retained.
  Add block visual repairs continued in the round below.
- Add block palette: true before, after, and clean Glaze reference captures in
  add-block-parity at 390px and 1280px in light and dark. Match the stacked header,
  search geometry and 334px/480px sheet widths. The requested visual
  refinement removes group counts, aligns row icons to titles, restores
  disclosure indicators, and eliminates the unused bottom area on desktop
  while retaining scrolling on mobile. The independent visual audit scored
  97/100; the remaining difference is slightly tighter group spacing than
  the Glaze reference.
- Independent codebase composition audit: 80/100 (primitives 22/25,
  product components 17/20, routes 17/20, adoption 15/20, enforcement 9/15).
  233 of 301 non-test component modules directly reference the DS; 40 of
  44 component routes call `buildSeo`. Priorities: portable Playwright
  launch in CI, shared search adoption, fewer styling escape hatches,
  product-owned styles colocated with components, and a thinner OAuth
  callback route.
- Composition follow-on: Chromium fixtures and the state checker now use
  Playwright's installed browser by default and accept an optional local
  override. Slider reset verification waits for the rendered range to settle.
  FilterBarSearch uses the DS compact search input and keeps slash focus
  and Escape clear. The Add block follow-up removes nested gutters, moves
  disclosure chevrons away from leading icons, and removes redundant bottom
  padding. True before/after captures in composition-round
  include Add block in both themes at 390px and 1280px, plus the available
  filter search surfaces in the local demo. Independent Add block closeout:
  100/100. All 18 browser test files passed using the default Chromium
  resolution, without an executable override.
- Skeleton and Table composition: moved placeholder geometry onto the
  surrounding product layout; removed raw chrome props from Skeleton,
  SkeletonText, SkeletonSwap, Table and its parts. Type assertions prevent
  reintroducing these props. Existing Table visual debt is separate from
  this API cleanup. Add block uses the standard full-height inset Sheet
  again. True before/after captures in skeleton-table
  cover the drawer, Responses loading, and four admin tables in light/dark
  at 390px and 1280px. A single text placeholder now fills its reserved
  width; only a multiline group's last bar is shortened.
  Independent API-cleanup audit: 100/100. Separate parity work remains
  for SkeletonText's half-line bar rhythm and Table's shell, density,
  sticky header, scroll accessibility, loading rows, sort controls, and
  row-action reveal.
- Add block section headers use Accordion's `sections` recipe: a leading
  glyph and label, a trailing disclosure chevron, and tokenized spacing and
  dividers. Keep search, row content, and full-height Sheet layout in the
  picker composition. Before/after captures in add-block-accordion
  cover both themes at 390px and 1280px. Browser coverage checks the
  section variant's accessible name, keyboard expansion, and chevron
  state. Remaining desktop whitespace belongs to the Responses redesign.
- Route error and 404 recovery actions now share the compact Glaze primary
  treatment. Select restores the compact 10px inline inset and mounts
  the empty row only when there are no options. Option text leaves room
  for the selected checkmark. The Viewer popup fits
  its two options in 66px. Captured both themes at 390px and 1280px.
- Alert dialog visual repair: Discard, typed confirmations and the shared
  confirmation host use the previous Glaze inset panel, compact footer
  and glass confirm action. Browser before/afters in discard-dialog
  cover Responses Discard at 390px and 1280px and account sign-out at
  1280px in both themes. Typed confirmation no longer submits from the
  input on Enter; explicit keyboard activation still works, and a failed
  destructive request keeps the dialog open with a retry message. Regular
  Dialog chrome, regular action failure, and the app-wide Button visual
  sweep remain open. Independent confirmation audit: 100/100.
- Control shape guard: multiline fields use the 10px overlay corner, and
  the rendered state check pins it independently of pill buttons, inputs,
  and selects. The web boundary requires the shared Textarea.
  Responses comparisons in textarea-shape
  include a reconstructed baseline using the previous pill rule. Apply
  the same closed API and rendered checks as each family is repaired:
  control size, padding and gap, typography, contrast, responsive geometry,
  and motion. The existing disabled-field and popup-motion checks still
  fail independently of the radius contract.
- Toolbar follow-on started: restore the keyboard focus ring, keep the
  disabled control subdued on hover, and rotate the separator for a
  vertical toolbar. Next, verify navigation and action source in both
  orientations.

- Redaction visual correction: judging horizontal overflow missed overlapping
  labels inside the rail. Both redaction surfaces now use major marks and the
  existing current-level heading, matching the pre-migration composition.
  Verified the 296px desktop rail and 316px mobile rail on Responses, plus the
  enabled dark-mode state at File paths hidden. The generic StepSlider still
  supports tick labels for consumers with space for them.

- Responses browser feedback: the block sheet now keeps its tab separate from
  selection and owns one set of insets. Align the preview toolbar to the compact
  control token, keep Search aligned with sidebar glyphs, and keep redaction
  tick labels readable through narrower layouts. Activity group headers and
  checked event rows lead to runs; forge links remain separate. Events without
  any run retain honest non-run semantics. Segmented controls pair the selected
  fill with its foreground in both themes.

- Popover re-audit: 96/100. Restored available-height default surfaces, actual
  collision-side motion, hover pinning, and app-owned GIF, condition and Dev
  geometry. On the live demo routes at 1280×900 and 1280×540, condition search
  focused and filtered; the 320px GIF picker focused its search and kept its
  attribution visible with the results region constrained. GIPHY results
  were still loading during verification. The pinned SDK does not offer an
  opt-out from side flipping, so exact placement parity remains open.
- Slider follow-on: restored the scalar and stepped track anatomy, ordered
  stops, positioned labels, disabled styles, reduced-motion treatment, and
  opt-in stable readout. Browser checks cover keyboard, drag and commit source,
  native form/reset, agent changes and locked controls. Live redaction showed
  nine stops and no horizontal overflow at 390px and 1313px. The prior audit
  scored 93/100 before the semantic registration and sweep follow-up above.

- The first corrected-motion audit found transient horizontal overflow and an
  unpositioned `popLayout` exit layer. Both are closed. Its proposed removal of
  the expanded/collapsed brand-anchor delta was rejected because the user
  explicitly requested two optically correct endpoints with a positional morph.
- The fresh re-audit passed the corrected sidebar round at 97/100 with no
  collapse blocker. The last local `SidebarSwap` duration/easing tuple now uses
  `UI_MOTION.slide`; browser automation for real-route hover, focus, reduced
  motion, and narrow/wide endpoints remains assigned to the shell matrix.
- Add measured expanded/collapsed centerlines plus hover, focus, and
  reduced-motion endpoints to the planned authenticated shell matrix. The
  current focused tests enforce markup and loading-slot contracts but do not
  replace browser geometry and motion coverage.
- The sidebar motion constants now live in `@tripwire/ui/motion`; migrate other
  repeated raw duration and easing arrays into that finite contract during the
  primitive closeout rather than expanding feature-local motion vocabularies.
- The authenticated org-home endpoint now has measured parity between the brand
  and first navigation icon at x = 25 px, with Search and account triggers both
  beginning at x = 8 px. The remaining route, theme, narrow-viewport, focus,
  and reduced-motion combinations stay open in step 4.
- The post-fix independent audit passed the sidebar motion round at 97/100. Its
  sole motion deduction was the absence of an executable overshoot check; the
  component-state matrix now closes that gap.
- The primitive import inventory currently reports zero `@base-ui` imports and
  zero legacy `#/design-system/ui/*` imports in the web and UI source trees.
  Twenty-one UI package modules now own ui-sdk behavior directly; remaining
  closeout work is contract, composition, visual parity, and route coverage—not
  another primitive import replacement pass.
- `packages/ui/COMPONENTS.md` now records the public surface, finite semantic
  ladders, composition boundaries, and per-family readiness. Independent
  interactive and presentational audits supplied its gap inventory.
- The route contract runner accepts a base URL and explicit sidebar state, uses
  the specification's 390, 768, 1280, and 1920 px viewports, and measures rail
  width, icon size, and centerline alignment whenever a desktop rail is present.
- The existing `.design-system/dev-storage.json` capture redirects every route
  matrix case to Sign in. It is stale and cannot close the authenticated shell
  gate; accepting that run would be a false green.
- Primitive audits identified six closeout priorities: remove public visual
  escape hatches, require accessible names, close destructive-action bypasses,
  align root and subpath exports, replace static-markup-only interaction claims
  with executable tests, and guard relative-time/overlay correctness edges.
- The authenticated route matrix covers 64 organization-route cases and 64
  repository-route cases across expanded/collapsed state, light/dark themes,
  100%/200% zoom, and 390/768/1280/1920 px viewports. Shell geometry is measured
  where the responsive rail is rendered; narrow cases still enforce route,
  hierarchy, typography, overflow, and console contracts. The checker binds
  hit-area expectations to the finite `--control-sm` token and fails visible
  collapsed labels, missing expanded labels by role, icon-size drift, centerline
  drift, rail-width drift, route redirects, and console errors. Every
  route/state writes to a namespaced evidence directory. The matrix also
  verifies Search hover response, keyboard reachability and focus visibility,
  token-level reduced-motion duration, and one canonical interrupted transition
  per authenticated route and starting rail state. The interruption check
  reverses the rail mid-flight, fails non-monotonic recovery or semantic-bound
  overshoot, and requires the original endpoint to settle within 0.5 px.
- The repository matrix exposed a shared chart-frame `h3` default that skipped
  directly from the page `h1`; the chart molecule's anatomy now defines its
  title as the page-section `h2`, with a focused semantic test. Consumers that
  need a nested chart must first establish a separate finite nested anatomy
  rather than passing an arbitrary heading level.
- `AccessibleName` now gives Combobox, NumberInput, RadioGroup,
  SegmentedControl, Slider, StepSlider, and Select one required, mutually
  exclusive naming contract. The web typecheck proves every product callsite
  declares either a direct accessible label or a visible-label reference;
  `thumbLabel` was removed as a duplicate Slider naming path.
- `Command` now separates neutral and destructive actions at the type level.
  Destructive entries require confirmation copy, expose the same confirmation
  metadata to agents, and pass human activation through the shared ui-sdk
  confirmation host. The global Sign out command now uses that contract instead
  of maintaining feature-local dialog state. Command rows render as real
  buttons inside the ui-sdk listbox so the agent bridge can name and press them.
  A destructive agent press delegates approval to the primitive's visible
  confirmation dialog instead of asking twice. Executable browser coverage
  proves pointer and keyboard cancellation, exactly-once acceptance, and an
  agent press that cannot run the action before the visible confirmation is
  accepted. Compile-time fixtures reject destructive entries without
  confirmation and neutral entries that carry destructive confirmation.
- Command rows now expose one finite metadata anatomy: an inline label badge,
  trailing status badges, and the canonical current check. The global palette
  uses it for Personal, Tripwire state, review counts, blocked counts, and the
  active workspace or repository. Arbitrary React metadata slots are not part
  of the primitive contract. Live verification confirmed the current check and
  Personal badge remain aligned in the full result list and that a filtered
  repository result preserves its trailing status badge without changing the
  popup geometry. Command labels now truncate against a non-shrinking status
  rail, and an app-level mapping test locks Personal, Current, Tripwire state,
  review count, blocked count, and destructive confirmation metadata across the
  product-molecule boundary.
- Command and CommandDialog now have one closed ui-sdk contract. Controlled and
  default query or dialog state are mutually exclusive, duplicate item values
  fail closed, links remain native anchors, and action promises are returned to
  ui-sdk so pending state rejects duplicate pointer and agent activation. Empty
  and loading content are siblings of the listbox rather than invalid listbox
  children. Executable coverage proves filtering, rich row anatomy, disabled
  refusal, controlled query proposals, native navigation, mouse, keyboard, and
  agent sources, destructive human confirmation, destructive agent refusal and
  approval, dialog focus return, and reduced motion. CommandDialog restores the
  Glaze palette contract at 20dvh with a token-driven 640×432 desktop surface,
  bounded mobile geometry, a dialog-only search divider, a filling scrollable
  list, light and dark surface evidence, and a computed forced-colors focus
  treatment. The generic Command keeps the divider removed so repo and
  workspace pickers do not regain the stray white line. Independent audit
  passed 100/100.
- NumberInput now has one finite state contract: direct and referenced names are
  mutually exclusive, controlled and default values cannot be mixed, and
  disabled, read-only, required, bounds, step, unit, and form submission retain
  native semantics. Executable browser coverage proves pointer and keyboard
  stepping, Home and End bounds, typed-value clamping, controlled proposals,
  disabled and read-only refusal, form inclusion, and `setValue` agent actions
  with normalized sources. The styled anatomy now targets ui-sdk's actual
  increment and decrement slots, exposes spinbutton value metadata, and keeps
  value and unit in one centered group between inset ghost steppers. Rendered
  coverage locks the 32px control, 24px steppers, 4px insets, one focus
  treatment, light/dark surfaces, and the 120ms interaction transition that
  resolves to zero under reduced motion. Independent audit passed 100/100.
- Dialog behavior now has an executable browser contract. Regular controlled
  and uncontrolled dialogs focus their declared first field, wrap focus in both
  directions, dismiss by Escape or backdrop, return focus to their trigger, and
  prevent duplicate pending actions. The public action contract is a finite safe
  or navigation union; arbitrary footer content and mixed controlled/default
  state are rejected at compile time. Close and Cancel become visibly and
  semantically disabled while an action is pending. Alert dialogs reject
  backdrop dismissal, cancel without running the action, confirm exactly once,
  and return focus to their trigger. Destructive dialogs require byte-exact
  typed confirmation, expose pending controls as disabled, reject backdrop
  dismissal, and run the destructive action exactly once. Executable coverage
  locks primary and destructive treatments, light/dark surfaces, reduced motion,
  mouse/keyboard/agent source sequences, agent actions, and confirmation
  metadata. Independent audit passed 100/100.
- Button behavior now has an executable browser contract. Safe actions report
  pointer and keyboard sources, expose pending and busy state, reject duplicate
  activation while pending, retain focus, and recover after the promise
  settles. Navigation buttons and action links retain native anchors and
  new-tab safety while exposing an explicit ui-sdk `open` action that preserves
  agent source. Destructive buttons cancel without acting and confirm exactly
  once, including the icon-only contract, whose accessible label is required.
  Compile-time fixtures reject destructive actions without confirmation, mixed
  action and navigation semantics, unsafe ActionLink variants, raw visual
  escape hatches, safe actions carrying destructive confirmation, and unnamed
  icon buttons. External submit and reset buttons retain native form ownership,
  submitter name and value. Rendered coverage locks 26/32/36 px control heights,
  12/14 px icon sizes, light/dark/forced-colors states, focus, hover, reduced
  motion, and disabled refusal for pointer, keyboard, and agents. Independent
  audit passed 100/100.
- Checkbox, CheckboxGroup, and Switch now share an executable browser contract.
  Pointer and keyboard activation report their real sources, indeterminate
  state resolves through the native checkbox behavior, groups preserve disabled
  options and form values, pending switches are busy and noninteractive, and
  agent changes report the agent source. Native form submission includes the
  checked checkbox, group, and switch values. Compile-time fixtures require one
  and only one accessible naming path for every standalone toggle.
  Controlled controls report proposed values without mutating their rendered
  state. Read-only controls remain focusable, reject pointer, keyboard, and
  agent changes, and preserve their submitted values. Group-level disabled and
  option-level disabled states reject every activation source, required groups
  participate in native form validity, and Enter submits a focused switch's
  form without toggling it. Controlled/default state is mutually exclusive at
  compile time, external form ownership and reset restore uncontrolled defaults,
  indeterminate reset remains mixed, and controlled controls remain prop-owned.
  Invalid semantics and danger-border treatment now reach standalone controls
  and grouped options; group-level disabled and read-only state reaches every
  option wrapper. Pending switch fields expose one busy, disabled,
  noninteractive affordance. Rendered coverage locks the 20 px checkbox, 40 x
  20 px medium switch, 32 x 16 px small switch, 8 px checkbox rhythm, Glaze
  checked fills, light/dark parity, forced-colors behavior, and reduced-motion
  pending state. Independent closeout audit passed 100/100.
- Field, Input, and Textarea now share an executable browser contract. Field
  labels, descriptions, matched errors, invalid state, and native validity
  transitions remain associated with their controls. Direct labels,
  `aria-labelledby`, and explicit Field-owned naming are finite compile-time
  contracts, and the Field-owned path fails closed outside a Field. Keyboard
  and agent edits report normalized sources, controlled fields report proposals
  without mutating, Textarea Enter inserts a newline, and Input Enter submits
  the native form. Disabled fieldsets exclude descendants from form data until
  enabled, then restore both agent mutation and submission. Read-only inputs
  and textareas remain focusable and submitted while rejecting human and agent
  edits through the behavior adapter. Adorned InputGroups own one complete
  focus-visible ring and hand it to the copy action when focus advances. The
  rendered matrix covers 390, 768, 1280, and 1920 px in light and dark themes,
  plus forced colors and reduced motion. Independent closeout audit passed
  100/100.
- Collapsible and Accordion now share an executable disclosure contract.
  Pointer, keyboard, and agent changes report normalized sources; controlled
  disclosures report proposed state without mutating; disabled triggers remain
  focusable while rejecting human and agent changes; find-in-page panels stay
  mounted as `hidden="until-found"`; single-selection accordions replace the
  open item; and multiple accordions keep enabled items open together.
  Controlled/default state and header/simple anatomy are mutually exclusive at
  compile time, and raw event-handler escape hatches are not public. Rendered
  coverage locks before/after header geometry, 36 px default and 26 px picker
  rows, localized tabular counts, narrow-label truncation, default and bordered
  panels, native Tab order, the current APG no-op Arrow/Home/End behavior, and
  actual `beforematch` reveal with a normalized programmatic source. Light and
  dark trigger, hover, disabled, count, and border treatments, forced-colors
  behavior, focus, and reduced-motion transitions are executable. Independent
  closeout audit passed 100/100.
- Combobox now has an executable single, multiple, controlled, create, and
  agent contract. Keyboard and pointer selection report normalized sources;
  disabled controls and options reject keyboard, pointer, and agent selection;
  read-only fields stay focusable and submitted while refusing pointer,
  keyboard, and agent value, query, or popup changes;
  controlled value, query, and open state report proposals without mutating
  their controlled dimension; multiple chips remove and add values through the
  same callback; custom creation is one visible shared Button action for pointer,
  keyboard, and agent callers; and object-valued options preserve stable chip
  identity while agent value ids resolve back to canonical option objects. The
  option contract no longer accepts an arbitrary metadata node, keeping row
  anatomy within the primitive instead of adding a visual escape hatch.
  External single and multiple forms preserve native submission, required
  validity, disabled exclusion, and programmatic reset sources. Rendered
  coverage locks 32 px default and 26 px inline controls, anchor-width and
  viewport-bounded popups, long-label truncation, exact focus return, light and
  dark surfaces, forced-colors semantics, opening motion, and reduced motion.
  Independent closeout audit passed 100/100.
- Menu now exposes a finite entry anatomy for actions, links, checkboxes, radio
  groups, labels, groups, separators, and noninteractive summaries. Leading
  icons, badges, descriptions, trailing metadata, current markers, and keyboard
  shortcuts use named slots; arbitrary content rows and React-node labels are
  not public escape hatches. Every menu declares exactly one trigger naming
  path, checkbox and radio controlled/default state is mutually exclusive, and
  unsupported checkbox or radio shortcuts are rejected at compile time.
  Executable browser coverage proves controlled open proposals, disabled focus
  without activation, typeahead, Escape dismissal, trigger focus return,
  controlled checkbox proposals, uncontrolled radio selection, safe new-tab
  links, pending exactly-once actions, and pointer and keyboard destructive
  confirmation. Agent set-open and press actions preserve the agent source;
  executable denial proves a destructive press cannot run until the bridge
  grants approval. Styled viewport coverage now locks the finite popover width,
  collision bounds at 390/768/1280/1920 px, light/dark surfaces, reduced motion,
  and forced-colors focus treatment. Ordinary rows preserve the approved Glaze
  8 px inset, checkbox and radio rows alone reserve the 28 px indicator lane,
  indicators are absolutely aligned with leading icons, and descriptions do not
  alter that x-axis rhythm. Destructive confirmation returns its promise to
  ui-sdk, keeping pending and exact-once behavior owned by the primitive. Every
  close path waits for actual dialog and menu teardown in executable evidence;
  eight consecutive stress runs and the independent closeout audit passed at
  100/100.
- RadioGroup and SegmentedControl now share one finite option anatomy and
  mutually exclusive controlled/default state. The ui-sdk primitive owns
  pointer selection, keyboard navigation, disabled-option skipping, loop
  behavior, native form validity and reset, read-only refusal, and closed-list
  agent `setValue` actions with normalized sources. Full-row pointer targets no
  longer depend on label DOM adjacency, while locale-formatted counts, badges,
  and descriptions remain discoverable without polluting exact option names.
  SegmentedControl preserves the Glaze 32 px default and 26 px small contracts,
  13/12 px labels, 12 px small icons, 6 px internal rhythm, fill and icon-only
  anatomy, scalar and multiple selection, stable historical count width, and a
  measured sliding thumb that follows dynamic option replacement. Light, dark,
  forced-colors, overflow, focus, form, agent, and reduced-motion coverage is
  green. Independent closeout audit passed 100/100.
- Select now owns a finite native and popup contract across small, medium, and
  large sizes. Option identifiers are non-empty strings, while null is the one
  placeholder sentinel; compile-time and runtime defenses reject empty option
  identifiers, and generic application adapters normalize legacy empty values
  before they reach the primitive. Icons, descriptions, metadata, selected
  indicators, empty results, bounded long lists, and working scroll controls
  use named anatomy without arbitrary row slots. Native forms preserve required,
  disabled, external-form, reset, and null behavior. The ui-sdk popup owns
  pointer selection, typeahead, Home/End/arrow navigation, disabled skipping,
  dismissal, focus return, read-only refusal, and agent `setOpen`, `setQuery`,
  `setValue`, and `clear` actions with normalized sources. Light, dark,
  forced-colors, long-content, focus, form, agent, offset, opening-motion, and
  reduced-motion coverage is green. Independent closeout audit passed 100/100.

- Button and regular Dialog follow-up: primary and destructive Button roles
  own the Glaze glass finish. The processed-style browser matrix checks glass
  gradients, inset shadow, backdrop blur, rim, catch-light, and contrast in
  light and dark. Regular Dialog uses the inset panel and shared compact
  actions. A rejected action keeps the dialog open and shows a tinted,
  announced retry message above the footer, preserving focus on close.
- Native Field disabled state reaches Input and Textarea; the state matrix
  checks the disabled appearance. The anchored overlay contract checks
  directional translation without scale and verifies reduced motion.
- Live Chromium opened Invite member and Connect repos in light/dark at
  1280px and 390px after hydration. The eight captures are under the local
  visualization folder, form-dialogs. The older Invite reference is a Glaze
  baseline view; the remaining reference captures were blocked by its local
  sign-in failure. The full monorepo suite exposed worker, auth/Postgres, and
  Node fallback failures outside this UI pass; package UI tests passed.

- Toolbar has no app route consumers. The component-state fixture verified
  horizontal and vertical keyboard navigation, focusable disabled actions
  that refuse activation, Home/End, group exit, keyboard action source, and
  1 × 16px horizontal and 1px vertical separators with Glaze clearance.
- RelativeTime now shows “Unknown time” for malformed timestamps instead of
  throwing during render. Focused rendering tests cover invalid strings,
  numbers, and Date objects alongside valid timestamp semantics.

- Independent rechecks closed the Toolbar spacing and RelativeTime edge
  cases. The component matrix now rejects a taller horizontal separator or
  incorrect clearance, and timestamp tests cover fallback attributes and
  the full UTC date and time. UI and web typechecks passed.
- The Members route passed 64 browser cases across expanded and collapsed
  sidebars, four viewport widths, two themes, two text scales, and both motion
  preferences. The audit recognizes the dedicated Settings navigation, which
  replaces Search and the repository switcher on these routes. Current
  captures are under .design-system/ui-contract/demo-team-settings-members--*.
- Avatar and Progress browser fixture now covers loaded and broken images,
  valid → broken → valid source replacement, exact announced progress counts,
  an indeterminate sweep, and a still reduced-motion fill. Opened Members on
  the migration server and measured all three 36px square member avatars.
  Matched fixture before/after captures in light and dark at 390px and 1280px
  are in the local visualization folder under avatar-progress.
  The identity family remains provisional. The audit identified pre-existing
  AvatarGroup parity gaps in overflow count sizing and discoverability, avatar
  overlap and cutouts, plus size and glyph differences in non-photo fallbacks.
  Progress audit follow-up restored the 1px inset edge and minimum visible
  fill at small positive readings. Chromium measured 6 × 6px at 1/10,000,
  zero width at 0, and a still, start-aligned half fill under reduced motion.

- Restored AvatarGroup overlap and 2px cutouts, the four Glaze avatar/count
  sizes, centered exposed initials, and Bot/Globe glyphs. Hidden names are
  available on hover and keyboard focus. The state matrix verifies geometry
  and focus return after Escape. The live Members route measured 32 × 32px
  for each large avatar. Matched group captures are under avatar-group in the
  local visualization folder.

- Badge and Icon passed independent review. Badge preserves Glaze sizes,
  spacing, tag corners, status fills, and forced-colors edges. Icon treats
  whitespace-only labels as decorative. The browser matrix covers light/dark
  at 390 and 1280px and all supported glyph sizes. The live Roles route showed
  both Built in badges at 20px with a 1px outline. Matched captures are under
  badge-icon in the local visualization folder. The old Badge count/max API
  has no app consumers and remains outside this repair.

- Roles and Connections each passed 64 authenticated shell cases across the
  two sidebar modes, four widths, two themes, two text scales, and two
  motion preferences. A live keyboard check found that Create role lost focus
  when Escape unmounted its dialog; Connect repos returned focus normally.
  Create and Edit now use the shared Dialog trigger, and reopening resets
  the draft. Live Create checks verified Escape, Cancel, focus return, and
  clean reopen at 390/1280 in light/dark. Before/after captures are under
  role-dialog-focus in the local visualization folder. No role was saved.
- Activity's Search audit now starts keyboard navigation at the skip link.
  Blurring the active element left Chromium's sequential navigation starting
  point elsewhere in the page, causing false misses on a dense timeline.
  Live Chromium reached Search in three Tab presses from the skip link.
  The first Activity run link navigated internally; its separate forge action
  pointed to the corresponding GitHub pull request.
- Activity passed 32/32 collapsed and 29/32 expanded shell cases after the
  keyboard audit correction. All three failures were at 768px with doubled
  text: the checker reported a missing repository label, although the final
  screenshots show it. Verdict labels visibly truncate at this doubled-text
  width and at 390px with normal text. Keep the Activity viewport contract
  open until both the filter reflow and the label measurement are resolved.
- Independent route review: 75/100 (provisional, round remains open).
  At 390px in light and dark, the Connections tab is partly offscreen and
  Activity timeline dividers intersect event text. Mobile Roles and
  Connections route captures include loading placeholders, so loaded-state
  parity still needs fresh matched baseline and migration screenshots.
  The reviewer separately verified the Create role focus repair.

- Mobile route repair: Activity verdicts retain their intrinsic label width
  inside the local horizontal scroller. Keyboard focus reveals the whole option
  without moving the page vertically. Verified 390px, 768px with doubled text,
  and 1280px in both themes. Timeline actor text now clears the verdict icon
  by 80px at 390px (previously overlapped by 38px); narrow rows wrap and reserve
  space for status, timestamp, and forge actions. Desktop columns are unchanged.
  The Connections tab now has a 16px inset at 390px after direct, client, and
  hash navigation, with manual scrolling retained. The older Glaze build also
  clipped the tab, so this is a carry-over fix. Matched pre-edit/post-edit
  captures are in activity-verdict-filter, activity-timeline, and
  settings-active-tab in the local visualization folder. Settled mobile and
  desktop reference/current captures for all three routes are in
  mobile-route-cohesion. The reference process was later confirmed to serve
  the appeals staging checkout rather than Glaze f4c34df5. Treat those files
  as historical comparisons only. The
  [audit score register](ui-sdk-migration-audit-scores.md) preserves scoped
  scores and re-audits for the final overview.
- Combined route shell verification passed 192/192 after rerunning the Settings
  shards against the stable server. The first parallel run included Vite reloads
  and one transition timing miss; the rerun had no failures. Activity now
  passes all 200% text cases. The independent targeted re-audit scored 98/100
  with no remaining blocker in the three fixes. Independently reviewed Roles
  images initially showed loading in both builds; replacement images explicitly
  wait for the fixture avatar and no skeletons. The score is for the repair
  slice; the overall composition and full route-cohesion gates remain open.

- Next Settings round: verified the canonical and legacy index redirects
  reach General in both demo-team and dev-owner. Redaction keyboard editing
  and Discard reset, and Billing feedback keyboard entry and focus return,
  worked at 390px and 1280px in both themes. Agents and Billing now use
  level-2 empty headings, leaving nested heading defaults unchanged. General
  Timezone now distinguishes Default (UTC) from explicit UTC, keys by
  option value, and references its visible label. Targeted browser checks
  verified both UTC rows and clean dismissal in four viewport/theme pairs.
- Account findings still to track: Delete account loses focus when exiting
  its loaded blocked step; a direct account hash may fail to scroll to its
  section. Session timestamps already truncate at 390px in the historical
  comparison; matching provenance must be established before calling it
  a regression. General Timezone and Redaction disclosure indicators also
  need a separate parity pass.
- Account Timezone restores the row's missing named container, so the
  existing compact layout places the fully visible label above the picker.
  At 390px the gap measured about 12.5px; at 1280px the row stays inline.
  All four viewport/theme pairs passed keyboard open and Escape focus return.
  Before/after evidence is in settings-account-agents. The true Glaze
  reference served on :5184; :5183 is the historical appeals staging build.
- Remaining Settings visual deltas from settled comparisons: General
  Timezone trailing chevron and deletion trigger tone; Redaction disclosure
  chevron and expanded row rhythm; Billing empty-state vertical rhythm.
  None was silently accepted as parity.
- Expanded shell matrix: General, Agents, and Billing passed 96/96 after
  the fixes. Redaction and Account had passed 64/64 before the local Account
  layout repair; Account's changed interaction and geometry were rechecked
  in all four core viewport/theme pairs. Full Settings parity remains open.

- Settings next repair wave: Account Delete dialog now uses a shared explicit
  final-focus target across the loading and blocked states. Escape and Close
  return to the Delete account button. Direct Account section links reveal
  the target and set the current nav item; client navigation and Back were
  verified. Account captures: account-focus-hash.
- General timezone restores an optional canonical Combobox disclosure, scoped
  to General; the existing layout still differs from the reference width.
  Delete organization uses the typed destructive dialog's coral trigger,
  one confirmation only, and the exact name gate. Cancel returned focus and
  the irreversible action was not submitted. Captures: settings-general-parity.
- Redaction and Responses share the restored compact disclosure. Trigger
  height is 26px, first row offset 34px in both themes and widths; the current
  20px Checkbox anatomy leaves 12px extra inline spacing and about 12px
  extra expanded height versus Glaze. Billing mascot and CTA match reference
  vertical positions. Captures: settings-disclosure-billing.
- The route verification index now accounts for all 56 modules and records
  settled evidence, guarded redirects, and remaining fixture states. This is
  coverage accounting, not a final route pass. Platform admin and workflow
  fixture presets are available, but seeding resets demo records and must
  be serialized after the current live audit.
- The independent follow-up audit gave the Settings repair slice 97/100.
  It initially found an apparent disclosure content loss in transition
  screenshots. Settled captures verified a 188px panel with all five inputs
  at 390px in both motion modes; the auditor withdrew the finding.
  Recheck and verified screenshots are in settings-disclosure-billing.
- Removed the public visual escape hatch and migrated both consumers:
  AgentRain owns its motion with reduced-motion gates and workflow labels
  use an SVG tied to validated provider colors. The run-chain connector
  derives its height from its containing rows via equal block insets.
  The lint baseline tightened to 40 arbitrary values, 0 direct imports,
  33 inline visuals, 250 raw colors, 335 raw spacings, and 177 raw type.
  Changed-line lint still reports violations across the migration diff.

- Timezone geometry rechecked independently. Account outer pill already
  matches Glaze. General had a 16px height increase because ui-sdk replaces
  the disclosure slot attribute. Canonical CSS now positions the real slot;
  32px height and 358/360px outer widths match Glaze. The inset/paper tone
  mismatch remains open at the Combobox owner.
- Schedule hint now lives in its named layout molecule; browser checks at
  390px and 1280px in light and dark verified actual scrollLeft synchronization
  and the same token-hint positions. Before/after: schedule-positioning.
- Appeals admin and public preview reached settled states against Glaze across
  both themes and widths. Playwright intercepted and aborted the settings POST
  on both builds: title, introduction and organization serialized identically.
  No settings were changed. Captures: appeal-portal-route.
- Signed-out login, signed-in device entry and expired-device/consent states,
  authenticated invite pre-join, and missing route screenshots recorded against
  Glaze at 390px dark. OAuth direct/error direct redirect to login, and both
  popup failures render the Close window control. Captures: public-edge-states.
- The lint baseline is now 37 arbitrary values, 0 direct imports, 31 inline
  visuals, 243 raw colors, 294 raw spacings and 171 raw type findings.

- Public-edge and Appeals audit scored 84/100. Restored explicit primary
  actions in Appeals sign-in/settings and Invite through Button, and fixed
  identity geometry for the painted 32×32 workspace avatar. All four
  viewport/theme combinations passed. Fixed captures use the fixed-3000
  prefix. Signed-in 404 Home link is present. Signed-in unknown invite
  redemption returns the same invalid-copy and Back home action on both builds.
- Independent composition follow-up scored 86/100 (previously 80). The
  OAuth callback now leaves validation and SEO in a 29-line route; its
  client page owns popup protocol and presentation. Sixteen signed-out
  browser cases passed, with four byte-identical failure screenshot pairs.
- Current full typecheck, Biome and package/UI boundaries passed. Tracked
  changed-line lint passed across 282 files before later repair edits.
  Three worker integration failures reproduced on clean Glaze. The
  scheduled-run database setup succeeded on isolated rerun (5/5). Popover
  passed on isolated rerun; its broad browser matrix now has a 20-second
  test budget rather than Bun's five-second default.

- Public CTA/avatar re-audit scored 87/100. Both public and admin variants
  have painted 32px org marks where present and primary action treatment.
  Legacy pending-capable buttons reserve a hidden spinner slot at rest;
  compact migration buttons therefore still differ materially in width.
  Appeals standalone shell matrix: 32/32 cases without reported failures.
- Workflow grid/editor/pending review: 48/48 isolated browser cases across
  four viewports and both themes. Matching Accept requests were intercepted
  on both, with no submission. Independent visual score 82/100. Copy toolbar,
  Accept emphasis and icon-only More geometry are separate correction work.
- Run detail local timestamp behavior restored in canonical RelativeTime.
  Both local and UTC are visible in the hint; keyboard Tab then Escape
  preserves the trigger focus. The actual run passed four viewport/theme
  cases. Evidence: workflow-run-route-verification/run-time-focused.json.
- Browser-agent product bridge allows only Combobox open/close through
  setOpen; confirmed both on a real control in Chromium. Query selection
  and clearing are denied without or with agent-supplied confirmation.
- Integrated full test snapshot: 5,442 passed, 2 skipped, 26 failures and
  13 errors before follow-up repairs. The three behavior failures reproduced
  on clean Glaze; scheduled database setup and Popover pass on isolated rerun.
  Other database hooks timed out. The UI suite independently passed 64/64.

- Shared IconButton small desktop visual geometry now 26×26px on workflow
  Grid. Both Grid and editor retain the 44px coarse-pointer minimum. Six
  Enter/open/Escape/focus-return cases passed.
- Diff toolbar Copy, Wrap and Collapse are 26px high on the shared baseline
  in both themes and widths. Copy icon and Accept primary emphasis restored;
  Wrap exposes real pressed state with IconToggle. Eight browser cases passed
  including clipboard, keyboard and an intercepted Accept request.
- Finite choice/removable chips replaced the catch-all Chip API. Verified
  selected and removal keyboard behavior and focus on Mascot, Honeypot and Home.
  OAuth waitlist and Queue moved to auth page owners, with eight byte-identical
  before/after screenshots. A planted CI boundary check keeps route visuals out.
- Codebase composition re-audit: 90/100. Tracked changed lines pass relative
  to POC HEAD. Direct Oxlint of 119 as-yet untracked sources found 273
  diagnostics in 33 files, 194 design-system and 79 antislop; this is not a
  count under Git rename detection and blocks claiming final CI green.

- Canonical Card, Panel and Item no longer accept chrome overrides. Card
  comparison covered Home, Rules, Activity and Run in 16 viewport/theme
  cases. Item verification matched Account geometry and paired screenshots
  decoded to identical pixels. Independent scoped Item follow-up 97/100;
  separated PickerRow action layout from the full target hit-area selector.
- Chart frame, plot, strip and tooltip use semantic owners; actual 24-point
  plot bounds and keyboard ArrowRight matched Glaze. Raw evidence JSON
  search, copy, indentation and keyboard navigation passed eight captures.
- The temporary index includes prospective additions and rename detection
  without changing the real index. PR-style changed-line lint passed across
  403 TypeScript files with the final reduced lint baseline. Composition
  re-audit 93/100. This does not certify app-wide Glaze or behavior parity.
- Staff seeded all six route headings; Users, Orgs, Repos and Installations
  each reached five populated rows. Users regained table frame anatomy and
  nonwrapping column labels. Drawer again names the opened user and primary
  Approve, and Escape closes in four current viewport/theme cases. No
  moderation writes were executed.
- Workflow Grid title-row correction matched card/title/footer positions
  and preserved the wider touch hit target. The public Appeal preview
  restored its inset border, and Activity's date control recovered the
  named layout role; exact control geometry and selecting Last 7 days
  pass in both themes. Remaining public sizing differences are captured.
- Rule outcomes: the desktop controls touched. Restored the shared 16px
  gap, with a single column at mobile widths, and returned the number suffix
  inline. Four loaded Account age captures after the fix at 390px and 1280px
  in both themes, with matching Glaze reference images and 32px controls.
- Latest full run: 5,579 passed, two skipped, ten failed. Six failures were
  traced to the inaccessible workflow problem marker trigger; the focused
  fix passes 18 cases. GitCafe recovery passed twice by itself after its
  full-run Postgres startup failure. The remaining three worker rule outcomes
  also fail on Glaze f4c34df5. Full suite is not green.
- Latest independent Workflow Grid card slice: 85/100. Search, switch tone,
  glyphs and coarse-pointer target differences remain; see the score register
  and route verification index for complete scope and open gates.
- Rule settings write parity: Account age Save changes (7 to 8 days) and
  Pull requests outcome (Warn) sent identical payloads on both builds;
  both intercepted requests were aborted before server execution.
- Latest complete web and UI slice: 1,355 passed, one skipped, zero failures.
  Root typecheck, both boundary checks and alternate-index lint (404 changed
  TypeScript files) passed. Browser workflow node and connection markers
  now open by keyboard and restore focus on Escape.
- New route fixtures: populated Rules Installed and Library in a paired
  matrix, plus Replay with 238 seeded change requests and a stored-empty
  variant. Installed card geometry now matches; Library controls still differ.
  Missing-preview Replay stalls after polling on both reference and migration.
- The browser agent previously exposed its own Allow control and the parent
  Dialog as actionable. Planted Chromium test failed on both exposures, then
  passed after the approval portal became agent-hidden. Human approval and
  dismissal still work. Dialog interaction coverage passed.
- Workflow Grid checked Switch thumb and StatusMark glyphs restored on both
  themes and widths. Track width and gradient remain open; the 85/100
  independent score predates this fix and is not a final re-audit.
- Independent populated Rules Installed follow-up: 87/100. First card
  geometry matches Glaze and keyboard tab selection/focus works. A subsequent
  unscored pass matched the 80px header and 64px footer sparklines and their
  contrast; segment width, description rhythm and Library remain open.
- Replay footer spacing, frame and 12px text rechecked at 390px and 1280px in
  both themes; the shared button is ~5px narrower. Saved paired captures.
- Org General Save now follows Input value changes; verified keyboard name
  change and matching intercepted rename payloads. The save control uses
  primary styling as in Glaze. Actual writes and provider exchange remain
  outside these captures.
- Actual registered agent tools cannot make member role changes, decide
  appeals, grant OAuth or device scopes, or approve/block Human review.
  Human actions made expected requests intercepted before server execution.
  Project browser-agent tools are not a substitute for server permissions.
- Isolated Staff Users agent checks blocked row and drawer cooldown,
  direct and bulk approvals, declines and enabled impersonation, including
  the portaled decline confirmation. Keyboard Cancel returned focus; human
  actions emitted intercepted requests. No staff writes were sent.
- Final narrow check after Staff: 23 passed, zero failures, 230 assertions.
  Both boundary checks, Biome, repository typecheck, component states, and
  prospective 404-file changed-line lint passed locally. The audit found
  all 56 route modules accounted for. Full visual, permission and write
  parity, and full integrated green remain required.

- Public-vessel round captured the Login, Invite, Appeals preview, and Appeals
  admin routes at 390px and 1280px in both themes. Glaze comparisons and real
  migration before/after screenshots are in public-vessel-cta-round. Three
  async CTAs retain the larger of idle copy and pending copy with its spinner:
  Sign in with GitHub 161.95px, Join org 90.83px, and Save changes 119.89px.
  Keyboard activation produced one intercepted request each. Login card framing
  and FAQ height match Glaze. Portal Settings textarea and panel heights and
  field fill match, with a residual mobile panel position from the interactive
  empty-inbox ghost. The compact FAQ width and dev-only disclosure placement
  still differ. No provider flow, invite redeem, or settings write was executed.
- Product direction for a separate Replay follow-up: a dedicated sandbox
  that lets a maintainer run a draft ruleset against recorded repository
  activity, compare the outcome to the live ruleset, and inspect what
  changed and why. Keep simulation separate from actions and activation.
  Synthetic scenarios can answer explicit what-if questions; they do not
  predict future repository events. The migration preserves today's
  rule preview behavior and does not implement that new sandbox.
- Independent Grid switch 93/100; Rules Installed and Library 83 to 90
  before the long-title follow-up; public vessel/CTA 83/100. Score register
  records remaining unapproved geometry, surface and spacing differences.
- Replay now exits the missing-preview skeleton after 12 successful empty
  replies, verified at desktop and independently in both mobile themes.
  The stored evidence and simulator direction are separate concerns.
- General and Account timezone pill fill, border, width and keyboard
  dismissal compare against Glaze in 16 browser cases. Timezone submission
  parity remains open: the separate intercept probe did not reach selection.
- Paired intermediate and wide comparison: 48 successful captures across
  Home, Members, General, Rules, Activity and Appeals, both themes per build.
  No horizontal overflow. The two 768 light skeleton samples were recaptured
  after settling, replacing their original PNGs in intermediate-wide-route-sample.

- Workflow Editor Code refusal restores the Glaze shell border and fill through
  the existing Card with a contextual layout role. The notice frame matched at
  390px and 1280px in both themes. A valid code file still copies and wraps by
  keyboard. Evidence: workflow-code-notice, with earlier migration before
  captures in workflow-run-route-verification. No workflow was changed.
- Controlled full suite: 5,585 passed, two skipped, one GitCafe connection
  database setup/teardown timeout. That file passed all five cases in
  isolation. The three formerly red exemption tests pass when the local
  TRIPWIRE_DISABLE_EXEMPTION override is explicitly false. Production code
  and the developer's setting were not changed. Changed-line lint passed
  across 405 TypeScript files; the integrated run does not prove final
  full-suite green.

- Replay Show all now focuses the first newly revealed row on keyboard
  activation. Chromium reproduced the focus loss before and verified all 238
  rows and new focus after at 390px and 1280px in both themes. Evidence is in
  replay-show-all-focus. Replay install write parity remains open.

- Grid Create split uses a shared joined seam and whole-group anchor. Its
  default caret turns up on open. Independent comparison 84/100. Popup density,
  placement and typography still need work. FilterBarSearch regained the Glaze
  slash hint on fine pointers. Independent Grid and Rules comparison 90/100.
  Field widths, start inset and weight differences remain.
- Rechecked Replay focus after moving row geometry to the existing layout
  contract. The baseline fell to 17 arbitrary values, 147 raw colors and 225
  raw spacing entries. Changed-line lint passed across 405 TypeScript files.
- The controlled integrated retry hit a Postgres startup timeout in
  rearm-backfill. All four tests in that file passed in isolation. Full-suite
  green remains open.
- Docker and the development Postgres were healthy. The previous 5,586-pass
  integrated run lost a disposable Postgres startup in rearm-backfill.
  The test fixture now retries the whole startup, bounds individual probes,
  retains failure causes, and gives attempts unique container names.
  Both previously affected files passed together (9 tests). An injected
  unreachable PostgreSQL port proved replacement and cleanup of the first
  container. The full suite was restarted against the updated helper.

- Full suite after the Postgres retry repair: 5,590 passed, two skipped,
  zero failures. Workflow Grid Templates compact menu and responsive opening
  independently scored 100/100 in 22 browser cases. Remaining filter and
  full-route checks are open.

- Compact search text inset and weight match Glaze. Independent Grid and
  Rules audit scored 96/100 across 24 Chromium cases. Desktop widths still
  differ by 4px and 2px respectively because of neighboring controls.

- Restored the Glaze filter-select label-to-caret gap to 6px using the
  existing spacing token. Workflow Grid and Rules desktop search widths
  now match at 508.39px and 571.89px. Both narrow rows remain 340px.
  Independent comparison covered 24 Chromium cases with light and dark
  themes and fine and coarse pointers. Real before and after captures
  are in filter-row-width-parity.

- Restored single-choice filter dismissal through the shared Menu radio
  contract. Paired Grid and Rules keyboard selections update the sort,
  dismiss the menu, and return focus in both themes and widths.
  Saved the eight Grid open and selected screenshot pairs in
  filter-row-width-parity. The Menu browser regression test passed.

- Independent filter menu dismissal scored 100/100. Grid and Rules
  passed 16 paired keyboard cases. Desktop pointer selection returned
  focus. Analytics Contributor stayed open after checking an option and
  restored focus on Escape. The UI package typecheck passed.
- Started the navigation round on Admin Users. The populated pagination
  footer matched local width, height, range text, and disabled edge
  controls at 390px and 1280px in both themes. Its page position is about
  24px lower in the migration. Multi-page navigation remains open.

- Admin Users Access status uses the shared compact SegmentedControl again.
  A paired 55-user Chromium fixture verified Next, Previous, range labels,
  and disabled edge controls at 390px and 1280px in light and dark.
  The toolbar heights match Glaze at 103px and 36px. The extra last-row rule
  was removed from card Tables. The pagination footer now differs by
  0.5px vertically. Admin Organizations, Repositories, Installations and
  empty Users pagination showed no overflow in the paired dark checks.
  Evidence is in admin-pagination-parity. Web typecheck and 12 focused
  tests passed. Compact segment widths and selection-column alignment
  remain open.

- Admin Users follow-up independently scored 96/100. Access status,
  Online now, and Search match Glaze geometry in both widths and themes.
  The compact borders, 40px selection column, 16px checkboxes, and 20px
  avatars match. All eight paired keyboard and pagination cases passed.
  The User column remains 1.92px wider at 390px and 3.41px wider at 1280px,
  and the table is 0.5px taller. Evidence is in admin-access-final-recheck,
  with pre-edit captures in admin-access-before.
  Dark-mode checks at both widths also matched the Activity verdict and
  Home attention filter widths. Analytics Metric fills the row in the
  migration and Mascot Resting face is 2px wider overall. Those differences
  remain open. The related captures compare Glaze with the final build.

- Analytics Metric regained intrinsic width and matched Glaze at 270.52px.
  The independent audit scored 100/100 and verified arrow-key selection
  with focus retained. Activity and Responses geometry smoke checks passed.
- Mascot Resting face regained Glaze shell and content spacing. The
  independent visual score is 96/100. The local control and card match,
  but mobile document position remains 21.81px higher. Happy activation
  did not settle as selected on either build during the paired audit.
  The pre-edit captures in metric-mascot cover dark mode. The independent
  comparison covers light and dark.
- Expanded the catalog contracts for Breadcrumb, Pagination, and Steps.
  The link and step interaction coverage gaps are still open.

- Added Chromium coverage for the shared navigation contracts. The test
  follows breadcrumb and pagination links with the keyboard, checks
  current-page markers and first/last page edges, and verifies display-only
  and interactive Steps, disabled future steps, and focus retention.
  Admin Users pagination retains its existing app-level evidence. The
  navigation and Button browser tests and UI typecheck passed. This was a
  behavior verification round with no production visual changes.

- Account Deletion Continue now advances to typed confirmation. The shared
  Dialog action allows this step to keep the dialog open after success.
  A live member fixture in Chromium verified Check, Confirm, Back, Escape,
  focus restoration, and the disabled confirmation in four cases across
  390px and 1280px in both themes. No deletion was submitted. An added
  regression case checks a continuing action and focus return in Dialog.
- Toast announcements and dismissal now have Chromium coverage. Canceling a
  destructive toast confirmation keeps the notification available and
  restores focus to its action. Explicit confirmation invokes the action
  once and dismisses the notification.
- The registered browser agent test now exercises the real app provider
  with a stub registration transport. Hidden targets, disallowed actions,
  and the confirmation boundary pass. Native browser transport remains open.
- Typography verification sampled five paired routes in 120 Chromium renders
  covering both themes, 320–1280px, and 200 percent CSS text enlargement.
  Heading structure and page widths passed. Analytics text clipping,
  native browser zoom, and further route verification remain open.

## Analytics reflow and native browser audit

- Analytics chart headings, event metadata, and Metric options reflow in the
  route instead of clipping. Chromium passed eight CSS text-size cases and
  eight native zoom cases across light and dark, with 24 targets measured in
  each case. ArrowRight selected a metric and Enter opened an event's run.
- Native Chromium passed the five-route zoom sample. All 20 cases at 200
  percent had zero page or main overflow. The Analytics repair also has
  separate evidence for its below-fold event rows.
- Native WebMCP registered and invoked snapshot, query, and act on signed-in
  Moderation and Activity in Chrome 156 and 157. Actuation opened and closed
  Sort. Three protected moderation controls were excluded and rejected with
  zero decision requests. Route changes and fresh registration were observed;
  stale tool rejection and the API-disabled fallback remain open.
- Independent composition audit scored 92/100 and checked 56 of 56 source route
  modules. The paired runtime audit had 11 usable pairs across 10 distinct
  public route and viewport states. WSL timeouts and inconsistent fixture
  sessions prevented paired signed-in visual verification. Full cohesion
  scoring, permission states, and request-body parity remain open.
- Notra findings are recorded in
  [Settings composition](ui-sdk-notra-settings-composition.md). They propose
  a stable section and table frame built from existing Tripwire primitives.

## Account and Workflow Review follow-up

- [x] Match Notra's standalone Delete account panel with the Tripwire settings
  frame and give Sign out a separate panel. The Account audit scored 97/100
  across eight light and dark browser renders. It verified both focus-return
  paths and observed zero attempted writes. Notra fills the entry button red.
  Tripwire uses the destructive button on the final confirmation step.
  Local browser evidence is in account-actions-notra-independent. The
  preceding desktop dark and mobile light captures are in
  account-actions-independent.
- [x] Fix the narrow deletion wizard header and restore focus when leaving
  the typed confirmation. Verify reopening returns to the first applicable
  step. Local evidence is in account-deletion-wizard.
- [x] Restore the accepted, declined, and expired Workflow Review notices.
  Their icons, stacked copy, and fills match Glaze in 12 paired cases at
  390px and 1280px in both themes. The accepted link worked by keyboard.
  Independent score: 100/100 for the notice slice. One reference capture
  came from the earlier run using the same fixture.
  Local captures are in workflow-review-terminal-independent.
- [x] Compare General timezone and Redaction Save payloads with Glaze.
  In two paired viewport and theme combinations, each change emitted one
  matching intercepted request per build. Both settings then persisted after
  a real browser save and reload on a separate disposable organization.
- [x] Remove the standalone Sign out card and use the destructive style for
  the Account deletion launcher. The independent audit passed all eight
  viewport and theme cases with keyboard open and focus return.
  Browser evidence is in account-actions-followup-audit.
- [x] Complete the frozen browser sweep at four widths in both themes. It
  recorded 1,008 route cases across both builds with no horizontal overflow
  in measured cases. Retakes loaded Home, public Appeals, Admin, Workflow
  Editor, and the Workflow Grid on both builds. The callback and queue
  redirected to the same destinations. Full OAuth sign-in and the remaining
  write paths stay open. Evidence is in app-wide-5500.
- [ ] Reconcile the app-wide matrix and remaining write paths on a frozen
  revision, then record the independent score and CI result.

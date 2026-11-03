# Accepted design direction

## Identity

Tripwire is an operator’s contribution gate: direct, evidence-first, compact, and calm under pressure. Screens should make the next decision and its consequences obvious without turning routine repository work into a marketing dashboard.

## Active system

Glaze is the sole visual implementation. `@tripwire/ui` owns the application-agnostic semantic contract; web owns product-specific composition. Quartz is historical only and must not appear in runtime code, tokens, configuration, route styling, or review criteria.

Source priority:

1. Accessibility, keyboard behavior, permissions, and preserved product behavior.
2. `@tripwire/ui` semantic typography, color, state, and layout contracts.
3. The installed Glaze component and token rules.
4. Existing product terminology and real data.
5. Antislop as a filter against generic composition.

Where older Tripwire or Quartz documents conflict with this file, this file and the recorded Glaze-only decision win.

## Personality

- Dense enough for daily repository operations, never cramped.
- Near-monochrome ink and paper; hue is reserved for real status and danger.
- Plainspoken labels and helper copy; no hype, cute filler, or duplicated headings.
- One clear primary action per decision group.
- Evidence and consequences outrank decoration.

## Composition

- Use semantic page, section, collection, form, and action molecules before page-local layout.
- Group with spacing first. Add a shell or panel only when it clarifies one actionable working region.
- Avoid equal stat-card grids, nested cards, decorative icon tiles, colored side rails, status dots, and eyebrow labels.
- Keep route declarations thin. Loading, empty, error, populated, permission, pending, and overflow states share the same structural hierarchy.
- Responsive layouts must remain reachable at 320px and 200% text zoom; actions wrap without detaching from their subject.
- Daily decision routes use a task-first single column: evidence and actions lead, while analytics and secondary context follow instead of competing beside the queue.

## Typography and copy

- Use only the closed semantic typography roles from `@tripwire/ui`.
- One page title; headings follow document hierarchy rather than visual convenience.
- Mono is for copied identifiers, paths, and code, not status or decoration.
- Sentence case. Actions use a verb and object where the object is not already unmistakable.
- UX polish may tighten hierarchy, grouping, labels, and helper copy, but cannot change permissions, server writes, route capabilities, or product meaning.

## Color, surface, and motion

- Semantic foreground/background pairs own color. Feature code does not choose palette values.
- Focus, selection, invalid, disabled, pending, open, and pressed states remain visibly distinct in light and dark themes.
- No gradients, glows, decorative blur, backdrop blur, or shadows.
- Glass belongs only to the one leading pressable action in a group.
- Motion communicates state or continuity, respects reduced motion, and never delays reading.

## Dials

- ENERGY: 2/5 — restrained, with emphasis earned by decisions and status.
- RHYTHM: 3/5 — compact daily-tool cadence with deliberate breathing room between regions.
- MOTION: 1/5 — short state transitions only; no decorative entrance choreography.

## Redesign method

Moderation established the route language through three temporary operational-density variants. The selected Focus direction is now the accepted pilot: a relaxed single task column, review evidence and actions with room to wrap, and analytics below the queue. The picker and rejected Split and Scan implementations are removed before route-family fan-out.

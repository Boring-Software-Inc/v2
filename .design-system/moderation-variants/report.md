# Moderation composition variants

The picker is development-only on the real `/$org/$repo/moderation` route. Set `__variant` to `focus`, `split`, or `scan`; the picker preserves collection search and filter state.

Primary axis: **operational density**. All three retain the same data, writes, permissions, filters, confirmation, analytics, and route shell. Secondary structure changes follow from how much parallel context each density level can support.

## Directions

| Variant | Axis position | Composition | Right when | Costs |
| --- | --- | --- | --- | --- |
| Focus | Lowest density | Relaxed single task column; each review row gives evidence and actions more room; analytics follows the queue | Decisions require careful reading and the queue is the clear primary job | More vertical travel; analytics is below the first viewport |
| Split | Medium density | Queue and analytics share the desktop workspace; analytics remains visible while decisions are made | Recent verdict patterns are useful context during review | The queue column is narrower, so long evidence truncates sooner |
| Scan | Highest density | Wide queue with one-line desktop rows; analytics follows as a full-width secondary panel | Experienced operators process a larger queue and recognize evidence quickly | Highest information density; less room for explanatory hierarchy |

## Evidence

- `focus-{1280,390}.{png,aria.yml}`
- `split-{1280,390}.{png,aria.yml}`
- `scan-{1280,390}.{png,aria.yml}`

## Shared floor

- All variants render in the real dashboard shell with six seeded review items.
- 320px checks produced no document overflow; review actions wrap and remain inside the viewport.
- At 390px, all variants stack to one column and preserve full action labels.
- A 200% zoom probe produced no document overflow.
- Keyboard semantics and accessible names are inherited from the production controls; accessibility snapshots remain equivalent apart from the development picker.
- Reduced-motion rendering and console checks passed; no new page or console errors were observed.
- Existing shell navigation uses a horizontally scrollable strip at narrow widths. That common shell behavior is outside the variant axis and remains a promotion-stage hardening item.
- Setup-only onboarding remains its own production composition rather than being forced into a queue variant.

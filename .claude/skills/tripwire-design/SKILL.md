---
name: tripwire-design
description: Tripwire's visual language distilled from the redesign demo — color tokens, type scale, spacing, radius, and motion. Invoke when building or reviewing any UI surface so it matches the demo instead of inventing a look.
---

# Tripwire design system

The redesign demo (`apps/web`) is the design, final. New surfaces MUST match it.
All values below are lifted from `apps/web/src/styles.css` and the demo's
components — treat them as the source, not suggestions. Everything is Tailwind v4
tokens (`@theme`), light + `.dark`, OKLCH.

## Color tokens (use the token, never a raw hex/oklch)
Semantic surface + text tokens, resolved per theme via CSS variables:
- Structure: `background`, `foreground`, `card`, `popover`, `border`, `input`,
  `ring`, `container`.
- Elevation ladder: `surface-0` < `surface-1` < `surface-2` (subtle stepped
  greys; `surface-0` is the lowest card, `surface-2` the raised one).
- Intent: `primary` / `primary-foreground`, `secondary`, `muted` /
  `muted-foreground` (the workhorse for de-emphasized text), `accent`,
  `destructive`.
- Brand: `brand` (`oklch(63.7% 0.167 254deg)`, a blue) and `brand-dev` (amber).
  Brand is used sparingly — this is a near-monochrome zinc/grey UI with brand as
  a punctuation color, not a fill.
- Sidebar has its own `sidebar-*` token set; charts use `chart-1..5`.
- **Severity is the ONE place a hue is earned:** critical `bg-red-500`, high
  `bg-amber-500`, medium `muted-foreground/60`, low `muted-foreground/30` — a
  dot marker, not a filled pill. Keep it that restrained.
- Dither charts use a fixed palette union (`DitherColor`: green, blue, purple,
  pink, orange, red, grey) — pick from it, don't add hues.

## Typography
- Families: `--font-sans` = Geist Variable → Inter → system; `--font-mono` =
  Geist Mono Variable; `--font-pixel` = Silkscreen; `--font-pixel-geist` = Geist
  Pixel (display face, dither-kit docs only).
- **Base body is small and calm:** `body` is `13px`, `font-weight: 450`. Mono/
  code get `letter-spacing: -0.02em`, weight `450`.
- Type scale (`--text-*`, rem + tuned line-heights): `sm .875/1.45`,
  `base 1/1.55`, `lg 1.0625/1.45`, `xl 1.1875/1.4`, `2xl 1.375/1.3`,
  `3xl 1.625/1.2`, `4xl 1.875/1.15`, `5xl 2/1.1`. Larger = tighter leading. Use
  the scale; don't hand-pick sizes.

## Spacing
Tailwind's default 4px spacing scale. The UI is dense and quiet — prefer tight,
consistent gaps (`gap-1`/`gap-2` in rows, `gap-4` between cards) over generous
whitespace. Match neighboring components rather than introducing new rhythm.

## Radius
Driven by `--radius: 0.625rem` with derived steps:
`radius-sm = radius-4px`, `radius-md = radius-2px`, `radius-lg = radius`,
`radius-xl = radius+4px`. In practice: **`rounded-md` is the default** (most
common), `rounded-lg`/`rounded-xl` for cards and larger panels, `rounded-full`
for avatars / pills / dots. `rounded-sm` is rare.

## Motion
- **CSS transitions are almost always `transition-colors`** (hover/state on rows,
  buttons, links). Occasionally `transition-opacity` / `-shadow` / `-transform`.
  Durations stay short: `duration-200` default, `duration-500` for the rare
  larger fade. Avoid `transition-all`.
- **Real animation uses `motion` (Framer) springs, not eased tweens.** House
  springs are snappy and slightly damped: `type: "spring"` with
  `stiffness: ~320–480`, `damping: ~34–44` for entrances/layout; stiffer
  (`stiffness: 520–600`) for small quick pops. Numeric counters use
  `@number-flow/react`.
- Respect `prefers-reduced-motion`. Motion is functional (state, presence,
  count changes), never decorative.

## Feel, in one line
Dense, near-monochrome, zinc-and-grey dashboard; brand blue as punctuation;
severity as the only earned hue; small 13px calm type; `rounded-md` default;
snappy springs, color-transitions everywhere else. When unsure, open the nearest
existing demo component and match it.

## Type + spacing scale (run page, evidence — locked)
Do not re-invent a 13px padding. This scale is the source; snap to it.

- **Mono is reserved.** ONLY rule ids (`account-age@1`), file paths, and inline
  code render in Geist Mono. Line numbers, severity words, confidence, timings,
  and statuses are all SANS. Monospacing a status label is a bug.
- **Vertical rhythm is a 4px unit.** Every padding, margin, and gap is a multiple
  of 4 (`p-1`/`p-2`/`p-3`/`p-4`, `gap-2`/`gap-3`/`gap-4`). No `p-3.5` (14px), no
  `py-2.5` (10px) — if a Paper export lands off-grid, snap it to the nearest 4.
- **Line-heights snap to 16 / 20 / 24.** Sizes: `11px/16` (meta — line numbers,
  counts) · `12px/16` (labels, rule ids) · `13px/20` (body, finding reasons) ·
  `15px/24` (the statement — a rule's summarize line on a failed step).
- **Two horizontal axes inside a step: the content edge, and ONE indent for
  evidence.** Do not add a right-aligned gutter column (a duration/status column
  pinned right invents a third edge and opens a dead gap) — keep trailing meta
  inline, hugging its content.
- **Colour is a budget.** In a step, the status badge is the only saturated
  element; a passed step is muted/quiet. In a finding, the severity word carries
  the one hue and the card's fill is tinted by severity — nothing else (line
  numbers, paths, code chips) takes colour.

## File + finding evidence (ai-review — locked)
- **File container:** `surface-1` fill, `rounded-xl`, NO border (fill-only reads
  as raised, not nested). Header = file icon · path (directory dim ~55% /
  basename bright + weight 500) · severity counts on the right. Links to
  `github.com/{repo}/blob/{sha}/{file}`.
- **Collapse is a density affordance, not a default:** a file with ≥ 3 findings
  renders COLLAPSED behind a disclosure chevron; < 3 renders inline, no chevron.
- **Finding card:** fill-only, no border, `rounded-md` (8px), background TINTED by
  severity so no two severities share a surface — critical = surface-1 + ~7%
  destructive · warning = surface-1 + ~6% amber · note = plain surface-1. Meta
  line = severity word in its colour then `line N` (muted sans); the reason is
  the brightest text in the block (`13px/20`, foreground). The reason is the
  payload, the path is a label — never invert that weight. A finding is always a
  negative observation: it has NO pass/fail badge.
- Inline backticks in a reason render as `<code>` chips (`surface-2` fill, mono,
  11.5px), sanitized as text — never as HTML.

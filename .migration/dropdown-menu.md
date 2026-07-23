# dropdown-menu

2026-07-22, transformation engine, renamed + restructured mapping (DropdownMenu -> Menu), migrated clean.

## Changed

- apps/web/src/components/ui/dropdown-menu.tsx: @radix-ui/react-dropdown-menu
  -> @base-ui/react/menu. Content restructured Portal > Positioner > Popup:
  side/align/sideOffset/alignOffset live on the Positioner (isolate z-50),
  sideOffset default 6 kept, popup classes unchanged. Item highlight hook
  focus:bg-surface-0 -> data-highlighted:bg-surface-0 (Base UI highlights
  via data attribute, not DOM focus). Label stays a PLAIN DIV on purpose:
  Base UI's GroupLabel requires a Group wrapper, radix's Label was a free
  div, and the topbar uses it free-floating; a div preserves exact semantics.
- Consumer call sites:
  - dashboard-topbar.tsx: trigger asChild-button flattened into the Trigger
    itself (it renders a native button; classes moved onto it); the Settings
    link item became render={<Link/>}; sign-out item's focus:text-destructive
    -> data-highlighted:text-destructive.
  - workflows-grid-page.tsx: both asChild Button triggers became
    render={<Button/>} (disabled moved to the Trigger on the template menu).
- Leftover scan: source has zero @radix-ui imports. bun.lock retains 17
  transitive @radix-ui entries pulled by cmdk (third-party, never touched
  per the skill's hard rule).

## Left alone

- rule-filters sort control and editor selects are native <select> /
  hand-rolled, not this wrapper.
- cmdk, sonner: not radix, untouched.

## Behavior changes

- Base UI menu items close on click by default (closeOnClick=true), same as
  radix's onSelect default: our items used onClick already, so no change.
- Item highlight is data-highlighted (pointer + keyboard both set it);
  visuals identical, mechanism differs.

## Verify by hand

- Topbar avatar menu: opens on click, arrow keys move highlight, Enter
  activates, Settings navigates (renders as a link), sign out shows red on
  highlight, Escape closes and returns focus to the avatar button.
- Workflows grid: the template split-button menu and each card's actions
  menu open aligned to the right edge; rename/delete items fire.

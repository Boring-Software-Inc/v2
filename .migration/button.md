# button

2026-07-22, transformation engine (no components.json; hand-rolled wrapper), migrated clean.

## Changed

- apps/web/src/components/ui/button.tsx: Slot/Slottable idiom replaced with
  the real @base-ui/react/button primitive. Props are ButtonPrimitive.Props
  (render replaces asChild; nativeButton supported natively). cva variants,
  sizes, iconLeft/iconRight slots, and data-slot attributes unchanged, so
  every existing class and style survives. Slottable dropped: with render,
  children stay children, icons stay siblings.
- 8 asChild call sites converted to render={<Link/>} / render={<a/>} with
  nativeButton={false} (non-button trigger rule):
  not-found.tsx:15, invite-page.tsx:57+75, org-home-page.tsx:138,
  analytics-page.tsx:101 (className moved from the Link child onto the
  Button so the merged class set is identical), install-setup-page.tsx:45+94+160.
- Leftover scan clean: grep "radix-ui|@radix-ui" on all touched files: no hits.

## Left alone

- 4 remaining asChild sites are DropdownMenu parts (dashboard-topbar x2,
  workflows-grid-page x2); they convert with the dropdown-menu component.
- badge.tsx still imports @radix-ui/react-slot; it is the next component.

## Behavior changes

None expected: Base UI Button renders a native button by default; link
renders are explicit nativeButton={false}. Disabled styling still flows
through the disabled: classes.

## Verify by hand

- Any page with a primary button: click, focus ring, disabled state.
- not-found "Back to moderation", invite "sign in"/"back home", org home
  "install the app on github", analytics "back to moderation": each renders
  as a LINK (right-click shows link menu), keyboard-activates with Enter,
  and navigates.

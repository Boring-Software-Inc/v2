# dialog

2026-07-22, transformation engine, restructured mapping, migrated clean.

## Changed

- apps/web/src/components/ui/dialog.tsx: @radix-ui/react-dialog ->
  @base-ui/react/dialog. Part renames: Overlay -> Backdrop (still exported
  as DialogOverlay), Content -> Popup (centered modal, no Positioner).
  ANIMATION MODEL CHANGED per the class mapping: the radix keyframe classes
  (data-[state=open]:animate-in / fade-in-0 / zoom-in-95) became Base UI
  transition classes (data-starting-style / data-ending-style with
  opacity/scale + duration-150). Positioning, radius, border, shadow, and
  every layout class unchanged. Header/Footer/Title/Description untouched.
- Leftover scan clean: no radix imports remain.

## Left alone

- Consumers (activity-stack re-run dialog, workflows-grid) use
  Dialog/Trigger/Content/Close with plain props; all source-compatible, no
  call-site changes. No consumer used forceMount, onOpenAutoFocus, or the
  per-interaction dismiss callbacks.

## Behavior changes

- Open/close motion is now transition-based (fade + scale over 150ms)
  instead of radix keyframes. Visual FEEL flagged for eyeball verification,
  not just typecheck.
- modal prop widened (boolean | 'trap-focus'); consumers pass nothing, so
  default modal behavior (focus trap + scroll lock) holds.

## Verify by hand

- Activity page: open the re-run dialog. Watch the motion: quick fade+scale
  in, same out. Escape closes. Focus lands inside on open and RETURNS to
  the trigger on close. Backdrop click closes. The close X works.
- Workflows grid: the delete-workflow confirm dialog, same checks.

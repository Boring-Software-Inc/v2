'use client';

import * as React from 'react';
import {Drawer as DrawerPrimitive} from '@base-ui/react/drawer';
import {Button as ButtonPrimitive} from '@base-ui/react/button';
import {useDomDirection} from '#/lib/glaze/direction.ts';
import {Button, type ButtonProps} from '#/components/glaze/ui/button.tsx';
import {Icon, Failed, Close as CloseIcon} from '#/components/glaze/icon.tsx';
import {ActionRegionContext, SlowNotice} from '#/components/glaze/ui/slow-notice.tsx';
import {useWaitRegion} from '#/lib/glaze/waiting.ts';
import {cn, mergeClass, mergeRefs} from '#/lib/glaze/utils.ts';
import {useGlazeModal, useGlazePortal} from '#/lib/glaze/portal.ts';
import {createPortal} from 'react-dom';
import {closesAfter, overlayPanel, overlayShell, scrimClass, useDefaultAction, useOverlayOpen, useScrollBody, type DefaultAction} from '#/lib/glaze/overlay.ts';

// Glaze's sheet, on Base UI's Drawer. A side panel, in two modes:
//
//   <Sheet>               modal: slides in over the scrim from `side` (the inline end by default: right, or left
//                         under dir="rtl"), and a swipe toward that edge dismisses it on touch. side="bottom" is the
//                         phone's bottom sheet, with a grab handle.
//   <Sheet modal={false}> docked: sits in the layout beside a list as the details of the selection, resizable from
//                         its leading edge by pointer or keys.
//
// The look is Dialog's: Glaze's card from the card recipes, standing 8px off the screen's edges so all four corners
// stay round. The shell grey with the overlay ring; everything but the footer in the paper panel 3px in, the header
// fixed and the body scrolling; SheetFooter as the shell-foot row under it, with a flat Close and at most one primary
// SheetAction. No shadow. SheetAction takes
// Dialog's onAction: a returned promise holds the sheet open (Escape, a swipe, the scrim, Close and the X all wait)
// and a rejection shows above the footer. A modal sheet makes the page behind inert while it is open.

/** start and end follow the reading direction; the rest are the screen's own edges. */
type Side = 'top' | 'right' | 'bottom' | 'left' | 'start' | 'end';
type ScreenSide = Exclude<Side, 'start' | 'end'>;

/** The screen edge a side names under a direction: end is right in left-to-right text and left in right-to-left. */
function screenSide(side: Side, dir: 'ltr' | 'rtl'): ScreenSide {
  if (side === 'start') return dir === 'rtl' ? 'right' : 'left';
  if (side === 'end') return dir === 'rtl' ? 'left' : 'right';
  return side;
}

const swipeOf: Record<ScreenSide, 'up' | 'right' | 'down' | 'left'> = {top: 'up', right: 'right', bottom: 'down', left: 'left'};

type SheetState = {
  docked: boolean;
  side: ScreenSide;
  setSide: (side: ScreenSide) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  titleId: string;
  trigger: React.RefObject<HTMLElement | null>;
  pending: boolean;
  error: string | null;
  run: (action: () => void | Promise<unknown>, closeAfter: boolean) => void;
  contained: boolean;
};

const SheetContext = React.createContext<SheetState | null>(null);

function useSheet() {
  const context = React.useContext(SheetContext);
  if (!context) throw new Error('Sheet parts must be inside <Sheet>.');
  return context;
}

type SheetProps = Omit<DrawerPrimitive.Root.Props, 'modal' | 'swipeDirection' | 'onOpenChange'> & {
  /** false docks the panel in the layout instead of over it. */
  modal?: boolean;
  /**
   * Shows a modal sheet open inside a frame, as a docs specimen: Base UI's modal handling (scroll lock, the inert
   * page) is off, so several can be open on one page.
   */
  contained?: boolean;
  onOpenChange?: (open: boolean) => void;
};

function Sheet({modal = true, contained = false, open: openProp, defaultOpen = false, onOpenChange, children, ...props}: SheetProps) {
  const [side, setSide] = React.useState<ScreenSide>('right');
  const titleId = React.useId();
  const trigger = React.useRef<HTMLElement | null>(null);
  const {open, setOpen, pending, error, run} = useOverlayOpen<DrawerPrimitive.Root.ChangeEventDetails>({open: openProp, defaultOpen, onOpenChange});
  const state = React.useMemo(() => ({docked: !modal, side, setSide, open, setOpen, titleId, trigger, pending, error, run, contained}), [modal, side, open, setOpen, titleId, pending, error, run, contained]);
  return <SheetContext.Provider value={state}>
    {modal
      ? <DrawerPrimitive.Root data-slot="sheet" open={open} onOpenChange={setOpen} swipeDirection={swipeOf[side]} modal={contained ? false : undefined} {...props}>{children}</DrawerPrimitive.Root>
      : children as React.ReactNode}
  </SheetContext.Provider>;
}

function SheetTrigger({ref, onClick, ...props}: DrawerPrimitive.Trigger.Props) {
  const {docked, open, setOpen, trigger} = useSheet();
  const refs = React.useMemo(() => mergeRefs(trigger as React.Ref<HTMLButtonElement>, ref), [trigger, ref]);
  if (docked) return <ButtonPrimitive
    data-slot="sheet-trigger"
    ref={refs}
    aria-expanded={open}
    data-popup-open={open || undefined}
    onClick={event => { onClick?.(event as never); setOpen(!open); }}
    {...(props as ButtonPrimitive.Props)}
  />;
  return <DrawerPrimitive.Trigger data-slot="sheet-trigger" ref={refs} onClick={onClick} {...props}/>;
}

/** Closes the sheet: the footer's way out, a small paper Button unless `render` says otherwise. Disabled while an action runs. */
function SheetClose({onClick, disabled, render, ...props}: DrawerPrimitive.Close.Props) {
  const {docked, setOpen, trigger, pending} = useSheet();
  const look = render ?? <Button variant="secondary" size="sm"/>;
  if (docked) return <ButtonPrimitive
    data-slot="sheet-close"
    data-dialog-action="dismiss"
    disabled={disabled || pending}
    render={look as ButtonPrimitive.Props['render']}
    onClick={event => { onClick?.(event as never); setOpen(false); trigger.current?.focus(); }}
    {...(props as ButtonPrimitive.Props)}
  />;
  return <DrawerPrimitive.Close data-slot="sheet-close" data-dialog-action="dismiss" disabled={disabled || pending} render={look} onClick={onClick} {...props}/>;
}

function SheetPortal(props: DrawerPrimitive.Portal.Props) {
  const container = useGlazePortal();
  return <DrawerPrimitive.Portal data-slot="sheet-portal" container={container} {...props}/>;
}

function SheetOverlay({className, ...props}: DrawerPrimitive.Backdrop.Props) {
  return <DrawerPrimitive.Backdrop
    data-slot="sheet-overlay"
    // Dialog's scrim, fading with the swipe that dismisses the sheet.
    className={mergeClass([scrimClass, 'opacity-[calc(1-var(--drawer-swipe-progress,0))] data-swiping:duration-0'], className)}
    {...props}
  />;
}

// ---------- Content ----------

const modalPanel = cn(
  'group/sheet relative min-h-0',
  overlayShell,
  // Arrives with a 16px slide from its edge and a fade over --dur-overlay; leaves on --dur-state.
  'transition-[translate,opacity] duration-(--dur-overlay) ease-out data-swiping:duration-0 data-swiping:select-none',
  'data-starting-style:opacity-0 data-ending-style:opacity-0 data-ending-style:duration-(--dur-state) data-ending-style:ease-in',
  // Side panels: 480px, the viewport's height less 8px each end; on a phone 40px of page shows beside it.
  'data-[side=right]:w-[min(var(--overlay),100%-var(--space-10))] data-[side=left]:w-[min(var(--overlay),100%-var(--space-10))]',
  'data-[side=top]:max-h-[calc(100dvh-var(--space-10))] data-[side=top]:w-full data-[side=top]:max-w-(--overlay-lg)',
  // A bottom sheet's first row is its grab handle; the panel takes the second.
  'data-[side=bottom]:grid-rows-[auto_minmax(0,1fr)]',
  'data-[side=bottom]:max-h-[calc(100dvh-var(--space-10))] data-[side=bottom]:w-full data-[side=bottom]:max-w-(--overlay-lg) data-[side=bottom]:mb-[env(safe-area-inset-bottom)]',
  // Follows the finger, then slides the last 16px in from and out toward its edge, behind motion-safe so a reduced
  // motion setting leaves only the fade.
  'data-[side=right]:translate-x-[var(--drawer-swipe-movement-x,0px)] motion-safe:data-[side=right]:data-starting-style:translate-x-(--space-4) motion-safe:data-[side=right]:data-ending-style:translate-x-(--space-4)',
  'data-[side=left]:translate-x-[var(--drawer-swipe-movement-x,0px)] motion-safe:data-[side=left]:data-starting-style:-translate-x-(--space-4) motion-safe:data-[side=left]:data-ending-style:-translate-x-(--space-4)',
  'data-[side=top]:translate-y-[var(--drawer-swipe-movement-y,0px)] motion-safe:data-[side=top]:data-starting-style:-translate-y-(--space-4) motion-safe:data-[side=top]:data-ending-style:-translate-y-(--space-4)',
  'data-[side=bottom]:translate-y-[var(--drawer-swipe-movement-y,0px)] motion-safe:data-[side=bottom]:data-starting-style:translate-y-(--space-4) motion-safe:data-[side=bottom]:data-ending-style:translate-y-(--space-4)',
);

// The viewport is a flex row with 8px of page around the panel, and a row runs right to left under dir="rtl", so
// the screen edges flip back.
const viewportAlign: Record<ScreenSide, string> = {
  right: 'items-stretch justify-end rtl:justify-start',
  left: 'items-stretch justify-start rtl:justify-end',
  top: 'flex-col items-center justify-start',
  bottom: 'flex-col items-center justify-end',
};

type SheetContentProps = Omit<DrawerPrimitive.Popup.Props, 'className'> & {
  className?: string;
  /**
   * The edge it comes from (modal) or sits on (docked). start and end follow the reading direction, so the default,
   * end, is the right edge in left-to-right text and the left edge in right-to-left.
   */
  side?: Side;
  /** The ghost X in the header's corner. Off by default on a bottom sheet, which has its handle and Close. */
  showCloseButton?: boolean;
  /** Docked: starting width in px. Double-clicking the handle returns to it. */
  defaultWidth?: number;
  /** Docked: the narrowest and widest the handle allows. */
  minWidth?: number;
  maxWidth?: number;
  /** Docked: called with the width after a drag or key press. Store it to keep the width between visits. */
  onWidthChange?: (width: number) => void;
};

function SheetContent({side = 'end', ...props}: SheetContentProps) {
  const {docked, setSide} = useSheet();
  // The direction where the panel lands: the portal container carries the dir of the subtree it serves.
  const screen = screenSide(side, useDomDirection(useGlazePortal()));
  React.useLayoutEffect(() => { setSide(screen); }, [screen, setSide]);
  if (docked) return <DockedContent side={side === 'start' || side === 'left' ? 'start' : 'end'} {...props}/>;
  return <ModalContent side={screen} {...props}/>;
}

const closePlace = 'absolute end-3 top-3.5 z-(--z-raised)';

/** The row on the shell under the panel, which SheetFooter portals into, as in Dialog. */
const FootSlotContext = React.createContext<HTMLElement | null | undefined>(undefined);

/** The panel, then the slot for the footer row on the shell. */
function Card({children, close}: {children: React.ReactNode; close: React.ReactNode}) {
  const [foot, setFoot] = React.useState<HTMLDivElement | null>(null);
  return <>
    <FootSlotContext.Provider value={foot}>
      <div data-slot="sheet-panel" className={cn(overlayPanel, 'relative')}>{children}{close}</div>
    </FootSlotContext.Provider>
    <div ref={setFoot} data-slot="sheet-foot" className="contents"/>
  </>;
}

function CloseButton({docked}: {docked: boolean}) {
  const {pending} = useSheet();
  const button = <Button variant="ghost" size="icon-sm" className={closePlace}/>;
  return docked
    ? <SheetClose data-slot="sheet-close-button" aria-label="Close" data-dialog-action={undefined} render={button}><Icon icon={CloseIcon}/></SheetClose>
    : <DrawerPrimitive.Close data-slot="sheet-close-button" aria-label="Close" disabled={pending} render={button}><Icon icon={CloseIcon}/></DrawerPrimitive.Close>;
}

function ModalContent({className, children, side, showCloseButton, ref, onKeyDown, initialFocus, defaultWidth: _w, minWidth: _min, maxWidth: _max, onWidthChange: _c, ...props}: Omit<SheetContentProps, 'side'> & {side: ScreenSide}) {
  const {open, pending, contained} = useSheet();
  const action = useDefaultAction<HTMLDivElement>({ref, onKeyDown, initialFocus});
  useGlazeModal(open && !contained);
  // A bottom sheet has a grab handle and a Close in its footer; a corner X beside them is a second way to do one thing.
  const withClose = showCloseButton ?? side !== 'bottom';
  return <SheetPortal>
    <SheetOverlay/>
    <DrawerPrimitive.Viewport data-slot="sheet-viewport" className={cn('fixed inset-0 z-(--z-overlay) flex p-2', viewportAlign[side])}>
      <DrawerPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        data-show-close={withClose || undefined}
        aria-busy={pending || undefined}
        className={cn(modalPanel, className)}
        {...action}
        {...props}
      >
        {side === 'bottom' && <div data-slot="sheet-handle" aria-hidden className="flex h-3 cursor-grab items-start justify-center active:cursor-grabbing">
          <span className="h-1 w-8 rounded-pill bg-line-control forced-colors:bg-[CanvasText]"/>
        </div>}
        <DrawerPrimitive.Content data-slot="sheet-inner" className="contents">
          <Card close={withClose && <CloseButton docked={false}/>}>{children}</Card>
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Popup>
    </DrawerPrimitive.Viewport>
  </SheetPortal>;
}

function DockedContent({className, children, side, showCloseButton = true, defaultWidth = 360, minWidth = 280, maxWidth = 640, onWidthChange, style, onKeyDown, ref, initialFocus: _f, finalFocus: _ff, render: _r, ...rest}: Omit<SheetContentProps, 'side'> & {side: 'start' | 'end'}) {
  const {open, setOpen, titleId, trigger, pending} = useSheet();
  const [width, setWidth] = React.useState(defaultWidth);
  const [dragging, setDragging] = React.useState(false);
  const start = React.useRef<{x: number; w: number} | null>(null);
  if (!open) return null;
  const set = (w: number) => {
    const next = Math.round(Math.min(Math.max(w, minWidth), maxWidth));
    setWidth(next);
    onWidthChange?.(next);
  };
  // The handle is on the edge that faces the content. Dragging away from the panel widens it, and right to left
  // flips which way that is on screen, so the sign comes from the computed direction at drag time.
  const sign = (el: Element) => {
    const rtl = getComputedStyle(el).direction === 'rtl';
    return (side === 'end') !== rtl ? -1 : 1;
  };
  return <aside
    aria-labelledby={titleId}
    {...(rest as React.HTMLAttributes<HTMLElement>)}
    ref={ref as React.Ref<HTMLElement>}
    data-slot="sheet-content"
    data-docked=""
    data-side={side}
    data-show-close={showCloseButton || undefined}
    onKeyDown={event => {
      onKeyDown?.(event as never);
      if (event.defaultPrevented || event.key !== 'Escape') return;
      // Escape closes the docked panel from inside it and returns focus to whatever opened it.
      if ((event.target as HTMLElement).closest('[role=menu],[role=listbox],[role=dialog]')) return;
      if (pending) { event.preventDefault(); return; }
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    }}
    className={cn('group/sheet relative shrink-0 max-md:w-full!', overlayShell, 'border-line-faint', typeof className === 'string' ? className : undefined)}
    // value-ok: the width is the person's, dragged or stepped from the handle, so it can only live inline.
    style={{width, ...(typeof style === 'object' ? style : undefined)}}
  >
    <div
      role="separator"
      tabIndex={0}
      aria-label="Resize panel"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-valuetext={`${width} pixels`}
      data-slot="sheet-handle"
      data-dragging={dragging || undefined}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus();
        start.current = {x: event.clientX, w: width};
        setDragging(true);
      }}
      onPointerMove={event => { if (start.current) set(start.current.w + sign(event.currentTarget) * (event.clientX - start.current.x)); }}
      onPointerUp={() => { start.current = null; setDragging(false); }}
      onPointerCancel={() => { start.current = null; setDragging(false); }}
      onDoubleClick={() => set(defaultWidth)}
      onKeyDown={event => {
        const step = event.shiftKey ? 8 : 32;
        const s = sign(event.currentTarget);
        if (event.key === 'ArrowLeft') set(width - s * step);
        else if (event.key === 'ArrowRight') set(width + s * step);
        else if (event.key === 'Home') set(minWidth);
        else if (event.key === 'End') set(maxWidth);
        else if (event.key === 'Enter') set(defaultWidth);
        else return;
        event.preventDefault();
      }}
      className={cn(
        'group/handle absolute inset-y-3 z-(--z-raised) flex w-2 cursor-col-resize touch-none justify-center rounded-pill max-md:hidden',
        side === 'end' ? '-start-1' : '-end-1',
      )}
    >
      <span className="w-px bg-transparent transition-colors duration-(--dur-state) ease-out group-hover/handle:bg-line-control group-data-dragging/handle:bg-ink group-focus-visible/handle:bg-ink forced-colors:bg-[CanvasText]"/>
    </div>
    <Card close={showCloseButton && <CloseButton docked/>}>{children}</Card>
  </aside>;
}

/** The top of the panel, as in the dialog: the title with the description 4px under it, 16px in. */
function SheetHeader({className, ...props}: React.ComponentProps<'div'>) {
  const {pending, error} = useSheet();
  return <div
    data-slot="sheet-header"
    data-pending={pending || undefined}
    data-status={error ? 'fail' : undefined}
    className={cn('flex shrink-0 flex-col gap-1 p-4 group-data-show-close/sheet:pe-12 group-has-data-[slot=sheet-body]/sheet:pb-3', className)}
    {...props}
  />;
}

/** The rest of the panel, which scrolls; a hairline under the header shows once it has. */
function SheetBody({className, ref, ...props}: React.ComponentProps<'div'>) {
  const setRef = useScrollBody<HTMLDivElement>(ref);
  return <div
    ref={setRef}
    data-slot="sheet-body"
    className={cn(
      'flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain border-t border-transparent px-4 pt-3 pb-4 type-body-sm text-text-1',
      'not-group-has-data-[slot=sheet-header]/sheet:pt-4 data-scrolled:border-line-faint focus-visible:focus-ring-inset',
      className,
    )}
    {...props}
  />;
}

/** The shell's footer row: meta, then SheetClose and one SheetAction, small, 3px from the shell's edges. */
function SheetFooter({className, defaultAction, meta, children, ...props}: React.ComponentProps<'div'> & {
  /** What Enter does when focus is not on a control. Unset: dismiss if the action is destructive, else primary. */
  defaultAction?: DefaultAction;
  /** Caption text at the start of the row; it truncates. */
  meta?: React.ReactNode;
}) {
  const {error, pending} = useSheet();
  const actions = useWaitRegion();
  const slot = React.useContext(FootSlotContext);
  const row = <>
    {error && <div data-slot="sheet-error" role="alert" data-status="fail" className="mt-(--shell-inset) flex items-start gap-2 rounded-panel bg-fail-tint px-3 py-2 type-body-sm text-fail-text">
      <Icon icon={Failed} className="mt-0.5"/>
      <span className="min-w-0 break-words">{error}</span>
    </div>}
    <div
      data-slot="sheet-footer"
      data-default-action={defaultAction ?? 'auto'}
      className={cn('shell-foot justify-end', className)}
      {...props}
    >
      {meta && <span data-slot="sheet-footer-meta" className="me-auto">{meta}</span>}
      <SlowNotice active={pending || actions.waiting} className="me-auto"/>
      <ActionRegionContext.Provider value={actions.store}>{children}</ActionRegionContext.Provider>
    </div>
  </>;
  // Inside SheetContent the row goes on the shell under the panel, as in Dialog.
  if (slot === undefined) return row;
  return slot ? createPortal(row, slot) : null;
}

function SheetTitle({className, children, ...props}: DrawerPrimitive.Title.Props) {
  const {docked, titleId} = useSheet();
  const base = 'min-w-0 type-heading-sm text-text-1 break-words group-data-docked/sheet:truncate';
  // Docked, the title is a plain heading with no Base UI state to hand a className function.
  if (docked) return <h2 id={titleId} data-slot="sheet-title" className={cn(base, typeof className === 'string' && className)}>{children as React.ReactNode}</h2>;
  return <DrawerPrimitive.Title data-slot="sheet-title" className={mergeClass(base, className)} {...props}>{children}</DrawerPrimitive.Title>;
}

function SheetDescription({className, ...props}: DrawerPrimitive.Description.Props) {
  const {docked} = useSheet();
  const base = 'type-body-sm text-text-2';
  if (docked) return <p data-slot="sheet-description" className={cn(base, typeof className === 'string' && className)}>{props.children as React.ReactNode}</p>;
  return <DrawerPrimitive.Description data-slot="sheet-description" className={mergeClass(base, className)} {...props}/>;
}

type SheetActionProps = ButtonProps & {
  /** Close the sheet after the action. On with onAction and for a bare action; off with onClick or type="submit". */
  close?: boolean;
  /** Runs the action. A returned promise turns the button pending and holds the sheet open until it settles. */
  onAction?: () => void | Promise<unknown>;
};

/** The footer's one lead action, small and ink (coral with variant="destructive"), pressed by Enter when the footer's default is primary. */
function SheetAction({close, onAction, onClick, size = 'sm', pending: pendingProp, ...props}: SheetActionProps) {
  const {pending, run} = useSheet();
  const closeAfter = closesAfter({close, onAction, onClick, type: props.type});
  return <Button
    data-slot="sheet-action"
    data-dialog-action="primary"
    size={size}
    pending={pendingProp ?? (onAction !== undefined || props.pendingLabel !== undefined || pending ? pending : undefined)}
    onClick={event => {
      onClick?.(event);
      if (event.defaultPrevented) return;
      if (onAction || closeAfter) run(onAction ?? (() => {}), closeAfter);
    }}
    {...props}
  />;
}

/** A titled group of label and value rows, for the details of a selection. */
function SheetSection({className, title, children, ...props}: Omit<React.ComponentProps<'section'>, 'title'> & {title?: React.ReactNode}) {
  return <section data-slot="sheet-section" className={cn('flex flex-col gap-1', className)} {...props}>
    {title && <h3 className="type-label-sm text-text-2">{title}</h3>}
    <dl className="flex flex-col">{children}</dl>
  </section>;
}

/** One label and value in a section, on a 36px row with a hairline under it. `mono` for IDs and hashes. */
function SheetField({label, children, mono, className}: {label: React.ReactNode; children: React.ReactNode; mono?: boolean; className?: string}) {
  return <div data-slot="sheet-field" className={cn('rule-row grid min-h-(--row) grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-center gap-3 py-2', className)}>
    <dt className="truncate type-body-sm text-text-2">{label}</dt>
    <dd className={cn('min-w-0 text-text-1', mono ? 'type-code-sm break-all' : 'type-body-sm break-words')}>{children}</dd>
  </div>;
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetPortal,
  SheetOverlay,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
  SheetAction,
  SheetSection,
  SheetField,
  useSheet,
  type SheetProps,
  type SheetContentProps,
};

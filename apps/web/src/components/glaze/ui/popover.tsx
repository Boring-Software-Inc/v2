'use client';

import * as React from 'react';
import {Popover as PopoverPrimitive} from '@base-ui/react/popover';
import {Button} from '#/components/glaze/ui/button.tsx';
import {Icon, Information, Close as CloseIcon} from '#/components/glaze/icon.tsx';
import {cn, mergeClass} from '#/lib/glaze/utils.ts';
import {useGlazePortal} from '#/lib/glaze/portal.ts';
import {overlayMotion, overlaySurface} from '#/lib/glaze/overlay.ts';

// Glaze's popover, on Base UI's Popover. The overlay recipe: paper, the 1px --line ring, --radius-overlay, no shadow;
// 12px of padding, 288px wide, 6px off its anchor and no arrow. It slides --overlay-shift in from its anchor over
// --dur-overlay and leaves faster. Three openings:
//
//   <PopoverTrigger>              click or tap opens it; anything inside can take focus. No corner X:
//                                 Escape, a click outside or the popover's own Done close it
//   <PopoverTrigger openOnHover>  a hover preview after 600ms, extra content for a pointer. It peeks:
//                                 leaving closes it. Pressing inside it (or on a button trigger) while
//                                 it peeks pins it, and only a pinned preview shows a close button; it
//                                 stays until Escape, the button or a click outside. A link trigger stays
//                                 a link: a click navigates, and a tap on touch only navigates, it never
//                                 opens the preview as well
//   <PopoverInfo>                 the info toggletip beside a term: tap or click toggles it, and its
//                                 text is also the button's description, so focus alone reads it.
//                                 Plain text only: focus never enters it, so a link inside is unreachable
//
// Escape closes it and focus goes back to the trigger. A modal popover (modal={true}) also gets the X.

type PopoverState = {pinned: boolean; peeking: boolean; modal: boolean; pin: () => void; pointer: React.RefObject<string | null>};
const PopoverContext = React.createContext<PopoverState>({pinned: false, peeking: false, modal: false, pin: () => {}, pointer: {current: null}});

type Reason = PopoverPrimitive.Root.ChangeEventDetails['reason'];

type PopoverProps = PopoverPrimitive.Root.Props & {
  /** With defaultOpen on an openOnHover trigger: start as a peek or already pinned, for a specimen. */
  defaultPreview?: 'peeking' | 'pinned';
};

function Popover({open: openProp, defaultOpen = false, onOpenChange, modal = false, defaultPreview, ...props}: PopoverProps) {
  const [openState, setOpenState] = React.useState(defaultOpen);
  const open = openProp ?? openState;
  // How it opened decides how it closes: a hover peek closes on leave, a pinned preview stays, a click
  // opens an ordinary popover. Only a pinned preview shows the close button.
  const [openedBy, setOpenedBy] = React.useState<'hover' | 'pin' | 'click' | null>(defaultOpen ? (defaultPreview === 'pinned' ? 'pin' : defaultPreview === 'peeking' ? 'hover' : 'click') : null);
  // The pointer type of the last press on a trigger: a tap on a hover-preview link only navigates.
  const pointer = React.useRef<string | null>(null);

  const change = (next: boolean, details: PopoverPrimitive.Root.ChangeEventDetails) => {
    const reason: Reason = details.reason;
    const fromPreview = !!(details.event?.target as Element | null)?.closest?.('[data-hover-preview]');
    if (next && reason === 'trigger-press' && fromPreview && pointer.current === 'touch') {
      // Touch has no hover, so the preview is not for it: the tap follows the link and nothing opens.
      details.cancel();
      return;
    }
    if (next) {
      setOpenedBy(reason === 'trigger-hover' ? 'hover' : fromPreview ? 'pin' : 'click');
    } else if (openedBy === 'hover' && reason === 'trigger-press') {
      // A click on the trigger of a peeking preview keeps it: the person wants to read or use it.
      details.cancel();
      setOpenedBy('pin');
      return;
    } else if (openedBy === 'pin' && reason === 'trigger-hover') {
      // A pinned preview ignores the pointer leaving.
      details.cancel();
      return;
    }
    if (openProp === undefined) setOpenState(next);
    if (!next) setOpenedBy(null);
    onOpenChange?.(next, details);
  };

  const state = React.useMemo(() => ({pinned: open && openedBy === 'pin', peeking: open && openedBy === 'hover', modal: modal === true, pin: () => setOpenedBy('pin'), pointer}), [open, openedBy, modal]);
  return <PopoverContext.Provider value={state}>
    <PopoverPrimitive.Root data-slot="popover" open={open} onOpenChange={change} modal={modal} {...props}/>
  </PopoverContext.Provider>;
}

function PopoverTrigger({openOnHover, delay = 600, closeDelay = 300, render, onPointerDown, ...props}: PopoverPrimitive.Trigger.Props) {
  const {pointer} = React.useContext(PopoverContext);
  // A link stays a link: Base UI gives a non-button trigger role="button", which would announce a
  // navigation link as a button (trap/link-as-button).
  const link = React.isValidElement<{href?: string}>(render) && render.type === 'a' && render.props.href !== undefined;
  return <PopoverPrimitive.Trigger
    data-slot="popover-trigger"
    data-hover-preview={openOnHover || undefined}
    openOnHover={openOnHover}
    delay={openOnHover ? delay : undefined}
    closeDelay={openOnHover ? closeDelay : undefined}
    render={render}
    onPointerDown={event => { pointer.current = event.pointerType; onPointerDown?.(event); }}
    {...props}
    {...(link ? {role: 'link'} : undefined)}
  />;
}

function PopoverClose(props: PopoverPrimitive.Close.Props) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props}/>;
}

type PopoverContentProps = PopoverPrimitive.Popup.Props & Pick<PopoverPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset' | 'collisionPadding' | 'collisionAvoidance'>;

function PopoverContent({className, align = 'center', alignOffset = 0, side = 'bottom', sideOffset = 6, collisionPadding = 8, collisionAvoidance, children, initialFocus, onPointerDown, ...props}: PopoverContentProps) {
  const container = useGlazePortal();
  const {pinned, peeking, modal, pin} = React.useContext(PopoverContext);
  return <PopoverPrimitive.Portal container={container}>
    <PopoverPrimitive.Positioner
      data-slot="popover-positioner"
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      collisionAvoidance={collisionAvoidance}
      className="isolate z-(--z-overlay)"
    >
      <PopoverPrimitive.Popup
        data-slot="popover-content"
        data-peeking={peeking || undefined}
        data-pinned={pinned || undefined}
        data-modal={modal || undefined}
        // A peek never takes focus away from the page; a pinned or clicked popover does.
        initialFocus={initialFocus ?? (peeking ? false : undefined)}
        // Pressing inside a peeking preview pins it: the person has started to use it.
        onPointerDown={event => { if (peeking) pin(); onPointerDown?.(event); }}
        className={mergeClass([
          'relative flex max-h-(--available-height) w-(--popover) max-w-(--available-width) flex-col gap-3 overflow-y-auto overscroll-contain p-3 type-body-sm',
          overlaySurface,
          overlayMotion,
        ], className)}
        {...props}
      >
        {children}
        {(pinned || modal) && <PopoverPrimitive.Close
          data-slot="popover-pin-close"
          aria-label={pinned ? 'Close preview' : 'Close'}
          // 26px in the 12px padding, its centre on the title's first line.
          render={<Button variant="ghost" size="icon-sm" className="absolute end-2 top-2"/>}
        ><Icon icon={CloseIcon}/></PopoverPrimitive.Close>}
      </PopoverPrimitive.Popup>
    </PopoverPrimitive.Positioner>
  </PopoverPrimitive.Portal>;
}

function PopoverHeader({className, ...props}: React.ComponentProps<'div'>) {
  return <div data-slot="popover-header" className={cn('flex flex-col gap-0.5 in-data-pinned:pe-6 in-data-modal:pe-6', className)} {...props}/>;
}

function PopoverTitle({className, ...props}: PopoverPrimitive.Title.Props) {
  return <PopoverPrimitive.Title data-slot="popover-title" className={mergeClass('type-label text-text-1 break-words', className)} {...props}/>;
}

function PopoverDescription({className, ...props}: PopoverPrimitive.Description.Props) {
  return <PopoverPrimitive.Description data-slot="popover-description" className={mergeClass('type-body-sm text-text-2 break-words', className)} {...props}/>;
}

type PopoverInfoProps = {
  /**
   * The explanation: a sentence or two of plain text. No links or buttons: focus stays on the icon, so
   * nothing inside can be reached by keyboard. Put a "Learn more" link next to the term instead, or use
   * a Popover. Elements other than text and inline formatting warn in development.
   */
  children: React.ReactNode;
  /** The button's accessible name. Defaults to "About <title>" when the title is text. */
  label?: string;
  /** An optional first line, usually the term itself. */
  title?: React.ReactNode;
  side?: PopoverPrimitive.Positioner.Props['side'];
  align?: PopoverPrimitive.Positioner.Props['align'];
  /** How it moves when it would not fit; a still specimen pins it with {side: 'none'}. */
  collisionAvoidance?: PopoverPrimitive.Positioner.Props['collisionAvoidance'];
  className?: string;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} & Omit<React.ComponentProps<'button'>, 'children' | 'title'>;

/**
 * The info toggletip: a 16px info glyph in a 24px button beside a term. Tap or click toggles the
 * explanation; Escape or a click outside closes it. Focus stays on the button, and the explanation is
 * also the button's description, so a screen reader hears it on focus without opening anything.
 */
/** True when a node holds a link, a button or a form control, which PopoverInfo cannot let anyone reach. */
function hasInteractive(node: React.ReactNode): boolean {
  let found = false;
  React.Children.forEach(node, child => {
    if (found || !React.isValidElement<{children?: React.ReactNode; href?: string; onClick?: unknown}>(child)) return;
    if ((typeof child.type === 'string' && ['a', 'button', 'input', 'select', 'textarea'].includes(child.type)) || child.props.href !== undefined || child.props.onClick) found = true;
    else found = hasInteractive(child.props.children);
  });
  return found;
}

function PopoverInfo({children, label, title, side = 'top', align = 'center', collisionAvoidance, className, defaultOpen, open, onOpenChange, ...props}: PopoverInfoProps) {
  const container = useGlazePortal();
  if (process.env.NODE_ENV !== 'production' && hasInteractive(children)) console.error('PopoverInfo holds plain text only: focus never enters it, so a link or button inside cannot be reached by keyboard. Use a Popover.');
  const descriptionId = React.useId();
  const name = label ?? (typeof title === 'string' ? `About ${title}` : 'More information');
  return <PopoverPrimitive.Root defaultOpen={defaultOpen} open={open} onOpenChange={onOpenChange ? next => onOpenChange(next) : undefined}>
    <PopoverPrimitive.Trigger
      {...(props as PopoverPrimitive.Trigger.Props)}
      data-slot="popover-info"
      aria-label={name}
      aria-describedby={descriptionId}
      className={cn(
        // 24px: the WCAG 2.5.8 minimum as the box itself, so nothing nearby can sit inside its target. A round box,
        // since it is a one-line control; the wash shows under the pointer.
        'relative -my-1 inline-flex size-6 shrink-0 items-center justify-center rounded-pill align-middle text-text-2',
        'hover:bg-hover hover:text-text-1 data-popup-open:bg-pressed data-popup-open:text-text-1',
        'forced-colors:text-[ButtonText]',
        className,
      )}
    >
      <Icon icon={Information}/>
    </PopoverPrimitive.Trigger>
    <span id={descriptionId} hidden>{children}</span>
    <PopoverPrimitive.Portal container={container}>
      <PopoverPrimitive.Positioner side={side} align={align} sideOffset={6} collisionPadding={8} collisionAvoidance={collisionAvoidance} className="isolate z-(--z-overlay)">
        <PopoverPrimitive.Popup
          data-slot="popover-info-content"
          initialFocus={false}
          className={cn('flex w-(--popover) max-w-(--available-width) flex-col gap-1 p-3 type-body-sm text-text-2 break-words', overlaySurface, overlayMotion)}
        >
          {title && <PopoverPrimitive.Title className="type-label text-text-1">{title}</PopoverPrimitive.Title>}
          <div>{children}</div>
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  </PopoverPrimitive.Root>;
}

export {Popover, PopoverTrigger, PopoverClose, PopoverContent, PopoverHeader, PopoverTitle, PopoverDescription, PopoverInfo, type PopoverInfoProps, type PopoverProps};

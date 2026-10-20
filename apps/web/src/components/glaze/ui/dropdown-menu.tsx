'use client';

import * as React from 'react';
import {Menu as MenuPrimitive} from '@base-ui/react/menu';
import {ContextMenu as ContextMenuPrimitive} from '@base-ui/react/context-menu';
import {menuCheckItemClass, menuItemClass, menuLabelClass, menuPopupClass, menuSeparatorClass} from '#/lib/glaze/overlay.ts';
import {Icon, ChevronRight, Check} from '#/components/glaze/icon.tsx';
import {Kbd} from '#/components/glaze/ui/kbd.tsx';
import {cn, mergeClass} from '#/lib/glaze/utils.ts';
import {useGlazePortal} from '#/lib/glaze/portal.ts';

// Glaze's dropdown menu, on Base UI's Menu and ContextMenu. One list of actions, two ways to open it:
//
//   <DropdownMenu>                       a trigger button opens it below
//   <DropdownMenu trigger="contextmenu"> a right click, a long press on touch, or Shift+F10 opens it at
//                                        the pointer over an area such as a table
//
// The overlay recipe (paper, the 1px ring, --radius-overlay, no shadow) with 4px of padding; 32px rows in the 13/500
// label, or 28px rows with size="sm" for a menu opened from a small control. The highlighted row takes the hover wash
// at the tag radius; a destructive row reads in coral's word and takes the fail tint when highlighted.
// Arrow keys move, typing jumps to an item, Enter or Space runs it, Escape closes this menu only and
// focus returns to the trigger. Submenus open on hover, Right arrow or Enter, and a safe triangle keeps
// them open while the pointer travels toward them.
//
// A context menu marks what it acts on: the row (tr, [role=row], li or [data-menu-target]) under the
// right click, or under the finger of a long press, keeps the selected-row wash while its menu is open, so the person sees which row "Delete" will hit after the pointer has moved into the menu.
// onTargetChange hands that row to the caller, so the menu acts on the row the trigger marked, not on
// what the caller guessed from its own events. A click menu opened from a button inside such a row (the
// row's More button) marks the row the same way. Everything in a context menu also needs a visible
// path, usually that More button (trap/menu-only-path).

type Mode = 'click' | 'contextmenu';
type MenuState = {
  mode: Mode;
  /** Marks a row as the menu's target, or clears it with null. */
  mark: (row: HTMLElement | null) => void;
  /** The row under the last touch or pen press, for a long press that fires no contextmenu event. */
  pressed: React.RefObject<HTMLElement | null>;
};
const MenuContext = React.createContext<MenuState>({mode: 'click', mark: () => {}, pressed: {current: null}});

// The popup, rows, labels and rules are lib/overlay.ts's list recipe, which Command and the other list popups share.
// The highlighted row is the focus indicator: the popup and its rows take no ring of their own.
const menuShortcutClass = 'ms-auto flex shrink-0 items-center gap-1 ps-4';

type DropdownMenuProps = MenuPrimitive.Root.Props & {
  /** click: a trigger button opens it. contextmenu: a right click, long press or Shift+F10 on the trigger area opens it at the pointer. */
  trigger?: Mode;
  /** The row the menu acts on, when it opens on one, and null when it closes. Read the target here. */
  onTargetChange?: (row: HTMLElement | null) => void;
};

/** The row a context menu acts on, found from where it opened. */
const TARGET = '[data-menu-target], tr, [role="row"], li';

/** The row around `from` inside a context-menu area (`area`, or the nearest one), or null. */
function rowOf(from: EventTarget | null | undefined, area?: Element | null) {
  if (!(from instanceof Element)) return null;
  const row = from.closest<HTMLElement>(TARGET);
  const within = area ?? row?.closest('[data-menu-area]');
  return row && within && within.contains(row) && row !== within ? row : null;
}

function DropdownMenu({trigger = 'click', onOpenChange, onTargetChange, ...props}: DropdownMenuProps) {
  const target = React.useRef<HTMLElement | null>(null);
  const pressed = React.useRef<HTMLElement | null>(null);
  const onTarget = React.useRef(onTargetChange);
  React.useLayoutEffect(() => { onTarget.current = onTargetChange; });
  const mark = React.useCallback((row: HTMLElement | null) => {
    if (row === target.current) return;
    target.current?.removeAttribute('data-menu-target-open');
    target.current = row;
    row?.setAttribute('data-menu-target-open', '');
    onTarget.current?.(row);
  }, []);
  const state = React.useMemo(() => ({mode: trigger, mark, pressed}), [trigger, mark]);
  const change: MenuPrimitive.Root.Props['onOpenChange'] = (open, details) => {
    if (open && !target.current) {
      // A long press on touch opens the menu without a contextmenu event on some phones, so mark the row
      // the finger went down on. A click menu marks the row its button sits in.
      mark(trigger === 'contextmenu' ? pressed.current : rowOf(details.event?.target));
    }
    if (!open) { mark(null); pressed.current = null; }
    onOpenChange?.(open, details);
  };
  return <MenuContext.Provider value={state}>
    {trigger === 'contextmenu'
      ? <ContextMenuPrimitive.Root data-slot="dropdown-menu" onOpenChange={change as ContextMenuPrimitive.Root.Props['onOpenChange']} {...(props as ContextMenuPrimitive.Root.Props)}/>
      : <MenuPrimitive.Root data-slot="dropdown-menu" onOpenChange={change} {...props}/>}
  </MenuContext.Provider>;
}

function DropdownMenuPortal(props: MenuPrimitive.Portal.Props) {
  const container = useGlazePortal();
  return <MenuPrimitive.Portal data-slot="dropdown-menu-portal" container={container} {...props}/>;
}

type DropdownMenuTriggerProps = MenuPrimitive.Trigger.Props & {
  /**
   * Context menu only: keep text selection in the area. Off by default, so a long press on touch opens
   * the menu instead of selecting a word. Turn it on for a log or code people copy from.
   */
  selectable?: boolean;
};

function DropdownMenuTrigger({selectable = false, className, ...props}: DropdownMenuTriggerProps) {
  const {mode, mark, pressed} = React.useContext(MenuContext);
  if (mode === 'contextmenu') {
    const base = cn(
      !selectable && 'select-none',
      // The row the menu acts on: the selected-row wash, so it reads after the pointer has moved into the menu.
      '[&_[data-menu-target-open]]:bg-pressed',
      'forced-colors:[&_[data-menu-target-open]]:outline-solid forced-colors:[&_[data-menu-target-open]]:outline-2 forced-colors:[&_[data-menu-target-open]]:-outline-offset-2',
    );
    return <ContextMenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      data-menu-area=""
      data-selectable={selectable || undefined}
      onPointerDown={event => { if (event.pointerType !== 'mouse') pressed.current = rowOf(event.target, event.currentTarget); }}
      onContextMenu={event => { mark(rowOf(event.target, event.currentTarget)); }}
      onKeyDown={event => {
        // Shift+F10 opens the menu at the focused row, as the Menu key does natively: a contextmenu
        // event at the row's centre, which Base UI opens on and mark() reads.
        if (!(event.shiftKey && event.key === 'F10')) return;
        const from = document.activeElement as HTMLElement | null;
        if (!from || !event.currentTarget.contains(from)) return;
        event.preventDefault();
        const box = from.getBoundingClientRect();
        // Near the row's reading start: its left, or its right in right-to-left text.
        const inset = Math.min(box.width / 2, 160);
        const x = getComputedStyle(from).direction === 'rtl' ? box.right - inset : box.left + inset;
        from.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: x, clientY: box.top + box.height / 2, button: 2}));
      }}
      className={mergeClass(base, className as ContextMenuPrimitive.Trigger.Props['className'])}
      {...(props as ContextMenuPrimitive.Trigger.Props)}
    />;
  }
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" className={className} {...props}/>;
}

type DropdownMenuContentProps = MenuPrimitive.Popup.Props & Pick<MenuPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset' | 'collisionPadding' | 'collisionAvoidance' | 'anchor'> & {
  /** sm: 28px rows in the 12px label, for a menu opened from a small control or a row. */
  size?: 'default' | 'sm';
};

function DropdownMenuContent({align, alignOffset, side, sideOffset, collisionPadding = 8, collisionAvoidance, anchor, size = 'default', className, ...props}: DropdownMenuContentProps) {
  const {mode} = React.useContext(MenuContext);
  // A click menu takes its name from its trigger; a context menu has no trigger button, so it needs
  // one. Pass the row's name ("Actions for run_8f2a"); "Actions" is the fallback.
  const popup = <MenuPrimitive.Popup data-slot="dropdown-menu-content" data-size={size} aria-label={mode === 'contextmenu' ? 'Actions' : undefined} className={mergeClass(menuPopupClass, className)} {...props}/>;
  return <DropdownMenuPortal>
    {mode === 'contextmenu'
      ? <ContextMenuPrimitive.Positioner className="isolate z-(--z-overlay) outline-none" align={align ?? 'start'} alignOffset={alignOffset ?? 4} side={side ?? 'inline-end'} sideOffset={sideOffset ?? 0} collisionPadding={collisionPadding} collisionAvoidance={collisionAvoidance}>{popup}</ContextMenuPrimitive.Positioner>
      : <MenuPrimitive.Positioner className="isolate z-(--z-overlay) outline-none" align={align ?? 'start'} alignOffset={alignOffset ?? 0} side={side ?? 'bottom'} sideOffset={sideOffset ?? 6} collisionPadding={collisionPadding} collisionAvoidance={collisionAvoidance} anchor={anchor}>{popup}</MenuPrimitive.Positioner>}
  </DropdownMenuPortal>;
}

function DropdownMenuGroup(props: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props}/>;
}

function DropdownMenuLabel({className, inset, ...props}: MenuPrimitive.GroupLabel.Props & {inset?: boolean}) {
  return <MenuPrimitive.GroupLabel data-slot="dropdown-menu-label" data-inset={inset || undefined} className={mergeClass(menuLabelClass, className)} {...props}/>;
}

type ItemVariant = 'default' | 'destructive';

function DropdownMenuItem({className, inset, variant = 'default', ...props}: MenuPrimitive.Item.Props & {inset?: boolean; variant?: ItemVariant}) {
  return <MenuPrimitive.Item
    data-slot="dropdown-menu-item"
    data-inset={inset || undefined}
    data-variant={variant}
    data-status={variant === 'destructive' ? 'fail' : undefined}
    className={mergeClass(menuItemClass, className)}
    {...props}
  />;
}

/** An item that navigates: a real link, so open in a new tab and copy link work (trap/menu-navigation). */
function DropdownMenuLinkItem({className, inset, ...props}: MenuPrimitive.LinkItem.Props & {inset?: boolean}) {
  return <MenuPrimitive.LinkItem
    data-slot="dropdown-menu-link-item"
    data-inset={inset || undefined}
    className={mergeClass([menuItemClass, 'cursor-pointer'], className)}
    {...props}
  />;
}

function DropdownMenuSub(props: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props}/>;
}

function DropdownMenuSubTrigger({className, inset, children, ...props}: MenuPrimitive.SubmenuTrigger.Props & {inset?: boolean}) {
  return <MenuPrimitive.SubmenuTrigger
    data-slot="dropdown-menu-sub-trigger"
    data-inset={inset || undefined}
    className={mergeClass([menuItemClass, 'data-popup-open:bg-hover forced-colors:data-popup-open:outline-solid forced-colors:data-popup-open:outline-1 forced-colors:data-popup-open:-outline-offset-1'], className)}
    {...props}
  >
    {children}
    <Icon icon={ChevronRight} className="ms-auto rtl:-scale-x-100"/>
  </MenuPrimitive.SubmenuTrigger>;
}

function DropdownMenuSubContent({align = 'start', alignOffset = -5, side = 'inline-end', sideOffset = 4, className, collisionPadding = 8, collisionAvoidance, anchor: _anchor, size = 'default', ...props}: DropdownMenuContentProps) {
  // A submenu always positions against its parent item, whichever way the root opened.
  return <DropdownMenuPortal>
    <MenuPrimitive.Positioner className="isolate z-(--z-overlay) outline-none" align={align} alignOffset={alignOffset} side={side} sideOffset={sideOffset} collisionPadding={collisionPadding} collisionAvoidance={collisionAvoidance}>
      <MenuPrimitive.Popup data-slot="dropdown-menu-sub-content" data-size={size} className={mergeClass(menuPopupClass, className)} {...props}/>
    </MenuPrimitive.Positioner>
  </DropdownMenuPortal>;
}

function DropdownMenuCheckboxItem({className, children, inset, ...props}: MenuPrimitive.CheckboxItem.Props & {inset?: boolean}) {
  return <MenuPrimitive.CheckboxItem
    data-slot="dropdown-menu-checkbox-item"
    data-inset={inset || undefined}
    className={mergeClass(menuCheckItemClass, className)}
    {...props}
  >
    <span data-slot="dropdown-menu-checkbox-item-indicator" className="pointer-events-none absolute start-2 flex size-(--icon) items-center justify-center">
      <MenuPrimitive.CheckboxItemIndicator className="tick-draw flex [&_svg]:text-text-1"><Icon icon={Check}/></MenuPrimitive.CheckboxItemIndicator>
    </span>
    {children}
  </MenuPrimitive.CheckboxItem>;
}

function DropdownMenuRadioGroup(props: MenuPrimitive.RadioGroup.Props) {
  return <MenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props}/>;
}

function DropdownMenuRadioItem({className, children, inset, ...props}: MenuPrimitive.RadioItem.Props & {inset?: boolean}) {
  return <MenuPrimitive.RadioItem
    data-slot="dropdown-menu-radio-item"
    data-inset={inset || undefined}
    className={mergeClass(menuCheckItemClass, className)}
    {...props}
  >
    <span data-slot="dropdown-menu-radio-item-indicator" className="pointer-events-none absolute start-2 flex size-(--icon) items-center justify-center">
      {/* The chosen option takes the checkbox item's check: a menu marks a choice with a glyph, never a dot. */}
      <MenuPrimitive.RadioItemIndicator className="tick-draw flex [&_svg]:text-text-1"><Icon icon={Check}/></MenuPrimitive.RadioItemIndicator>
    </span>
    {children}
  </MenuPrimitive.RadioItem>;
}

function DropdownMenuSeparator({className, ...props}: MenuPrimitive.Separator.Props) {
  return <MenuPrimitive.Separator data-slot="dropdown-menu-separator" className={mergeClass(menuSeparatorClass, className)} {...props}/>;
}

/** The item's shortcut, one key cap per key, from keys or from a string child, at the row's inline end. */
function DropdownMenuShortcut({className, keys, children, ...props}: React.ComponentProps<'kbd'> & {keys?: string[]}) {
  const caps = keys ?? (typeof children === 'string' ? [children] : null);
  return <kbd data-slot="dropdown-menu-shortcut" className={cn(menuShortcutClass, className)} {...props}>
    {caps ? caps.map((key, i) => <Kbd key={i}>{key}</Kbd>) : children}
  </kbd>;
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  type DropdownMenuProps,
};

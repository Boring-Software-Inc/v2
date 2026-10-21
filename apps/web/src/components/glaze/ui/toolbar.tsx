'use client';

import {createContext, useContext} from 'react';
import {Toggle as TogglePrimitive} from '@base-ui/react/toggle';
import {Toolbar as ToolbarPrimitive} from '@base-ui/react/toolbar';
import {cn, mergeClass} from '#/lib/glaze/utils.ts';
import {Button, buttonVariants, type ButtonProps} from '#/components/glaze/ui/button.tsx';

// Glaze's toolbar, on Base UI's Toolbar: a row of icon and text actions on one thing (an answer, a draft, a run's
// output). It is one tab stop; the arrow keys move between its items, Home and End jump to the ends.
//
// Flat, with no track and no box: the items are ghost Buttons, so the row sits on whatever surface holds it, a panel,
// the shell's footer or the page. A toolbar is a group of actions, so it holds at most one primary (ink, coral or
// green glass), at the end, and everything else stays ghost or the flat secondary; the lint's one-primary counts a
// Toolbar as one group.
//
// ToolbarToggle is an on or off setting (wrap lines, show timestamps). Pressed is the pressed wash, ink at 10%, never
// glass: it is a thing you have your hand on, not a value chosen inside a control. ToolbarSeparator is a 1px rule
// between groups, 16px tall, 4px clear each side.
//
// size sets every item: default 32px, sm 26px. iconOnly makes an item square; it then needs an aria-label.
//
// Items never wrap or truncate. A toolbar wider than its container scrolls sideways. The scroll box keeps 4px of room
// round the items so the focus ring is never clipped, and gives it back with a -4px margin, so the items line up with
// the text around them.

type ToolbarSize = 'sm' | 'default';
const SizeContext = createContext<ToolbarSize>('default');

type ToolbarProps = ToolbarPrimitive.Root.Props & {
  /** Every item's height: default 32px, sm 26px. */
  size?: ToolbarSize;
};

function Toolbar({className, size = 'default', ...props}: ToolbarProps) {
  return <SizeContext.Provider value={size}>
    <ToolbarPrimitive.Root
      data-slot="toolbar"
      data-size={size}
      className={mergeClass('-m-1 flex w-max max-w-[calc(100%+var(--space-2))] min-w-0 items-center gap-0.5 overflow-x-auto p-1 [scrollbar-width:none]', className)}
      {...props}
    />
  </SizeContext.Provider>;
}

/** A set of items that belong together. disabled turns every item in it off. */
function ToolbarGroup({className, ...props}: ToolbarPrimitive.Group.Props) {
  return <ToolbarPrimitive.Group data-slot="toolbar-group" className={mergeClass('flex shrink-0 items-center gap-0.5', className)} {...props}/>;
}

function itemSize(size: ToolbarSize, iconOnly?: boolean): NonNullable<ButtonProps['size']> {
  if (iconOnly) return size === 'sm' ? 'icon-sm' : 'icon';
  return size === 'sm' ? 'sm' : 'default';
}

type ToolbarButtonProps = Omit<ToolbarPrimitive.Button.Props, 'render'> & {
  /** ghost (the default) for every quiet action; secondary for a flat one; primary, confirm or destructive for the one lead. */
  variant?: ButtonProps['variant'];
  /** A square item holding only an icon. Give it an aria-label. */
  iconOnly?: boolean;
  pending?: boolean;
};

function ToolbarButton({variant = 'ghost', iconOnly, pending, className, children, ...props}: ToolbarButtonProps) {
  const size = useContext(SizeContext);
  return <ToolbarPrimitive.Button
    data-slot="toolbar-button"
    render={<Button variant={variant} size={itemSize(size, iconOnly)} pending={pending}/>}
    className={mergeClass(['max-w-none', !iconOnly && (size === 'sm' ? 'px-2' : 'px-2.5')], className)}
    {...props}
  >{children}</ToolbarPrimitive.Button>;
}

type ToolbarToggleProps = Omit<TogglePrimitive.Props, 'render'> & {
  /** A square item holding only an icon. Give it an aria-label. */
  iconOnly?: boolean;
};

/** An on or off setting. Pressed takes the pressed wash and sets aria-pressed. */
function ToolbarToggle({iconOnly, className, ...props}: ToolbarToggleProps) {
  const size = useContext(SizeContext);
  return <ToolbarPrimitive.Button
    data-slot="toolbar-toggle"
    render={<TogglePrimitive
      className={mergeClass([
        buttonVariants({variant: 'ghost', size: itemSize(size, iconOnly)}),
        'max-w-none',
        !iconOnly && (size === 'sm' ? 'px-2' : 'px-2.5'),
        'text-text-2 hover:not-data-disabled:text-text-1',
        'data-pressed:bg-pressed data-pressed:text-text-1 data-pressed:hover:not-data-disabled:bg-pressed',
        'forced-colors:data-pressed:border-2',
      ], className)}
      {...props}
    />}
  />;
}

/** A 1px rule between two groups of items. */
function ToolbarSeparator({className, ...props}: ToolbarPrimitive.Separator.Props) {
  return <ToolbarPrimitive.Separator
    data-slot="toolbar-separator"
    className={cn('mx-1 h-4 w-px shrink-0 bg-line forced-colors:bg-[CanvasText]', className)}
    {...props}
  />;
}

export {Toolbar, ToolbarGroup, ToolbarButton, ToolbarToggle, ToolbarSeparator, type ToolbarProps, type ToolbarButtonProps, type ToolbarToggleProps};

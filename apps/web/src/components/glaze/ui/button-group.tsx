'use client';

import {mergeProps} from '@base-ui/react/merge-props';
import {useRender} from '@base-ui/react/use-render';
import {cva, type VariantProps} from 'class-variance-authority';
import {createContext, useContext, useMemo, useRef, type ComponentProps, type ReactNode, type RefObject} from 'react';
import {Icon, ChevronDown} from '#/components/glaze/icon.tsx';
import {cn, mergeRefs} from '#/lib/glaze/utils.ts';
import {Button, type ButtonProps} from '#/components/glaze/ui/button.tsx';
import {DropdownMenu, DropdownMenuContent, DropdownMenuTrigger} from '#/components/glaze/ui/dropdown-menu.tsx';

// Glaze's button group: related buttons joined into one pill. The first member keeps its round start, the last
// its round end, and the ones between are square, so the group reads as one control. Members overlap by a pixel, so two
// rings make one 1px seam, never a 2px one; the hovered or focused member rises over its neighbours so its whole
// ring shows. A press does not scale a member, because a shrinking cell would open the seams.
//
// Use it for actions of one kind side by side: previous and next, zoom out and in, a set of views. It is a group of
// actions, so it holds at most one primary (ink) member; the lint counts a ButtonGroup as one group.
//
// ButtonGroupText is a flat label or value inside the row (a page count, a zoom level), on the same height, with the
// secondary button's ring colour as its line, so it joins the seams. ButtonGroupSeparator is a 1px rule between two halves
// of a group of ghost buttons.
//
// Split button: ButtonGroupMenu as the last member is a square caret that opens a DropdownMenu of close alternatives
// ("Run on all cases", "Run on failures only"). The menu anchors to the whole group, not the caret, so it lines up
// under both halves and is at least as wide as the group. Like every member it is flat: the group is one control and
// holds no glass, so a split button is the secondary beside a page's one primary, never the primary itself. Pass the
// main action's pending to the menu, so the alternatives lock while it runs.

const buttonGroupVariants = cva(
  [
    'flex w-fit items-stretch',
    // Joined members: no press scale, and the hovered or focused one sits over its neighbours.
    '[&>*]:[--scale-press:1] [&>*]:hover:z-(--z-raised) [&>*]:focus-visible:z-(--z-raised)', // value-ok: 1 is no scale, the joined members must not shrink
    // A group of groups: 8px apart, each its own pill.
    // A focused member's ring is drawn inside it, so a square middle cell does not grow a square halo past the pill.
    '[&>*]:focus-visible:focus-ring-inset',
    'has-[>[data-slot=button-group]]:gap-2',
  ],
  {
    variants: {
      orientation: {
        // A member's place ignores the focus guards an open menu adds inside the group, so a split button's caret
        // keeps its round end while its menu is open.
        horizontal: [
          '[&>:not([data-slot=button-group],[data-slot=button-group-separator]):not(:nth-child(1_of_:not([data-base-ui-focus-guard],[aria-owns])))]:-ms-px',
          '[&>:not([data-slot=button-group],[data-slot=button-group-separator]):not(:nth-child(1_of_:not([data-base-ui-focus-guard],[aria-owns])))]:rounded-s-none [&>:not([data-slot=button-group],[data-slot=button-group-separator]):not(:nth-last-child(1_of_:not([data-base-ui-focus-guard],[aria-owns])))]:rounded-e-none',
        ],
        vertical: [
          'flex-col',
          '[&>:not([data-slot=button-group],[data-slot=button-group-separator]):not(:nth-child(1_of_:not([data-base-ui-focus-guard],[aria-owns])))]:-mt-px',
          '[&>:not([data-slot=button-group],[data-slot=button-group-separator]):not(:nth-child(1_of_:not([data-base-ui-focus-guard],[aria-owns])))]:rounded-t-none [&>:not([data-slot=button-group],[data-slot=button-group-separator]):not(:nth-last-child(1_of_:not([data-base-ui-focus-guard],[aria-owns])))]:rounded-b-none',
          // A column of pills would be lozenges; its ends take the overlay corner instead.
          '[&>:nth-child(1_of_:not([data-base-ui-focus-guard],[aria-owns]))]:rounded-t-overlay [&>:nth-last-child(1_of_:not([data-base-ui-focus-guard],[aria-owns]))]:rounded-b-overlay',
        ],
      },
    },
    defaultVariants: {orientation: 'horizontal'},
  },
);

type ButtonGroupProps = ComponentProps<'div'> & VariantProps<typeof buttonGroupVariants>;

// The group's element, for a split button's menu to anchor to.
const GroupAnchor = createContext<RefObject<HTMLDivElement | null> | null>(null);

/** A row or column of joined buttons. Name it with aria-label when its members do not say what they act on. */
function ButtonGroup({className, orientation = 'horizontal', ref, ...props}: ButtonGroupProps) {
  const own = useRef<HTMLDivElement | null>(null);
  const setRef = useMemo(() => mergeRefs<HTMLDivElement>(own, ref), [ref]);
  return <GroupAnchor.Provider value={own}>
    <div
      ref={setRef}
      role="group"
      data-slot="button-group"
      data-orientation={orientation}
      className={cn(buttonGroupVariants({orientation}), className)}
      {...props}
    />
  </GroupAnchor.Provider>;
}

type ButtonGroupMenuProps = {
  /** The caret's name: what the alternatives are. "More run options". */
  label: string;
  /** DropdownMenuItems, groups and separators. */
  children: ReactNode;
  /** Match the main action: secondary (the default) or ghost. A group holds no glass. */
  variant?: 'secondary' | 'ghost';
  /** Match the main action's size. */
  size?: 'sm' | 'default' | 'lg';
  /** The main action is running: the caret locks with it. */
  pending?: boolean;
  disabled?: boolean;
  /** Where the menu lines up under the group. */
  align?: 'start' | 'end';
  /** Opens with the menu open, for a still picture. */
  defaultOpen?: boolean;
  /** How the menu moves to stay on screen; a still picture pins it. */
  collisionAvoidance?: ComponentProps<typeof DropdownMenuContent>['collisionAvoidance'];
};

const caretSize: Record<NonNullable<ButtonGroupMenuProps['size']>, ButtonProps['size']> = {sm: 'icon-sm', default: 'icon', lg: 'icon-lg'};

/** Split mode: a caret member that opens a menu of alternatives, anchored to the whole group. */
function ButtonGroupMenu({label, children, variant = 'secondary', size = 'default', pending, disabled, align = 'end', defaultOpen, collisionAvoidance}: ButtonGroupMenuProps) {
  const anchor = useContext(GroupAnchor);
  return <DropdownMenu defaultOpen={defaultOpen} modal={defaultOpen ? false : undefined}>
    <DropdownMenuTrigger
      render={<Button variant={variant} size={caretSize[size]}/>}
      disabled={disabled || pending}
      aria-label={label}
      data-slot="button-group-menu-trigger"
    >
      <Icon icon={ChevronDown} className="transition-transform duration-(--dur-state) in-data-popup-open:rotate-180 motion-reduce:transition-none"/>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      data-slot="button-group-menu"
      anchor={anchor ?? undefined}
      align={align}
      size={size === 'sm' ? 'sm' : 'default'}
      collisionAvoidance={collisionAvoidance}
      finalFocus={defaultOpen ? false : undefined}
      className="min-w-(--anchor-width) max-w-[min(var(--popover),var(--available-width))]"
    >{children}</DropdownMenuContent>
  </DropdownMenu>;
}

/** A label or value inside the group, such as "Page 2 of 14", joined to the members around it. */
function ButtonGroupText({className, render, ...props}: useRender.ComponentProps<'div'>) {
  return useRender({
    defaultTagName: 'div',
    render,
    props: mergeProps<'div'>(
      {
        ...({'data-slot': 'button-group-text'} as ComponentProps<'div'>),
        className: cn('relative flex items-center gap-1.5 rounded-pill border border-(--flat-ring) bg-(--flat-bg) px-3 type-label text-text-2 data tabular-nums [&_svg]:pointer-events-none [&_svg]:size-(--icon)', className),
      },
      props,
    ),
  });
}

/** A 1px rule between two halves of a group of ghost buttons. */
function ButtonGroupSeparator({className, orientation = 'vertical', ...props}: ComponentProps<'div'> & {orientation?: 'horizontal' | 'vertical'}) {
  return <div
    role="separator"
    aria-orientation={orientation}
    data-slot="button-group-separator"
    data-orientation={orientation}
    className={cn('relative shrink-0 self-stretch rounded-none! bg-line forced-colors:bg-[CanvasText]', orientation === 'vertical' ? 'mx-1 my-2 w-px' : 'mx-2 my-1 h-px', className)}
    {...props}
  />;
}

export {ButtonGroup, ButtonGroupMenu, ButtonGroupSeparator, ButtonGroupText, buttonGroupVariants, type ButtonGroupMenuProps, type ButtonGroupProps};

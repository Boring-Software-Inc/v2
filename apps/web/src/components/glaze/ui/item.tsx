'use client';

import {createContext, useContext} from 'react';
import {mergeProps} from '@base-ui/react/merge-props';
import {useRender} from '@base-ui/react/use-render';
import {cva, type VariantProps} from 'class-variance-authority';
import {cn} from '#/lib/glaze/utils.ts';

// The list row: media, a title and a description, then meta and actions on one line, 36px tall (--row) with one line
// and growing with a description. Rows live in an ItemGroup: a panel (the card's white surface) whose rows split on
// rule-row, the last one dropping it at the panel's edge. Inside a Card use ItemGroup variant="plain" in
// CardContent flush, so the card's panel is the one surface.
//
// A row that opens something puts ItemLink in its title: the link's hit area covers the row, the row takes the hover
// wash, its focus ring is drawn inside the row's edge (the panel would clip one outside it), and ItemActions sit
// above the link as their own buttons. Selected takes the pressed wash, ink at 10%, never a colour and never a bar
// on one edge.
//
// The row gives up parts as it narrows, measured by its own width: under 28rem the meta goes, and the title truncates
// last. Actions never drop.

const ItemGroupContext = createContext(false);

const itemGroupVariants = cva('group/item-group flex w-full min-w-0 flex-col overflow-hidden', {
  variants: {
    variant: {
      panel: 'panel forced-colors:border-[CanvasText]',
      plain: '',
    },
  },
  defaultVariants: {variant: 'panel'},
});

type ItemGroupProps = React.ComponentProps<'div'> & VariantProps<typeof itemGroupVariants>;

/** The list: a panel of rows, or plain inside a card's panel. role="list"; each Item inside is a listitem. */
function ItemGroup({className, variant = 'panel', role = 'list', ...props}: ItemGroupProps) {
  return <ItemGroupContext.Provider value={true}>
    <div data-slot="item-group" data-variant={variant} role={role} className={cn(itemGroupVariants({variant}), className)} {...props}/>
  </ItemGroupContext.Provider>;
}

const itemVariants = cva(
  [
    'group/item @container/item relative flex w-full min-w-0 items-center gap-3 px-3 text-start text-text-1',
    'transition-[background-color] duration-(--dur-state) ease-out',
    'in-data-[slot=item-group]:rule-row',
    // A row with an ItemLink is one target: the wash under the pointer, the ring inside its edge on focus.
    'has-[[data-slot=item-link]:hover]:not-data-selected:bg-hover-row has-[[data-slot=item-link]:active]:bg-pressed',
    'has-[[data-slot=item-link]:focus-visible]:focus-ring-row',
    'data-selected:bg-pressed forced-colors:data-selected:outline forced-colors:data-selected:outline-2 forced-colors:data-selected:-outline-offset-2',
    'data-disabled:text-text-disabled',
  ],
  {
    variants: {
      inset: {
        true: 'rounded-tag in-data-[slot=item-group]:border-0',
        false: '',
      },
      size: {
        default: 'min-h-(--row) py-1.5 has-data-[slot=item-description]:py-2',
        sm: 'min-h-(--control) gap-2 py-1',
      },
    },
    defaultVariants: {size: 'default'},
  },
);

type ItemProps = useRender.ComponentProps<'div'> & VariantProps<typeof itemVariants> & {
  /** The chosen row in a list. Takes the pressed wash and aria-current on its link. */
  selected?: boolean;
  /** A row that cannot be opened now: its words go to the disabled grey. */
  disabled?: boolean;
};

function Item({className, size = 'default', inset = false, selected, disabled, render, ...props}: ItemProps) {
  const inGroup = useContext(ItemGroupContext);
  return useRender({
    defaultTagName: 'div',
    props: mergeProps<'div'>(
      {className: cn(itemVariants({size, inset}), className)},
      {
        'data-slot': 'item',
        'data-size': size,
        'data-selected': selected ? '' : undefined,
        'data-disabled': disabled ? '' : undefined,
        role: inGroup ? 'listitem' : undefined,
      } as React.ComponentProps<'div'>,
      props,
    ),
    render,
    state: {slot: 'item', size},
  });
}

const itemMediaVariants = cva('flex shrink-0 items-center justify-center group-has-data-[slot=item-description]/item:self-start group-has-data-[slot=item-description]/item:mt-0.5 [&_svg]:pointer-events-none', {
  variants: {
    variant: {
      default: '',
      icon: 'size-6 text-text-2',
      image: 'size-8 overflow-hidden rounded-tag bg-field [&_img]:size-full [&_img]:object-cover',
    },
  },
  defaultVariants: {variant: 'default'},
});

/** The lead: an Avatar, an icon or a thumbnail. */
function ItemMedia({className, variant = 'default', ...props}: React.ComponentProps<'div'> & VariantProps<typeof itemMediaVariants>) {
  return <div data-slot="item-media" data-variant={variant} className={cn(itemMediaVariants({variant}), className)} {...props}/>;
}

/** The title and description, taking the room left. */
function ItemContent({className, ...props}: React.ComponentProps<'div'>) {
  return <div data-slot="item-content" className={cn('flex min-w-0 flex-1 flex-col gap-0.5', className)} {...props}/>;
}

/** The name, one line, truncated last. Add an ID after it in mono. */
function ItemTitle({className, ...props}: React.ComponentProps<'div'>) {
  return <div data-slot="item-title" className={cn('flex min-w-0 items-baseline gap-2 type-label [&>*:first-child]:min-w-0 [&>*:first-child]:truncate', className)} {...props}/>;
}

/** Up to two lines under the title, in text-2. */
function ItemDescription({className, ...props}: React.ComponentProps<'p'>) {
  return <p data-slot="item-description" className={cn('line-clamp-2 type-body-sm text-text-2 group-data-disabled/item:text-text-disabled', className)} {...props}/>;
}

/** A time, an owner, a count. The first part the row drops: hidden when the row is under 28rem wide. */
function ItemMeta({className, ...props}: React.ComponentProps<'div'>) {
  return <div data-slot="item-meta" className={cn('shrink-0 type-caption text-text-2 @max-md/item:hidden', className)} {...props}/>;
}

/**
 * The row's link, inside ItemTitle. Its hit area covers the whole row, ItemActions stay their own buttons above it,
 * and the row takes one tab stop with its ring inside the row's edge.
 */
function ItemLink({className, ...props}: React.ComponentProps<'a'>) {
  return <a data-slot="item-link" data-control="" className={cn('min-w-0 truncate after:absolute after:inset-0 after:content-[""]', className)} {...props}/>;
}

/** Buttons at the end of the row: size="icon-sm" ghost, or one size="sm" secondary Button. They never drop. */
function ItemActions({className, ...props}: React.ComponentProps<'div'>) {
  return <div data-slot="item-actions" className={cn('relative z-(--z-raised) -me-2 flex shrink-0 items-center gap-1', className)} {...props}/>;
}

export {Item, ItemGroup, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemMeta, ItemLink, ItemActions, itemVariants, itemGroupVariants, type ItemProps, type ItemGroupProps};

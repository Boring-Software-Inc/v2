'use client';

import {Toggle as TogglePrimitive} from '@base-ui/react/toggle';
import {cva} from 'class-variance-authority';
import type {ComponentProps, KeyboardEvent, MouseEvent, ReactNode, RefObject} from 'react';
import {Icon, Close} from '#/components/glaze/icon.tsx';
import {cn} from '#/lib/glaze/utils.ts';

// Glaze's chip: the small pill a person acts on. Two jobs share one look and one size, 26px (--control-sm), so a chip
// sits 3px inside a 32px field, the card's shell inset, and stays concentric with it:
// - Chip: a filter that is on or off, on Base UI's Toggle with aria-pressed. Off is paper with the field's hairline;
//   on is the pressed wash (ink at 10%) with the line darkened to ink at a third; hover darkens only the line. Flat, not glass: glass marks the one
//   control a group leads with, and a row of filters has no lead.
// - Chip with onRemove: a value someone chose (a tag), with a real remove button 3px inside its end. Removing it hands
//   focus to the next chip's remove button, else the previous one, so a keyboard user can clear a row with Enter or
//   Backspace without focus falling to the page. The last chip has no neighbour, so the caller names where focus goes
//   then with focusAfterEmpty (usually the field that adds values).
// Both take an optional count after the label, in tabular figures. A label too long for its row ends in an ellipsis.
// ChipGroup is a row 4px apart that wraps; it is also the scope removal moves focus within.

const chipVariants = cva([
  'group/chip relative inline-flex h-(--control-sm) focus-sm max-w-full min-w-0 shrink-0 items-center gap-1 rounded-pill border whitespace-nowrap select-none',
  'type-label-sm transition-[background-color,border-color,color,scale] duration-(--dur-state) ease-out',
  '[&_svg]:pointer-events-none [&_svg]:size-(--icon-sm) [&_svg]:shrink-0 [&_svg]:text-text-3',
  'forced-colors:border-[ButtonText]',
]);

const toggleClasses = [
  'cursor-pointer px-2.5 [-webkit-tap-highlight-color:transparent]',
  'border-line-control bg-paper text-text-1',
  'hover:not-data-disabled:border-line-focus active:not-data-disabled:scale-(--scale-press) active:duration-(--dur-press)',
  'data-pressed:border-line-focus data-pressed:bg-pressed data-pressed:[&_svg]:text-text-1',
  'data-disabled:cursor-not-allowed data-disabled:border-line-faint data-disabled:text-text-disabled',
  'forced-colors:data-pressed:border-2',
].join(' ');

const valueClasses = [
  'ps-2.5 pe-(--shell-inset) border-line-control bg-paper text-text-1',
  'data-invalid:border-fail',
  'data-disabled:border-line-faint data-disabled:text-text-disabled',
].join(' ');

/** The remove button 3px inside a value chip's end. Exported for the combobox's chips, which are this chip on Base UI's parts. */
const chipRemoveClasses = cn(
  // 3px inside the chip's line, so the round button is concentric with the pill.
  'relative inline-flex size-[calc(var(--control-sm)-2*var(--shell-inset)-2*var(--line-width))] shrink-0 items-center justify-center rounded-pill text-text-2',
  'transition-[background-color,color] duration-(--dur-state) ease-out hover:not-disabled:bg-hover hover:not-disabled:text-text-1 active:not-disabled:bg-pressed',
  'focus-sm focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:text-text-disabled',
  // The hit area reaches the chip's full height.
  'after:absolute after:-inset-1',
  '[&_svg]:text-current',
);

/** A count after the label, in tabular figures and text-2. */
const fmt = new Intl.NumberFormat('en-US');

function ChipCount({children, className}: {children: ReactNode; className?: string}) {
  return <span data-slot="chip-count" className={cn('data text-text-2', className)}>{typeof children === 'number' ? fmt.format(children) : children}</span>;
}

type ToggleChipProps = TogglePrimitive.Props & {
  /** A number after the label: matching runs, active filters. */
  count?: number;
  onRemove?: undefined;
};

type ValueChipProps = Omit<ComponentProps<'span'>, 'onChange'> & {
  count?: number;
  /** Makes the chip a removable value. Called by the remove button, Backspace or Delete. */
  onRemove: () => void;
  /** The remove button's name. Defaults to "Remove" and the chip's text. */
  removeLabel?: string;
  /** A value the field will not take. Turns the line coral; say why in the field's error. */
  invalid?: boolean;
  disabled?: boolean;
  /** Where focus goes when this was the last chip in the row: the field that adds values, usually. */
  focusAfterEmpty?: RefObject<HTMLElement | null>;
};

type ChipProps = ToggleChipProps | ValueChipProps;

function Chip(props: ChipProps) {
  if (props.onRemove) return <ValueChip {...props}/>;
  const {className, count, children, ...rest} = props as ToggleChipProps;
  return <TogglePrimitive
    data-slot="chip"
    className={state => cn(chipVariants(), toggleClasses, typeof className === 'function' ? className(state) : className)}
    {...rest}
  >
    {typeof children === 'string' ? <span className="min-w-0 truncate">{children}</span> : children}
    {count !== undefined && <ChipCount>{count}</ChipCount>}
  </TogglePrimitive>;
}

/** Where focus goes after a chip is removed: the next chip's remove button, else the previous one. */
function focusAfterRemove(button: HTMLElement, fallback?: RefObject<HTMLElement | null>) {
  const scope = button.closest('[data-slot=chip-group]') ?? button.closest('[data-slot=chip-value]')?.parentElement;
  if (!scope) return () => {};
  const all = [...scope.querySelectorAll<HTMLElement>('[data-slot=chip-remove]:not(:disabled)')];
  const i = all.indexOf(button);
  const target = all[i + 1] ?? all[i - 1];
  return () => {
    if (target?.isConnected) target.focus();
    else if (!target) fallback?.current?.focus();
  };
}

function ValueChip({className, count, children, onRemove, removeLabel, invalid, disabled, focusAfterEmpty, ...props}: ValueChipProps) {
  const text = typeof children === 'string' ? children : undefined;
  const remove = (event: MouseEvent<HTMLButtonElement> | KeyboardEvent<HTMLButtonElement>) => {
    const refocus = focusAfterRemove(event.currentTarget, focusAfterEmpty);
    onRemove();
    requestAnimationFrame(refocus);
  };
  return <span
    data-slot="chip-value"
    data-invalid={invalid || undefined}
    data-disabled={disabled || undefined}
    className={cn(chipVariants(), valueClasses, className)}
    {...props}
  >
    <span className="min-w-0 truncate">{children}</span>
    {count !== undefined && <ChipCount>{count}</ChipCount>}
    {invalid && <span className="sr-only">(not accepted)</span>}
    <button
      type="button"
      data-slot="chip-remove"
      onClick={remove}
      onKeyDown={event => { if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); remove(event); } }}
      disabled={disabled}
      aria-label={removeLabel ?? (text ? `Remove ${text}` : 'Remove')}
      className={chipRemoveClasses}
    >
      <Icon icon={Close} size={12}/>
    </button>
  </span>;
}

/** A row of chips 4px apart that wraps. The scope removal moves focus within. */
function ChipGroup({className, ...props}: ComponentProps<'div'>) {
  return <div data-slot="chip-group" className={cn('flex flex-wrap items-center gap-1', className)} {...props}/>;
}

export {Chip, ChipCount, ChipGroup, chipVariants, toggleClasses as chipToggleClasses, valueClasses as chipValueClasses, chipRemoveClasses, type ChipProps};

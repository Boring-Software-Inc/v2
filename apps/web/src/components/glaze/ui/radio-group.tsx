'use client';

import {Radio as RadioPrimitive} from '@base-ui/react/radio';
import {RadioGroup as RadioGroupPrimitive} from '@base-ui/react/radio-group';
import {useId, type ReactNode} from 'react';
import {cn} from '#/lib/glaze/utils.ts';

// Glaze's radio group, on Base UI's RadioGroup and Radio. One tab stop for the group; the arrow keys move the choice.
// Each radio is a 16px circle with a 1px line at ink 45%, the 3:1 edge a control needs, which turns text-2 under the
// pointer. The chosen one is small glaze (glaze-sm) with a 6px dot in its glyph colour, so it reads from the fill and the
// dot in both themes. Invalid (aria-invalid on the group) turns every unchosen circle's line coral. Disabled drops the
// glaze to the flat grey field.
//
// Radios exist to compare a few choices, so RadioGroupOption carries each choice's consequence: a label and a line
// under it, both inside one label so the whole row is the target, the line tied by aria-describedby. Arrowing through
// the group, a screen reader hears "Fast, about 2 seconds a reply, radio button, 2 of 3", not three bare names.

type RadioGroupProps = RadioGroupPrimitive.Props & {'aria-invalid'?: boolean | 'true' | 'false'};

function RadioGroup({className, 'aria-invalid': invalid, ...props}: RadioGroupProps) {
  const isInvalid = invalid === true || invalid === 'true';
  return <RadioGroupPrimitive
    data-slot="radio-group"
    data-invalid={isInvalid || undefined}
    aria-invalid={isInvalid || undefined}
    className={state => cn('group/radio-group grid w-full gap-3', typeof className === 'function' ? className(state) : className)}
    {...props}
  />;
}

const base = [
  'peer relative inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-pill focus-sm [-webkit-tap-highlight-color:transparent]',
  'after:absolute after:-inset-1.5',
  'data-disabled:cursor-not-allowed data-readonly:cursor-default',
  'forced-colors:border forced-colors:border-solid forced-colors:border-[CanvasText]',
].join(' ');
const chosen = 'glaze-sm forced-colors:[forced-color-adjust:none] forced-colors:bg-[Highlight]';
const open = [
  'border border-line-strong bg-paper transition-[border-color,background-color] duration-(--dur-state) ease-out',
  'hover:not-data-disabled:not-data-readonly:group-not-data-invalid/radio-group:border-text-2 active:not-data-disabled:not-data-readonly:bg-pressed',
  'group-data-invalid/radio-group:border-fail',
  'data-disabled:border-line-control data-disabled:bg-field',
].join(' ');

function RadioGroupItem({className, ...props}: RadioPrimitive.Root.Props) {
  return <RadioPrimitive.Root
    data-slot="radio-group-item"
    className={state => cn(base, state.checked ? chosen : open, typeof className === 'function' ? className(state) : className)}
    {...props}
  >
    <RadioPrimitive.Indicator data-slot="radio-group-indicator" className="size-1.5 rounded-pill bg-current forced-colors:bg-[HighlightText]"/>
  </RadioPrimitive.Root>;
}

type RadioGroupOptionProps = Omit<RadioPrimitive.Root.Props, 'children' | 'className'> & {
  /** Classes for the row, a plain label around the radio. */
  className?: string;
  /** The choice's name, one to three words. */
  label: ReactNode;
  /** What picking it means: a limit, a price, a consequence. Read with the name. */
  description?: ReactNode;
};

/** A radio with its label and an optional description in one target row. */
function RadioGroupOption({label, description, className, ...props}: RadioGroupOptionProps) {
  const id = useId();
  return <label data-slot="radio-group-option" className={cn('flex cursor-pointer items-start gap-3 has-data-disabled:cursor-not-allowed', className)}>
    <RadioGroupItem aria-labelledby={`${id}-l`} aria-describedby={description ? `${id}-d` : undefined} {...props}/>
    <span className="flex min-w-0 flex-col gap-0.5 peer-data-disabled:*:text-text-disabled">
      <span id={`${id}-l`} className="type-label text-text-1">{label}</span>
      {description && <span id={`${id}-d`} className="type-body-sm text-text-2">{description}</span>}
    </span>
  </label>;
}

export {RadioGroup, RadioGroupItem, RadioGroupOption, type RadioGroupProps, type RadioGroupOptionProps};

'use client';

import {Checkbox as CheckboxPrimitive} from '@base-ui/react/checkbox';
import {CheckboxGroup as CheckboxGroupPrimitive} from '@base-ui/react/checkbox-group';
import {Icon, Check} from '#/components/glaze/icon.tsx';
import {cn} from '#/lib/glaze/utils.ts';

// Glaze's checkbox, on Base UI's Checkbox. A 16px box on the 6px tag corner, so it never reads as a radio's circle.
// Unticked is paper with a 1px line at ink 45%, the 3:1 edge a control needs, and the line turns text-2 under the
// pointer. Ticked and mixed are small glaze (glaze-sm), the press recipe drawn for 16px, with the check or the minus in its
// glyph colour, so the state reads from the fill and the glyph and holds in both themes (light glaze in dark). Invalid turns
// an unticked box's line coral. Disabled drops the glaze to the flat grey field, as a disabled button does.
//
// The hit area grows past the box with ::after, so a 16px box still takes a 28px target. The box stops its click from
// bubbling, so ticking a checkbox inside a clickable row never opens the row.
//
// Select-all: inside a CheckboxGroup with allValues, a Checkbox with parent takes its state from the rest: all ticked is
// checked, some is mixed, none is clear. Pressed from mixed it ticks all, then clears all, then brings back the set the
// person picked, so select-all never destroys a hand-made selection.

type CheckboxProps = CheckboxPrimitive.Root.Props & {'aria-invalid'?: boolean | 'true' | 'false'};

const base = [
  'peer relative inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-tag focus-sm [-webkit-tap-highlight-color:transparent]',
  'after:absolute after:-inset-1.5',
  'data-disabled:cursor-not-allowed data-readonly:cursor-default',
  'forced-colors:border forced-colors:border-solid forced-colors:border-[CanvasText]',
].join(' ');

// A ticked box is small glaze: a lifted grey to ink, so the white check reads at 6.7:1 or better where it sits.
const ticked = 'glaze-sm forced-colors:[forced-color-adjust:none] forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]';
const clear = [
  'border border-line-strong bg-paper transition-[border-color,background-color] duration-(--dur-state) ease-out',
  'hover:not-data-disabled:not-data-readonly:not-aria-invalid:border-text-2 active:not-data-disabled:not-data-readonly:bg-pressed',
  'aria-invalid:border-fail',
  'data-disabled:border-line-control data-disabled:bg-field',
].join(' ');

function Checkbox({className, 'aria-invalid': invalid, onClick, ...props}: CheckboxProps) {
  const isInvalid = invalid === true || invalid === 'true';
  return <CheckboxPrimitive.Root
    data-slot="checkbox"
    aria-invalid={isInvalid || undefined}
    onClick={event => { onClick?.(event); event.stopPropagation(); }}
    className={state => cn(base, state.checked || state.indeterminate ? ticked : clear, typeof className === 'function' ? className(state) : className)}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      data-slot="checkbox-indicator"
      className="tick-draw grid place-content-center text-current"
      render={(indicatorProps, state) => <span {...indicatorProps}>
        {state.indeterminate
          // The dash is a drawn bar, not a glyph: 8 by 2, square to the pixel grid, so it stays crisp at 16px.
          ? <span data-slot="checkbox-dash" className="block h-0.5 w-2 rounded-pill bg-current"/>
          // Bold: the tick is a 12px glyph on the glaze, where regular (0.75px) goes thin beside the 2px dash.
          : <Icon icon={Check} size={12} weight="bold"/>}
      </span>}
    />
  </CheckboxPrimitive.Root>;
}

/** A set of checkboxes with one value array. Give it allValues to let a parent Checkbox select all. */
function CheckboxGroup({className, ...props}: CheckboxGroupPrimitive.Props) {
  return <CheckboxGroupPrimitive
    data-slot="checkbox-group"
    className={state => cn('flex flex-col gap-2', typeof className === 'function' ? className(state) : className)}
    {...props}
  />;
}

export {Checkbox, CheckboxGroup, type CheckboxProps};

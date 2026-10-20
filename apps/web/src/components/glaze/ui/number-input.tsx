'use client';

import type {ReactNode, Ref} from 'react';
import {NumberField as NumberFieldPrimitive} from '@base-ui/react/number-field';
import {Icon, Add, Subtract} from '#/components/glaze/icon.tsx';
import {cn} from '#/lib/glaze/utils.ts';
import {useFieldDisabled} from '#/components/glaze/ui/field.tsx';
import {InputAction, InputLeading, InputRoot, InputTrailing, type InputSize} from '#/components/glaze/ui/input.tsx';

// Glaze's number input, on Base UI's NumberField: a number in Input's pill, with a step down at its start and a step
// up at its end. The steppers are InputActions, ghost and round, 3px inside the line like every action in a field, so
// the pill reads − value + and stays concentric. The value is centred in tabular figures; a unit ("ms", "tokens")
// follows it in text-3, inside the pill.
//
// Base UI does the arithmetic: the arrow keys step, Shift steps by largeStep and Alt by smallStep, holding a stepper
// repeats, and a typed number is read and clamped on blur. A stepper turns off at its bound. The steppers stay out of
// the tab order: the keys already step from the text, so one tab stop is enough.

type NumberInputProps = Omit<NumberFieldPrimitive.Root.Props, 'className' | 'render' | 'onValueChange'> & {
  /** 26, 32 or 36px. Match the buttons and fields beside it. */
  size?: InputSize;
  /** Text after the value, inside the pill: "ms", "tokens", "USD". Also read after the value. */
  unit?: string;
  /** Before the steppers: an icon or a currency sign. */
  leading?: ReactNode;
  onValueChange?: (value: number | null) => void;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  ref?: Ref<HTMLInputElement>;
};

/** A stepper is a control, so its glyph is text-2 at rest; at its bound, or in a disabled field, it drops to
    text-disabled and loses its wash. At text-3 the drop to text-disabled was too small to read as off. */
const stepperClass = '[&_svg]:text-text-2 disabled:bg-transparent disabled:text-text-disabled data-disabled:bg-transparent data-disabled:text-text-disabled aria-disabled:text-text-disabled aria-disabled:hover:bg-transparent disabled:[&_svg]:text-text-disabled! aria-disabled:[&_svg]:text-text-disabled!';

const textSize: Record<InputSize, string> = {sm: 'type-caption', default: 'type-body-sm', lg: 'type-body'};

function NumberInput({size = 'default', unit, leading, placeholder, className, disabled: disabledProp, onValueChange, 'aria-label': ariaLabel, 'aria-describedby': describedBy, 'aria-invalid': invalid, ref, ...props}: NumberInputProps) {
  const disabled = useFieldDisabled() || !!disabledProp;
  const forced = Object.fromEntries(Object.entries(props).filter(([k]) => k.startsWith('data-force-')));
  const rest = Object.fromEntries(Object.entries(props).filter(([k]) => !k.startsWith('data-force-'))) as typeof props;
  return <NumberFieldPrimitive.Root
    data-slot="number-input"
    disabled={disabled}
    onValueChange={v => onValueChange?.(v)}
    {...rest}
  >
    <NumberFieldPrimitive.Group
      data-slot="number-input-group"
      render={<InputRoot size={size} disabled={disabled} readOnly={props.readOnly}/>}
      data-invalid={invalid || undefined}
      // A stepper at its bound is a disabled button inside the pill, which the field recipe would read as a disabled field.
      className={cn('gap-1 px-3 not-data-disabled:bg-paper! not-data-disabled:text-text-1!', className)}
      {...forced}
    >
      {leading !== undefined && <InputLeading>{leading}</InputLeading>}
      <InputLeading>
        <NumberFieldPrimitive.Decrement data-slot="number-input-decrement" aria-label="Decrease" tabIndex={-1} render={<InputAction className={stepperClass}/>}><Icon icon={Subtract}/></NumberFieldPrimitive.Decrement>
      </InputLeading>
      <span className="flex min-w-0 flex-1 items-center justify-center gap-1">
        <NumberFieldPrimitive.Input
          ref={ref}
          data-slot="number-input-control"
          data-control=""
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          className={cn('h-full w-full min-w-0 bg-transparent text-text-1 data disabled:text-text-disabled placeholder:text-text-3 disabled:cursor-not-allowed', textSize[size], unit ? 'w-auto min-w-4 text-end field-sizing-content' : 'text-center')}
        />
        {unit && <span data-slot="number-input-unit" aria-hidden className={cn('shrink-0 text-text-3 group-data-disabled/input:text-text-disabled', textSize[size])}>{unit}</span>}
      </span>
      <InputTrailing>
        <NumberFieldPrimitive.Increment data-slot="number-input-increment" aria-label="Increase" tabIndex={-1} render={<InputAction className={stepperClass}/>}><Icon icon={Add}/></NumberFieldPrimitive.Increment>
      </InputTrailing>
    </NumberFieldPrimitive.Group>
  </NumberFieldPrimitive.Root>;
}

export {NumberInput, type NumberInputProps};

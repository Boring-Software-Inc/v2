'use client';

import {DirectionProvider} from '@base-ui/react/direction-provider';
import {Slider as SliderPrimitive} from '@base-ui/react/slider';
import {type CSSProperties, useMemo, useRef} from 'react';
import {useDomDirection} from '#/lib/glaze/direction.ts';
import {cn, mergeRefs} from '#/lib/glaze/utils.ts';

type StepSliderProps = {
  steps: readonly number[];
  value?: number;
  defaultValue?: number;
  onValueChange?: (value: number) => void;
  onValueCommitted?: (value: number) => void;
  majorSteps?: readonly number[];
  getValueText?: (value: number) => string;
  disabled?: boolean;
  className?: string;
  ref?: React.Ref<HTMLDivElement>;
  'aria-label'?: string;
  'aria-labelledby'?: string;
};

function nearestIndex(steps: readonly number[], value: number): number {
  let best = 0;
  for (let index = 1; index < steps.length; index++) {
    if (Math.abs((steps[index] ?? 0) - value) < Math.abs((steps[best] ?? 0) - value)) {
      best = index;
    }
  }
  return best;
}

function stopOffset(index: number, last: number): string {
  return `calc(var(--step-thumb) / 2 + (100% - var(--step-thumb)) * ${last === 0 ? 0 : index / last})`;
}

function StepSlider({
  steps,
  value,
  defaultValue,
  onValueChange,
  onValueCommitted,
  majorSteps,
  getValueText,
  disabled,
  className,
  ref,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
}: StepSliderProps) {
  const box = useRef<HTMLDivElement | null>(null);
  const boxRefs = useMemo(() => mergeRefs(box, ref), [ref]);
  const dir = useDomDirection(box);
  const last = steps.length - 1;
  const index = nearestIndex(steps, value ?? defaultValue ?? steps[0] ?? 0);
  const majors = useMemo(() => new Set(majorSteps ?? steps), [majorSteps, steps]);
  const toValue = (at: number) => steps[Math.round(at)] ?? steps[0] ?? 0;

  return <DirectionProvider direction={dir}>
    <SliderPrimitive.Root
      ref={boxRefs}
      data-slot="step-slider"
      className={cn('w-full rounded-pill bg-(--switch-off) p-1 data-disabled:bg-field', className)}
      style={{'--step-thumb': '2rem'} as CSSProperties}
      value={index}
      min={0}
      max={last}
      step={1}
      disabled={disabled}
      thumbAlignment="edge"
      onValueChange={next => onValueChange?.(toValue(next))}
      onValueCommitted={next => onValueCommitted?.(toValue(next))}
    >
      <SliderPrimitive.Control
        data-slot="step-slider-control"
        className="relative flex h-8 w-full touch-none items-center select-none data-disabled:cursor-not-allowed"
      >
        <SliderPrimitive.Track data-slot="step-slider-track" className="relative h-full w-full rounded-pill select-none">
          <SliderPrimitive.Indicator
            data-slot="step-slider-range"
            className="glaze-sm glaze-sm-x relative h-full overflow-hidden rounded-pill select-none data-disabled:bg-text-disabled! data-disabled:bg-none!"
          >
            <span aria-hidden className="step-dots absolute inset-0" />
            <span
              aria-hidden
              key={index}
              data-slot="step-slider-sweep"
              className="step-dots step-sweep absolute inset-y-0 w-2/5 motion-reduce:hidden"
            />
          </SliderPrimitive.Indicator>
          {steps.map((step, at) => <span
            aria-hidden
            data-filled={at <= index || undefined}
            data-major={majors.has(step) || undefined}
            data-slot="step-slider-stop"
            key={step}
            className={cn(
              'pointer-events-none absolute top-1/2 h-2 w-0.5 -translate-1/2 bg-line-control',
              'data-major:h-3 data-filled:bg-(--glaze-sm-highlight)',
            )}
            style={{insetInlineStart: stopOffset(at, last)}}
          />)}
          <SliderPrimitive.Thumb
            data-slot="step-slider-thumb"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledby}
            getAriaValueText={(_formatted, at) => getValueText?.(toValue(at)) ?? String(toValue(at))}
            className={cn(
              'glass glass-paper relative block size-(--step-thumb) shrink-0 cursor-grab rounded-pill select-none',
              'before:absolute before:-inset-1.5 before:rounded-pill before:transition-[background-color] before:duration-(--dur-state) before:ease-out',
              'hover:not-data-disabled:before:bg-hover data-dragging:cursor-grabbing data-dragging:before:bg-pressed',
              'has-focus-visible:focus-ring focus-visible:focus-ring',
              'data-disabled:cursor-not-allowed',
            )}
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  </DirectionProvider>;
}

export {StepSlider, type StepSliderProps};

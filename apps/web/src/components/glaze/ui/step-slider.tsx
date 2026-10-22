'use client';

import {DirectionProvider} from '@base-ui/react/direction-provider';
import {Slider as SliderPrimitive} from '@base-ui/react/slider';
import {type CSSProperties, useEffect, useMemo, useRef} from 'react';
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

const SWEEP_FROM = -60;
const SWEEP_TO = 160;
const SWEEP_KEYFRAMES: Keyframe[] = [
  {maskPosition: `${SWEEP_FROM}% 0`},
  {maskPosition: `${SWEEP_TO}% 0`},
];
const SWEEP_TIMING: KeyframeAnimationOptions = {duration: 900, easing: 'ease-out'};
const SWEEP_PAST_FILL = (100 - SWEEP_FROM) / (SWEEP_TO - SWEEP_FROM);
const SWEEP_BANDS = [0, 1] as const;

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

function useSweep(index: number) {
  const bands = useRef<(HTMLSpanElement | null)[]>([]);
  const sweeps = useRef<(Animation | undefined)[]>([]);
  const active = useRef(0);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const running = sweeps.current[active.current];
    const isRunning = running?.playState === 'running';
    const progress = running?.effect?.getComputedTiming().progress ?? 1;
    if (isRunning && progress < SWEEP_PAST_FILL) {
      return;
    }
    const next = isRunning ? 1 - active.current : active.current;
    const band = bands.current[next];
    if (!band) {
      return;
    }
    sweeps.current[next]?.cancel();
    sweeps.current[next] = band.animate(SWEEP_KEYFRAMES, SWEEP_TIMING);
    active.current = next;
  }, [index]);

  useEffect(() => () => {
    for (const sweep of sweeps.current) {
      sweep?.cancel();
    }
  }, []);

  return bands;
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
  const bands = useSweep(index);
  const toValue = (at: number) => steps[Math.round(at)] ?? steps[0] ?? 0;
  const select = (at: number) => {
    const next = toValue(at);
    if (next !== steps[index]) {
      onValueChange?.(next);
    }
  };

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
      onValueChange={select}
      onValueCommitted={next => onValueCommitted?.(toValue(next))}
    >
      <SliderPrimitive.Control
        data-slot="step-slider-control"
        className="relative flex h-8 w-full cursor-pointer touch-none items-center select-none data-disabled:cursor-not-allowed"
      >
        <SliderPrimitive.Track data-slot="step-slider-track" className="relative h-full w-full rounded-pill select-none">
          <SliderPrimitive.Indicator
            data-slot="step-slider-range"
            className={cn(
              'glaze-sm glaze-sm-x relative box-content h-full overflow-hidden rounded-pill pe-[calc(var(--step-thumb)/2)] select-none',
              'transition-[width] duration-(--dur-step) ease-(--ease-step)',
              'data-disabled:bg-text-disabled! data-disabled:bg-none!',
            )}
          >
            <span aria-hidden className="step-dots absolute inset-0" />
            {SWEEP_BANDS.map(band => <span
              aria-hidden
              key={band}
              data-slot="step-slider-sweep"
              className="step-sweep absolute inset-0 motion-reduce:hidden"
              ref={element => {
                bands.current[band] = element;
              }}
            />)}
          </SliderPrimitive.Indicator>
          {steps.map((step, at) => at === index ? null : <span
            aria-hidden
            data-filled={at < index || undefined}
            data-major={majors.has(step) || undefined}
            data-slot="step-slider-stop"
            key={step}
            className={cn(
              'pointer-events-none absolute top-1/2 h-2 w-0.5 -translate-1/2 bg-line-control',
              'transition-colors duration-(--dur-step) ease-(--ease-step)',
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
              'group/thumb block size-(--step-thumb) shrink-0 cursor-grab rounded-pill outline-none select-none',
              'transition-[inset-inline-start] duration-(--dur-step) ease-(--ease-step)',
              'data-dragging:cursor-grabbing data-disabled:cursor-not-allowed',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'glass glass-paper relative block size-full rounded-pill',
                'transition-[scale] duration-(--dur-state) ease-out group-data-dragging/thumb:scale-[0.94]',
                'before:absolute before:-inset-1.5 before:rounded-pill before:transition-[background-color] before:duration-(--dur-state) before:ease-out',
                'group-hover/thumb:not-group-data-disabled/thumb:before:bg-hover group-data-dragging/thumb:before:bg-pressed',
                'group-has-focus-visible/thumb:focus-ring',
              )}
            />
          </SliderPrimitive.Thumb>
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  </DirectionProvider>;
}

export {StepSlider, type StepSliderProps};

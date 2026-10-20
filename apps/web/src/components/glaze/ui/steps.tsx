'use client';

import * as React from 'react';
import {Icon, Check, FailedMark, Pending} from '#/components/glaze/icon.tsx';
import {cn} from '#/lib/glaze/utils.ts';

// The steps of a flow, in order, with the current one marked: a setup, a deploy's stages, an agent's plan. An <ol>, so
// a screen reader reads the order and the count.
//
// Each step is a small pill marker, a label and an optional one-line description, joined to the next by a 2px rounded
// track. Done is the small glaze (glaze-sm) with a white check; current is the paper surface with an ink ring and its
// numeral in text-1, where the eye lands; upcoming is the grey field with its numeral in text-3. The track fills with
// the same gradient, run along it, up to the current step, and slides when value changes (--dur-overlay on the house
// ease-out; reduced motion zeroes the token, so it jumps). A step can be overridden: pending (the step is running)
// shows the pending arc, the house's one loop, and error swaps the numeral for a coral cross and says "Failed" beside
// the label. Colour means status, so only error has a hue, and every state also says its word to a screen reader.
//
// With onValueChange the steps become buttons: a press goes back to that step, and with linear (the default) only
// the steps up to the current one can be picked.

type StepState = 'done' | 'current' | 'upcoming' | 'pending' | 'error';
type Orientation = 'horizontal' | 'vertical';
type StepsSize = 'sm' | 'default';

type StepsContextValue = {value: number; orientation: Orientation; size: StepsSize; onValueChange?: (step: number) => void; linear: boolean};
const StepsContext = React.createContext<StepsContextValue | null>(null);
const StepContext = React.createContext<{step: number; state: StepState; disabled: boolean} | null>(null);

function useSteps() {
  const ctx = React.useContext(StepsContext);
  if (!ctx) throw new Error('Step parts must be inside <Steps>.');
  return ctx;
}
function useStep() {
  const ctx = React.useContext(StepContext);
  if (!ctx) throw new Error('Step parts must be inside <Step>.');
  return ctx;
}

type StepsProps = Omit<React.ComponentProps<'ol'>, 'onChange'> & {
  /** The current step, from 1. Steps before it are done. */
  value: number;
  /** Makes each step a button that goes back to it. */
  onValueChange?: (step: number) => void;
  orientation?: Orientation;
  /** sm: a 16px marker and 12px labels, for a card or a panel header. default: a 20px marker and 13px labels. */
  size?: StepsSize;
  /** With onValueChange: only steps up to the current one can be picked. */
  linear?: boolean;
};

function Steps({value, onValueChange, orientation = 'horizontal', size = 'default', linear = true, className, ...props}: StepsProps) {
  const ctx = React.useMemo(() => ({value, onValueChange, orientation, size, linear}), [value, onValueChange, orientation, size, linear]);
  return <StepsContext.Provider value={ctx}>
    <ol
      data-slot="steps"
      data-orientation={orientation}
      data-size={size}
      className={cn('group/steps flex w-full min-w-0', orientation === 'horizontal' ? 'flex-row items-start' : 'flex-col', className)}
      {...props}
    />
  </StepsContext.Provider>;
}

type StepProps = React.ComponentProps<'li'> & {
  /** Its place, from 1. */
  step: number;
  /** Overrides the state worked out from value: pending while the step runs, error when it failed. */
  state?: StepState;
  disabled?: boolean;
};

function Step({step, state: stateProp, disabled = false, className, ...props}: StepProps) {
  const {value, orientation, size} = useSteps();
  const state: StepState = stateProp ?? (step < value ? 'done' : step === value ? 'current' : 'upcoming');
  const ctx = React.useMemo(() => ({step, state, disabled}), [step, state, disabled]);
  return <StepContext.Provider value={ctx}>
    <li
      data-slot="step"
      data-state={state}
      aria-current={step === value ? 'step' : undefined}
      className={cn(
        'group/step relative flex min-w-0 flex-col',
        // Horizontal: every step but the last shares the width, so the row ends on the last label; the 8px at the end
        // is the gap between a track and the next marker. Vertical: the gap under a step holds its track.
        orientation === 'horizontal' ? 'flex-1 pe-2 last:flex-none last:pe-0' : cn('last:pb-0', size === 'sm' ? 'pb-3' : 'pb-4'),
        className,
      )}
      {...props}
    />
  </StepContext.Provider>;
}

/** The step's marker and text: a button that goes back to the step when Steps has onValueChange, a div otherwise. */
function StepTrigger({className, children, ...props}: React.ComponentProps<'button'>) {
  const {onValueChange, value, linear, orientation, size} = useSteps();
  const {step, disabled} = useStep();
  const base = cn(
    'relative flex min-w-0 text-start',
    orientation === 'horizontal' ? cn('flex-col items-start', size === 'sm' ? 'gap-1.5' : 'gap-2') : cn('items-start', size === 'sm' ? 'gap-2' : 'gap-3'),
    className,
  );
  if (!onValueChange) return <div data-slot="step-trigger" className={base}>{children}</div>;
  const blocked = disabled || (linear && step > value);
  return <button
    type="button"
    data-slot="step-trigger"
    disabled={blocked}
    onClick={() => onValueChange(step)}
    className={cn(base, 'cursor-pointer rounded-tag decoration-line-strong underline-offset-4 enabled:hover:[&_[data-slot=step-title]]:underline disabled:cursor-not-allowed')}
    {...props}
  >{children}</button>;
}

// Error says its word visibly in StepTitle, so the marker adds none for it.
const stepWord: Record<StepState, string> = {done: ', done', current: ', current', upcoming: '', pending: ', running', error: ''};

/** The pill marker: a check on the small glaze, the numeral on paper or the field, the arc, or a coral cross. */
function StepIndicator({className, children, ...props}: React.ComponentProps<'span'>) {
  const {size} = useSteps();
  const {step, state} = useStep();
  return <span
    data-slot="step-indicator"
    data-state={state}
    className={cn(
      'grid shrink-0 place-items-center rounded-pill type-label-sm leading-none data transition-colors duration-(--dur-state) ease-out',
      size === 'sm' ? 'h-4 w-5.5' : 'h-5 w-7',
      // upcoming: the grey field, the numeral in text-3
      'bg-field text-text-3',
      // done: the small glaze and its white check
      'data-[state=done]:glaze-sm data-[state=done]:text-(--glaze-sm-text)',
      // current and pending: paper with an ink ring, drawn inside so the marker keeps its size
      'data-[state=current]:bg-paper data-[state=current]:text-text-1 data-[state=current]:inset-ring data-[state=current]:inset-ring-ink',
      'data-[state=pending]:bg-paper data-[state=pending]:text-text-1 data-[state=pending]:inset-ring data-[state=pending]:inset-ring-ink',
      // error: the failure tint and a coral cross
      'data-[state=error]:bg-fail-tint data-[state=error]:text-fail',
      'forced-colors:border forced-colors:border-[CanvasText]',
      className,
    )}
    {...props}
  >
    {children ?? (state === 'done' ? <Icon icon={Check} size={12} weight="bold"/>
      : state === 'error' ? <Icon icon={FailedMark} size={size === 'sm' ? 12 : 14}/>
      : state === 'pending' ? <Icon icon={Pending} size={12} className="animate-spin motion-reduce:animate-none"/>
      : String(step))}
    {stepWord[state] && <span className="sr-only">{stepWord[state]}</span>}
  </span>;
}

/** Holds the label and the description beside or under the marker. */
function StepText({className, ...props}: React.ComponentProps<'span'>) {
  return <span
    data-slot="step-text"
    className={cn('flex min-w-0 flex-col gap-0.5 group-data-[orientation=vertical]/steps:group-data-[size=default]/steps:pt-px', className)}
    {...props}
  />;
}

type StepTitleProps = React.ComponentProps<'span'> & {
  /** The word an error step says beside its label. */
  errorText?: React.ReactNode;
};

/** The label. An error step says errorText ("Failed") beside it in the failure text, so the state is a word. */
function StepTitle({className, children, errorText = 'Failed', ...props}: StepTitleProps) {
  const {size} = useSteps();
  const {state} = useStep();
  return <span
    data-slot="step-title"
    className={cn(
      'inline-flex min-w-0 max-w-full items-baseline gap-1.5 text-text-1 group-data-[state=upcoming]/step:text-text-2',
      size === 'sm' ? 'type-label-sm' : 'type-label',
      className,
    )}
    {...props}
  >
    <span className="truncate">{children}</span>
    {state === 'error' && <span data-slot="step-error" className="shrink-0 text-fail-text">{errorText}</span>}
  </span>;
}

/** One line under the label, in text-2; it truncates rather than wraps. */
function StepDescription({className, ...props}: React.ComponentProps<'span'>) {
  return <span data-slot="step-description" className={cn('block max-w-(--measure-hint) truncate type-caption text-text-2', className)} {...props}/>;
}

/** The 2px track to the next step. It fills with the gradient once this step is done. The last step draws none. */
function StepSeparator({className, ...props}: React.ComponentProps<'span'>) {
  const {orientation, size, value} = useSteps();
  const {step} = useStep();
  const filled = step < value;
  const horizontal = orientation === 'horizontal';
  return <span
    aria-hidden
    data-slot="step-separator"
    data-filled={filled ? '' : undefined}
    className={cn(
      'absolute block overflow-hidden rounded-pill bg-line group-last/step:hidden forced-colors:bg-[GrayText]',
      // Horizontal: from 8px past the marker to the step's end, through the marker's middle. Vertical: down the
      // marker's middle from 4px under it to 4px above the next one.
      horizontal
        ? cn('end-2 h-0.5 -translate-y-1/2', size === 'sm' ? 'start-7.5 top-2' : 'start-9 top-2.5')
        : cn('bottom-1 w-0.5 -translate-x-1/2 rtl:translate-x-1/2', size === 'sm' ? 'start-2.75 top-5' : 'start-3.5 top-6'),
      className,
    )}
    {...props}
  >
    <span
      data-slot="step-separator-fill"
      className={cn(
        'block size-full rounded-pill transition-transform duration-(--dur-overlay) ease-out motion-reduce:transition-none forced-colors:bg-[CanvasText]',
        horizontal ? 'glaze-sm glaze-sm-x origin-left rtl:origin-right' : 'glaze-sm origin-top',
        filled ? 'scale-100' : horizontal ? 'scale-x-0' : 'scale-y-0',
      )}
    />
  </span>;
}

export {Steps, Step, StepTrigger, StepIndicator, StepText, StepTitle, StepDescription, StepSeparator, type StepsProps, type StepProps, type StepState, type StepsSize};

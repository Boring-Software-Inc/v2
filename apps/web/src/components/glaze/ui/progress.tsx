'use client';

import {createContext, useContext, type CSSProperties} from 'react';
import {Progress as ProgressPrimitive} from '@base-ui/react/progress';
import {Meter as MeterPrimitive} from '@base-ui/react/meter';
import {Icon, FailedMark, Pending, Warning} from '#/components/glaze/icon.tsx';
import {cn, mergeClass} from '#/lib/glaze/utils.ts';

// How far something got, or how full something is. One component, two jobs:
//
//   mode="progress" (default): a task moving to done, on Base UI Progress (role="progressbar"). An upload, an eval
//     run over 200 tickets, an index build.
//   mode="meter": a level inside a known range, on Base UI Meter (role="meter"). Tokens against a plan, seats used.
//     It takes warnAt and failAt thresholds.
//
// The bar is a slim pill: the grey field as the track with a 1px hairline (--line-faint) drawn inside its edge, and
// the fill in small glaze run along the bar (glaze-sm-x: a lifted grey at the start to ink at the end, with the crisp
// 1px top highlight), rounded at both ends, easing to its new width in --dur-state. 4px small, 6px by default, 8px
// large. With a ProgressLabel or ProgressValue, they sit in a row above the bar: what on the left, the reading in
// tabular figures on the right.
//
// Colour means status, so the fill stays ink until a meter crosses a threshold: amber past warnAt, coral at failAt,
// and the reading says so with a glyph and a word ("Near limit", "At limit"), never by hue alone. A meter draws a
// small tick across the track at each threshold inside the range, so the person sees trouble coming before the fill
// reaches it.
//
// Indeterminate (value null) is a short glaze segment sliding along the track, one pass per --dur-sweep: the second
// loop the motion foundation allows. Under reduced motion it stands still as a half fill, and the pending arc (still)
// sits where the reading goes, so the bar never reads as half done on its own.

type Mode = 'progress' | 'meter';
type Size = 'sm' | 'default' | 'lg';
type ProgressStatus = 'warn' | 'fail';

const ProgressContext = createContext<{mode: Mode; status?: ProgressStatus; indeterminate: boolean; statusLabel?: React.ReactNode}>({mode: 'progress', indeterminate: false});

const statusWords: Record<ProgressStatus, string> = {warn: 'Near limit', fail: 'At limit'};

/** Which status a meter's fraction has reached. */
function meterStatus(fraction: number, warnAt: number | null, failAt: number | null): ProgressStatus | undefined {
  if (failAt !== null && fraction >= failAt) return 'fail';
  if (warnAt !== null && fraction >= warnAt) return 'warn';
  return undefined;
}

type ProgressProps = Omit<ProgressPrimitive.Root.Props, 'value'> & {
  /** min to max. null or left out is indeterminate (mode progress only). */
  value?: number | null;
  mode?: Mode;
  /** The bar's thickness: 4, 6 or 8px. */
  size?: Size;
  /** Sets the status by hand, for a task that is in trouble: a run whose failures pass a limit. */
  status?: ProgressStatus;
  /** Meter only. The fraction where it turns amber and draws a tick. null never warns. */
  warnAt?: number | null;
  /** Meter only. The fraction where it turns coral, with a tick when under 1. null never fails. */
  failAt?: number | null;
  /** The words after the reading when the status is warn or fail. "Near limit" and "At limit" by default. */
  statusLabel?: React.ReactNode;
};

function Progress({className, children, value = null, min = 0, max = 100, mode = 'progress', size = 'default', status: statusProp, warnAt = 0.8, failAt = 1, statusLabel, ...props}: ProgressProps) {
  const meter = mode === 'meter';
  const fraction = value === null ? null : Math.min(Math.max((value - min) / (max - min || 1), 0), 1);
  const status = statusProp ?? (meter && fraction !== null ? meterStatus(fraction, warnAt, failAt) : undefined);
  const indeterminate = !meter && fraction === null;
  const shared = {
    'data-slot': 'progress',
    'data-mode': mode,
    'data-size': size,
    'data-status': status,
    'data-indeterminate': indeterminate || undefined,
    locale: 'en-US' as const,
    // The status words join the reading a screen reader hears: "92%, Near limit".
    getAriaValueText: (formatted: string | null) => {
      const word = status ? (typeof statusLabel === 'string' ? statusLabel : statusWords[status]) : '';
      return [formatted ?? (indeterminate ? 'In progress' : ''), word].filter(Boolean).join(', ');
    },
  };
  const rootClass = 'group/progress flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-2';
  const ticks = meter ? [warnAt, failAt].filter((t): t is number => t !== null && t > 0 && t < 1) : [];
  const track = <ProgressTrack meter={meter} size={size} ticks={ticks} filled={(fraction ?? 0) > 0}/>;
  const context = {mode, status, indeterminate, statusLabel};
  if (meter) return <ProgressContext.Provider value={context}>
    <MeterPrimitive.Root value={value ?? 0} min={min} max={max} {...shared} className={mergeClass(rootClass, className as MeterPrimitive.Root.Props['className'])} {...(props as Omit<MeterPrimitive.Root.Props, 'value'>)}>
      {children}{track}
    </MeterPrimitive.Root>
  </ProgressContext.Provider>;
  return <ProgressContext.Provider value={context}>
    <ProgressPrimitive.Root value={value} min={min} max={max} {...shared} className={mergeClass(rootClass, className)} {...props}>
      {children}{track}
    </ProgressPrimitive.Root>
  </ProgressContext.Provider>;
}

const trackHeight: Record<Size, string> = {sm: 'h-(--progress-bar-sm)', default: 'h-(--progress-bar)', lg: 'h-(--progress-bar-lg)'};
// A fill shorter than the bar is thick would squash its round ends, so any value above zero shows at least a circle.
const fillMin: Record<Size, string> = {sm: 'min-w-(--progress-bar-sm)', default: 'min-w-(--progress-bar)', lg: 'min-w-(--progress-bar-lg)'};

/** The track and its fill, from the start edge, with a tick at each meter threshold. */
function ProgressTrack({meter, size, ticks, filled}: {meter: boolean; size: Size; ticks: number[]; filled: boolean}) {
  const Track = meter ? MeterPrimitive.Track : ProgressPrimitive.Track;
  const Indicator = meter ? MeterPrimitive.Indicator : ProgressPrimitive.Indicator;
  return <span data-slot="progress-bar" className="relative block w-full basis-full">
    <Track
      data-slot="progress-track"
      className={cn(
        'relative block w-full overflow-hidden rounded-pill bg-field forced-colors:outline forced-colors:outline-1',
        // The hairline inside the edge, drawn over the fill so the bar keeps one outline at any value.
        'after:pointer-events-none after:absolute after:inset-0 after:rounded-pill after:border after:border-line-faint',
        trackHeight[size],
      )}
    >
      <Indicator
        data-slot="progress-indicator"
        className={cn(
          'glaze-sm glaze-sm-x block h-full rounded-pill transition-[width] duration-(--dur-state) ease-out motion-reduce:transition-none',
          'forced-colors:bg-[CanvasText]',
          // Past a threshold the fill takes the status colour, flat, and keeps the top highlight; the dark rim goes.
          'group-data-status/progress:[--glaze-sm-rim:transparent]',
          'group-data-[status=warn]/progress:bg-none group-data-[status=warn]/progress:bg-warn',
          'group-data-[status=fail]/progress:bg-none group-data-[status=fail]/progress:bg-fail',
          'group-data-indeterminate/progress:hidden',
          filled && fillMin[size],
        )}
      />
      {!meter && <span
        aria-hidden
        data-slot="progress-sweep"
        className={cn(
          'glaze-sm glaze-sm-x absolute inset-y-0 hidden w-(--progress-sweep) rounded-pill group-data-indeterminate/progress:block',
          'animate-sweep motion-reduce:start-0 motion-reduce:w-1/2 motion-reduce:animate-none',
          'forced-colors:bg-[CanvasText]',
        )}
      />}
    </Track>
    {ticks.map(t => <span
      key={t}
      aria-hidden
      data-slot="progress-tick"
      className="absolute -inset-y-0.5 start-(--at) w-px -translate-x-1/2 rounded-pill bg-line-strong rtl:translate-x-1/2"
      style={{'--at': `${t * 100}%`} as CSSProperties}
    />)}
  </span>;
}

/** The name of what is progressing or measured, on the left of the row above the bar. */
function ProgressLabel({className, ...props}: ProgressPrimitive.Label.Props) {
  const {mode} = useContext(ProgressContext);
  const Label = mode === 'meter' ? MeterPrimitive.Label : ProgressPrimitive.Label;
  return <Label data-slot="progress-label" className={mergeClass('min-w-0 flex-1 truncate type-label text-text-1', className) as MeterPrimitive.Label.Props['className']} {...(props as MeterPrimitive.Label.Props)}/>;
}

type ProgressValueProps = Omit<MeterPrimitive.Value.Props, 'children'> & {
  /** Formats the reading: {(formatted, value) => `${value} of 200`}. */
  children?: ((formattedValue: string, value: number) => React.ReactNode) | null;
};

const statusGlyph = {warn: Warning, fail: FailedMark};

/**
 * The reading on the right of the row above the bar, in tabular figures. Past a threshold a glyph and the status
 * words in the status colour come before it. While indeterminate it is empty, or the still arc under reduced motion.
 */
function ProgressValue({className, children, ...props}: ProgressValueProps) {
  const {mode, status, indeterminate, statusLabel} = useContext(ProgressContext);
  const cls = cn('ms-auto inline-flex shrink-0 items-center gap-2 type-caption text-text-2 data', className as string);
  const words = status ? <span data-slot="progress-status" className={cn('inline-flex items-center gap-1', status === 'fail' ? 'text-fail-text' : 'text-warn-text')}>
    <Icon icon={statusGlyph[status]} size={12} weight="bold"/>{statusLabel ?? statusWords[status]}
  </span> : null;
  if (indeterminate) return <span data-slot="progress-value" className={cls}><Icon icon={Pending} size={12} className="motion-safe:hidden"/></span>;
  if (mode === 'meter') return <span className={cls}>
    {words}<MeterPrimitive.Value data-slot="progress-value" {...props}>{children ?? undefined}</MeterPrimitive.Value>
  </span>;
  return <span className={cls}>
    {words}<ProgressPrimitive.Value data-slot="progress-value" {...(props as ProgressPrimitive.Value.Props)}>
      {children ? (formatted: string | null, value: number | null) => children(formatted ?? '', value ?? 0) : undefined}
    </ProgressPrimitive.Value>
  </span>;
}

export {Progress, ProgressLabel, ProgressValue, meterStatus, type ProgressProps, type ProgressValueProps, type ProgressStatus};

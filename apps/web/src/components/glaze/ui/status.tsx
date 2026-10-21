import {cva, type VariantProps} from 'class-variance-authority';
import {Icon, FailedMark, Pending, Success, Waiting, Warning, type GlazeIcon} from '#/components/glaze/icon.tsx';
import {cn} from '#/lib/glaze/utils.ts';

// Where a piece of work stands, as a word led by a small glyph: idle, queued, running, ok, warn, fail, or waiting on a
// person. The word is the status; the glyph is how the eye finds it in a column. Nothing else carries it, so it reads
// in grayscale, in forced colours and aloud.
//
// No dots. A dot says "something" and nothing more, so each outcome gets its own shape: ok a check in a ring, warn a
// triangle, fail a cross in a ring, waiting on a person an hourglass. Running is the pending arc, Glaze's one loop,
// turning once per --dur-spin and standing still under reduced motion. Queued and idle have nothing to find, so they
// take no glyph and the word goes to text-2.
//
// Colour means status and nothing else, so only the three outcomes take it: ok green, warn amber, fail coral, glyph
// and word in the one colour, each word 5.7:1 or better on paper. Running is ink; waiting takes the warn word colour, since it stops on a person.
//
// The glyph is 12px (--icon-sm) in a cell one line tall, centred on the first line of the word, so it sits on the
// word's cap height and a word that wraps keeps it on its first line.
//
// live: speaks only when work settles or stops on a person. A hidden status region holds the word for ok, warn, fail
// and waiting and stays empty on the way, so a screen reader hears one word when a run ends, not every hop.

type StatusValue = 'idle' | 'queued' | 'running' | 'ok' | 'warn' | 'fail' | 'waiting';

const statuses = ['idle', 'queued', 'running', 'ok', 'warn', 'fail', 'waiting'] as const satisfies readonly StatusValue[];

const statusLabels: Record<StatusValue, string> = {
  idle: 'Idle',
  queued: 'Queued',
  running: 'Running',
  ok: 'Passed',
  warn: 'Warning',
  fail: 'Failed',
  waiting: 'Waiting on you',
};

/** Severity for sorting a status column: fail first, then what waits on a person, idle last. Higher is worse. */
const statusRank: Record<StatusValue, number> = {fail: 6, waiting: 5, warn: 4, running: 3, queued: 2, ok: 1, idle: 0};

/** ok, warn and fail end a piece of work, and waiting stops it on a person; the others are on the way. */
const settled = (status: StatusValue) => status === 'ok' || status === 'warn' || status === 'fail' || status === 'waiting';

// items-baseline gives the Status the word's baseline, so it lines up with text beside it; the mark keeps to the first line.
const statusVariants = cva('inline-flex max-w-full min-w-0 items-baseline gap-1 data', {
  variants: {
    size: {
      default: 'type-label',
      sm: 'type-label-sm',
    },
    status: {
      idle: 'text-text-2',
      queued: 'text-text-2',
      running: 'text-text-1',
      ok: 'text-ok-text',
      warn: 'text-warn-text',
      fail: 'text-fail-text',
      waiting: 'text-warn-text',
    },
  },
  defaultVariants: {size: 'default', status: 'idle'},
});

/** The glyph for each status; queued and idle have none. */
const statusGlyph: Record<StatusValue, GlazeIcon | null> = {
  idle: null,
  queued: null,
  running: Pending,
  ok: Success,
  warn: Warning,
  fail: FailedMark,
  waiting: Waiting,
};

type StatusProps = Omit<React.ComponentProps<'span'>, 'children'> & Omit<VariantProps<typeof statusVariants>, 'status'> & {
  status?: StatusValue;
  /** Speak once when the status settles on ok, warn, fail or waiting; stay quiet on the way. */
  live?: boolean;
  /** Replaces the default word. One to three words that keep the outcome: "Refund failed". */
  children?: React.ReactNode;
};

function Status({status = 'idle', size = 'default', live, className, children, ...props}: StatusProps) {
  const word = children ?? statusLabels[status];
  return <span
    data-slot="status"
    data-status={status}
    data-size={size}
    className={cn(statusVariants({size, status}), className)}
    {...props}
  >
    <StatusMark status={status}/>
    <span data-slot="status-word" aria-hidden={live && settled(status) ? true : undefined} className="min-w-0 [overflow-wrap:anywhere]">{word}</span>
    {/* The region is always in the DOM, so a change from empty to the word is what gets announced. */}
    {live && <span role="status" className="sr-only">{settled(status) ? (typeof word === 'string' ? word : statusLabels[status]) : ''}</span>}
  </span>;
}

/**
 * The glyph on its own, one line tall, for a dense spot beside a word that already names the status. Pass label when
 * nothing beside it does, so it is announced; without one it is hidden from assistive tech. Queued and idle draw
 * nothing, so a lone one keeps only its label, for a screen reader.
 */
function StatusMark({status = 'idle', label, className, ...props}: Omit<React.ComponentProps<'span'>, 'children'> & {status?: StatusValue; label?: string}) {
  const glyph = statusGlyph[status];
  if (!glyph) return label ? <span data-slot="status-mark" data-status={status} className="sr-only">{label}</span> : null;
  return <span
    data-slot="status-mark"
    data-status={status}
    role={label ? 'img' : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : true}
    className={cn('flex h-lh shrink-0 items-center self-start', className)}
    {...props}
  >
    <Icon icon={glyph} size={12} weight={status === 'running' ? 'regular' : 'bold'} className={cn(status === 'running' && 'animate-spin motion-reduce:animate-none')}/>
  </span>;
}

export {Status, StatusMark, statusVariants, statusGlyph, statuses, statusLabels, statusRank, type StatusProps, type StatusValue};

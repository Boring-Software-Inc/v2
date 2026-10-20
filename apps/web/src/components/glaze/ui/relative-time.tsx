'use client';

import {useEffect, useState} from 'react';
import {TextHint} from '#/components/glaze/ui/truncate.tsx';
import {cn} from '#/lib/glaze/utils.ts';

// Glaze's relative time. A time as distance from now: "now", "3m ago", "in 2h", "Sep 12". Short units by default, so a column
// of times stays narrow and lines up on tabular figures. The exact local time and UTC show in a hint on
// hover or focus, and screen readers get the exact time as well.
//
// It ticks exactly when its label would change and at no other moment: "59m ago" turns into "1h ago" at
// the boundary, not up to a minute late, and a page of 200 times does not wake every 10 seconds to
// re-render the same words. While the tab is hidden it does not tick at all, and catches up the moment
// the tab shows again. It takes the type of the text around it; the hint is Truncate's TextHint, Tooltip's ink chip.

type Style = 'short' | 'long';

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
/** Under 45 seconds is "now". */
const NOW = 45 * SECOND;

function toDate(value: Date | string | number) {
  return value instanceof Date ? value : new Date(value);
}

// Units switch where the rounded value would reach the next unit, so the label never reads "60m ago".
const TO_HOURS = HOUR - MINUTE / 2;
const TO_DAYS = DAY - HOUR / 2;
const unitOf = (abs: number) => (abs < TO_HOURS ? MINUTE : abs < TO_DAYS ? HOUR : DAY);

/** "3m ago" (short) or "3 minutes ago" (long). Past a week, or with no `now` yet, it is a calendar date. */
function formatRelative(date: Date, now: number | null, style: Style = 'short', timeZone?: string) {
  const diff = now === null ? Infinity : date.getTime() - now;
  const abs = Math.abs(diff);
  if (abs < NOW) return 'now';
  if (abs >= WEEK) {
    const year = (d: Date | number) => new Intl.DateTimeFormat('en', {year: 'numeric', timeZone}).format(d);
    const sameYear = now !== null && year(date) === year(now);
    return new Intl.DateTimeFormat('en', {month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric', timeZone}).format(date);
  }
  const size = unitOf(abs);
  const value = Math.max(1, Math.round(abs / size));
  const [unit, short] = size === MINUTE ? ['minute', 'm'] as const : size === HOUR ? ['hour', 'h'] as const : ['day', 'd'] as const;
  if (style === 'long') return new Intl.RelativeTimeFormat('en', {numeric: 'auto'}).format(Math.sign(diff) * value, unit);
  return diff < 0 ? `${value}${short} ago` : `in ${value}${short}`;
}

/**
 * Milliseconds until the label changes. A past time grows, so the next change is where the rounded value
 * steps up or the unit changes; a future time shrinks toward now, so it is where the value steps down.
 * Past a week the label is a date and only the day boundary can change it.
 */
function untilChange(date: Date, now: number) {
  const diff = date.getTime() - now;
  const abs = Math.abs(diff);
  const past = diff <= 0;
  if (abs >= WEEK) return past ? HOUR : Math.min(HOUR, abs - WEEK + SECOND);
  if (abs < NOW) return past ? NOW - abs : abs + SECOND;
  const size = unitOf(abs);
  const value = Math.round(abs / size);
  const thresholds = [NOW, TO_HOURS, TO_DAYS, WEEK];
  const wait = past
    ? Math.min((value + 0.5) * size - abs, ...thresholds.filter(t => t > abs).map(t => t - abs))
    : Math.min(abs - (value - 0.5) * size, ...thresholds.filter(t => t <= abs).map(t => abs - t + 1));
  return Math.max(SECOND, Math.ceil(wait) + 50);
}

const exact = (date: Date, timeZone?: string) => new Intl.DateTimeFormat('en', {dateStyle: 'medium', timeStyle: 'medium', timeZone}).format(date);

type RelativeTimeProps = Omit<React.ComponentProps<'time'>, 'children' | 'dateTime'> & {
  /** The moment, as a Date, an ISO string or epoch milliseconds. */
  date: Date | string | number;
  /** Short units ("3m ago") or words ("3 minutes ago"). */
  format?: Style;
  /** Freeze "now", for tests and docs. When set, the time never ticks. */
  now?: Date | string | number;
  /** Show the exact time in a hint. On by default. */
  hint?: boolean;
};

// The server and the browser can disagree on both the clock and the time zone, so the first render uses
// neither: dates read in UTC and, without a frozen `now`, the label is the calendar date. After mount the
// browser's clock and zone take over.
function RelativeTime({date, format = 'short', now: fixedNow, hint = true, className, ...props}: RelativeTimeProps) {
  const at = toDate(date);
  const time = at.getTime();
  const frozen = fixedNow === undefined ? null : toDate(fixedNow).getTime();
  const [mounted, setMounted] = useState(false);
  const [clock, setClock] = useState<number | null>(null);

  useEffect(() => {
    setMounted(true);
    if (frozen !== null || Number.isNaN(time)) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      clearTimeout(timer);
      if (document.hidden) return;
      const current = Date.now();
      setClock(current);
      timer = setTimeout(tick, untilChange(new Date(time), current));
    };
    tick();
    document.addEventListener('visibilitychange', tick);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', tick); };
  }, [time, frozen]);

  if (Number.isNaN(time)) return <span data-slot="relative-time" data-invalid="" className={cn('text-text-2', className)}>Unknown time</span>;

  const now = frozen ?? clock;
  const zone = mounted ? undefined : 'UTC';
  const utc = `${exact(at, 'UTC')} UTC`;
  const local = mounted ? exact(at) : utc;
  const node = <time
    data-slot="relative-time"
    dateTime={at.toISOString()}
    tabIndex={hint ? 0 : undefined}
    className={cn('relative inline-block whitespace-nowrap data focus-visible:rounded-tag', className)}
    {...props}
  >
    <span aria-hidden>{formatRelative(at, now, format, zone)}</span>
    <span className="sr-only">{formatRelative(at, now, 'long', zone)}, {local}</span>
  </time>;

  if (!hint) return node;
  return <TextHint content={<span className="flex flex-col data">
    <span>{local}</span>
    {mounted && <span className="opacity-70">{utc}</span>}
  </span>}>{node}</TextHint>;
}

export {RelativeTime, formatRelative, untilChange, type RelativeTimeProps};

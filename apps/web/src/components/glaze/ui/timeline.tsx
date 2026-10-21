'use client';

import * as React from 'react';
import {useVirtualizer} from '@tanstack/react-virtual';
import {durationUnitFor, formatDurations} from '#/lib/glaze/data.ts';
import {cn} from '#/lib/glaze/utils.ts';
import {niceScale} from '#/components/glaze/ui/chart-scale.ts';
import {Skeleton} from '#/components/glaze/ui/skeleton.tsx';
import {Status, statusLabels} from '#/components/glaze/ui/status.tsx';

// Glaze's timeline: when each step of a run started and how long it took, with the slow and failed ones marked. It
// answers what every agent product gets asked: where did the 12.6s go, and which step broke? It shows what happened,
// never a plan.
//
// It sits in the card: the grey shell, the white panel holding a head row (the label, the total time, the run's
// outcome), an axis row with nice ticks in one unit, and a 36px row per span. Each row is the step's name, indented by
// depth with a hairline guide under its parent, then a track that ends at the run's total with the span's bar on it,
// a 12px capsule, and its duration beside the bar in tabular figures: after it when there is room, before it when not,
// and at the end of the name when neither fits; never inside it, so the number always sits on paper.
//
// Bars are ink at 45%, so a long trace reads as shape first. The open span's bar is solid ink. Only trouble takes
// colour: a failed span's bar and duration go coral and a slow one amber, with the word in the status column, which
// takes room only when some span needs it and drops on a narrow card (the bar and its duration still carry it). A
// running span grows to now with no end; a span waiting on a person is a hollow dashed capsule from its start to now,
// labelled "Waiting on you", because nothing has happened yet.
//
// Rows are one tab stop when onSpanClick is set: Up and Down move, Home and End jump, Enter opens. Each row is named
// "{label}, started at 1.2s, took 0.8s, failed", and a screen-reader table carries the same data, as a chart's does.

type TimelineStatus = 'queued' | 'running' | 'ok' | 'warn' | 'fail' | 'waiting';

type TimelineSpan = {
  id: string;
  label: string;
  /** ms from the run's start. */
  start: number;
  /** ms from the run's start. Missing while the span runs or waits. */
  end?: number;
  status?: TimelineStatus;
  /** The wait in words when it is not "Waiting on you": "Waiting on the on-call". */
  waitingLabel?: string;
  /** 0 for a top-level span. */
  depth?: number;
  /** After the name in mono: a tool name, an ID. Hidden under 512px of card, so the name keeps its room. */
  meta?: React.ReactNode;
  /** At the end of the name column in tabular figures: "4.8k tok", "$0.021". Hidden on a narrow card. */
  figure?: React.ReactNode;
};

type TimelineProps = Omit<React.ComponentProps<'section'>, 'children'> & {
  /** The head row's title and the timeline's name: "Run run_8f2a91". */
  label: string;
  spans: TimelineSpan[];
  /** ms from the start, for spans still running or waiting. The caller ticks it, once a second while live. */
  now?: number;
  /** The open span: the pressed wash on its row and a solid ink bar. */
  activeId?: string;
  onSpanClick?: (span: TimelineSpan) => void;
  /** px. The rows scroll past it, and window past 200 spans. */
  maxHeight?: number;
  /** Placeholder bars while the spans load. */
  loading?: boolean;
  /** A strip under the rows, on the shell's footer row: the open span's details, a link to the logs. */
  footer?: React.ReactNode;
  /** card: shell and panel. none: bare, inside a Card's flush content. */
  frame?: 'card' | 'none';
};

const ROW = 36;
const WINDOW_FROM = 200;
const statusWord = (s: TimelineSpan) => (s.status === 'waiting' ? s.waitingLabel ?? statusLabels.waiting : s.status ? statusLabels[s.status] : '');

function Timeline({label, spans, now, activeId, onSpanClick, maxHeight, loading = false, footer, frame = 'card', className, ...props}: TimelineProps) {
  const ends = spans.map(s => s.end ?? now ?? s.start);
  const total = Math.max(1, ...ends, now ?? 0);
  // Ticks fall on whole steps of the timeline's one unit: 0, 1, 2, 3 min, never 0.8 min.
  const {unit, size: unitSize} = durationUnitFor([total]);
  const unitScale = niceScale(0, total / unitSize, 4);
  // The track ends at the run's total, not the next nice number, so the last bar reaches the end and no empty third is left.
  const ticks = unitScale.ticks.filter(t => t * unitSize <= total + 1e-6).map(t => t * unitSize);
  const frac = (ms: number) => Math.min(Math.max(ms, 0), total) / total;
  const at = (ms: number) => `${frac(ms) * 100}%`;
  const durations = formatDurations(spans.map((s, i) => ends[i] - s.start)).values;
  const tickLabels = ticks.map(t => `${(t / unitSize).toLocaleString('en-US')}${unit}`);
  const totalLabel = formatDurations([total]).values[0];
  const running = spans.some(s => s.status === 'running' || (s.end === undefined && s.status !== 'waiting' && s.status !== 'queued'));
  const failed = spans.some(s => s.status === 'fail');
  const waiting = spans.some(s => s.status === 'waiting');
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const windowed = !!maxHeight && spans.length >= WINDOW_FROM;
  const virtualizer = useVirtualizer({count: windowed ? spans.length : 0, getScrollElement: () => scrollRef.current, estimateSize: () => ROW, overscan: 10});
  const rows = windowed ? virtualizer.getVirtualItems().map(item => ({index: item.index, start: item.start})) : spans.map((_, index) => ({index, start: 0}));
  const [focusIndex, setFocusIndex] = React.useState<number | null>(null);
  const activeIndex = activeId === undefined ? -1 : spans.findIndex(s => s.id === activeId);
  const tabRow = focusIndex ?? Math.max(activeIndex, 0);

  // The track's width in px, so a duration goes where it fits. 0 until measured, which falls back to fractions.
  const trackRef = React.useRef<HTMLSpanElement>(null);
  const [trackPx, setTrackPx] = React.useState(0);
  React.useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const measure = () => setTrackPx(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const focusRow = (index: number) => {
    const next = Math.max(0, Math.min(spans.length - 1, index));
    setFocusIndex(next);
    if (windowed) virtualizer.scrollToIndex(next, {align: 'auto'});
    requestAnimationFrame(() => scrollRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.focus());
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, index: number) => {
    const moves: Record<string, number> = {ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: spans.length - 1};
    if (event.key in moves) { event.preventDefault(); focusRow(moves[event.key]); return; }
    if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) { event.preventDefault(); onSpanClick?.(spans[index]); }
  };

  // The status column takes room only when some span has trouble or waits; from 576px of card.
  const marked = spans.some(s => s.status === 'warn' || s.status === 'fail' || s.status === 'waiting');
  const columns = cn(
    'grid items-center grid-cols-[minmax(0,2fr)_minmax(0,3fr)] @xl/timeline:grid-cols-[minmax(0,var(--label-col))_minmax(0,1fr)]',
    marked && '@xl/timeline:grid-cols-[minmax(0,var(--label-col))_minmax(0,1fr)_auto]',
  );
  // A running clock moves bars every tick; easing at the clock's own pace makes it one smooth growth.
  const glide = running ? 'transition-[inset-inline-start,width] duration-1000 ease-linear motion-reduce:transition-none' : '';
  const gridlines = ticks.slice(1).filter(t => frac(t) <= 0.92).map(t => <span key={t} aria-hidden className="absolute inset-y-0 w-px bg-line-faint" style={{insetInlineStart: at(t)}}/>);

  const row = (index: number, top: number) => {
    const s = spans[index];
    const end = ends[index];
    const open = s.id === activeId;
    const trouble = s.status === 'warn' || s.status === 'fail' ? s.status : undefined;
    const isRunning = s.end === undefined && s.status !== 'waiting' && s.status !== 'queued';
    // The duration goes after the bar when it fits before the track's end, else before the bar. About 6.5px a character.
    const labelPx = durations[index].length * 6.5 + (s.status === 'waiting' ? (statusWord(s).length + 2) * 6.5 : 0);
    // After the bar when it fits before the track's end, else before the bar; when neither fits (a long bar on a
    // narrow card), at the end of the name column, so it never runs over a name or a bar.
    const place: 'after' | 'before' | 'name' = trackPx === 0 ? (frac(end) <= 0.84 ? 'after' : 'before')
      : (1 - frac(end)) * trackPx >= labelPx + 8 ? 'after'
      : frac(s.start) * trackPx >= labelPx + 8 ? 'before' : 'name';
    const after = place === 'after';
    const durationTone = trouble === 'fail' ? 'text-fail-text' : trouble === 'warn' ? 'text-warn-text' : 'text-text-2';
    const durationText = <>
      <span className={cn(s.status === 'waiting' && marked && '@max-xl/timeline:hidden')}>{durations[index]}</span>
      {s.status === 'waiting' && <Status status="waiting" size="sm" className="@xl/timeline:hidden">{statusWord(s)}</Status>}
    </>;
    const name = `${s.label}, started at ${formatDurations([s.start]).values[0]}, ${isRunning || s.status === 'waiting' ? 'so far' : 'took'} ${durations[index]}${s.status && s.status !== 'ok' ? `, ${statusWord(s).toLowerCase()}` : ''}`;
    const depth = s.depth ?? 0;
    return <div
      key={s.id}
      data-index={index}
      data-slot="timeline-row"
      data-status={trouble ?? (s.status === 'waiting' ? 'waiting' : undefined)}
      data-open={open || undefined}
      role={onSpanClick ? 'option' : 'listitem'}
      aria-selected={onSpanClick ? open : undefined}
      aria-label={name}
      tabIndex={onSpanClick ? (index === tabRow ? 0 : -1) : undefined}
      onFocus={onSpanClick ? () => setFocusIndex(index) : undefined}
      onKeyDown={onSpanClick ? event => onKeyDown(event, index) : undefined}
      onClick={onSpanClick ? () => onSpanClick(s) : undefined}
      className={cn(
        columns, 'h-(--row) border-b border-line-faint transition-colors duration-(--dur-state) ease-out last:border-b-0',
        open && 'bg-pressed',
        onSpanClick && 'cursor-pointer focus-visible:focus-ring-inset', onSpanClick && !open && 'hover:bg-hover',
        windowed && 'absolute inset-x-0 top-0',
      )}
      // value-ok: a windowed row's offset comes from the virtualizer in px, so it can only live inline.
      style={windowed ? {transform: `translateY(${top}px)`} : undefined}
    >
      {/* value-ok: the indent is the span's depth in steps of --space-3, known only at render. */}
      <span aria-hidden data-slot="timeline-name" className="@container/name relative flex h-full min-w-0 items-center gap-2 pe-3" style={{paddingInlineStart: `calc(var(--space-3) + ${depth} * var(--space-3))`}}>
        {Array.from({length: depth}, (_, d) => <span key={d} data-slot="timeline-guide" className="absolute inset-y-0 w-px bg-line" style={{insetInlineStart: `calc(var(--space-3) + ${d} * var(--space-3) + var(--space-1))`}}/>)}
        <span className="min-w-16 truncate type-label text-text-1">{s.label}</span>
        {s.meta != null && <span className="min-w-0 shrink truncate type-code-xs text-text-2 @max-lg/timeline:hidden">{s.meta}</span>}
        {place === 'name' && <span data-slot="timeline-duration" data-place="name" className={cn('ms-auto flex shrink-0 items-center gap-1 whitespace-nowrap type-caption data', durationTone)}>{durationText}</span>}
        {s.figure != null && place !== 'name' && <span data-slot="timeline-figure" className="ms-auto shrink-0 type-caption data text-text-2 @max-md/timeline:hidden @max-[12rem]/name:hidden">{s.figure}</span>}
      </span>
      <span aria-hidden data-slot="timeline-track" className="relative me-3 h-full">
        {gridlines}
        {s.status === 'waiting'
          ? <span data-slot="timeline-wait" className={cn('absolute top-1/2 h-3 min-w-3 -translate-y-1/2 rounded-pill border border-dashed border-text-2 bg-paper', glide)} style={{insetInlineStart: at(s.start), width: `calc(${at(end)} - ${at(s.start)})`}}/>
          : <span
              data-slot="timeline-bar"
              data-status={trouble}
              className={cn(
                'absolute top-1/2 h-3 min-w-1 -translate-y-1/2 rounded-pill forced-colors:bg-[CanvasText]',
                trouble === 'fail' ? 'bg-fail' : trouble === 'warn' ? 'bg-warn' : open ? 'bg-ink' : 'bg-line-strong',
                glide,
              )}
              style={{insetInlineStart: at(s.start), width: `calc(${at(end)} - ${at(s.start)})`}}
            />}
        {place !== 'name' && <span
          data-slot="timeline-duration"
          data-place={place}
          className={cn('absolute top-1/2 flex -translate-y-1/2 items-center gap-1 whitespace-nowrap type-caption data', durationTone, glide)}
          style={after ? {insetInlineStart: `calc(${at(end)} + var(--space-2))`} : {insetInlineEnd: `calc(100% - ${at(s.start)} + var(--space-2))`}}
        >{durationText}</span>}
      </span>
      {marked && <span aria-hidden className="hidden justify-end pe-3 @xl/timeline:flex">
        {s.status === 'waiting'
          ? <Status status="waiting" size="sm">{statusWord(s)}</Status>
          : trouble && <Status status={trouble} size="sm">{statusWord(s)}</Status>}
      </span>}
    </div>;
  };

  const panel = <>
    <header data-slot="timeline-header" className="flex min-h-(--row) min-w-0 items-center gap-2 border-b border-line-faint px-3">
      <span className="min-w-0 truncate type-label text-text-1">{label}</span>
      {!loading && spans.length > 0 && <span className="shrink-0 type-label text-text-2 data">{totalLabel}</span>}
      <span className="ms-auto shrink-0">
        {failed ? <Status status="fail" size="sm">Failed</Status> : waiting ? <Status status="waiting" size="sm"/> : running ? <Status status="running" size="sm"/> : spans.length > 0 && !loading ? <Status status="ok" size="sm"/> : null}
      </span>
    </header>
    <div aria-hidden className={cn(columns, 'h-8 shrink-0 border-b border-line-faint')}>
      <span className="ps-3 type-label-sm text-text-2">Step</span>
      <span ref={trackRef} className="relative me-3 h-full">
        {!loading && spans.length > 0 && ticks.map((t, i) => <span key={t} className={cn('absolute top-1/2 -translate-y-1/2 type-caption text-text-2 data', i > 0 && '-translate-x-1/2 rtl:translate-x-1/2', frac(t) > 0.92 && 'hidden')} style={{insetInlineStart: at(t)}}>{tickLabels[i]}</span>)}
      </span>
      {marked && <span className="hidden @xl/timeline:block"/>}
    </div>
    <div
      ref={scrollRef}
      role={onSpanClick ? 'listbox' : 'list'}
      aria-label={`Steps in ${label}`}
      className="relative min-h-0 overflow-auto overscroll-contain"
      // value-ok: the rows' scroll height is the caller's, in px, so it can only live inline.
      style={maxHeight ? {maxHeight} : undefined}
    >
      {loading
        ? Array.from({length: 4}, (_, i) => <div key={i} aria-hidden className={cn(columns, 'h-(--row) border-b border-line-faint last:border-b-0')}>
            <span className="ps-3"><Skeleton className="h-2 w-2/3 rounded-pill"/></span>
            <span className="relative me-3 h-full"><Skeleton className="absolute top-1/2 h-3 -translate-y-1/2 rounded-pill" style={{insetInlineStart: `${i * 18}%`, width: `${30 - i * 4}%`}}/></span>
          </div>)
        : spans.length === 0
          ? <p className="px-3 py-4 type-body-sm text-text-2">No steps yet.</p>
          : windowed
            ? <div className="relative" style={{height: virtualizer.getTotalSize()}}>{rows.map(r => row(r.index, r.start))}</div>
            : rows.map(r => row(r.index, 0))}
    </div>
    <table className="sr-only">
      <caption>{label}</caption>
      <thead><tr><th scope="col">Step</th><th scope="col">Started at</th><th scope="col">Took</th><th scope="col">Status</th></tr></thead>
      <tbody>{spans.map((s, i) => <tr key={s.id}><th scope="row">{s.label}</th><td>{formatDurations([s.start]).values[0]}</td><td>{durations[i]}</td><td>{statusWord(s) || statusLabels.ok}</td></tr>)}</tbody>
    </table>
  </>;

  return <section
    data-slot="timeline"
    data-status={failed ? 'fail' : undefined}
    data-frame={frame}
    aria-label={label}
    aria-busy={loading || undefined}
    className={cn('@container/timeline flex min-w-0 flex-col text-text-1', frame === 'card' && 'shell forced-colors:border-[CanvasText]', className)}
    {...props}
  >
    {frame === 'card'
      ? <div data-slot="timeline-panel" className="panel flex min-w-0 flex-col overflow-hidden forced-colors:border-[CanvasText]">{panel}</div>
      : panel}
    {footer != null && <div data-slot="timeline-footer" className={frame === 'card' ? 'shell-foot' : 'flex min-h-(--row) items-center gap-2 border-t border-line-faint px-3 type-caption text-text-2'}>{footer}</div>}
  </section>;
}

export {Timeline, type TimelineProps, type TimelineSpan, type TimelineStatus};

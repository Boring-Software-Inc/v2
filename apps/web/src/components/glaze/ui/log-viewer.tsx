'use client';

import {memo, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {useVirtualizer} from '@tanstack/react-virtual';
import {Icon, ArrowDown, Failed, Wrap} from '#/components/glaze/icon.tsx';
import {cn} from '#/lib/glaze/utils.ts';
import {Button} from '#/components/glaze/ui/button.tsx';
import {CopyCodeButton, TokenLine, tokenize} from '#/components/glaze/ui/code-block.tsx';
import {Empty, EmptyHeader, EmptyTitle} from '#/components/glaze/ui/empty-state.tsx';
import {Input} from '#/components/glaze/ui/input.tsx';
import {SegmentedControl, SegmentedControlItem} from '#/components/glaze/ui/segmented-control.tsx';
import {Status} from '#/components/glaze/ui/status.tsx';

// Glaze's log viewer: a run's or an eval's output as it streams. It sits in the card: the grey shell, the white panel
// holding a head row (the label, the line count, Streaming or "2 failed", Next failure and Copy lines), an optional
// toolbar, then the lines on the panel's own paper (code-surface), under a hairline, run edge to edge.
//
// One row per line, in Glaze Mono through type-code-block, 12px on a 20px line: a log is read line by line with no
// sans beside it, so the inline 0.8 scale does not apply. The time, the level, the source and
// the message. Ink at its steps, like code: the time, the source and a debug line in text-2, the rest in text-1. Only
// warn and fail take colour, and only in their level word, so the colour always has a word.
//
// The toolbar is off by default: a short log needs none. A long one a person searches turns it on: a search field,
// the levels as a multiple segmented control (none pressed shows every level; pressing narrows to those), their counts,
// and wrap.
//
// It sticks to the bottom while lines arrive. Scrolling up stops following and shows a flat "38 new, 2 fail" pill back
// to the latest; reaching the bottom resumes. Rows are windowed, so 100,000 lines render only what is on screen. Next
// failure walks the fail lines, so a failure 40,000 lines up is one press away. Code stays left to right in a
// right-to-left page.

type LogLevel = 'debug' | 'info' | 'warn' | 'fail';
type LogLine = {
  id: string | number;
  /** A Date, epoch ms or a preformatted string. Shown as HH:MM:SS, in UTC unless preformatted. */
  time?: Date | number | string;
  level?: LogLevel;
  /** Where the line came from: a step, a tool, a model. */
  source?: string;
  message: string;
};

const levels: LogLevel[] = ['debug', 'info', 'warn', 'fail'];
const pad = (n: number) => String(n).padStart(2, '0');
const formatTime = (t: LogLine['time']) => {
  if (t === undefined) return '';
  if (typeof t === 'string') return t;
  const d = typeof t === 'number' ? new Date(t) : t;
  // UTC, like the logs, so the server and the browser print the same time.
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};

function findAll(text: string, q: string): [number, number][] {
  if (!q) return [];
  const out: [number, number][] = [];
  const hay = text.toLowerCase();
  let at = hay.indexOf(q);
  while (at >= 0) { out.push([at, at + q.length]); at = hay.indexOf(q, at + q.length); }
  return out;
}

const lineText = (l: LogLine) => [formatTime(l.time), (l.level ?? 'info').toUpperCase(), l.source, l.message].filter(Boolean).join(' ');

const levelText: Record<LogLevel, string> = {debug: 'text-text-2', info: 'text-text-2', warn: 'text-warn-text', fail: 'text-fail-text'};

/** One row, memoised, so a scroll renders only the rows that came into view. */
const LogRow = memo(function LogRow({line, index, start, q, hit, timestamps, wrap, measure}: {
  line: LogLine; index: number; start: number; q: string; hit: boolean; timestamps: boolean; wrap: boolean; measure: (el: Element | null) => void;
}) {
  const level = line.level ?? 'info';
  return <div
    data-index={index}
    ref={measure}
    data-slot="log-line"
    data-level={level}
    data-hit={hit || undefined}
    className={cn(
      // A row's layout never reaches outside it, so measuring one row does not lay out the rest.
      'absolute start-0 top-0 flex min-w-full items-start gap-3 px-3 type-code-block [contain:layout_style]',
      level === 'debug' ? 'text-text-2' : 'text-text-1',
      // A search hit or the Next failure target: the pressed wash.
      'data-hit:bg-pressed forced-colors:data-hit:outline forced-colors:data-hit:outline-1',
    )}
    // value-ok: a windowed row's offset comes from the virtualizer in px, so it can only live inline.
    style={{transform: `translateY(${start}px)`}}
  >
    {timestamps && <span className="shrink-0 text-text-2 max-sm:hidden">{formatTime(line.time)}</span>}
    <span className={cn('w-10 shrink-0', levelText[level])}>{level}</span>
    <span className={cn('min-w-0 flex-1', wrap ? 'whitespace-pre-wrap [overflow-wrap:anywhere]' : 'whitespace-pre')}>
      {line.source && <span className="text-text-2">{line.source} </span>}
      <TokenLine tokens={tokenize(line.message, 'text')[0] ?? []} marks={findAll(line.message, q)}/>
    </span>
  </div>;
});

type LogViewerProps = Omit<React.ComponentProps<'div'>, 'children'> & {
  lines: LogLine[];
  /** Stick to the bottom as lines arrive. Scrolling up pauses it; the jump pill resumes it. */
  follow?: boolean;
  /** Lines are still arriving: "Streaming" with the running arc in the head row. */
  streaming?: boolean;
  /** The search, level and wrap strip. Off by default; a long log a person searches turns it on. */
  toolbar?: boolean;
  /** The head row: label, count, status, Next failure, Copy lines. */
  header?: boolean;
  /** The time column. */
  timestamps?: boolean;
  /** Start with long messages wrapped. Off, they run on and the log scrolls sideways. */
  wrap?: boolean;
  /** px. The log's fixed height; it scrolls inside. */
  height?: number;
  /** The head row's title and the log's name: "Deploy log for api@v314". */
  label?: string;
  /** card: shell and panel. none: bare, inside a Card's flush content. */
  frame?: 'card' | 'none';
};

function LogViewer({lines, follow = true, streaming = false, toolbar = false, header = true, timestamps = true, wrap: defaultWrap = true, height = 320, label = 'Logs', frame = 'card', className, ...props}: LogViewerProps) {
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState<string[]>([]);
  const [wrap, setWrap] = useState(defaultWrap);
  const [following, setFollowing] = useState(follow);
  const [seenAt, setSeenAt] = useState(lines.length);
  const [hit, setHit] = useState(-1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();

  const counts = useMemo(() => {
    const c: Record<LogLevel, number> = {debug: 0, info: 0, warn: 0, fail: 0};
    for (const line of lines) c[line.level ?? 'info'] += 1;
    return c;
  }, [lines]);
  const filtered = useMemo(
    () => lines.filter(l => (!shown.length || shown.includes(l.level ?? 'info')) && (!q || l.message.toLowerCase().includes(q) || l.source?.toLowerCase().includes(q))),
    [lines, shown, q],
  );

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 20,
    overscan: 12,
    getItemKey: i => filtered[i].id,
    useFlushSync: false,
  });

  const total = virtualizer.getTotalSize();
  useLayoutEffect(() => {
    if (!following || !filtered.length) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [filtered.length, following, total]);
  useEffect(() => { if (following) setSeenAt(lines.length); }, [following, lines.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || !follow) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
    if (atBottom !== following) setFollowing(atBottom);
  };
  // The pill leaves once following resumes, so focus moves to the log body first.
  const jump = () => { scrollRef.current?.focus({preventScroll: true}); setFollowing(true); virtualizer.scrollToIndex(filtered.length - 1, {align: 'end'}); };
  const unseen = Math.max(0, lines.length - seenAt);
  const unseenFails = useMemo(() => lines.slice(seenAt).filter(l => l.level === 'fail').length, [lines, seenAt]);
  const failures = counts.fail;
  const failIndexes = useMemo(() => filtered.flatMap((l, i) => (l.level === 'fail' ? [i] : [])), [filtered]);
  const nextFailure = () => {
    if (!failIndexes.length) return;
    const to = failIndexes.find(i => i > hit) ?? failIndexes[0];
    if (follow) setFollowing(false);
    setHit(to);
    virtualizer.scrollToIndex(to, {align: 'center'});
  };

  // Glaze's empty state, plain and small, centred in the body.
  const empty = <Empty variant="plain" size="sm" reason={lines.length === 0 ? 'empty' : 'no-results'} role="none">
    <EmptyHeader><EmptyTitle className="break-words">
      {lines.length === 0 ? (streaming ? 'Waiting for the first line' : 'No output') : q ? <>No lines match <code>{query.trim()}</code></> : 'No lines at these levels'}
    </EmptyTitle></EmptyHeader>
  </Empty>;

  const body = <>
    {header && <div data-slot="log-viewer-header" className="flex min-h-(--row) min-w-0 shrink-0 items-center gap-2 border-b border-line-faint ps-3 pe-1.5">
      <span className="min-w-0 truncate type-label text-text-1">{label}</span>
      <span className="shrink-0 type-label text-text-2 data">{lines.length.toLocaleString('en-US')} {lines.length === 1 ? 'line' : 'lines'}</span>
      {streaming
        ? <Status status="running" size="sm" className="shrink-0">Streaming</Status>
        : failures > 0 && <Status status="fail" size="sm" className="shrink-0">{failures.toLocaleString('en-US')} failed</Status>}
      <span className="ms-auto flex shrink-0 items-center gap-0.5">
        {failIndexes.length > 0 && <Button data-slot="log-viewer-next-fail" variant="ghost" size="sm" onClick={nextFailure} aria-label={`Next failure, ${failIndexes.length} in this log`} className="px-2">
          <Icon icon={Failed}/><span className="data">{failIndexes.length.toLocaleString('en-US')}</span>
        </Button>}
        {/* Built on press: joining 100,000 lines on every render made each scroll frame a long task. */}
        <CopyCodeButton text={() => filtered.map(lineText).join('\n')} label="Copy lines"/>
      </span>
    </div>}
    {toolbar && <div data-slot="log-viewer-toolbar" className="flex min-w-0 shrink-0 flex-wrap items-center gap-1.5 border-b border-line-faint p-1.5">
      <Input mode="search" size="sm" aria-label={`Filter ${label}`} placeholder="Filter lines" value={query} onValueChange={setQuery} clearLabel="Clear filter" className="min-w-40 flex-1 border-line-faint"/>
      <SegmentedControl multiple size="sm" aria-label="Levels" value={shown} onValueChange={setShown}>
        {levels.map(level => <SegmentedControlItem key={level} value={level} count={counts[level]}>{level}</SegmentedControlItem>)}
      </SegmentedControl>
      <Button variant="secondary" size="icon-sm" aria-label="Wrap lines" aria-pressed={wrap} onClick={() => setWrap(w => !w)} className="text-text-2 aria-pressed:text-text-1"><Icon icon={Wrap} weight={wrap ? 'fill' : 'regular'}/></Button>
    </div>}
    <div className="relative flex min-h-0 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        dir="ltr"
        data-slot="log-viewer-body"
        role="log"
        aria-live="off"
        aria-label={label}
        tabIndex={0}
        // Rows are flex rows, so a hand selection would copy one cell per line; join each row's cells with spaces.
        onCopy={event => {
          const selection = window.getSelection();
          if (!selection || selection.isCollapsed || !selection.rangeCount) return;
          const rows = [...selection.getRangeAt(0).cloneContents().querySelectorAll('[data-slot=log-line]')];
          if (!rows.length) return;
          event.clipboardData.setData('text/plain', rows.map(row => [...row.children].map(cell => cell.textContent?.trim()).filter(Boolean).join(' ')).join('\n'));
          event.preventDefault();
        }}
        className="min-h-0 overflow-auto bg-code-surface py-2 focus-visible:focus-ring-inset"
        // value-ok: the log's height is the caller's, in px, so it can only live inline. With no lines yet the body is
        // as tall as its one-line message, not a tall empty box; it takes the height when the first line arrives.
        style={{height: lines.length === 0 ? undefined : height}}
      >
        {filtered.length === 0
          ? empty
          : <div className={cn('relative', !wrap && 'w-max min-w-full')} style={{height: virtualizer.getTotalSize()}}>
              {virtualizer.getVirtualItems().map(item => <LogRow
                key={item.key}
                line={filtered[item.index]}
                index={item.index}
                start={item.start}
                q={q}
                hit={item.index === hit}
                timestamps={timestamps}
                wrap={wrap}
                measure={virtualizer.measureElement}
              />)}
            </div>}
      </div>
      {!following && follow && filtered.length > 0 && <Button size="sm" variant="secondary" onClick={jump} data-slot="log-viewer-jump" className="absolute end-3 bottom-3">
        <Icon icon={ArrowDown}/>{unseen ? `${unseen.toLocaleString('en-US')} new${unseenFails ? `, ${unseenFails.toLocaleString('en-US')} fail` : ` ${unseen === 1 ? 'line' : 'lines'}`}` : 'Jump to latest'}
      </Button>}
    </div>
    <span role="status" className="sr-only">{failures ? `${failures} failed ${failures === 1 ? 'line' : 'lines'}` : ''}</span>
  </>;

  return <div
    data-slot="log-viewer"
    data-status={failures ? 'fail' : undefined}
    data-frame={frame}
    className={cn('flex min-w-0 flex-col text-text-1', frame === 'card' && 'shell forced-colors:border-[CanvasText]', className)}
    {...props}
  >
    {frame === 'card' ? <div data-slot="log-viewer-panel" className="panel flex min-w-0 flex-col overflow-hidden forced-colors:border-[CanvasText]">{body}</div> : body}
  </div>;
}

export {LogViewer, type LogLevel, type LogLine, type LogViewerProps};

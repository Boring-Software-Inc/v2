'use client';

import {Tooltip} from '@base-ui/react/tooltip';
import {useRender} from '@base-ui/react/use-render';
import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {useGlazePortal} from '#/lib/glaze/portal.ts';
import {cn, mergeRefs} from '#/lib/glaze/utils.ts';
import {tooltipMotionClass, tooltipPopupClass} from '#/components/glaze/ui/tooltip.tsx';

// One line of text that never wraps, cut so the person can still tell values apart, with the whole value one hover
// or one Tab away.
//
// position="end": natural text, ending in an ellipsis.
// position="middle": IDs and paths. It cuts where values differ: a path keeps its last segment, anything else its last
// 6 characters, and the head takes the ellipsis, so run_01J9ZK…4E7Q and src/agents/…/handler.ts keep both the prefix
// that says what it is and the tail that tells two apart.
//
// Both measure themselves: only a value that is actually cut gets the hint and a tab stop. A value that fits is plain
// text with no hint and no extra Tab. The DOM always holds the whole string, so copy, find in page and a screen
// reader get the full value.
//
// TextHint is the plain hint the display components share (Truncate, Relative time, the avatar group's +N). It draws
// Tooltip's ink chip with Tooltip's motion, so there is one look for a hint in Glaze; what it adds is a tap that pins
// it open on a touch screen, which has no hover, until the next tap or Escape. Unlike TooltipContent it takes any
// node, because a time's hint holds two lines.

type TextHintProps = {
  /** What the hint says. */
  content: React.ReactNode;
  /** The element the hint belongs to. It must accept a ref and props. */
  children: React.ReactElement;
  disabled?: boolean;
  side?: 'top' | 'bottom' | 'left' | 'right';
};

/** The hint's classes: Tooltip's chip and its motion, so a hint and a tooltip are one look. */
const textHintClass = cn(tooltipPopupClass, '[overflow-wrap:anywhere]');

function TextHint({content, children, disabled, side = 'top'}: TextHintProps) {
  const container = useGlazePortal();
  const [open, setOpen] = useState(false);
  const pointer = useRef('');
  const pinned = useRef(false);
  const coarse = () => pointer.current === 'touch' || pointer.current === 'pen';

  const onOpenChange = (next: boolean, details: Tooltip.Root.ChangeEventDetails) => {
    // A tap focuses the element before its click lands; the click decides, not the focus.
    if (coarse() && details.reason !== 'escape-key' && details.reason !== 'outside-press') return;
    // A pinned hint ignores hover and focus changes; only a tap or Escape closes it.
    if (pinned.current && !next && details.reason !== 'escape-key' && details.reason !== 'outside-press') return;
    if (!next) pinned.current = false;
    setOpen(next);
  };

  return <Tooltip.Root disabled={disabled} open={open && !disabled} onOpenChange={onOpenChange}>
    <Tooltip.Trigger
      delay={400}
      render={children}
      onPointerDown={(event: React.PointerEvent) => { pointer.current = event.pointerType; }}
      onKeyDown={() => { pointer.current = ''; }}
      onClickCapture={(event: React.MouseEvent) => {
        if (!coarse() || event.currentTarget instanceof HTMLAnchorElement) return;
        pointer.current = '';
        if (disabled) return;
        event.preventDefault();
        event.stopPropagation();
        pinned.current = !open;
        setOpen(!open);
      }}
    />
    <Tooltip.Portal container={container}>
      <Tooltip.Positioner side={side} sideOffset={6} collisionPadding={8} className="isolate z-(--z-overlay)">
        <Tooltip.Popup data-slot="text-hint" className={cn(textHintClass, tooltipMotionClass)}><span className="min-w-0">{content}</span></Tooltip.Popup>
      </Tooltip.Positioner>
    </Tooltip.Portal>
  </Tooltip.Root>;
}

const graphemes = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, {granularity: 'grapheme'}) : null;

/** Where each character a person sees starts, in UTF-16 offsets: an emoji or a letter with its accent is one. */
function characterStarts(text: string): number[] {
  if (graphemes) return Array.from(graphemes.segment(text), s => s.index);
  const starts: number[] = [];
  let at = 0;
  for (const point of text) { starts.push(at); at += point.length; }
  return starts;
}

/**
 * Where to split a middle cut, as a UTF-16 offset for slice(). Paths keep their last segment; anything else keeps its
 * last `tail` characters, counted as a person sees them, so a cut never lands inside an emoji.
 */
function splitTail(text: string, tail: number | 'auto') {
  const starts = characterStarts(text);
  if (tail === 'auto') {
    const slash = text.lastIndexOf('/');
    if (slash > 0 && slash < text.length - 1 && starts.length - starts.indexOf(slash) <= 32) return slash;
    tail = 6;
  }
  tail = Math.floor(tail);
  if (!(tail > 0)) return text.length;
  return starts.length <= tail ? 0 : starts[starts.length - tail];
}

/** True while the element's content is wider than its box. */
function useClipped(ref: React.RefObject<HTMLElement | null>, text: string) {
  const [clipped, setClipped] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setClipped(el.scrollWidth > el.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, text]);
  return clipped;
}

type TruncateProps = Omit<useRender.ComponentProps<'span'>, 'children'> & {
  /** The full value. A string, so the hint can repeat it. */
  children: string;
  /** end: an ellipsis at the end of natural text. middle: keep the head and the tail of an ID or path. */
  position?: 'end' | 'middle';
  /** End only: fade the clipped edge instead of drawing an ellipsis. Defaults to ellipsis. */
  treatment?: 'ellipsis' | 'fade';
  /** middle only: how much of the end to keep, a character count or 'auto' (the last path segment, else 6). */
  tail?: number | 'auto';
  /** Show the full value in a hint when it is cut. On by default. */
  hint?: boolean;
  /** Make a cut value a tab stop, so keyboard users can open the hint. On by default. */
  focusable?: boolean;
};

const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The middle cut. The head stays whole in the DOM; the cut clips the head to a whole number of characters (measured
 * with a Range, so kerning counts) and puts its own ellipsis between head and tail, so the ellipsis always touches the
 * tail. A copy takes the full string.
 */
function MiddleTruncate({children, tail, hint, focusable, className, render, treatment: _treatment, ...props}: Omit<TruncateProps, 'position'> & {tail: number | 'auto'; hint: boolean; focusable: boolean}) {
  const outer = useRef<HTMLSpanElement>(null);
  const head = useRef<HTMLSpanElement>(null);
  const tailEl = useRef<HTMLSpanElement>(null);
  const dots = useRef<HTMLSpanElement>(null);
  const [clipped, setClipped] = useState(false);
  const at = splitTail(children, tail);
  const headText = children.slice(0, at);
  const tailText = children.slice(at);

  useLayoutEffect(() => {
    const box = outer.current;
    const h = head.current;
    const t = tailEl.current;
    const d = dots.current;
    const node = h?.firstChild;
    if (!box || !h || !t || !d || !node) return;
    const span = (n: number) => {
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, n);
      return range.getBoundingClientRect().width;
    };
    const ends = [...characterStarts(headText).slice(1), headText.length];
    const measure = () => {
      h.style.width = '';
      d.style.display = 'none';
      const avail = box.clientWidth;
      const full = span(headText.length) + t.getBoundingClientRect().width;
      if (full <= avail + 0.5 || headText.length === 0) { setClipped(false); return; }
      d.style.display = 'inline';
      const room = avail - d.getBoundingClientRect().width - t.getBoundingClientRect().width;
      let lo = -1;
      let hi = ends.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (span(ends[mid]) <= room) lo = mid; else hi = mid - 1;
      }
      h.style.width = `${lo < 0 ? 0 : span(ends[lo])}px`;
      setClipped(true);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [headText, tailText]);

  const onCopy = (event: React.ClipboardEvent<HTMLSpanElement>) => {
    const selected = window.getSelection()?.toString() ?? '';
    if (!selected) return;
    const joined = new RegExp(`${escapeRe(headText)}\\s*${escapeRe(tailText)}`);
    event.clipboardData.setData('text/plain', joined.test(selected) ? selected.replace(joined, children) : children);
    event.preventDefault();
  };

  const tab = clipped && hint && focusable ? 0 : undefined;
  const value = useRender({defaultTagName: 'span', render, props: {
    'data-slot': 'truncate',
    'data-position': 'middle',
    'data-clipped': clipped || undefined,
    dir: 'auto',
    tabIndex: tab,
    onCopy,
    className: cn('inline-flex max-w-full whitespace-nowrap focus-visible:rounded-tag', className),
    ...props,
    children: <>
      <span ref={head} data-slot="truncate-head" className="overflow-hidden">{headText}</span>
      <span ref={dots} data-slot="truncate-ellipsis" aria-hidden="true" className="hidden shrink-0 select-none">…</span>
      <span ref={tailEl} data-slot="truncate-tail" className="shrink-0">{tailText}</span>
    </>,
  }});
  const text = <span ref={outer} className="block max-w-full min-w-0">
    {value}
  </span>;
  if (!hint) return text;
  return <TextHint content={children} disabled={!clipped}>{text}</TextHint>;
}

function Truncate({children, position = 'end', treatment = 'ellipsis', tail = 'auto', hint = true, focusable = true, className, ref, render, ...props}: TruncateProps) {
  const cut = useRef<HTMLSpanElement>(null);
  const fadeCut = useRef<HTMLSpanElement>(null);
  const cutRefs = useMemo(() => mergeRefs(cut, ref), [ref]);
  const clipped = useClipped(treatment === 'fade' ? fadeCut : cut, children);
  const tab = clipped && hint && focusable ? 0 : undefined;
  const text = useRender({defaultTagName: 'span', render, props: {
    ref: cutRefs,
    'data-slot': 'truncate',
    'data-position': 'end',
    'data-treatment': treatment,
    'data-clipped': clipped || undefined,
    tabIndex: tab,
    className: cn('block min-w-0 focus-visible:rounded-tag', treatment === 'ellipsis' && 'truncate', className),
    ...props,
    children: treatment === 'fade' ? <span ref={fadeCut} className={cn('block min-w-0 overflow-hidden whitespace-nowrap', clipped && '[mask-image:linear-gradient(to_right,var(--ink)_calc(100%_-_var(--space-6)),transparent)]')}>{children}</span> : children,
  }});
  if (position === 'middle') return <MiddleTruncate tail={tail} hint={hint} focusable={focusable} className={className} ref={ref} render={render} {...props}>{children}</MiddleTruncate>;
  if (!hint) return text;
  return <TextHint content={children} disabled={!clipped}>{text}</TextHint>;
}

export {Truncate, TextHint, textHintClass, splitTail, type TruncateProps, type TextHintProps};

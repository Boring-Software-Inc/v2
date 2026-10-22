'use client';

import {useEffect, useRef, useState, type CSSProperties, type ReactNode} from 'react';
import {cn} from '#/lib/glaze/utils.ts';
import {useSlowWait} from '#/components/glaze/ui/slow-notice.tsx';

// Holds the shape of content while it loads, so nothing moves when the content lands.
// - Skeleton is a box. Give it the size of the real thing (size-6 rounded-pill for an avatar, h-(--control) w-24).
// - SkeletonText is lines of text. Pass the type role of the real text: each line is one line box of that role, so a
//   three-line body paragraph and its skeleton are the same height to the pixel.
// - SkeletonSwap decides when to show it.
//
// The fill is the grey field, still: no sweep, no pulse. Glaze has one loop, the pending arc, and a moving
// skeleton is a second one that says nothing the grey block does not.
//
// SkeletonSwap never flashes. On a first load it holds the skeleton's space but keeps it invisible for --wait-show (150ms), so a
// fast response swaps straight to content; once shown, the skeleton stays at least --wait-hold (400ms), so a response at 170ms does
// not blink it on and off. On a reload the content on screen stays put (aria-busy at once, dimmed after the same
// 150ms): a skeleton stands in for missing content, never for content being refreshed.

function Skeleton({className, ...props}: React.ComponentProps<'div'>) {
  useSlowWait(true);
  return <div
    data-slot="skeleton"
    aria-hidden
    className={cn('shrink-0 rounded-tag bg-field forced-colors:bg-[GrayText]', className)}
    {...props}
  />;
}

type TextRole = 'heading' | 'heading-sm' | 'body' | 'body-sm' | 'label' | 'label-sm' | 'caption' | 'code' | 'code-sm';

const roles: Record<TextRole, string> = {
  heading: 'type-heading', 'heading-sm': 'type-heading-sm', body: 'type-body', 'body-sm': 'type-body-sm',
  label: 'type-label', 'label-sm': 'type-label-sm', caption: 'type-caption', code: 'type-code', 'code-sm': 'type-code-sm',
};

type SkeletonTextProps = Omit<React.ComponentProps<'div'>, 'children'> & {
  /** The type role of the text it stands in for. Sets the line height, so the heights match. */
  type?: TextRole;
  /** Number of lines. */
  lines?: number;
  /** Width of the last line, as a fraction of the full width. */
  last?: number;
};

/** Lines of text: each one line box of the role tall, the bar half of it, the last line shorter. */
function SkeletonText({className, type = 'body', lines = 1, last = 0.6, ...props}: SkeletonTextProps) {
  const count = Math.max(1, Math.floor(lines));
  return <div data-slot="skeleton-text" data-type={type} aria-hidden className={cn('flex w-full flex-col', roles[type], className)} {...props}>
    {Array.from({length: count}, (_, i) => <div key={i} className="flex h-lh items-center">
      <Skeleton
        className="h-1/2 w-full data-last:w-(--last)"
        data-last={count > 1 && i === count - 1 ? '' : undefined}
        style={{'--last': `${Math.min(1, Math.max(0.1, last)) * 100}%`} as CSSProperties}
      />
    </div>)}
  </div>;
}

type SkeletonSwapProps = {
  /** True while the content is loading. */
  loading: boolean;
  /** The skeleton, shaped like the content. */
  fallback: ReactNode;
  children: ReactNode;
  /** ms the skeleton stays invisible before it shows, --wait-show by default. A response inside it swaps straight to content. */
  delay?: number;
  /** ms the skeleton stays once shown, --wait-hold by default. */
  minDuration?: number;
  /** Names what is loading for a screen reader: "Loading runs". */
  label?: string;
  className?: string;
};

/**
 * Shows fallback on a first load without a flash: invisible for delay (its space held), then shown for at least
 * minDuration. On a reload the content stays and the region is marked busy and, after delay, dimmed.
 */
/** A time token read off the element, in ms: "150ms" or "0.15s". The fallback is the token's value, for the server. */
function timeToken(el: HTMLElement | null, name: string, fallback: number) {
  const raw = el ? getComputedStyle(el).getPropertyValue(name).trim() : '';
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  return raw.endsWith('ms') ? n : raw.endsWith('s') ? n * 1000 : n;
}

function SkeletonSwap({loading, fallback, children, delay: delayProp, minDuration: minProp, label = 'Loading', className}: SkeletonSwapProps) {
  const root = useRef<HTMLDivElement>(null);

  const [phase, setPhase] = useState<'hidden' | 'shown' | 'done'>(loading ? 'hidden' : 'done');
  const [hasContent, setHasContent] = useState(!loading);
  const shownAt = useRef(0);

  useEffect(() => {
    if (loading) {
      if (hasContent) return;
      setPhase('hidden');
      const t = setTimeout(() => { shownAt.current = Date.now(); setPhase('shown'); }, delayProp ?? timeToken(root.current, '--wait-show', 150));
      return () => clearTimeout(t);
    }
    setPhase(p => (p === 'shown' ? p : 'done'));
  }, [loading, delayProp, hasContent]);

  // Once shown, hold until minDuration has passed, even if loading already ended.
  useEffect(() => {
    if (loading || phase !== 'shown') return;
    const t = setTimeout(() => setPhase('done'), Math.max(0, minProp ?? timeToken(root.current, '--wait-hold', 400) - (Date.now() - shownAt.current)));
    return () => clearTimeout(t);
  }, [loading, phase, minProp]);

  useEffect(() => { if (phase === 'done' && !loading) setHasContent(true); }, [phase, loading]);

  const reloading = loading && hasContent;
  const [dim, setDim] = useState(false);
  useEffect(() => {
    if (!reloading) { setDim(false); return; }
    const t = setTimeout(() => setDim(true), delayProp ?? timeToken(root.current, '--wait-show', 150));
    return () => clearTimeout(t);
  }, [reloading, delayProp]);
  const holding = !reloading && phase !== 'done';
  useSlowWait(reloading);
  return <div
    ref={root}
    data-slot="skeleton-swap"
    data-phase={reloading ? 'stale' : phase}
    data-stale={(reloading && dim) || undefined}
    aria-busy={holding || reloading || undefined}
    className={cn('transition-opacity duration-(--dur-state) ease-out data-stale:opacity-(--stale)', className)}
  >
    {holding
      ? <><div className={cn(phase === 'hidden' && 'invisible')}>{fallback}</div><span className="sr-only" role="status">{phase === 'shown' ? label : ''}</span></>
      : children}
  </div>;
}

export {Skeleton, SkeletonText, SkeletonSwap, type SkeletonTextProps, type SkeletonSwapProps, type TextRole};

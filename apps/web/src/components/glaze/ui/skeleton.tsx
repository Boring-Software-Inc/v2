'use client';

import {Skeleton as Skullet, SkeletonBox} from 'skullet/react';
import {useRef, type CSSProperties, type ReactNode} from 'react';
import {cn} from '#/lib/glaze/utils.ts';
import {useSlowWait} from '#/components/glaze/ui/slow-notice.tsx';

type SkeletonProps = Pick<React.ComponentProps<typeof SkeletonBox>, 'className' | 'style'>;

/** A Skullet box sized by the Glaze layout that owns it. */
function Skeleton({className, ...props}: SkeletonProps) {
  useSlowWait(true);
  return <span
    data-slot="skeleton"
    aria-hidden
    className={cn('block shrink-0 rounded-tag', className)}
    style={props.style}
  >
    <SkeletonBox
      className="block forced-colors:bg-[GrayText]"
      height="100%"
      width="100%"
      radius="inherit"
    />
  </span>;
}

type TextRole = 'heading' | 'heading-sm' | 'body' | 'body-sm' | 'label' | 'label-sm' | 'caption' | 'code' | 'code-sm';

const roles: Record<TextRole, string> = {
  heading: 'type-heading', 'heading-sm': 'type-heading-sm', body: 'type-body', 'body-sm': 'type-body-sm',
  label: 'type-label', 'label-sm': 'type-label-sm', caption: 'type-caption', code: 'type-code', 'code-sm': 'type-code-sm',
};

type SkeletonTextProps = Omit<React.ComponentProps<'div'>, 'children'> & {
  /** The type role of the text it stands in for. */
  type?: TextRole;
  /** Number of lines. */
  lines?: number;
  /** Width of the last line, as a fraction of the full width. */
  last?: number;
};

/** Lines of text whose line boxes match the Glaze type role they stand in for. */
function SkeletonText({className, type = 'body', lines = 1, last = 0.6, ...props}: SkeletonTextProps) {
  const count = Math.max(1, Math.floor(lines));
  const lastWidth = `${Math.min(1, Math.max(0.1, last)) * 100}%`;
  return <div data-slot="skeleton-text" data-type={type} aria-hidden className={cn('flex w-full flex-col', roles[type], className)} {...props}>
    {Array.from({length: count}, (_, i) => <div key={i} className="flex h-lh items-center">
      <Skeleton
        className="h-1/2"
        style={{width: count > 1 && i === count - 1 ? lastWidth : '100%'} as CSSProperties}
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
  /** Names what is loading for a screen reader: "Loading runs". */
  label?: string;
  className?: string;
};

/** Uses Skullet for the first empty load and keeps settled content visible during background refreshes. */
function SkeletonSwap({loading, fallback, children, label = 'Loading', className}: SkeletonSwapProps) {
  const hasContent = useRef(!loading);
  if (!loading) hasContent.current = true;
  const initialLoad = loading && !hasContent.current;
  const reloading = loading && hasContent.current;
  useSlowWait(reloading);
  return <div data-slot="skeleton-swap" aria-busy={loading || undefined} className={className}>
    <Skullet loading={initialLoad} label={label} skeleton={fallback}>
      {children}
    </Skullet>
  </div>;
}

export {Skeleton, SkeletonText, SkeletonSwap, type SkeletonTextProps, type SkeletonSwapProps, type TextRole};

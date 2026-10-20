'use client';

import {useRef, useState} from 'react';
import {cva, type VariantProps} from 'class-variance-authority';
import {Icon, Retry, Empty as EmptyGlyph, Failed, NoAccess, NoResults, type GlazeIcon} from '#/components/glaze/icon.tsx';
import {Button} from '#/components/glaze/ui/button.tsx';
import {cn} from '#/lib/glaze/utils.ts';

// What a region shows when it has nothing else to show. Four reasons share one shape (a title, a sentence, one way
// out) and differ in what they say:
//   empty      nothing here yet; the first action creates it
//   no-results a search or filter matched nothing; the action clears it
//   no-access  the person cannot see this; the action asks for access
//   error      it failed to load; role="alert", the title in the failure word colour, the request ID, and Retry
//
// Everything is centred in a compact column: the reason's glyph on top, 40px light and bare in text-3
// (32 at size sm, coral for error), then the title in the label role, one line of description in text-2, and at most
// one action. Never an illustration, a tinted tile or a second glyph. Standalone (variant="panel") it is the card's
// white panel; inside a card, a list, a table or a menu use variant="plain", which shares that surface.
//
// The considered detail is Retry. EmptyRetry runs the caller's promise, keeps its box while it runs, and when the
// retry fails again says so in place: "Retry 2 failed at 14:03:12". Retrying a dead endpoint never looks like the
// button did nothing.

type EmptyReason = 'empty' | 'no-results' | 'no-access' | 'error';

const reasonGlyph: Record<EmptyReason, GlazeIcon> = {empty: EmptyGlyph, 'no-results': NoResults, 'no-access': NoAccess, error: Failed};

const emptyVariants = cva('group/empty flex w-full min-w-0 flex-col items-center gap-3 text-center text-text-1', {
  variants: {
    variant: {
      panel: 'panel forced-colors:border-[CanvasText]',
      plain: '',
    },
    size: {
      default: 'px-4 py-6',
      sm: 'gap-2 px-3 py-4',
    },
  },
  defaultVariants: {variant: 'panel', size: 'default'},
});

type EmptyProps = React.ComponentProps<'div'> & VariantProps<typeof emptyVariants> & {
  /** Why there is nothing. error sets role="alert" and the failure word colour on the title. */
  reason?: EmptyReason;
  art?: React.ReactNode;
};

function Empty({className, reason = 'empty', variant = 'panel', size = 'default', role, art, children, ...props}: EmptyProps) {
  return <div
    data-slot="empty"
    data-reason={reason}
    data-size={size}
    data-art={art ? '' : undefined}
    role={role ?? (reason === 'error' ? 'alert' : undefined)}
    className={cn(emptyVariants({variant, size}), className)}
    {...props}
  >
    {art}
    {children}
  </div>;
}

type EmptyArtSize = 'default' | 'compact';

const emptyArtSize: Record<EmptyArtSize, string> = {default: 'size-24', compact: 'size-16'};

function EmptyArt({className, size = 'default', ...props}: Omit<React.ComponentProps<'div'>, 'aria-hidden'> & {size?: EmptyArtSize}) {
  return <div
    data-slot="empty-art"
    data-size={size}
    aria-hidden
    className={cn('relative shrink-0', emptyArtSize[size], className)}
    {...props}
  />;
}

/** The title and description, held to a hint's measure. */
function EmptyHeader({className, ...props}: React.ComponentProps<'div'>) {
  return <div data-slot="empty-header" className={cn('flex max-w-(--measure-hint) min-w-0 flex-col items-center gap-1', className)} {...props}/>;
}

type EmptyTitleProps = React.ComponentProps<'h3'> & {
  /** The glyph over the title: the reason's by default, false for none, or another icon. */
  icon?: GlazeIcon | false;
};

/** What is missing, as a sentence: "No runs yet", "No runs match timeout". The reason's glyph sits over it. */
function EmptyTitle({className, icon, children, ...props}: EmptyTitleProps) {
  return <h3 data-slot="empty-title" className={cn('flex min-w-0 flex-col items-center gap-3 type-label text-text-1 group-data-[reason=error]/empty:text-fail-text group-data-[size=sm]/empty:gap-2', className)} {...props}>
    {icon !== false && <EmptyIcon icon={icon}/>}
    <span className="min-w-0 text-pretty">{children}</span>
  </h3>;
}

function EmptyIcon({icon}: {icon?: GlazeIcon}) {
  return <span data-slot="empty-icon" className="flex shrink-0 text-text-3 group-data-art/empty:hidden group-data-[reason=error]/empty:text-fail-text">
    <EmptyReasonGlyph icon={icon}/>
  </span>;
}

function EmptyReasonGlyph({icon}: {icon?: GlazeIcon}) {
  // The reason and the size live on the root's data attributes; each glyph renders and CSS shows the matching one,
  // so the title needs no context and works on the server. 40px, drawn at 32 in size sm.
  const sized = 'group-data-[size=sm]/empty:size-8';
  if (icon) return <Icon icon={icon} size={40} weight="light" className={sized}/>;
  return <>
    {(Object.keys(reasonGlyph) as EmptyReason[]).map(reason => <Icon key={reason} icon={reasonGlyph[reason]} size={40} weight="light" data-reason={reason} className={cn('hidden', sized, {
      empty: 'group-data-[reason=empty]/empty:block',
      'no-results': 'group-data-[reason=no-results]/empty:block',
      'no-access': 'group-data-[reason=no-access]/empty:block',
      error: 'group-data-[reason=error]/empty:block',
    }[reason])}/>)}
  </>;
}

/** One line: why it is empty and what the action does. */
function EmptyDescription({className, ...props}: React.ComponentProps<'p'>) {
  return <p
    data-slot="empty-description"
    className={cn(
      'type-body-sm text-pretty text-text-2 [&_a]:text-text-1 [&_a]:underline [&_a]:decoration-1 [&_a]:underline-offset-2',
      className,
    )}
    {...props}
  />;
}

/** The way out: one Button, secondary by default, primary only when it is the only way forward. */
function EmptyContent({className, ...props}: React.ComponentProps<'div'>) {
  return <div data-slot="empty-content" className={cn('flex min-w-0 flex-wrap items-center justify-center gap-2', className)} {...props}/>;
}

/** error: the request ID in mono. One click selects all of it, for pasting into a support thread. */
function EmptyCode({className, ...props}: React.ComponentProps<'code'>) {
  return <code data-slot="empty-code" className={cn('break-all text-text-1 select-all', className)} {...props}/>;
}

const clock = (d: Date) => d.toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false});

type EmptyRetryProps = Omit<React.ComponentProps<typeof Button>, 'onClick' | 'pending' | 'children'> & {
  /** Runs the retry. Reject (or throw) when it fails again. */
  onRetry: () => Promise<unknown>;
  children?: React.ReactNode;
};

/**
 * Retry that reports itself. Pending while the promise runs, and after a failed retry a status line under it:
 * "Retry 2 failed at 14:03:12", counting the person's presses. A success leaves it to the caller, who replaces the
 * Empty with the content and moves focus to it.
 */
function EmptyRetry({onRetry, children = 'Retry', variant = 'secondary', size = 'sm', className, ...props}: EmptyRetryProps) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<{attempt: number; at: string} | null>(null);
  const attempts = useRef(0);
  const run = async () => {
    if (pending) return;
    setPending(true);
    try {
      await onRetry();
      setFailed(null);
    } catch {
      attempts.current += 1;
      setFailed({attempt: attempts.current, at: clock(new Date())});
    } finally {
      setPending(false);
    }
  };
  return <span data-slot="empty-retry" className="inline-flex flex-col items-center gap-1">
    <Button variant={variant} size={size} pending={pending} pendingLabel="Retrying" onClick={run} className={className} {...props}>
      <Icon icon={Retry} size={12}/>{children}
    </Button>
    <span role="status" data-slot="empty-retry-status" className="type-caption text-text-2 data empty:hidden">
      {failed && `Retry ${failed.attempt} failed at ${failed.at}`}
    </span>
  </span>;
}

export {Empty, EmptyArt, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyCode, EmptyRetry, emptyVariants, type EmptyProps, type EmptyReason, type EmptyRetryProps, type EmptyArtSize};

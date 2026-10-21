import {Children, isValidElement, type ReactNode} from 'react';
import {cn} from '#/lib/glaze/utils.ts';
import {Panel} from '#/components/glaze/ui/panel.tsx';

// Glaze's card, the second of its three signatures: a light grey shell (styles.css, shell) with a white panel 3px
// inside it, rounded on all four corners so the corners stay concentric, and an optional footer row on the shell.
//
//   <Card>                      the shell
//     <CardHeader>              inside the panel: title, description, one header action
//     <CardContent>             inside the panel, under the header
//     <CardFooter>              on the shell, under the panel: meta first, then size="sm" actions
//
// Card wraps everything but its CardFooter in one panel, so a caller never draws the panel by hand. A Card whose
// direct children include Panels uses those instead: one shell, two panels 3px apart, then the footer.
//
// The footer is one row on the grey. Meta starts it (CardMeta, a count, a time, a model) and truncates; actions sit at
// the end, 3px from the shell's edges, and keep their size. A footer may hold only meta. It holds at most one ink
// (primary) Button, and every other action beside it is a flat secondary; the lint's one-primary fails a second.
//
// A card that opens a page puts CardLink in its title: the link's hit area covers the card, the ring goes round the
// whole shell, and there is one tab stop. A card that is a link holds no buttons.

function isPart(node: ReactNode, part: unknown) {
  return isValidElement(node) && node.type === part;
}

type CardProps = React.ComponentProps<'div'>;

function Card({className, children, ...props}: CardProps) {
  const parts = Children.toArray(children);
  const footer = parts.filter(part => isPart(part, CardFooter));
  const body = parts.filter(part => !isPart(part, CardFooter));
  const ownPanels = body.some(part => isPart(part, Panel));
  return <div
    data-slot="card"
    data-footer={footer.length ? '' : undefined}
    className={cn(
      'group/card shell relative text-text-1',
      // Two panels in one shell sit the shell's inset apart, the same 3px as the shell's padding.
      '[&>[data-slot=panel]~[data-slot=panel]]:mt-(--shell-inset)',
      // A card that is a link rings the whole shell; the link itself draws no ring (data-control).
      'has-[[data-slot=card-link]:focus-visible]:focus-ring',
      'forced-colors:border-[CanvasText]',
      className,
    )}
    {...props}
  >
    {ownPanels ? body : <div data-slot="card-panel" className="panel flex min-w-0 flex-col forced-colors:border-[CanvasText]">{body}</div>}
    {footer}
  </div>;
}

/**
 * The top of the panel: CardTitle over CardDescription, with one CardAction at the end spanning both lines. 12px from
 * the panel's edge, like every padded panel in Glaze.
 */
function CardHeader({className, ...props}: React.ComponentProps<'div'>) {
  return <div
    data-slot="card-header"
    className={cn('grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 p-3 [&+[data-slot=card-content]:not([data-flush])]:pt-0', className)}
    {...props}
  />;
}

/** The topic, in 1 to 4 words. 13/500, wrapping, never truncated. */
function CardTitle({className, ...props}: React.ComponentProps<'div'>) {
  return <div data-slot="card-title" className={cn('col-start-1 min-w-0 type-label text-text-1 [overflow-wrap:anywhere]', className)} {...props}/>;
}

/** One or two sentences under the title, in text-2. */
function CardDescription({className, ...props}: React.ComponentProps<'div'>) {
  return <div data-slot="card-description" className={cn('col-start-1 min-w-0 max-w-(--measure-hint) type-body-sm text-text-2', className)} {...props}/>;
}

/** One action in the header, at the end: a size="sm" ghost or secondary Button. Pulled up 4px so the header keeps its height. */
function CardAction({className, ...props}: React.ComponentProps<'div'>) {
  return <div data-slot="card-action" className={cn('relative z-(--z-raised) col-start-2 row-span-2 row-start-1 -my-1 flex items-center gap-1 self-start', className)} {...props}/>;
}

type CardContentProps = React.ComponentProps<'div'> & {
  /**
   * Run the content to the panel's edge with no padding: rows, a table, a list. A rule closes off the header above.
   */
  flush?: boolean;
};

/** The body inside the panel. 12px in; flush runs rows to the edge. */
function CardContent({className, flush, ...props}: CardContentProps) {
  return <div
    data-slot="card-content"
    data-flush={flush || undefined}
    className={cn(
      'flex min-w-0 flex-col gap-3 type-body-sm text-text-1',
      flush ? 'gap-0 not-first:border-t not-first:border-line-faint' : 'p-3',
      className,
    )}
    {...props}
  />;
}

/**
 * The footer row on the shell, under the panel (styles.css, shell-foot). CardMeta first, then size="sm" Buttons: paper
 * for every action but the one that leads, which is ink. It may hold only meta.
 */
function CardFooter({className, ...props}: React.ComponentProps<'div'>) {
  return <div
    data-slot="card-footer"
    className={cn('shell-foot relative z-(--z-raised) justify-end [&>[data-slot=card-meta]:first-child]:me-auto [&>[data-slot=card-meta]:last-child]:pe-3', className)}
    {...props}
  />;
}

/** Quiet text in the footer: a count, a time, a model. 12px in text-2; it ends in an ellipsis before an action moves. */
function CardMeta({className, ...props}: React.ComponentProps<'span'>) {
  return <span data-slot="card-meta" className={cn('min-w-0 truncate type-caption text-text-2', className)} {...props}/>;
}

/**
 * The card's link, inside CardTitle. Its hit area covers the whole card, so a click anywhere opens it, the focus ring
 * goes round the shell and the card takes one tab stop.
 */
function CardLink({className, ...props}: React.ComponentProps<'a'>) {
  return <a
    data-slot="card-link"
    data-control=""
    className={cn('after:absolute after:inset-0 after:rounded-shell after:content-[""] hover:underline hover:decoration-1 hover:underline-offset-2', className)}
    {...props}
  />;
}

export {Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter, CardMeta, CardLink, type CardProps, type CardContentProps};

'use client';

import {createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {cva} from 'class-variance-authority';
import {Icon, Close, Failed, Information, Success, Warning, type GlazeIcon} from '#/components/glaze/icon.tsx';
import {Button} from '#/components/glaze/ui/button.tsx';
import {cn, mergeRefs} from '#/lib/glaze/utils.ts';

// A message about the view it sits in: a key that expires tomorrow, an eval that failed, a model that is slow today.
// Inline, in the flow, as a box of text with the 10px corner.
//
// status says what kind of message it is, and colour means status, so the status tints carry it: ok green, warn
// amber, fail coral, each with its icon in the status word colour and a title that names the thing in words. neutral
// is paper with a 1px line, for a note that is not good or bad news. No side bar, no shadow, no glass.
//
// Its considered detail is how it leaves. warn and fail never take a close button: they stay until the problem is
// gone. A neutral or ok alert with a dismissKey stays dismissed for that key, so the same notice does not come back
// on every visit, and returns by itself when the key changes with the message. Dismissing moves focus to the next
// focusable thing after the alert, never to the top of the page.

type AlertStatus = 'neutral' | 'ok' | 'warn' | 'fail';

// Four silhouettes that differ without colour: a circle with i, a circle with a check, a triangle, a circle with !.
const statusIcon: Record<AlertStatus, GlazeIcon> = {neutral: Information, ok: Success, warn: Warning, fail: Failed};

const alertVariants = cva('group/alert @container/alert relative w-full min-w-0 rounded-overlay p-3 text-start text-text-1 forced-colors:border forced-colors:border-[CanvasText]', {
  variants: {
    status: {
      neutral: 'border border-line bg-paper',
      ok: 'bg-ok-tint',
      warn: 'bg-warn-tint',
      fail: 'bg-fail-tint',
    },
  },
  defaultVariants: {status: 'neutral'},
});

type AlertContextValue = {status: AlertStatus; dismiss: () => void; dismissible: boolean};
const AlertContext = createContext<AlertContextValue | null>(null);

const storageKey = (key: string) => `glaze:alert-dismissed:${key}`;
function readDismissed(key: string) {
  try { return localStorage.getItem(storageKey(key)) === '1'; } catch { return false; }
}

/** The next element after `from` in document order that takes focus, outside `from` itself. */
function nextFocusable(from: HTMLElement) {
  const all = [...document.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])')];
  return all.find(el => !from.contains(el) && (from.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) ?? null;
}

type AlertProps = Omit<React.ComponentProps<'div'>, 'title'> & {
  /** What kind of message: a note, good news, a warning or a failure. warn and fail never take a close button. */
  status?: AlertStatus;
  /** The lead icon. true shows the status's; false hides it; an element replaces it. */
  icon?: boolean | ReactNode;
  /** false for a static note that is part of the page and must not be announced. On by default. */
  announce?: boolean;
  /** Remembers a dismissal under this key (localStorage). Change the key when the message changes. */
  dismissKey?: string;
  onDismiss?: () => void;
};

function Alert({className, status = 'neutral', icon = true, announce = true, dismissKey, onDismiss, role, children, ref, ...props}: AlertProps) {
  const root = useRef<HTMLDivElement>(null);
  const rootRefs = useMemo(() => mergeRefs(root, ref), [ref]);
  // Undefined until the stored dismissal is read, so an alert dismissed before never flashes in.
  const [dismissed, setDismissed] = useState<boolean | undefined>(dismissKey ? undefined : false);
  useLayoutEffect(() => { if (dismissKey) setDismissed(readDismissed(dismissKey)); }, [dismissKey]);

  const dismissible = status === 'neutral' || status === 'ok';
  const dismiss = useCallback(() => {
    if (!dismissible) return;
    const next = root.current ? nextFocusable(root.current) : null;
    if (dismissKey) { try { localStorage.setItem(storageKey(dismissKey), '1'); } catch {} }
    setDismissed(true);
    onDismiss?.();
    requestAnimationFrame(() => next?.focus());
  }, [dismissible, dismissKey, onDismiss]);

  if (dismissed !== false) return null;
  if (children === undefined || children === null || children === false) return null;

  const glyph: ReactNode = icon === false || icon === null ? null : icon === true ? <Icon icon={statusIcon[status]} size={14}/> : icon;
  const loud = status === 'warn' || status === 'fail';

  return <AlertContext.Provider value={{status, dismiss, dismissible}}>
    <div
      ref={rootRefs}
      data-slot="alert"
      data-status={status}
      role={role ?? (announce ? (loud ? 'alert' : 'status') : undefined)}
      className={cn(alertVariants({status}), className)}
      {...props}
    >
      {/* Parts place themselves on named areas, so they work in any order. Under 24rem the action drops under the text. */}
      <div
        data-slot="alert-grid"
        className={cn(
          'grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-start [grid-template-areas:"icon_title_action_close""icon_desc_action_close""icon_more_more_more"]',
        )}
      >
        {glyph && <span data-slot="alert-icon" className={cn(
          'me-2 flex h-lh items-center type-label [grid-area:icon] group-not-has-data-[slot=alert-title]/alert:type-body-sm',
          status === 'neutral' ? 'text-text-2' : status === 'ok' ? 'text-ok-text' : status === 'warn' ? 'text-warn-text' : 'text-fail-text',
        )}>{glyph}</span>}
        {children}
      </div>
    </div>
  </AlertContext.Provider>;
}

function useAlert() {
  const context = useContext(AlertContext);
  if (!context) throw new Error('Alert parts must be inside <Alert>.');
  return context;
}

/** The headline: names the thing in words ("Key expires tomorrow"). */
function AlertTitle({className, ...props}: React.ComponentProps<'p'>) {
  return <p data-slot="alert-title" className={cn('min-w-0 type-label text-text-1 [overflow-wrap:anywhere] [grid-area:title]', className)} {...props}/>;
}

/** What happened and what to do now. Links inside are ink and underlined. */
function AlertDescription({className, ...props}: React.ComponentProps<'div'>) {
  return <div
    data-slot="alert-description"
    className={cn(
      'min-w-0 type-body-sm text-text-1 [overflow-wrap:anywhere] [grid-area:desc] group-data-[status=neutral]/alert:text-text-2',
      '[&_a]:text-text-1 [&_a]:underline [&_a]:decoration-1 [&_a]:underline-offset-2',
      className,
    )}
    {...props}
  />;
}

/** One or two size="sm" Buttons at the end of the row; under the message when the alert is under 24rem wide. */
function AlertAction({className, ...props}: React.ComponentProps<'div'>) {
  return <div
    data-slot="alert-action"
    className={cn(
      'ms-3 -my-0.5 flex max-w-full min-w-0 flex-wrap items-center gap-2 self-center [grid-area:action]',
      '@max-sm/alert:ms-0 @max-sm/alert:mt-2 @max-sm/alert:my-0 @max-sm/alert:justify-self-start @max-sm/alert:[grid-area:more]',
      className,
    )}
    {...props}
  />;
}

/** Dismisses a neutral or ok alert. Renders nothing on warn and fail, which stay until the problem is fixed. */
function AlertClose({className, label = 'Dismiss', onClick, ...props}: Omit<React.ComponentProps<typeof Button>, 'children' | 'size' | 'variant'> & {label?: string}) {
  const {dismiss, dismissible} = useAlert();
  if (!dismissible) {
    if (process.env.NODE_ENV !== 'production') console.warn('AlertClose: warn and fail alerts stay until the problem is fixed, so the close button is not rendered.');
    return null;
  }
  return <Button
    variant="ghost"
    size="icon-sm"
    data-slot="alert-close"
    aria-label={label}
    onClick={event => { onClick?.(event); if (!event.defaultPrevented) dismiss(); }}
    className={cn('ms-2 -me-1.5 -mt-1 self-start [grid-area:close]', className)}
    {...props}
  >
    <Icon icon={Close} size={12}/>
  </Button>;
}

export {Alert, AlertTitle, AlertDescription, AlertAction, AlertClose, alertVariants, type AlertProps, type AlertStatus};

'use client';

import * as React from 'react';
import type {Dialog as DialogPrimitive} from '@base-ui/react/dialog';
import {coarsePointer, cycleTab} from '#/lib/glaze/portal.ts';
import {cn, mergeRefs} from '#/lib/glaze/utils.ts';

// What Glaze's overlays share, written once. Dialog and Sheet take the open state that waits for a running action,
// the footer's default action on Enter and the scrim. Every overlay, anchored or modal, takes its surface and its
// way of appearing from here, and every list popup (menu, command, select) its rows.
//
// No overlay casts a shadow. A menu, popover or toast is the overlay recipe from styles.css: paper, a 1px --line
// ring, --radius-overlay, on a page a step darker than paper. A dialog and a sheet are the card: the shell grey
// with a ring, a paper panel 3px in, and the footer row on the shell.

// ---------- Open state and the pending block ----------

type ChangeDetails = {cancel: () => void};

/**
 * What the open state knows, apart from React. Every open and every close starts a new session, and a run belongs
 * to the session it started in, so a settle from an earlier session changes nothing.
 */
type OverlayModel = {open: boolean; session: number; pending: boolean; error: string | null};

const overlayModel = (open: boolean): OverlayModel => ({open, session: 0, pending: false, error: null});

/** Any promise-like value counts as pending, not only a native Promise. */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return value !== null && (typeof value === 'object' || typeof value === 'function') && typeof (value as {then?: unknown}).then === 'function';
}

/**
 * The overlay opened or closed, by the parent's prop or by itself. Opening starts clean, with no error. Any close,
 * the parent's included, ends the session, so a run still going is no longer this overlay's.
 */
function overlayOpenChanged(model: OverlayModel, open: boolean): OverlayModel {
  if (model.open === open) return model;
  return {open, session: model.session + 1, pending: false, error: open ? null : model.error};
}

/** Whether a request to close goes through. While a run is pending nothing closes the overlay. */
function overlayMayClose(model: OverlayModel) {
  return !model.pending;
}

/** A run starts. Refused while one is pending; the error clears. */
function overlayRunStarted(model: OverlayModel): OverlayModel | null {
  if (model.pending) return null;
  return {...model, pending: true, error: null};
}

type RunOutcome = {ok: true} | {ok: false; error: string};

/**
 * A run settled. Ignored unless it belongs to the current session and that session still waits on it. Success asks
 * to close when closeAfter; failure keeps the message as the error.
 */
function overlayRunSettled(model: OverlayModel, session: number, outcome: RunOutcome, closeAfter: boolean): {model: OverlayModel; close: boolean} {
  if (session !== model.session || !model.pending) return {model, close: false};
  if (outcome.ok) return {model: {...model, pending: false}, close: closeAfter && model.open};
  return {model: {...model, pending: false, error: outcome.error}, close: false};
}

const FAILED = 'That did not work. Nothing changed.';
const messageOf = (e: unknown) => e instanceof Error ? e.message : typeof e === 'string' && e ? e : FAILED;

/** Base UI's change details for a close the overlay asks for itself, after an action finished. */
function ownDetails<D extends ChangeDetails>(): D {
  const details = {
    reason: 'imperative-action',
    event: new Event('glaze-overlay'),
    trigger: undefined,
    isCanceled: false,
    isPropagationAllowed: false,
    cancel() { details.isCanceled = true; },
    allowPropagation() { details.isPropagationAllowed = true; },
    preventUnmountOnClose() {},
  };
  return details as unknown as D;
}

/**
 * Open state, controlled or not, and the pending block. run() calls an action; a returned thenable sets pending
 * until it settles, and while pending setOpen(false) is refused, so Escape, a swipe, the scrim, Cancel and the X all
 * wait. It closes after success when asked and keeps the rejection's message as the error. `session` changes on
 * every open and close, whichever side opened it, so state that belongs to one open (a typed confirm) resets by
 * keying on it.
 */
function useOverlayOpen<D extends ChangeDetails>({open: openProp, defaultOpen = false, onOpenChange}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean, details: D) => void;
}) {
  const [openState, setOpenState] = React.useState(defaultOpen);
  const open = openProp ?? openState;
  const [model, setModel] = React.useState(() => overlayModel(open));
  const modelRef = React.useRef(model);
  const commit = React.useCallback((next: OverlayModel) => {
    if (next === modelRef.current) return;
    modelRef.current = next;
    setModel(next);
  }, []);
  const latest = React.useRef({controlled: openProp !== undefined, onOpenChange});
  React.useLayoutEffect(() => { latest.current = {controlled: openProp !== undefined, onOpenChange}; });
  // The transition of open, from the prop or from inside, starts a new session.
  React.useLayoutEffect(() => { commit(overlayOpenChanged(modelRef.current, open)); }, [open, commit]);

  const setOpen = React.useCallback((next: boolean, details?: D) => {
    const full = details ?? ownDetails<D>();
    // The action is running: nothing closes the overlay until it settles.
    if (!next && !overlayMayClose(modelRef.current)) { full.cancel(); return; }
    if (!latest.current.controlled) setOpenState(next);
    latest.current.onOpenChange?.(next, full);
  }, []);

  const run = React.useCallback((action: () => unknown, closeAfter: boolean) => {
    const started = overlayRunStarted(modelRef.current);
    if (!started) return;
    let result: unknown;
    try { result = action(); }
    catch (e) { commit({...modelRef.current, error: messageOf(e)}); return; }
    if (!isThenable(result)) { commit({...modelRef.current, error: null}); if (closeAfter) setOpen(false); return; }
    commit(started);
    const settle = (outcome: RunOutcome) => {
      const {model: next, close} = overlayRunSettled(modelRef.current, started.session, outcome, closeAfter);
      commit(next);
      if (close) setOpen(false);
    };
    result.then(() => settle({ok: true}), (e: unknown) => settle({ok: false, error: messageOf(e)}));
  }, [commit, setOpen]);

  return {open, setOpen, pending: model.pending, error: model.error, session: model.session, run};
}

/**
 * Whether a primary action closes its overlay. With onAction it closes after the action settles. Without one, a
 * bare action is a "done" and closes, as a plain confirm button does; an onClick or a form submit owns what happens
 * next, so those stay open.
 */
function closesAfter({close, onAction, onClick, type}: {close?: boolean; onAction?: unknown; onClick?: unknown; type?: string}) {
  return close ?? (onAction !== undefined || (onClick === undefined && type !== 'submit'));
}

// ---------- The footer's default action ----------

type DefaultAction = 'primary' | 'dismiss' | 'none';

// A focused control already owns Enter, so the overlay never takes it from one of these.
const CONTROL = 'button, a[href], textarea, select, summary, [role="button"], [role="link"], [role="menuitem"], [role="option"], [role="combobox"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="slider"], [contenteditable="true"]';
// Text a person types into. Enter in one never dismisses, so typing is never thrown away.
const FIELD = 'input:not([type="checkbox"],[type="radio"],[type="button"],[type="submit"],[type="reset"],[type="hidden"],[type="range"]):not(:disabled,[readonly]), textarea:not(:disabled,[readonly])';

function footerOf(popup: HTMLElement) {
  // Nested overlays portal elsewhere, so this query never reaches a child overlay's footer.
  return popup.querySelector<HTMLElement>('[data-default-action]');
}

function modeOf(footer: HTMLElement): DefaultAction {
  const declared = footer.dataset.defaultAction;
  if (declared === 'primary' || declared === 'dismiss' || declared === 'none') return declared;
  // Undeclared: a destructive primary makes dismiss the default, so Enter fails safe.
  return footer.querySelector('[data-dialog-action="primary"][data-variant="destructive"]') ? 'dismiss' : 'primary';
}

/** The footer's button for an action, or null when it is disabled. */
function actionOf(footer: HTMLElement, action: 'primary' | 'dismiss') {
  const el = footer.querySelector<HTMLElement>(`[data-dialog-action="${action}"]`);
  if (!el || el.matches(':disabled, [aria-disabled="true"], [data-disabled]')) return null;
  return el;
}

type InitialFocus = DialogPrimitive.Popup.Props['initialFocus'];

/**
 * Wires a popup to its footer's default action. Enter outside a control presses the declared button; opening
 * focuses `[data-autofocus]` (on a finger only `[data-autofocus="always"]`), else the dismiss button (dismiss) or the first field, else the primary button
 * (primary). Tab cycles inside the popup.
 */
function useDefaultAction<E extends HTMLElement>({ref, onKeyDown, initialFocus}: {
  ref?: React.Ref<E>;
  onKeyDown?: React.KeyboardEventHandler<E>;
  initialFocus?: InitialFocus;
}) {
  const popupRef = React.useRef<E | null>(null);
  const setRef = React.useMemo(() => mergeRefs(popupRef, ref), [ref]);

  const handleKeyDown = (event: React.KeyboardEvent<E>) => {
    onKeyDown?.(event);
    cycleTab(event);
    if (event.defaultPrevented || event.key !== 'Enter' || event.nativeEvent.isComposing || event.repeat) return;
    if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return;
    const popup = event.currentTarget;
    const target = event.target as HTMLElement;
    if (!popup.contains(target)) return; // bubbled through the React tree from a nested overlay
    if (target !== popup && target.closest(CONTROL)) return;
    if (target instanceof HTMLInputElement && target.form) return; // the form submits itself
    const footer = footerOf(popup);
    if (!footer) return;
    const mode = modeOf(footer);
    if (mode === 'none' || (mode === 'dismiss' && target.matches(FIELD))) return;
    const button = actionOf(footer, mode);
    if (!button) return;
    event.preventDefault();
    button.click();
  };

  const focusOnOpen: InitialFocus = initialFocus ?? (() => {
    const popup = popupRef.current;
    if (!popup) return true;
    // A finger: a focused text field raises the keyboard before anyone asked for it, so the panel takes focus and
    // the person taps the field.
    if (coarsePointer()) return popup.querySelector<HTMLElement>('[data-autofocus="always"]') ?? popup;
    const auto = popup.querySelector<HTMLElement>('[data-autofocus]');
    if (auto) return auto;
    const footer = footerOf(popup);
    if (!footer) return true;
    const mode = modeOf(footer);
    if (mode === 'dismiss') return actionOf(footer, 'dismiss') ?? true;
    if (mode === 'primary') return popup.querySelector<HTMLElement>(FIELD) ?? actionOf(footer, 'primary') ?? true;
    // none: no button may hold focus on open, or Enter would press it. The first field, else the panel.
    return popup.querySelector<HTMLElement>(FIELD) ?? popup;
  });

  return {ref: setRef, onKeyDown: handleKeyDown, initialFocus: focusOnOpen};
}

// ---------- The scrolling body ----------

/**
 * For the body of a dialog or a sheet, which scrolls between a header and a footer that stay put. Sets
 * data-scrolled while it is scrolled off its top, so the hairline under the header shows only when there is content
 * under it, and gives the body a tab stop while it has something to scroll, so the keyboard can reach it.
 */
function useScrollBody<E extends HTMLElement>(ref?: React.Ref<E>) {
  const scroller = React.useRef<E | null>(null);
  const setRef = React.useMemo(() => mergeRefs(scroller, ref), [ref]);
  React.useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => {
      if (el.scrollTop > 0) el.dataset.scrolled = ''; else delete el.dataset.scrolled;
      if (el.scrollHeight > el.clientHeight + 1) el.tabIndex = 0; else el.removeAttribute('tabindex');
    };
    update();
    el.addEventListener('scroll', update, {passive: true});
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => { el.removeEventListener('scroll', update); ro.disconnect(); };
  }, []);
  return setRef;
}

// ---------- Looks ----------

/** Forced colors repaint the ring away, so every overlay takes a CanvasText outline there. */
const forcedOutline = 'forced-colors:outline-solid forced-colors:outline-1 forced-colors:outline-[CanvasText]';

/**
 * The anchored overlay: the overlay recipe (paper, the 1px --line ring, --radius-overlay), no shadow. The popup
 * itself takes no ring when it holds focus; what is inside shows it.
 */
const overlaySurface = cn('overlay outline-none', forcedOutline);

/**
 * The modal overlay, a dialog or a sheet: the card's shell recipe (grey, --radius-shell, --shell-inset of padding),
 * its edge darkened to the overlay's 1px --line ring so it reads on the scrim. The shell is a grid: the panel takes
 * the first row and the room left, the error and the footer row take what they need under it.
 */
const overlayShell = cn('shell grid-rows-[minmax(0,1fr)] border-line text-text-1 outline-none', forcedOutline);

/** The card's panel recipe inside overlayShell (paper, --radius-panel, rounded on all four corners), as a column that scrolls in its body. */
const overlayPanel = 'panel flex min-h-0 min-w-0 flex-col overflow-hidden';

/** The overlay-motion recipe (styles.css): anchored, it slides --overlay-shift from its trigger; modal, it settles from --scale-overlay. In on --dur-overlay, out on --dur-state. */
const overlayMotion = 'overlay-motion';

/** The scrim behind every modal overlay: ink at 24% in light, black at 64% in dark (--scrim). */
const scrimClass = 'fixed inset-0 z-(--z-overlay) bg-scrim transition-opacity duration-(--dur-overlay) ease-out data-starting-style:opacity-0 data-ending-style:opacity-0 data-ending-style:duration-(--dur-state)';

// ---------- Lists: menus, the command list, select ----------

// The one list recipe every popup list shares, so a menu row, a command row and a select option are one row.
// Rows are --menu-row (32), or --menu-row-sm (28) in a small list; the popup sets --menu-item-h and the rows read it.
// The highlighted row takes the hover wash at --radius-tag, and that wash is the focus indicator: a row inside a
// 4px-padded popup has no room for an offset ring, and two marks on one row would disagree.

/** The list popup: the anchored overlay, 4px of padding, at least --menu-min wide, scrolling past --popup-max. */
const menuPopupClass = cn(
  overlaySurface, overlayMotion,
  'flex max-h-[min(var(--popup-max),var(--available-height))] min-w-(--menu-min) max-w-(--available-width) flex-col overflow-y-auto overscroll-contain p-1 [--menu-item-h:var(--menu-row)]',
  'data-[size=sm]:[--menu-item-h:var(--menu-row-sm)]',
);

/** One row: 13/500, 8px in, the icon 14 and 8px from the label. Highlighted takes the wash; destructive reads in coral's word. */
const menuItemClass = cn(
  'relative flex min-h-(--menu-item-h) w-full cursor-default items-center gap-2 rounded-tag px-2 type-label text-text-1 outline-none select-none data-inset:ps-7',
  'in-data-[size=sm]:type-label-sm',
  '[&_svg]:size-(--icon) [&_svg]:shrink-0 [&_svg]:text-text-3',
  'data-highlighted:bg-hover data-disabled:cursor-not-allowed data-disabled:text-text-disabled data-disabled:[&_svg]:text-text-disabled',
  'data-[variant=destructive]:text-fail-text data-[variant=destructive]:[&_svg]:text-fail-text data-[variant=destructive]:data-highlighted:bg-fail-tint',
  'forced-colors:data-highlighted:outline-solid forced-colors:data-highlighted:outline-2 forced-colors:data-highlighted:-outline-offset-2',
);

/** A checkbox or radio row: the leading 28px column holds the indicator. */
const menuCheckItemClass = cn(menuItemClass, 'ps-7');

/** A group's heading: the caption role in text-2, on the rows' 8px inset. */
const menuLabelClass = 'flex min-h-(--menu-item-h) items-center px-2 type-caption text-text-2 select-none data-inset:ps-7';

/** The hairline between groups, edge to edge of the popup. */
const menuSeparatorClass = '-mx-1 my-1 h-px shrink-0 bg-line-faint';

/** A key cap: mono at the caption's 0.8, a tag radius, a hairline. In a menu, a command row and a tooltip. */

export {
  useOverlayOpen,
  overlayModel,
  overlayOpenChanged,
  overlayMayClose,
  overlayRunStarted,
  overlayRunSettled,
  isThenable,
  closesAfter,
  useDefaultAction,
  useScrollBody,
  overlaySurface,
  overlayShell,
  overlayPanel,
  overlayMotion,
  scrimClass,
  menuPopupClass,
  menuItemClass,
  menuCheckItemClass,
  menuLabelClass,
  menuSeparatorClass,
  type DefaultAction,
};

'use client';

import {Button as ButtonPrimitive} from '@base-ui/react/button';
import {cva, type VariantProps} from 'class-variance-authority';
import {useEffect, useMemo, useRef, type ReactNode, type Ref} from 'react';
import {Icon, Pending} from '#/components/glaze/icon.tsx';
import {cn, controlHeight, mergeClass, mergeRefs} from '#/lib/glaze/utils.ts';

// Glaze's button on Base UI's Button. 32px tall by default, 26 small, 36 large, a 13/500 label.
//
// The primary family is glass (styles.css, glass), one recipe in three keys, and a group leads with exactly one of
// them: primary is ink glass, the default lead. destructive is coral glass, the lead of a group whose action cannot be
// undone. confirm is green glass, the lead when the action says yes to something proposed: approve a tool call,
// accept a change, ship a reviewed deploy. Never two of the family side by side.
//
// Only the primary family is glass. secondary is the plain card surface (styles.css, flat): the panel's paper, its
// hairline and a text-1 label, no sheen, no gradient, no blur, so the one glass pill beside it reads as the next step. ghost is plain: no ring, a wash under the pointer, for a quiet action in a row or a toolbar.
// No variant casts a shadow; the glass's depth is its sheen, dark centre and rim, drawn inside the pill.
//
// pending: waiting on the action it started. The idle label and the pending layer share one grid cell, so the box
// never changes size, and the idle label stays the accessible name; aria-busy says it is working. The pending layer
// shows the arc, a 3/4 ring that turns once per --dur-spin.
//
// Height is max(the size's token, one line plus 8px), so a label at 200% text zoom grows the box instead of spilling,
// while the box keeps an explicit height that a flex row cannot stretch.

const buttonVariants = cva(
  [
    'group/button relative inline-flex max-w-full shrink-0 items-center justify-center gap-1.5 rounded-pill whitespace-nowrap select-none',
    'disabled:cursor-not-allowed data-disabled:cursor-not-allowed aria-busy:cursor-progress',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ],
  {
    variants: {
      variant: {
        primary: 'glass glass-ink',
        destructive: 'glass glass-coral',
        confirm: 'glass glass-green',
        secondary: 'flat',
        'confirm-wash': 'flat wash-ok',
        'destructive-wash': 'flat wash-fail',
        // Plain: no glass. A wash under the pointer and while held, the same press scale as the glass.
        ghost: [
          'bg-transparent text-text-1 transition-[background-color,color,scale] duration-(--dur-press) ease-out',
          'hover:not-data-disabled:bg-hover active:not-data-disabled:bg-pressed active:not-data-disabled:scale-(--scale-press)',
          'data-disabled:not-aria-busy:text-text-disabled',
          'forced-colors:border forced-colors:border-solid forced-colors:border-[ButtonText]',
        ],
      },
      size: {
        sm: `${controlHeight.sm} px-2.5 type-label-sm [&_svg]:size-(--icon-sm)`,
        default: `${controlHeight.default} px-3 type-label [&_svg]:size-(--icon)`,
        lg: `${controlHeight.lg} px-3.5 type-label-lg [&_svg]:size-(--icon-lg)`,
        'icon-sm': 'size-(--control-sm) px-0 [&_svg]:size-(--icon-sm)',
        icon: 'size-(--control) px-0 [&_svg]:size-(--icon)',
        'icon-lg': 'size-(--control-lg) px-0 [&_svg]:size-(--icon-lg)',
      },
    },
    defaultVariants: {variant: 'primary', size: 'default'},
  },
);

type ButtonProps = ButtonPrimitive.Props & VariantProps<typeof buttonVariants> & {
  /**
   * Waiting on the action this button started. The button refuses repeat presses but keeps focus, sets aria-busy and
   * shows the arc. Pass it (true or false) from the first render on any button that can pend: it reserves the arc's
   * room from the start, so the box never changes size.
   */
  pending?: boolean;
  /** An optional pending verb ("Publishing"), shown while pending, never announced. Both labels share one cell. */
  pendingLabel?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
};

/** The pending arc: a 3/4 ring turning once per --dur-spin, still under reduced motion. */
function Arc() {
  return <Icon icon={Pending} data-slot="button-arc" className="animate-spin motion-reduce:animate-none"/>;
}

/** The text a screen reader would name the button by, roughly: text outside aria-hidden parts. */
function visibleName(el: HTMLElement): string {
  const label = el.getAttribute('aria-label') ?? '';
  if (label.trim() || el.getAttribute('aria-labelledby')) return label || 'labelledby';
  let text = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { text += node.textContent ?? ''; return; }
    if (node instanceof Element && node.getAttribute('aria-hidden') === 'true') return;
    if (node instanceof Element && node.getAttribute('role') === 'img') { text += node.getAttribute('aria-label') ?? ''; return; }
    node.childNodes.forEach(walk);
  };
  walk(el);
  return text.trim();
}

/**
 * Development only: a button with no accessible name (an icon size with no aria-label) is announced as just
 * "button". Report it once per render with the element, so the call site can be found from the console.
 */
function useNameCheck() {
  const node = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' || !node.current) return;
    if (!visibleName(node.current)) {
      node.current.setAttribute('data-unnamed', '');
      console.error('Glaze Button has no accessible name. Give it text children, or aria-label on an icon size.', node.current);
    } else node.current.removeAttribute('data-unnamed');
  });
  return node;
}

function Button({className, variant, size, pending, pendingLabel, disabled, focusableWhenDisabled, children, ref, ...props}: ButtonProps) {
  const v = variant ?? 'primary';
  const s = size ?? 'default';
  const iconOnly = s.startsWith('icon');
  const canPend = pending !== undefined;
  const named = useNameCheck();
  const mergedRef = useMemo(() => mergeRefs(ref as Ref<HTMLElement> | undefined, named), [ref, named]);

  // A text label never wraps; a label too long for its container ends in an ellipsis and stays the accessible name.
  const label = typeof children === 'string' ? <span data-slot="button-text" className="min-w-0 truncate">{children}</span> : children;
  const content = canPend
    ? <span data-slot="button-stack" className="grid min-w-0 place-items-center [grid-template-areas:'stack']">
        <span data-slot="button-idle" className={cn('inline-flex max-w-full min-w-0 items-center gap-1.5 [grid-area:stack]', pending && 'opacity-0')}>{label}</span>
        <span data-slot="button-pending" aria-hidden className={cn('inline-flex max-w-full min-w-0 items-center gap-1.5 [grid-area:stack]', !pending && 'invisible')}>
          <Arc/>{iconOnly ? null : typeof pendingLabel === 'string' ? <span className="min-w-0 truncate">{pendingLabel}</span> : pendingLabel ?? label}
        </span>
      </span>
    : label;

  return <ButtonPrimitive
    data-slot="button"
    data-variant={v}
    data-size={s}
    ref={mergedRef}
    disabled={disabled || pending}
    focusableWhenDisabled={pending || focusableWhenDisabled}
    aria-busy={pending || undefined}
    className={mergeClass(buttonVariants({variant: v, size: s}), className)}
    {...props}
  >{content}</ButtonPrimitive>;
}

export {Button, buttonVariants, type ButtonProps};
